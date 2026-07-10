import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { initSchema } from './schema.js'
import { seedData } from './seed.js'
import { runMigrations } from './migrations.js'

let db = null

export function getDb() {
  if (!db) {
    throw new Error('Database not initialized')
  }
  return db
}

export function initDatabase() {
  const dbPath = join(app.getPath('userData'), 'refresh.db')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  initSchema(db)
  seedData(db)
  runMigrations(db)
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
