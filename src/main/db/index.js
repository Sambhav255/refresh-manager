import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { initSchema } from './schema.js'
import { seedData } from './seed.js'
import { runMigrations, SCHEMA_VERSION } from './migrations.js'
import { snapshotBeforeMigration, restoreSnapshot } from './update-safety.js'

let db = null

export function getDb() {
  if (!db) {
    throw new Error('Database not initialized')
  }
  return db
}

function appVersion() {
  try {
    return app.getVersion()
  } catch {
    return 'unknown'
  }
}

// Record the app version + schema version that last opened the DB, and log an
// upgrade to the audit trail. Best-effort — never blocks startup.
function stampVersion(database, fromVersion, toVersion) {
  try {
    const set = database.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`)
    set.run('app_version', appVersion())
    set.run('schema_version', String(toVersion))
    if (fromVersion < toVersion) {
      database
        .prepare(
          `INSERT INTO audit_log (actor_user_id, action, detail) VALUES (NULL, 'app:migrated', ?)`
        )
        .run(
          JSON.stringify({ fromSchema: fromVersion, toSchema: toVersion, appVersion: appVersion() })
        )
    }
  } catch {
    /* ignore */
  }
}

// Open the local database and bring its schema up to date SAFELY: a DB written
// by a newer build is refused (downgrade guard); a populated DB is snapshotted
// before any migration runs; and a failed migration is rolled back to that
// snapshot — so shipping a new version can never crash mid-upgrade with
// corrupted or half-migrated data. Throws a tagged error (see `err.code`) that
// the startup handler turns into a clear dialog.
export function initDatabase() {
  const dbPath = join(app.getPath('userData'), 'refresh.db')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  // Detect a pre-existing (already-set-up) database before initSchema creates
  // any tables, and read its schema version before we touch it.
  const existed = !!db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'`)
    .get()
  const fromVersion = db.pragma('user_version', { simple: true })

  // Downgrade guard: never operate against a schema newer than we understand.
  if (fromVersion > SCHEMA_VERSION) {
    closeDatabase()
    const err = new Error(
      `This data was created by a newer version of Refresh Manager (database v${fromVersion}; this app supports up to v${SCHEMA_VERSION}). Please install the latest version to open it. Your data has not been changed.`
    )
    err.code = 'DB_TOO_NEW'
    throw err
  }

  initSchema(db)
  seedData(db)

  if (existed) {
    const check = db.pragma('quick_check', { simple: true })
    if (check !== 'ok') {
      closeDatabase()
      const err = new Error(
        `Database integrity check failed (${check}). Your data file may be corrupt — contact support or restore from a backup.`
      )
      err.code = 'DB_CORRUPT'
      throw err
    }
  }

  // Snapshot a populated DB before applying any pending migration.
  let snapshotPath = null
  if (existed && fromVersion < SCHEMA_VERSION) {
    try {
      snapshotPath = snapshotBeforeMigration(db, dbPath, fromVersion)
    } catch (e) {
      closeDatabase()
      const err = new Error(
        `Could not create a pre-update safety backup, so the update was stopped to protect your data. Free up disk space and retry, or contact support. (${e.message})`
      )
      err.code = 'SNAPSHOT_FAILED'
      throw err
    }
  }

  try {
    runMigrations(db)
  } catch (e) {
    closeDatabase()
    let restored = false
    if (snapshotPath) {
      try {
        restoreSnapshot(dbPath, snapshotPath)
        restored = true
      } catch {
        /* leave the live file as-is; snapshot on disk is still the recovery point */
      }
    }
    const err = new Error(
      `A database update did not complete and was rolled back. Your data is intact${restored ? ' and has been restored to its pre-update state' : ''}. Please reinstall the previous version of Refresh Manager (your data will open normally) or contact support. Details: ${e.message}`
    )
    err.code = 'MIGRATION_FAILED'
    err.snapshotPath = snapshotPath
    throw err
  }

  stampVersion(db, fromVersion, SCHEMA_VERSION)
  return db
}

export function closeDatabase() {
  if (db) {
    db.close()
    db = null
  }
}

// P2-2: cheap liveness probe used to detect a DB file that has been deleted or
// disconnected while the app is running. Returns true only if the connection is
// open and answers a trivial query.
export function isDatabaseHealthy() {
  try {
    return !!db && db.pragma('quick_check', { simple: true }) === 'ok'
  } catch {
    return false
  }
}

export function hasUsers() {
  const row = getDb().prepare('SELECT COUNT(*) as count FROM users').get()
  return row.count > 0
}
