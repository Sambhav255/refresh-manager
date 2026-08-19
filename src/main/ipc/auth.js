import { ipcMain } from 'electron'
import bcrypt from 'bcryptjs'
import { getDb, hasUsers } from '../db/index.js'
import { getSession, setSession, clearSession } from '../session.js'
import { requireOwner } from '../session.js'
import { writeAudit } from '../audit.js'

function wrap(handler) {
  return async (_event, payload) => {
    try {
      return await handler(payload || {})
    } catch (err) {
      return { success: false, error: err.message }
    }
  }
}

// In-memory PIN throttling (main process only, no schema change).
const MAX_PIN_ATTEMPTS = 5
const PIN_COOLDOWN_MS = 30000
let failedPinAttempts = 0
let lockedUntil = 0

// The owner password is the highest-value credential (gates restore, refunds,
// staff management) — throttle it too, with a stricter cooldown than PINs.
const MAX_PASSWORD_ATTEMPTS = 5
const PASSWORD_COOLDOWN_MS = 60000
let failedPasswordAttempts = 0
let passwordLockedUntil = 0

// Lockout copy derived from the real cooldown, so the message can never drift
// from the constant (it used to say "a few seconds" for a 30-second lock).
function secondsLeft(until) {
  const s = Math.max(1, Math.ceil((until - Date.now()) / 1000))
  if (s >= 60) {
    const m = Math.round(s / 60)
    return `${m} minute${m === 1 ? '' : 's'}`
  }
  return `${s} seconds`
}

// Reject a new PIN if it collides with any existing active staff PIN.
// excludeUserId lets a staff member keep/re-set their own PIN without
// colliding with themselves.
async function assertPinUnique(db, pin, excludeUserId = null) {
  const rows = db
    .prepare(`SELECT id, pin_hash FROM users WHERE role = 'staff' AND is_active = 1`)
    .all()
  for (const row of rows) {
    if (excludeUserId != null && Number(row.id) === Number(excludeUserId)) continue
    if (row.pin_hash && (await bcrypt.compare(pin, row.pin_hash))) {
      throw new Error('That PIN is already in use.')
    }
  }
}

// Admin login is name + password, so active admins must have distinct names
// or the lookup would silently pick one of them.
function assertAdminNameUnique(db, name, excludeUserId = null) {
  const row = db
    .prepare(
      `SELECT id FROM users WHERE role = 'owner' AND is_active = 1 AND name = ? ${
        excludeUserId != null ? 'AND id != ?' : ''
      }`
    )
    .get(...(excludeUserId != null ? [name, excludeUserId] : [name]))
  if (row) throw new Error('An admin with that name already exists.')
}

