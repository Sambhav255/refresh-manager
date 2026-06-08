import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { initSchema } from './schema.js'
import { seedData } from './seed.js'

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
  return db
}

export function hasUsers() {
  const row = getDb().prepare('SELECT COUNT(*) as count FROM users').get()
  return row.count > 0
}
