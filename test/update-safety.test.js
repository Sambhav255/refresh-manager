import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, existsSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { __setUserDataDir, __getUserDataDir } from 'electron'
import { initDatabase, getDb, closeDatabase } from '../src/main/db/index.js'
import { SCHEMA_VERSION } from '../src/main/db/migrations.js'
import { snapshotBeforeMigration, restoreSnapshot } from '../src/main/db/update-safety.js'

function freshUserData() {
  closeDatabase()
  __setUserDataDir(mkdtempSync(join(tmpdir(), 'refresh-upd-')))
}

describe('update-safety — snapshot / restore primitives', () => {
  beforeEach(freshUserData)

  it('snapshots a consistent copy and restores it byte-for-byte', () => {
    const dbPath = join(__getUserDataDir(), 'refresh.db')
    const db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.exec(`CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)`)
    db.prepare(`INSERT INTO t (id, v) VALUES (1, 'original')`).run()

    const snap = snapshotBeforeMigration(db, dbPath, 3)
    expect(existsSync(snap)).toBe(true)

    // Mutate after the snapshot, then roll back.
    db.prepare(`UPDATE t SET v = 'changed' WHERE id = 1`).run()
    db.close()
    restoreSnapshot(dbPath, snap)

    const reopened = new Database(dbPath)
    expect(reopened.prepare(`SELECT v FROM t WHERE id = 1`).get().v).toBe('original')
    reopened.close()
  })
})

describe('update-safety — initDatabase downgrade guard', () => {
  beforeEach(freshUserData)

  it('refuses a database written by a newer schema version', () => {
    // Craft a DB that looks set up (users table) and claims a future schema.
    const dbPath = join(__getUserDataDir(), 'refresh.db')
    const seed = new Database(dbPath)
    seed.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)`)
    seed.prepare(`INSERT INTO users (name) VALUES ('Owner')`).run()
    seed.pragma(`user_version = ${SCHEMA_VERSION + 5}`)
    seed.close()

    let caught
    try {
      initDatabase()
    } catch (e) {
      caught = e
    }
    expect(caught).toBeTruthy()
    expect(caught.code).toBe('DB_TOO_NEW')
    // Guard fired before touching data.
    const check = new Database(dbPath)
    expect(check.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION + 5)
    check.close()
  })
})

describe('update-safety — initDatabase snapshots before migrating an existing DB', () => {
  beforeEach(freshUserData)

  it('creates a pre-update snapshot when an old populated DB is upgraded', () => {
    // An old install: users table present, user_version 0 (pre-versioning).
    const dbPath = join(__getUserDataDir(), 'refresh.db')
    const old = new Database(dbPath)
    old.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)`)
    old.prepare(`INSERT INTO users (name) VALUES ('Owner')`).run()
    // user_version defaults to 0 → migrations pending.
    old.close()

    initDatabase()
    const db = getDb()
    // Migrated up to current.
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    // A snapshot of the pre-update state exists.
    const snapDir = join(__getUserDataDir(), 'pre-update-backups')
    expect(existsSync(snapDir)).toBe(true)
    expect(readdirSync(snapDir).filter((f) => f.endsWith('.db')).length).toBeGreaterThan(0)
    // Version stamped.
    expect(db.prepare(`SELECT value FROM settings WHERE key='schema_version'`).get().value).toBe(
      String(SCHEMA_VERSION)
    )
  })

  it('does NOT snapshot a brand-new (empty) database', () => {
    initDatabase() // fresh: no users table yet
    const snapDir = join(__getUserDataDir(), 'pre-update-backups')
    // Either the dir was never created, or it holds no snapshots.
    const snaps = existsSync(snapDir) ? readdirSync(snapDir).filter((f) => f.endsWith('.db')) : []
    expect(snaps.length).toBe(0)
  })
})

describe('update-safety — a failing migration rolls the DB back and refuses to start', () => {
  beforeEach(freshUserData)

  it('restores the pre-update snapshot when a migration fails its integrity check', () => {
    // Craft an OLD-schema DB (no booking_deposit CHECK → v1 will rebuild the
    // transactions table) that also contains a PRE-EXISTING dangling foreign key
    // (a membership pointing at a non-existent transaction). The rebuild's own
    // transaction commits, then the runner's post-rebuild foreign_key_check
    // throws — a failure that ONLY a file-level snapshot restore can undo.
    const dbPath = join(__getUserDataDir(), 'refresh.db')
    const old = new Database(dbPath)
    old.pragma('journal_mode = WAL')
    old.pragma('foreign_keys = OFF') // plant a dangling ref that a real old DB could carry
    old.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transaction_type TEXT NOT NULL CHECK(transaction_type IN ('membership','day_package','day_pass','pool_inventory','restaurant')),
        source TEXT NOT NULL DEFAULT 'pool' CHECK(source IN ('pool','restaurant')),
        customer_name TEXT NOT NULL, phone TEXT, product_id INTEGER, member_id INTEGER,
        amount REAL NOT NULL, payment_method TEXT NOT NULL CHECK(payment_method IN ('cash','qr')),
        staff_id INTEGER NOT NULL, notes TEXT, is_voided INTEGER DEFAULT 0,
        void_reason TEXT, void_by INTEGER, void_at TEXT,
        created_at TEXT DEFAULT (datetime('now','localtime'))
      );
      CREATE TABLE memberships (id INTEGER PRIMARY KEY, transaction_id INTEGER REFERENCES transactions(id));
    `)
    old.prepare(`INSERT INTO users (name) VALUES ('Owner')`).run()
    old.prepare(`INSERT INTO settings (key, value) VALUES ('seeded', 'true')`).run()
    old.prepare(`INSERT INTO memberships (id, transaction_id) VALUES (1, 999)`).run() // dangling
    old.close()

    let caught
    try {
      initDatabase()
    } catch (e) {
      caught = e
    }
    expect(caught).toBeTruthy()
    expect(caught.code).toBe('MIGRATION_FAILED')

    // The live file was rolled back: still the old schema at user_version 0,
    // and the data is intact — despite the migration's own transaction having
    // committed before the post-check failed.
    const after = new Database(dbPath)
    expect(after.pragma('user_version', { simple: true })).toBe(0)
    const txnSql = after
      .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='transactions'`)
      .get().sql
    expect(txnSql.includes('booking_deposit')).toBe(false)
    expect(after.prepare(`SELECT COUNT(*) c FROM users`).get().c).toBe(1)
    expect(
      after.prepare(`SELECT transaction_id FROM memberships WHERE id=1`).get().transaction_id
    ).toBe(999)
    after.close()
  })
})
