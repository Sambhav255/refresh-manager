import { ipcMain } from 'electron'
import bcrypt from 'bcryptjs'
import { getDb, hasUsers } from '../db/index.js'
import { getSession, setSession, clearSession } from '../session.js'
import { requireOwner } from '../session.js'

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

export function registerAuthHandlers() {
  ipcMain.handle(
    'auth:needs-setup',
    wrap(() => ({ needsSetup: !hasUsers() }))
  )

  ipcMain.handle(
    'auth:setup',
    wrap(async ({ ownerName, password, staffName, staffPin }) => {
      if (hasUsers()) throw new Error('Setup already completed')
      if (!ownerName || !password || !staffName || !staffPin) {
        throw new Error('All fields are required')
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

      const tx = db.transaction(() => {
        const owner = insertOwner.run(ownerName, ownerHash)
        insertStaff.run(staffName, pinHash)
        return owner.lastInsertRowid
      })

      const ownerId = tx()
      const owner = db.prepare('SELECT id, name, role FROM users WHERE id = ?').get(ownerId)
      setSession(owner)
      return { success: true, user: { userId: owner.id, name: owner.name, role: owner.role } }
    })
  )

  ipcMain.handle(
    'auth:login',
    wrap(async ({ pin, username, password }) => {
      const db = getDb()

      if (pin) {
        if (Date.now() < lockedUntil) {
          throw new Error('Too many attempts. Please try again in a few seconds.')
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
        }
        throw new Error('Incorrect PIN')
      }

      if (username && password) {
        const owner = db
          .prepare(
            `SELECT id, name, role, password_hash FROM users WHERE role = 'owner' AND is_active = 1 AND name = ?`
          )
          .get(username)
        if (!owner || !(await bcrypt.compare(password, owner.password_hash))) {
          throw new Error('Incorrect password')
        }
        const session = { userId: owner.id, name: owner.name, role: owner.role }
        setSession(session)
        return { success: true, user: session }
      }

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
      requireOwner()
      if (!name || !pin) throw new Error('Name and PIN required')
      if (!/^\d{4}$/.test(pin)) throw new Error('PIN must be 4 digits')
      const db = getDb()
      await assertPinUnique(db, pin)
      const pinHash = await bcrypt.hash(pin, 10)
      const result = db
        .prepare(`INSERT INTO users (name, role, pin_hash) VALUES (?, 'staff', ?)`)
        .run(name, pinHash)
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
      requireOwner()
      getDb().prepare(`UPDATE users SET is_active = 0 WHERE id = ? AND role = 'staff'`).run(userId)
      return { success: true }
    })
  )

  ipcMain.handle(
    'auth:change-pin',
    wrap(async ({ userId, newPin }) => {
      requireOwner()
      if (!/^\d{4}$/.test(newPin)) throw new Error('PIN must be 4 digits')
      const db = getDb()
      await assertPinUnique(db, newPin, userId)
      const pinHash = await bcrypt.hash(newPin, 10)
      db.prepare(`UPDATE users SET pin_hash = ? WHERE id = ? AND role = 'staff'`).run(
        pinHash,
        userId
      )
      return { success: true }
    })
  )
}
