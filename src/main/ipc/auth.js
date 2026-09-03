import { ipcMain } from 'electron'
import { randomBytes } from 'crypto'
import bcrypt from 'bcryptjs'
import { getDb, hasUsers } from '../db/index.js'
import { getSession, setSession, clearSession } from '../session.js'
import { requireOwner, requireSession, requireStaffOrOwner } from '../session.js'
import { writeAudit } from '../audit.js'
import { cartHasItems, setCartGuard } from '../cart-guard.js'

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

// auth:recover-with-code is unauthenticated by necessity — it is the one door a
// locked-out owner can reach before any session exists. Guessing is therefore
// the entire attack surface, so it gets fewer tries and a far longer cooldown
// than the password path. (Like the throttles above this lives in memory only,
// so it resets on relaunch; the code's own entropy, not this counter, is what
// makes brute force hopeless. The counter just stops someone sitting at the
// till from grinding away.)
const MAX_RECOVERY_ATTEMPTS = 3
const RECOVERY_COOLDOWN_MS = 15 * 60 * 1000
let failedRecoveryAttempts = 0
let recoveryLockedUntil = 0

// The recovery code lives in `settings` — no schema change, and it travels with
// a backup/restore exactly like every other install-level setting.
const RECOVERY_HASH_KEY = 'recovery_code_hash'
const RECOVERY_ISSUED_KEY = 'recovery_code_issued_at'

// 0/O, 1/I/L and U are all missing: this code's whole job is to be copied onto
// paper by hand and typed back months later, possibly by someone else, so a
// character that can be misread is a character that can strand the business.
const RECOVERY_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ'
const RECOVERY_GROUPS = 4
const RECOVERY_GROUP_LEN = 5

// 20 characters from a 30-symbol alphabet ~= 98 bits. Deliberately far more
// than a password needs: this one is never typed under time pressure and never
// has to be memorised, so entropy is free here in a way it never is elsewhere.
function generateRecoveryCode() {
  const len = RECOVERY_GROUPS * RECOVERY_GROUP_LEN
  const n = RECOVERY_ALPHABET.length
  // 256 is not a multiple of 30, so a plain `% n` would make the first few
  // symbols slightly likelier. Reject the biased tail instead of skewing.
  const limit = Math.floor(256 / n) * n
  const chars = []
  while (chars.length < len) {
    for (const byte of randomBytes(len)) {
      if (byte >= limit) continue
      chars.push(RECOVERY_ALPHABET[byte % n])
      if (chars.length === len) break
    }
  }
  const groups = []
  for (let i = 0; i < len; i += RECOVERY_GROUP_LEN) {
    groups.push(chars.slice(i, i + RECOVERY_GROUP_LEN).join(''))
  }
  return groups.join('-')
}

