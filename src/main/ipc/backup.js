import { app, ipcMain, dialog } from 'electron'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
  statSync,
  openSync,
  readSync,
  closeSync
} from 'fs'
import { join, dirname } from 'path'
import Database from 'better-sqlite3'
import { getDb, closeDatabase } from '../db/index.js'
import { requireOwner } from '../session.js'
import bcrypt from 'bcryptjs'

const SQLITE_MAGIC = 'SQLite format 3\0'

// Cheap validity check: a real SQLite file starts with a fixed 16-byte header.
function isSqliteFile(filePath) {
  let fd
  try {
    fd = openSync(filePath, 'r')
    const buf = Buffer.alloc(16)
    const read = readSync(fd, buf, 0, 16, 0)
    return read === 16 && buf.toString('binary') === SQLITE_MAGIC
  } catch {
    return false
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

// 2-A / 2-B: a valid header does not mean a valid database. Open the file in a
// throwaway read-only connection and run an integrity pragma. `full` is the
// thorough integrity_check (used before a restore clobbers live data); `quick`
// is the cheaper quick_check (used to verify a freshly-written backup).
function verifyDatabaseIntegrity(filePath, mode = 'full') {
  const pragma = mode === 'quick' ? 'quick_check' : 'integrity_check'
  let probe
  try {
    probe = new Database(filePath, { readonly: true, fileMustExist: true })
    const rows = probe.pragma(pragma)
    return rows.length === 1 && (rows[0].integrity_check === 'ok' || rows[0].quick_check === 'ok')
  } catch {
    return false
  } finally {
    if (probe) probe.close()
  }
}

function removeSidecars(dbPath) {
  for (const suffix of ['-wal', '-shm']) {
    const sidecar = `${dbPath}${suffix}`
    if (existsSync(sidecar)) {
      try {
        unlinkSync(sidecar)
      } catch {
        /* ignore */
      }
    }
  }
}

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

  // 2-B: never report success for a backup that isn't a readable database. A
  // silently-corrupt live DB would otherwise produce silently-corrupt backups.
  if (!verifyDatabaseIntegrity(filePath, 'quick')) {
    try {
      unlinkSync(filePath)
    } catch {
      /* ignore */
    }
    throw new Error(
      'Backup verification failed — the written file did not pass an integrity check.'
    )
  }

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
      const session = requireOwner()
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

      // Reject a corrupt/non-SQLite file BEFORE touching the live DB, so a bad
      // restore leaves the current data intact.
      if (!isSqliteFile(backupFilePath)) {
        throw new Error('Selected file is not a valid database backup.')
      }

      // 2-A: a valid header is not enough — a header-valid but corrupt backup
      // would overwrite good data with garbage. Run a full integrity_check on
      // the backup in a read-only probe and abort (live DB untouched) unless ok.
      if (!verifyDatabaseIntegrity(backupFilePath, 'full')) {
        throw new Error('Backup failed its integrity check — restore aborted, live data untouched.')
      }

      const livePath = join(app.getPath('userData'), 'refresh.db')

      // Flush and fully close the live connection so we can replace the file
      // (Windows locks it while open) and so no stale WAL replays over it.
      db.pragma('wal_checkpoint(TRUNCATE)')
      closeDatabase()
      removeSidecars(livePath)

      copyFileSync(backupFilePath, livePath)

      // Defensive: a checkpointed backup shouldn't carry sidecars, but if the
      // copy brought any along, clear them so the restored file is authoritative.
      removeSidecars(livePath)

      // 2-E: record the restore in the RESTORED file (a restore rewrites the
      // whole ledger behind one password — that must be tamper-evident). The
      // backup may predate audit_log, so ensure the table exists first.
      try {
        const restored = new Database(livePath)
        restored.exec(`
          CREATE TABLE IF NOT EXISTS audit_log (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            actor_user_id INTEGER,
            action        TEXT NOT NULL,
            detail        TEXT,
            created_at    TEXT DEFAULT (datetime('now','localtime'))
          );
        `)
        restored
          .prepare(
            `INSERT INTO audit_log (actor_user_id, action, detail) VALUES (?, 'backup:restore', ?)`
          )
          .run(session.userId, JSON.stringify({ from: backupFilePath, by: session.name }))
        restored.close()
      } catch {
        /* audit is best-effort; never block the restore */
      }

      // Reopen cleanly against the restored file on the next launch.
      setTimeout(() => {
        app.relaunch()
        app.exit(0)
      }, 800)

      return { success: true, willRelaunch: true }
    })
  )
}
