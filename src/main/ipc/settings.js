import { ipcMain } from 'electron'
import { getDb } from '../db/index.js'
import { requireOwner, requireStaffOrOwner } from '../session.js'

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
      requireOwner()
      if (!key) throw new Error('Setting key is required')
      getDb()
        .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
        .run(key, value ?? '')
      return { success: true }
    })
  )
}