// Hash and compare the bare characters, never the dashed display form: the
// grouping is a reading aid, so someone typing it without dashes, in lower
// case, or with stray spaces must still get in.
function normalizeRecoveryCode(raw) {
  return String(raw ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

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
    wrap(async ({ ownerName, password, staffName, staffPin, backupPath }) => {
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
      const folder = typeof backupPath === 'string' ? backupPath.trim() : ''
      if (!folder) throw new Error('Backup folder is required before first use')

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
      db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('backup_path', ?)`).run(
        folder
      )
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
      setCartGuard(false)
      return { success: true }
    })
  )

  ipcMain.handle(
    'auth:set-cart-guard',
    wrap(({ hasItems }) => {
      requireStaffOrOwner()
      setCartGuard(!!hasItems)
      return { success: true }
    })
  )

  ipcMain.handle(
    'auth:switch-staff-pin',
    wrap(async ({ pin }) => {
      const session = requireSession()
      if (session.role !== 'staff') {
        throw new Error('Only staff can switch accounts this way')
      }
      if (cartHasItems()) {
        throw new Error('Finish or clear the current sale before switching staff')
      }
      if (Date.now() < lockedUntil) {
        throw new Error(`Too many attempts. Please try again in ${secondsLeft(lockedUntil)}.`)
      }
      if (!/^\d{4}$/.test(String(pin ?? ''))) {
        throw new Error('Enter a 4-digit PIN')
      }

      const db = getDb()
      const staff = db
        .prepare(
          `SELECT id, name, role, pin_hash FROM users WHERE role = 'staff' AND is_active = 1`
        )
        .all()
      for (const user of staff) {
        if (user.pin_hash && (await bcrypt.compare(pin, user.pin_hash))) {
          failedPinAttempts = 0
          lockedUntil = 0
          const next = { userId: user.id, name: user.name, role: user.role }
          setSession(next)
          writeAudit(session.userId, 'staff:switch-pin', {
            fromUserId: session.userId,
            toUserId: next.userId,
            toName: next.name
          })
          return { success: true, user: next }
        }
      }

      failedPinAttempts += 1
      if (failedPinAttempts >= MAX_PIN_ATTEMPTS) {
        lockedUntil = Date.now() + PIN_COOLDOWN_MS
        failedPinAttempts = 0
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

  // ---- Last-resort recovery code -----------------------------------------
  // Every reset above needs an admin who is ALREADY signed in. If the business
  // runs on one admin account and that password is forgotten, none of them
  // help: the setup wizard refuses to run a second time, so the only route left
  // was editing users.password_hash by hand. That happened once already.
  //
  // The way back is a code generated in advance, shown exactly once, written on
  // paper and kept off the machine. It is an authentication bypass, so it is
  // kept as narrow as it can be and still work:
  //   - only a bcrypt hash is ever stored, so the database cannot give it back;
  //   - issuing one costs the current password, so an unattended till cannot be
  //     used to mint a permanent spare key;
  //   - it is spent on first success, and re-issuing kills the previous one;
  //   - it sets a password and nothing else — no session, no new account, no
  //     rights beyond "you may now sign in normally".

  ipcMain.handle(
    'auth:has-recovery-code',
    wrap(() => {
      // Deliberately callable with no session: the login screen has to decide
      // whether to offer "I've lost my password" before anyone has signed in.
      // All it discloses is that a code exists — never the code, and nothing
      // about which accounts exist. Same reasoning as auth:login-roster.
      const db = getDb()
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(RECOVERY_HASH_KEY)
      if (!row?.value) return { exists: false }
      // When it was issued is only useful to someone already inside, so it is
      // the one part gated on a session.
      if (getSession()?.role !== 'owner') return { exists: true }
      const at = db.prepare('SELECT value FROM settings WHERE key = ?').get(RECOVERY_ISSUED_KEY)
      return { exists: true, issuedAt: at?.value || null }
    })
  )

  ipcMain.handle(
    'auth:issue-recovery-code',
    wrap(async ({ currentPassword }) => {
      const session = requireOwner()
      const db = getDb()
      const me = db
        .prepare(`SELECT id, password_hash FROM users WHERE id = ? AND role = 'owner'`)
        .get(session.userId)
      // Holding a session is not enough. This mints a key that outlives the
      // session, works from the login screen, and can be carried out of the
      // building — so it costs the password, exactly like changing one.
      if (!me || !currentPassword || !(await bcrypt.compare(currentPassword, me.password_hash))) {
        throw new Error('Current password is incorrect')
      }
      const code = generateRecoveryCode()
      const hash = await bcrypt.hash(normalizeRecoveryCode(code), 10)
      const issuedAt = db.prepare(`SELECT datetime('now','localtime') AS t`).get().t
      const put = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      // Only ever one live code: overwriting the hash is what cancels the old
      // one, so a code that was written down last year stops working the moment
      // a replacement is generated.
      db.transaction(() => {
        put.run(RECOVERY_HASH_KEY, hash)
        put.run(RECOVERY_ISSUED_KEY, issuedAt)
      })()
      writeAudit(session.userId, 'admin:recovery-code-issued', {
        actorName: session.name,
        issuedAt
      })
      // The only moment the plaintext exists anywhere but the owner's paper.
      return { success: true, code, issuedAt }
    })
  )

  ipcMain.handle(
    'auth:recover-with-code',
    wrap(async ({ code, adminName, newPassword }) => {
      if (Date.now() < recoveryLockedUntil) {
        throw new Error(
          `Too many attempts. Please try again in ${secondsLeft(recoveryLockedUntil)}.`
        )
      }
      const db = getDb()
      const stored = db.prepare('SELECT value FROM settings WHERE key = ?').get(RECOVERY_HASH_KEY)
      // Nothing to guess when no code was ever issued, so this is not a failed
      // attempt — and saying so plainly beats letting the owner retype a code
      // that could never have worked.
      if (!stored?.value) {
        throw new Error('No recovery code has been set up on this computer.')
      }
      if (!newPassword || newPassword.length < 4) {
        throw new Error('New password must be at least 4 characters')
      }

      const supplied = normalizeRecoveryCode(code)
      const codeOk = supplied.length > 0 && (await bcrypt.compare(supplied, stored.value))
      const wanted = typeof adminName === 'string' ? adminName.trim() : ''
      const target = db
        .prepare(`SELECT id, name FROM users WHERE role = 'owner' AND is_active = 1 AND name = ?`)
        .get(wanted)

      if (!codeOk || !target) {
        failedRecoveryAttempts += 1
        // Audited precisely BECAUSE it failed: an unexplained attempt to force
        // the recovery door is the single most important thing an owner could
        // find in this log. The reason is recorded for admins to read and is
        // never returned to the caller.
        writeAudit(null, 'admin:recovery-failed', {
          reason: codeOk ? 'unknown-admin' : 'bad-code',
          adminName: wanted.slice(0, 60) || null,
          attempt: failedRecoveryAttempts
        })
        if (failedRecoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
          recoveryLockedUntil = Date.now() + RECOVERY_COOLDOWN_MS
          failedRecoveryAttempts = 0
          throw new Error(
            `That recovery code is not valid. Too many attempts — please try again in ${secondsLeft(recoveryLockedUntil)}.`
          )
        }
        // One message covers a wrong code AND an admin name that does not
        // exist. Splitting them would turn the one unauthenticated write
        // endpoint in the app into an account-name oracle.
        throw new Error('That recovery code is not valid.')
      }

      const hash = await bcrypt.hash(newPassword, 10)
      db.transaction(() => {
        db.prepare(`UPDATE users SET password_hash = ? WHERE id = ? AND role = 'owner'`).run(
          hash,
          target.id
        )
        // Single use, spent in the same transaction that sets the password, so
        // there is no window where the password changed but the code still
        // works — or the reverse.
        db.prepare('DELETE FROM settings WHERE key IN (?, ?)').run(
          RECOVERY_HASH_KEY,
          RECOVERY_ISSUED_KEY
        )
      })()

      failedRecoveryAttempts = 0
      recoveryLockedUntil = 0
      // Anyone reaching this point got here through failed logins, which will
      // have armed the password cooldown. Recovery that then makes you wait a
      // minute is not recovery.
      failedPasswordAttempts = 0
      passwordLockedUntil = 0

      writeAudit(null, 'admin:recovery-used', { userId: target.id, name: target.name })
      // No setSession, on purpose: the code buys a password, not a way in.
      // Whoever used it still has to sign in with what they just chose.
      return { success: true, name: target.name }
    })
  )
}
