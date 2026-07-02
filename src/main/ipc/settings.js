import { ipcMain } from 'electron'
import { getDb } from '../db/index.js'
import { requireOwner, requireStaffOrOwner } from '../session.js'
import { writeAudit } from '../audit.js'

// Setting keys whose values are secrets/PII — audit that they changed, but
// never record the value itself.
const SENSITIVE_SETTING_KEYS = new Set(['backup_passphrase'])

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
    wrap(() => {
      requireStaffOrOwner()
      const rows = getDb().prepare('SELECT key, value FROM settings').all()
      const settings = {}
      for (const row of rows) {
        settings[row.key] = row.value
      }
      return { settings }
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
