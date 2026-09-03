import { app, ipcMain, dialog, shell } from 'electron'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  statSync,
  openSync,
  readSync,
  closeSync
} from 'fs'
import { join, dirname, basename } from 'path'
import Database from 'better-sqlite3'
import { getDb, closeDatabase, hasUsers } from '../db/index.js'
import {
  writeDailyExport,
  markExportDone,
  markExportFailed
} from '../daily-export.js'
import { getBuildIdentity } from '../build-info.js'
import { getDiagnosticsInfo } from '../diagnostics.js'
import { requireOwner } from '../session.js'
import { packEncrypted, unpackEncrypted, isEncryptedBackup } from '../backup-archive.js'
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

const STALE_MS = 36 * 3600 * 1000

function isStaleAt(isoOrLocal) {
  if (!isoOrLocal) return true
  const s = String(isoOrLocal).trim()
  const parsed = Date.parse(s.includes('T') ? s : s.replace(' ', 'T'))
  if (Number.isNaN(parsed)) return true
  return Date.now() - parsed > STALE_MS
}

function readDiagnosticsBundle() {
  const { logDir, logFile } = getDiagnosticsInfo()
  const parts = []
  parts.push('=== Diagnostics logs ===')
  parts.push(`Log directory: ${logDir}`)
  if (logFile && existsSync(logFile)) {
    parts.push(`--- ${basename(logFile)} ---`)
    parts.push(readFileSync(logFile, 'utf8'))
  } else if (logDir && existsSync(logDir)) {
    const files = readdirSync(logDir)
      .filter((f) => f.startsWith('diagnostics-') && f.endsWith('.log'))
      .sort()
      .reverse()
      .slice(0, 3)
    for (const f of files) {
      parts.push(`--- ${f} ---`)
      parts.push(readFileSync(join(logDir, f), 'utf8'))
    }
  }
  return parts.join('\n')
}

function wrap(handler) {
  return async (_event, payload) => {
    try {
      return await handler(payload || {})
    } catch (err) {
      return { success: false, error: err.message }
    }
  }
}

function photosDir() {
  return join(app.getPath('userData'), 'photos')
}

// 2-F: the owner-set passphrase that encrypts backups (empty ⇒ plaintext).
function getPassphrase(db) {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'backup_passphrase'`).get()
  const v = (row?.value || '').trim()
  return v || null
}

function getBackupFolder(db, destinationPath) {
  if (destinationPath) return destinationPath
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'backup_path'`).get()
  return row?.value || null
}

function backupFilename(encrypted) {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
  return `${BACKUP_PREFIX}${stamp}.${encrypted ? 'rmbak' : 'db'}`
}

