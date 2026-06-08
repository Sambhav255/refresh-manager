import { app, ipcMain } from 'electron'
import { copyFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { getDb } from '../db/index.js'
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

export function registerBackupHandlers() {
  ipcMain.handle(
    'backup:create',
    wrap(({ destinationPath } = {}) => {
      requireOwner()
      const db = getDb()
      db.pragma('wal_checkpoint(TRUNCATE)')

      const sourcePath = join(app.getPath('userData'), 'refresh.db')
      if (!existsSync(sourcePath)) throw new Error('Database file not found')

      let dest = destinationPath
      if (!dest) {
        const row = db.prepare(`SELECT value FROM settings WHERE key = 'backup_path'`).get()
        dest = row?.value
      }
      if (!dest) throw new Error('Backup destination not configured')

      const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
      const filePath = join(dest, `refresh_backup_${timestamp}.db`)

      mkdirSync(dirname(filePath), { recursive: true })
      copyFileSync(sourcePath, filePath)

      return { success: true, filePath }
    })
  )
}