export function registerAuthHandlers() {
  ipcMain.handle(
    'auth:needs-setup',
    wrap(() => ({ needsSetup: !hasUsers() }))
  )

  ipcMain.handle(
    'auth:setup',
    wrap(async ({ ownerName, password, staffName, staffPin }) => {
      if (hasUsers()) throw new Error('Setup already completed')
      // Names are trimmed before validation AND before insert: login matches on
      // an exact name, so storing "  Owner  " would lock the owner out of a
      // fresh install with no password-reset path. Matches auth:add-admin.
      const owner = typeof ownerName === 'string' ? ownerName.trim() : ''
      const staff = typeof staffName === 'string' ? staffName.trim() : ''
      if (!owner || !password || !staff || !staffPin) {
        throw new Error('All fields are required')
      }
      if (owner.length > 60 || staff.length > 60) {
        throw new Error('Names must be 60 characters or fewer')
      }
      if (password.length < 4) throw new Error('Password must be at least 4 characters')
      if (!/^\d{4}$/.test(staffPin)) throw new Error('Staff PIN must be 4 digits')

      const db = getDb()
      await assertPinUnique(db, staffPin)
      const ownerHash = await bcrypt.hash(password, 10)
      const pinHash = await bcrypt.hash(staffPin, 10)

      const insertOwner = db.prepare(
        `INSERT INTO users (name, role, password_hash) VALUES (?, 'owner', ?)`
      )
      const insertStaff = db.prepare(
        `INSERT INTO users (name, role, pin_hash) VALUES (?, 'staff', ?)`
      )

      // The hasUsers() check above is separated from these inserts by two
      // awaited bcrypt hashes, so two concurrent submits could both pass it.
      // Re-check inside the transaction, where it is atomic.
      const tx = db.transaction(() => {
        if (hasUsers()) throw new Error('Setup already completed')
        const inserted = insertOwner.run(owner, ownerHash)
        insertStaff.run(staff, pinHash)
        return inserted.lastInsertRowid
      })

      const ownerId = tx()
      const created = db.prepare('SELECT id, name, role FROM users WHERE id = ?').get(ownerId)
      setSession(created)
      return {
        success: true,
        user: { userId: created.id, name: created.name, role: created.role }
      }
    })
  )

  ipcMain.handle(
    'auth:login',
    wrap(async ({ pin, username, password }) => {
      const db = getDb()

      if (pin) {
        if (Date.now() < lockedUntil) {
          throw new Error(`Too many attempts. Please try again in ${secondsLeft(lockedUntil)}.`)
        }
        const staff = db
          .prepare(
            `SELECT id, name, role, pin_hash FROM users WHERE role = 'staff' AND is_active = 1`
          )
          .all()
        for (const user of staff) {
          if (user.pin_hash && (await bcrypt.compare(pin, user.pin_hash))) {
            failedPinAttempts = 0
            lockedUntil = 0
            const session = { userId: user.id, name: user.name, role: user.role }
            setSession(session)
            return { success: true, user: session }
          }
        }
        failedPinAttempts += 1
        if (failedPinAttempts >= MAX_PIN_ATTEMPTS) {
          lockedUntil = Date.now() + PIN_COOLDOWN_MS
          failedPinAttempts = 0
          // Say so on the attempt that ARMS the lock — the user used to learn
          // about it only on the next try, after the wait had already started.
          throw new Error(
            `Incorrect PIN. Too many attempts — please try again in ${secondsLeft(lockedUntil)}.`
          )
        }
        const left = MAX_PIN_ATTEMPTS - failedPinAttempts
        throw new Error(
          left <= 2
            ? `Incorrect PIN. ${left} attempt${left === 1 ? '' : 's'} left.`
            : 'Incorrect PIN'
        )
      }

      if (username && password) {
        if (Date.now() < passwordLockedUntil) {
          throw new Error(
            `Too many attempts. Please try again in ${secondsLeft(passwordLockedUntil)}.`
          )
        }
        const owner = db
          .prepare(
            `SELECT id, name, role, password_hash FROM users WHERE role = 'owner' AND is_active = 1 AND name = ?`
          )
          .get(username)
        if (!owner || !(await bcrypt.compare(password, owner.password_hash))) {
          failedPasswordAttempts += 1
          if (failedPasswordAttempts >= MAX_PASSWORD_ATTEMPTS) {
            passwordLockedUntil = Date.now() + PASSWORD_COOLDOWN_MS
            failedPasswordAttempts = 0
            throw new Error(
              `Incorrect password. Too many attempts — please try again in ${secondsLeft(passwordLockedUntil)}.`
            )
          }
          const left = MAX_PASSWORD_ATTEMPTS - failedPasswordAttempts
          throw new Error(
            left <= 2
              ? `Incorrect password. ${left} attempt${left === 1 ? '' : 's'} left.`
              : 'Incorrect password'
          )
        }
        failedPasswordAttempts = 0
        passwordLockedUntil = 0
        const session = { userId: owner.id, name: owner.name, role: owner.role }
        setSession(session)
        return { success: true, user: session }
      }

      // Name the missing field. This fallback used to surface for every empty
      // form, reading like a system fault rather than "you left a box blank".
      if (!pin && !username && !password)
        throw new Error('Enter your PIN, or a username and password')
      if (username && !password) throw new Error('Enter your password')
      if (password && !username) throw new Error('Enter your username')
      throw new Error('Invalid login credentials')
    })
  )

  ipcMain.handle(
    'auth:logout',
    wrap(() => {
      clearSession()
      return { success: true }
    })
  )

  ipcMain.handle(
    'auth:get-session',
    wrap(() => ({ user: getSession() }))
  )

  ipcMain.handle(
    'auth:add-staff',
    wrap(async ({ name, pin }) => {
      const session = requireOwner()
      if (!name || !pin) throw new Error('Name and PIN required')
      if (!/^\d{4}$/.test(pin)) throw new Error('PIN must be 4 digits')
      const db = getDb()
      await assertPinUnique(db, pin)
      const pinHash = await bcrypt.hash(pin, 10)
      const result = db
        .prepare(`INSERT INTO users (name, role, pin_hash) VALUES (?, 'staff', ?)`)
        .run(name, pinHash)
      writeAudit(session.userId, 'staff:add', { userId: result.lastInsertRowid, name })
      return { success: true, userId: result.lastInsertRowid }
    })
  )

  ipcMain.handle(
    'auth:list-staff',
    wrap(() => {
      requireOwner()
      const users = getDb()
        .prepare(
          `SELECT id, name, role, is_active, created_at FROM users WHERE role = 'staff' ORDER BY name`
        )
        .all()
      return { users }
    })
  )

  ipcMain.handle(
    'auth:deactivate-user',
    wrap(({ userId }) => {
      const session = requireOwner()
      getDb().prepare(`UPDATE users SET is_active = 0 WHERE id = ? AND role = 'staff'`).run(userId)
      writeAudit(session.userId, 'staff:deactivate', { userId })
      return { success: true }
    })
  )

  // ---- Multi-admin management -------------------------------------------
  // The business can have several admins (and several staff). Staff already
  // scale (unique PINs, list/add/deactivate); these handlers give admins the
  // same lifecycle, with two safety rails: you cannot deactivate yourself,
  // and you cannot deactivate the last active admin.

  ipcMain.handle(
    'auth:add-admin',
    wrap(async ({ name, password }) => {
      const session = requireOwner()
      if (!name || !name.trim()) throw new Error('Name is required')
      if (!password || password.length < 4) {
        throw new Error('Password must be at least 4 characters')
      }
      const db = getDb()
      const trimmed = name.trim()
      assertAdminNameUnique(db, trimmed)
      const hash = await bcrypt.hash(password, 10)
      const result = db
        .prepare(`INSERT INTO users (name, role, password_hash) VALUES (?, 'owner', ?)`)
        .run(trimmed, hash)
      writeAudit(session.userId, 'admin:add', { userId: result.lastInsertRowid, name: trimmed })
      return { success: true, userId: result.lastInsertRowid }
    })
  )

  ipcMain.handle(
    'auth:list-admins',
    wrap(() => {
      requireOwner()
      const users = getDb()
        .prepare(
          `SELECT id, name, role, is_active, created_at FROM users WHERE role = 'owner' ORDER BY name`
        )
        .all()
      return { users }
    })
  )

  ipcMain.handle(
    'auth:deactivate-admin',
    wrap(({ userId }) => {
      const session = requireOwner()
      if (Number(userId) === Number(session.userId)) {
        throw new Error('You cannot deactivate your own account.')
      }
      const db = getDb()
      const tx = db.transaction(() => {
        const target = db
          .prepare(`SELECT id, is_active FROM users WHERE id = ? AND role = 'owner'`)
          .get(userId)
        if (!target) throw new Error('Admin not found')
        const activeAdmins = db
          .prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND is_active = 1`)
          .get().n
        if (target.is_active && activeAdmins <= 1) {
          throw new Error('At least one active admin is required.')
        }
        db.prepare(`UPDATE users SET is_active = 0 WHERE id = ? AND role = 'owner'`).run(userId)
      })
      tx()
      writeAudit(session.userId, 'admin:deactivate', { userId })
      return { success: true }
    })
  )

  ipcMain.handle(
    'auth:change-admin-password',
    wrap(async ({ currentPassword, newPassword }) => {
      const session = requireOwner()
      if (!newPassword || newPassword.length < 4) {
        throw new Error('New password must be at least 4 characters')
      }
      const db = getDb()
      const me = db
        .prepare(`SELECT id, password_hash FROM users WHERE id = ? AND role = 'owner'`)
        .get(session.userId)
      if (!me || !currentPassword || !(await bcrypt.compare(currentPassword, me.password_hash))) {
        throw new Error('Current password is incorrect')
      }
      const hash = await bcrypt.hash(newPassword, 10)
      db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(hash, session.userId)
      writeAudit(session.userId, 'admin:change-password', { userId: session.userId })
      return { success: true }
    })
  )

  ipcMain.handle(
    'auth:change-pin',
    wrap(async ({ userId, newPin }) => {
      const session = requireOwner()
      if (!/^\d{4}$/.test(newPin)) throw new Error('PIN must be 4 digits')
      const db = getDb()
      await assertPinUnique(db, newPin, userId)
      const pinHash = await bcrypt.hash(newPin, 10)
      db.prepare(`UPDATE users SET pin_hash = ? WHERE id = ? AND role = 'staff'`).run(
        pinHash,
        userId
      )
      writeAudit(session.userId, 'staff:change-pin', { userId })
      return { success: true }
    })
  )

  // ---- Recovery: password / PIN resets ----------------------------------
  // Before this existed the only way back into an install whose admin password
  // had been forgotten was editing users.password_hash by hand — the setup
  // wizard refuses to run a second time once any user exists. These two
  // handlers give an admin who IS signed in a way to restore access for
  // everyone else, without ever weakening the credential checks themselves.

  ipcMain.handle(
    'auth:reset-admin-password',
    wrap(async ({ userId, newPassword }) => {
      const session = requireOwner()
      if (!newPassword || newPassword.length < 4) {
        throw new Error('New password must be at least 4 characters')
      }
      // Resetting your OWN password here would be the one move that can strand
      // the install: this path does not ask for the current password, so an
      // unattended session could be used to change the credential the operator
      // actually knows. Own-password changes go through
      // auth:change-admin-password, which proves the current one first. The
      // consequence is the anti-lockout invariant — the actor's account is
      // never touched, so a working admin login always survives a reset.
      if (Number(userId) === Number(session.userId)) {
        throw new Error('Use "Change my password" to change your own password.')
      }
      const db = getDb()
      const target = db
        .prepare(`SELECT id, name, is_active FROM users WHERE id = ? AND role = 'owner'`)
        .get(userId)
      if (!target) throw new Error('Admin not found')
      // A deactivated account cannot log in at all, so resetting its password
      // hands back nothing — say so rather than let it look like a recovery.
      if (!target.is_active) {
        throw new Error('That admin is deactivated and cannot sign in.')
      }
      const hash = await bcrypt.hash(newPassword, 10)
      db.prepare(`UPDATE users SET password_hash = ? WHERE id = ? AND role = 'owner'`).run(
        hash,
        userId
      )
      // A forgotten password usually means failed attempts, which may have armed
      // the shared cooldown. Recovery that makes you wait a minute is not
      // recovery, and the actor already holds full admin rights.
      failedPasswordAttempts = 0
      passwordLockedUntil = 0
      writeAudit(session.userId, 'admin:reset-password', {
        userId: target.id,
        name: target.name,
        actorName: session.name
      })
      return { success: true }
    })
  )

  ipcMain.handle(
    'auth:reset-staff-pin',
    wrap(async ({ userId, newPin }) => {
      const session = requireOwner()
      if (!/^\d{4}$/.test(String(newPin ?? ''))) throw new Error('PIN must be 4 digits')
      const db = getDb()
      const target = db
        .prepare(`SELECT id, name, is_active FROM users WHERE id = ? AND role = 'staff'`)
        .get(userId)
      if (!target) throw new Error('Staff member not found')
      if (!target.is_active) {
        throw new Error('That staff member is deactivated and cannot sign in.')
      }
      // Same uniqueness rule as add-staff/change-pin: PINs are the only thing
      // that identifies a staff member at login, so a collision would silently
      // attribute one person's sales to another.
      await assertPinUnique(db, newPin, userId)
      const pinHash = await bcrypt.hash(newPin, 10)
      db.prepare(`UPDATE users SET pin_hash = ? WHERE id = ? AND role = 'staff'`).run(
        pinHash,
        userId
      )
      failedPinAttempts = 0
      lockedUntil = 0
      writeAudit(session.userId, 'staff:reset-pin', {
        userId: target.id,
        name: target.name,
        actorName: session.name
      })
      return { success: true }
    })
  )

  // ---- Login roster ------------------------------------------------------
  // Deliberately unauthenticated: the login screen needs it *before* anyone has
  // signed in, so it can only ever return what is safe to show on a locked
  // till. That means ids and display names of active accounts and nothing
  // else — no hashes, no PINs, no timestamps, no members, no money. Picking a
  // name does not authenticate anyone; the PIN/password check is unchanged.
  ipcMain.handle(
    'auth:login-roster',
    wrap(() => {
      const rows = getDb()
        .prepare(
          `SELECT id, name, role FROM users WHERE is_active = 1 AND role IN ('staff','owner') ORDER BY name`
        )
        .all()
      // Grouped rather than role-tagged: the picker needs to know which list a
      // name belongs to, and nothing finer than that.
      return {
        staff: rows.filter((r) => r.role === 'staff').map((r) => ({ id: r.id, name: r.name })),
        admins: rows.filter((r) => r.role === 'owner').map((r) => ({ id: r.id, name: r.name }))
      }
    })
  )
}