function listBackupFiles(folder) {
  if (!folder || !existsSync(folder)) return []
  return readdirSync(folder)
    .filter((f) => f.startsWith(BACKUP_PREFIX) && (f.endsWith('.db') || f.endsWith('.rmbak')))
    .map((f) => {
      const full = join(folder, f)
      const stat = statSync(full)
      return {
        fileName: f,
        filePath: full,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        encrypted: f.endsWith('.rmbak')
      }
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

function updateBackupStatus(db, { status, filePath, encrypted }) {
  // Local time, matching datetime('now','localtime') used everywhere else and
  // the local stamp in the backup filename. toISOString() is UTC, which made a
  // just-finished backup read as hours old and tripped the staleness check early.
  const now = db.prepare(`SELECT datetime('now','localtime') AS now`).get().now
  const set = db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`)
  set.run('last_backup_at', now)
  set.run('last_backup_status', status)
  if (filePath) set.run('last_backup_path', filePath)
  if (encrypted != null) set.run('last_backup_encrypted', encrypted ? 'true' : 'false')
}

// Collect member photos as archive entries (photos/<file>).
function gatherPhotoEntries() {
  const dir = photosDir()
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => !f.startsWith('.'))
    .map((f) => ({ name: `photos/${f}`, data: readFileSync(join(dir, f)) }))
}

export async function performBackup({ destinationPath, skipOwnerCheck = false } = {}) {
  if (!skipOwnerCheck) requireOwner()
  const db = getDb()
  db.pragma('wal_checkpoint(TRUNCATE)')

  const sourcePath = join(app.getPath('userData'), 'refresh.db')
  if (!existsSync(sourcePath)) throw new Error('Database file not found')

  // 2-B: verify the LIVE db before packing, so a corrupt source never becomes a
  // "successful" backup.
  const liveCheck = db.pragma('quick_check')
  if (!(liveCheck.length === 1 && liveCheck[0].quick_check === 'ok')) {
    throw new Error('Live database failed its integrity check — backup aborted.')
  }

  const dest = getBackupFolder(db, destinationPath)
  if (!dest) throw new Error('Backup destination not configured')
  mkdirSync(dest, { recursive: true })

  const passphrase = getPassphrase(db)
  const encrypted = !!passphrase

  const filePath = join(dest, backupFilename(encrypted))
  mkdirSync(dirname(filePath), { recursive: true })

  if (encrypted) {
    // 2-F/2-B: bundle db + photos into one encrypted, authenticated archive.
    const dbBytes = readFileSync(sourcePath)
    const entries = [{ name: 'refresh.db', data: dbBytes }, ...gatherPhotoEntries()]
    const blob = packEncrypted(passphrase, entries)
    writeFileSync(filePath, blob)

    // Verify the written archive round-trips with the passphrase and that the
    // db bytes survived intact (GCM guarantees fidelity; this catches a bad write).
    const check = unpackEncrypted(passphrase, readFileSync(filePath))
    const restoredDb = check.find((e) => e.name === 'refresh.db')
    if (!restoredDb || !restoredDb.data.equals(dbBytes)) {
      try {
        unlinkSync(filePath)
      } catch {
        /* ignore */
      }
      throw new Error('Backup verification failed — the encrypted archive did not round-trip.')
    }
  } else {
    // Plaintext fallback (no passphrase configured): copy the db and quick-check.
    copyFileSync(sourcePath, filePath)
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
  }

  pruneOldBackups(dest)
  updateBackupStatus(db, { status: 'success', filePath, encrypted })

  const today = db.prepare(`SELECT date('now','localtime') AS d`).get().d
  try {
    const excelPath = await writeDailyExport(db, dest, today)
    markExportDone(db, excelPath)
  } catch {
    markExportFailed(db)
  }

  return { success: true, filePath, encrypted }
}

// Write an audit row into a freshly-restored file (which may predate audit_log).
function auditRestore(livePath, session, from) {
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
      .run(session.userId, JSON.stringify({ from, by: session.name }))
    restored.close()
  } catch {
    /* audit is best-effort; never block the restore */
  }
}

function scheduleRelaunch() {
  setTimeout(() => {
    app.relaunch()
    app.exit(0)
  }, 800)
}

export function registerBackupHandlers() {
  ipcMain.handle(
    'backup:create',
    wrap(async (payload) => {
      try {
        return await performBackup(payload)
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
          `SELECT key, value FROM settings WHERE key IN ('last_backup_at','last_backup_path','last_backup_status','last_backup_encrypted','backup_path','backup_schedule','backup_auto_enabled','backup_passphrase','last_excel_at','last_excel_path','last_excel_status')`
        )
        .all()
      const settings = Object.fromEntries(rows.map((r) => [r.key, r.value]))
      return {
        lastBackupAt: settings.last_backup_at || null,
        lastBackupPath: settings.last_backup_path || null,
        status: settings.last_backup_status || null,
        lastBackupEncrypted: settings.last_backup_encrypted === 'true',
        backupPath: settings.backup_path || null,
        schedule: settings.backup_schedule || '23:59',
        autoEnabled: settings.backup_auto_enabled !== 'false',
        // Never return the passphrase itself — just whether one is configured.
        encryptionConfigured: !!(settings.backup_passphrase || '').trim(),
        lastExcelAt: settings.last_excel_at || null,
        lastExcelPath: settings.last_excel_path || null,
        lastExcelStatus: settings.last_excel_status || null,
        excelStale: isStaleAt(settings.last_excel_at),
        backupStale: isStaleAt(settings.last_backup_at)
      }
    })
  )

  ipcMain.handle(
    'backup:pick-folder',
    wrap(async () => {
      if (hasUsers()) requireOwner()
      const e2eFolder = (process.env.REFRESH_E2E_BACKUP_DIR || '').trim()
      if (e2eFolder) {
        getDb()
          .prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('backup_path', ?)`)
          .run(e2eFolder)
        return { success: true, folder: e2eFolder }
      }
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
    wrap(async ({ backupFilePath, password, backupPassphrase }) => {
      const session = requireOwner()
      if (!backupFilePath || !existsSync(backupFilePath)) {
        throw new Error('Backup file not found')
      }
      if (!password) throw new Error('Admin password required')

      const db = getDb()
      // There may be several admins; any active admin's password authorizes a
      // restore (the acting admin is already identified by the session above).
      const admins = db
        .prepare(`SELECT password_hash FROM users WHERE role = 'owner' AND is_active = 1`)
        .all()
      let authorized = false
      for (const admin of admins) {
        if (admin.password_hash && (await bcrypt.compare(password, admin.password_hash))) {
          authorized = true
          break
        }
      }
      if (!authorized) throw new Error('Incorrect admin password')

      const livePath = join(app.getPath('userData'), 'refresh.db')
      const fileBytes = readFileSync(backupFilePath)

      if (isEncryptedBackup(fileBytes)) {
        // 2-F: encrypted archive. Decrypt (wrong passphrase/tamper throws here,
        // before any live data is touched), then validate the contained db.
        const passphrase = (backupPassphrase || '').trim() || getPassphrase(db)
        const entries = unpackEncrypted(passphrase, fileBytes) // throws ⇒ live untouched
        const dbEntry = entries.find((e) => e.name === 'refresh.db')
        if (!dbEntry) throw new Error('Backup archive does not contain a database.')

        // Validate the contained db in a temp file before clobbering live data.
        const probePath = join(app.getPath('userData'), `.restore-probe-${Date.now()}.db`)
        writeFileSync(probePath, dbEntry.data)
        const ok = verifyDatabaseIntegrity(probePath, 'full')
        if (!ok) {
          try {
            unlinkSync(probePath)
          } catch {
            /* ignore */
          }
          throw new Error(
            'Backup failed its integrity check — restore aborted, live data untouched.'
          )
        }

        // Commit: close live, replace db, restore photos.
        db.pragma('wal_checkpoint(TRUNCATE)')
        closeDatabase()
        removeSidecars(livePath)
        copyFileSync(probePath, livePath)
        try {
          unlinkSync(probePath)
        } catch {
          /* ignore */
        }
        removeSidecars(livePath)

        const pDir = photosDir()
        mkdirSync(pDir, { recursive: true })
        for (const e of entries) {
          if (e.name.startsWith('photos/')) {
            writeFileSync(join(pDir, basename(e.name)), e.data)
          }
        }

        auditRestore(livePath, session, backupFilePath)
        scheduleRelaunch()
        return { success: true, willRelaunch: true, encrypted: true }
      }

      // Legacy / plaintext .db backup.
      if (!isSqliteFile(backupFilePath)) {
        throw new Error('Selected file is not a valid database backup.')
      }
      // 2-A: reject a header-valid but corrupt backup before touching live data.
      if (!verifyDatabaseIntegrity(backupFilePath, 'full')) {
        throw new Error('Backup failed its integrity check — restore aborted, live data untouched.')
      }

      db.pragma('wal_checkpoint(TRUNCATE)')
      closeDatabase()
      removeSidecars(livePath)
      copyFileSync(backupFilePath, livePath)
      removeSidecars(livePath)

      auditRestore(livePath, session, backupFilePath)
      scheduleRelaunch()
      return { success: true, willRelaunch: true }
    })
  )

  ipcMain.handle(
    'backup:open-folder',
    wrap(() => {
      requireOwner()
      const db = getDb()
      const folder = getBackupFolder(db)
      if (!folder) throw new Error('Backup folder not configured')
      shell.openPath(folder)
      return { success: true, folder }
    })
  )

  ipcMain.handle(
    'backup:export-logs',
    wrap(async () => {
      requireOwner()
      const identity = getBuildIdentity()
      const result = await dialog.showSaveDialog({
        title: 'Save support bundle',
        defaultPath: `refresh-support-${new Date().toISOString().slice(0, 10)}.txt`,
        filters: [{ name: 'Text', extensions: ['txt'] }]
      })
      if (result.canceled || !result.filePath) {
        return { success: false, cancelled: true }
      }
      const body = [
        '=== Refresh Manager support bundle ===',
        `Generated: ${new Date().toISOString()}`,
        '',
        '=== Version ===',
        `Version: ${identity.version}`,
        `Git SHA: ${identity.gitSha}`,
        `Build date: ${identity.buildDate}`,
        `Electron: ${process.versions.electron}`,
        `Platform: ${process.platform}`,
        '',
        readDiagnosticsBundle()
      ].join('\n')
      writeFileSync(result.filePath, body, 'utf8')
      return { success: true, filePath: result.filePath }
    })
  )
}
