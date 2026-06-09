import { app, ipcMain, dialog } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { getDb } from '../db/index.js'
import { requireOwner } from '../session.js'
import bcrypt from 'bcryptjs'

const MAX_BACKUPS = 30
const BACKUP_PREFIX = 'refresh_backup_'

function wrap(handler) {
  return async (_event, payload) => {
    try {
      return await handler(payload || {})
    } catch (err) {
      return { success: false, error: err.message }
    }
  }
}

function getBackupFolder(db, destinationPath) {
  if (destinationPath) return destinationPath
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'backup_path'`).get()
  return row?.value || null
}

function backupFilename() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
  return `${BACKUP_PREFIX}${stamp}.db`
}

function listBackupFiles(folder) {
  if (!folder || !existsSync(folder)) return []
  return readdirSync(folder)
    .filter((f) => f.startsWith(BACKUP_PREFIX) && f.endsWith('.db'))
    .map((f) => {
      const full = join(folder, f)
      const stat = statSync(full)
      return { fileName: f, filePath: full, size: stat.size, modifiedAt: stat.mtime.toISOString() }
    })
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
}

function pruneOldBackups(folder) {
  const files = listBackupFiles(folder)
  if (files.length <= MAX_BACKUPS) return
  for (const f of files.slice(MAX_BACKUPS)) {
    try {
      unlinkSync(f.filePath)
    } catch {
      /* ignore */
    }
  }
}

function updateBackupStatus(db, { status, filePath }) {
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ')
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('last_backup_at', ?)`).run(now)
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('last_backup_status', ?)`).run(
    status
  )
  if (filePath) {
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('last_backup_path', ?)`).run(
      filePath
    )
  }
}

export function performBackup({ destinationPath, skipOwnerCheck = false } = {}) {
  if (!skipOwnerCheck) requireOwner()
  const db = getDb()
  db.pragma('wal_checkpoint(TRUNCATE)')

  const sourcePath = join(app.getPath('userData'), 'refresh.db')
  if (!existsSync(sourcePath)) throw new Error('Database file not found')

  const dest = getBackupFolder(db, destinationPath)
  if (!dest) throw new Error('Backup destination not configured')

  const filePath = join(dest, backupFilename())
  mkdirSync(dirname(filePath), { recursive: true })
  copyFileSync(sourcePath, filePath)
  pruneOldBackups(dest)
  updateBackupStatus(db, { status: 'success', filePath })

  return { success: true, filePath }
}

export function registerBackupHandlers() {
  ipcMain.handle(
    'backup:create',
    wrap((payload) => {
      try {
        return performBackup(payload)
      } catch (err) {
        const db = getDb()
        updateBackupStatus(db, { status: 'failed', filePath: '' })
        throw err
      }
    })
  )

  ipcMain.handle(
    'backup:list',
    wrap(() => {
      requireOwner()
      const db = getDb()
      const folder = getBackupFolder(db)
      if (!folder) return { backups: [] }
      return { backups: listBackupFiles(folder) }
    })
  )

  ipcMain.handle(
    'backup:get-status',
    wrap(() => {
      requireOwner()
      const db = getDb()
      const rows = db
        .prepare(
          `SELECT key, value FROM settings WHERE key IN ('last_backup_at','last_backup_path','last_backup_status','backup_path','backup_schedule','backup_auto_enabled')`
        )
        .all()
      const settings = Object.fromEntries(rows.map((r) => [r.key, r.value]))
      return {
        lastBackupAt: settings.last_backup_at || null,
        lastBackupPath: settings.last_backup_path || null,
        status: settings.last_backup_status || null,
        backupPath: settings.backup_path || null,
        schedule: settings.backup_schedule || '23:59',
        autoEnabled: settings.backup_auto_enabled !== 'false'
      }
    })
  )

  ipcMain.handle(
    'backup:pick-folder',
    wrap(async () => {
      requireOwner()
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory', 'createDirectory']
      })
      if (result.canceled || !result.filePaths?.[0]) {
        return { success: false, cancelled: true }
      }
      const folder = result.filePaths[0]
      getDb()
        .prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('backup_path', ?)`)
        .run(folder)
      return { success: true, folder }
    })
  )

  ipcMain.handle(
    'backup:restore',
    wrap(async ({ backupFilePath, password }) => {
      requireOwner()
      if (!backupFilePath || !existsSync(backupFilePath)) {
        throw new Error('Backup file not found')
      }
      if (!password) throw new Error('Owner password required')

      const db = getDb()
      const owner = db
        .prepare(`SELECT password_hash FROM users WHERE role = 'owner' AND is_active = 1 LIMIT 1`)
        .get()
      if (!owner || !(await bcrypt.compare(password, owner.password_hash))) {
        throw new Error('Incorrect owner password')
      }

      db.pragma('wal_checkpoint(TRUNCATE)')
      const livePath = join(app.getPath('userData'), 'refresh.db')
      copyFileSync(backupFilePath, livePath)
      return { success: true }
    })
  )
}
