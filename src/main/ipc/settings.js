import { ipcMain } from 'electron'
import { getDb } from '../db/index.js'
import { requireOwner, requireStaffOrOwner } from '../session.js'
import { writeAudit } from '../audit.js'

// Setting keys whose values are secrets/PII — audit that they changed, but
// never record the value itself.
// Secrets that live in the settings table. backup_passphrase is stored in
// PLAINTEXT because it has to encrypt and decrypt backups; recovery_code_hash
// is a bcrypt hash but is still a credential. Neither may leave the main
// process — they are excluded from settings:get-all and from audit details.
const SENSITIVE_SETTING_KEYS = new Set(['backup_passphrase', 'recovery_code_hash'])

function wrap(handler) {
  return async (_event, payload) => {
    try {
      return await handler(payload || {})
    } catch (err) {
      return { success: false, error: err.message }
    }
  }
}

export function registerSettingsHandlers() {
  ipcMain.handle(
    'settings:get-all',
    // Every screen that needs settings calls this, including staff-facing ones,
    // so it is reachable with a 4-digit PIN. It used to return every row —
    // which handed any staff member the plaintext backup passphrase, and with
    // it the ability to decrypt a backup of the whole business. Secrets are now
    // withheld and reported only as "is it set", which is all any screen
    // actually needs; the main process reads the real values from the table
    // directly.
    wrap(() => {
      requireStaffOrOwner()
      const rows = getDb().prepare('SELECT key, value FROM settings').all()
      const settings = {}
      const configured = {}
      for (const row of rows) {
        if (SENSITIVE_SETTING_KEYS.has(row.key)) {
          configured[row.key] = !!String(row.value ?? '').trim()
          continue
        }
        settings[row.key] = row.value
      }
      return { settings, configured }
    })
  )

  ipcMain.handle(
    'settings:set',
    wrap(({ key, value }) => {
      const session = requireOwner()
      if (!key) throw new Error('Setting key is required')
      getDb()
        .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
        .run(key, value ?? '')
      // 2-E: record that a setting changed (never the value for sensitive keys).
      const detail = SENSITIVE_SETTING_KEYS.has(key) ? { key } : { key, value: value ?? '' }
      writeAudit(session.userId, 'settings:set', detail)
      return { success: true }
    })
  )
}
