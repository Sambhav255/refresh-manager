import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { __invoke, __setUserDataDir } from 'electron'
import { initDatabase, getDb, closeDatabase } from '../src/main/db/index.js'
import { runMigrations, SCHEMA_VERSION } from '../src/main/db/migrations.js'
import { freshDb, seed, loginOwner, loginStaff } from './helpers.js'

// Database-level uniqueness (last line of defence behind the handler checks).
// The handlers give the friendly error; these indexes catch direct DB access,
// future code paths and races.

const UNIQUE_INDEXES = [
  'idx_check_ins_member_day',
  'idx_pool_items_name_variant_active',
  'idx_rest_items_name_active',
  'idx_members_name_phone'
]

function indexNames(db) {
  return db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`)
    .all()
    .map((r) => r.name)
}

describe('schema constraints — indexes exist on a fresh database', () => {
  it('creates every uniqueness index and lands on the current schema version', () => {
    const db = freshDb()
    seed(db)
    const names = indexNames(db)
    for (const idx of UNIQUE_INDEXES) expect(names).toContain(idx)
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
  })
})

describe('schema constraints — check_ins: one per member per local day', () => {
  let db
  let ids
  beforeEach(() => {
    db = freshDb()
    ids = seed(db)
    loginStaff(ids)
  })

  function addMember(name, phone = null) {
    return db.prepare(`INSERT INTO members (name, phone) VALUES (?, ?)`).run(name, phone)
      .lastInsertRowid
  }

  it('rejects a second check-in for the same member on the same day', () => {
    const memberId = addMember('Ram')
    const insert = db.prepare(
      `INSERT INTO check_ins (member_id, checked_in_at, staff_id, source) VALUES (?, ?, ?, 'member')`
    )
    insert.run(memberId, '2026-03-01 09:00:00', ids.staffId)
    expect(() => insert.run(memberId, '2026-03-01 18:30:00', ids.staffId)).toThrow(/UNIQUE/i)
    // A different local day for the same member is fine.
    expect(() => insert.run(memberId, '2026-03-02 09:00:00', ids.staffId)).not.toThrow()
    // Same day, different member is fine.
    const other = addMember('Sita')
    expect(() => insert.run(other, '2026-03-01 09:05:00', ids.staffId)).not.toThrow()
  })

  it('does NOT collide walk-in (NULL member_id) check-ins with each other', () => {
    const insert = db.prepare(
      `INSERT INTO check_ins (member_id, checked_in_at, staff_id, source) VALUES (NULL, ?, ?, 'walkin')`
    )
    for (let i = 0; i < 5; i++) {
      expect(() => insert.run(`2026-03-01 1${i}:00:00`, ids.staffId)).not.toThrow()
    }
    expect(
      db
        .prepare(`SELECT COUNT(*) c FROM check_ins WHERE member_id IS NULL AND date(checked_in_at) = '2026-03-01'`)
        .get().c
    ).toBe(5)
  })

  it('leaves the handler in charge of the friendly repeat-check-in response', async () => {
    const memberId = addMember('Hari')
    const first = await __invoke('checkins:create', { memberId })
    expect(first.success).toBe(true)
    expect(first.alreadyCheckedIn).toBe(false)
    // Second tap: the handler short-circuits, so the index never has to fire and
    // reception sees no error.
    const second = await __invoke('checkins:create', { memberId })
    expect(second.success).toBe(true)
    expect(second.alreadyCheckedIn).toBe(true)
    expect(second.id).toBe(first.id)
    expect(db.prepare(`SELECT COUNT(*) c FROM check_ins WHERE member_id = ?`).get(memberId).c).toBe(
      1
    )
  })
})

describe('schema constraints — pool_inventory_items: unique (name, variant) among ACTIVE rows', () => {
  let db
  beforeEach(() => {
    db = freshDb()
    seed(db)
  })

  const insertItem = (d, name, variant, isActive = 1) =>
    d
      .prepare(
        `INSERT INTO pool_inventory_items (name, category, variant, is_active) VALUES (?, 'gear', ?, ?)`
      )
      .run(name, variant, isActive)

  it('rejects a duplicate active (name, variant)', () => {
    insertItem(db, 'Cap', 'Blue')
    expect(() => insertItem(db, 'Cap', 'Blue')).toThrow(/UNIQUE/i)
    // A different variant is a different item.
    expect(() => insertItem(db, 'Cap', 'Red')).not.toThrow()
  })

  it('treats a NULL variant and an empty-string variant as the same key', () => {
    insertItem(db, 'Towel', null)
    expect(() => insertItem(db, 'Towel', '')).toThrow(/UNIQUE/i)
    expect(() => insertItem(db, 'Towel', null)).toThrow(/UNIQUE/i)
  })

  it('still allows a duplicate when one row is INACTIVE (re-adding a retired item)', () => {
    insertItem(db, 'Float', 'Large', 0)
    expect(() => insertItem(db, 'Float', 'Large', 1)).not.toThrow()
    // ...and any number of retired rows may share the key.
    expect(() => insertItem(db, 'Float', 'Large', 0)).not.toThrow()
    // But not a second ACTIVE one.
    expect(() => insertItem(db, 'Float', 'Large', 1)).toThrow(/UNIQUE/i)
  })

  it('lets retiring the active row free the key up again', () => {
    const id = insertItem(db, 'Kickboard', null).lastInsertRowid
    expect(() => insertItem(db, 'Kickboard', null)).toThrow(/UNIQUE/i)
    db.prepare(`UPDATE pool_inventory_items SET is_active = 0 WHERE id = ?`).run(id)
    expect(() => insertItem(db, 'Kickboard', null)).not.toThrow()
  })
})

describe('schema constraints — restaurant_inventory_items: unique name among ACTIVE rows', () => {
  let db
  beforeEach(() => {
    db = freshDb()
    seed(db)
  })

  const insertItem = (name, isActive = 1) =>
    db
      .prepare(
        `INSERT INTO restaurant_inventory_items (name, category, is_active) VALUES (?, 'bev', ?)`
      )
      .run(name, isActive)

  it('rejects a duplicate active name', () => {
    insertItem('Sugar')
    expect(() => insertItem('Sugar')).toThrow(/UNIQUE/i)
  })

  it('still allows a duplicate when one row is INACTIVE', () => {
    insertItem('Cocoa', 0)
    expect(() => insertItem('Cocoa', 1)).not.toThrow()
    expect(() => insertItem('Cocoa', 1)).toThrow(/UNIQUE/i)
  })
})

describe('schema constraints — members: unique (name, phone) where phone is set', () => {
  let db
  beforeEach(() => {
    db = freshDb()
    seed(db)
  })

  const insertMember = (name, phone) =>
    db.prepare(`INSERT INTO members (name, phone) VALUES (?, ?)`).run(name, phone)

  it('rejects the same person entered twice', () => {
    insertMember('Ram Bahadur', '9800000001')
    expect(() => insertMember('Ram Bahadur', '9800000001')).toThrow(/UNIQUE/i)
  })

  it('allows two real people who share a name but not a phone', () => {
    insertMember('Ram Bahadur', '9800000001')
    expect(() => insertMember('Ram Bahadur', '9800000002')).not.toThrow()
  })

  it('does not collide members with no phone recorded', () => {
    expect(() => insertMember('Anonymous', null)).not.toThrow()
    expect(() => insertMember('Anonymous', null)).not.toThrow()
    expect(db.prepare(`SELECT COUNT(*) c FROM members WHERE name = 'Anonymous'`).get().c).toBe(2)
  })

  it('does not fire the index through the members:create handler for distinct people', async () => {
    const ids = seed.length ? null : null // (seed already ran in beforeEach)
    void ids
    loginOwner({ ownerId: db.prepare(`SELECT id FROM users WHERE role='owner'`).get().id })
    const a = await __invoke('members:create', { name: 'Gita Rai', phone: '9811111111' })
    const b = await __invoke('members:create', { name: 'Gita Rai', phone: '9822222222' })
    expect(a.success).toBe(true)
    expect(b.success).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Migration behaviour against pre-existing (dirty) production data.
// ---------------------------------------------------------------------------

// A database shaped like an install already at v6: every table the v7 migration
// touches exists, user_version is 6, so only the new migration runs.
function v6Database() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE members (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT,
      gender TEXT, notes TEXT, photo_path TEXT, created_at TEXT
    );
    CREATE TABLE audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, actor_user_id INTEGER,
      action TEXT NOT NULL, detail TEXT, created_at TEXT
    );
    CREATE TABLE check_ins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER REFERENCES members(id),
      checked_in_at TEXT, staff_id INTEGER, source TEXT
    );
    CREATE TABLE pool_inventory_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, category TEXT,
      variant TEXT, current_stock INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1
    );
    CREATE TABLE restaurant_inventory_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, category TEXT,
      current_stock REAL DEFAULT 0, is_active INTEGER DEFAULT 1
    );
  `)
  db.pragma('user_version = 6')
  db.prepare(`INSERT INTO users (id, name) VALUES (1, 'Staff')`).run()
  return db
}

describe('schema constraints — migration de-duplicates historical check-ins', () => {
  it('keeps exactly one row per member per day, and keeps the EARLIEST', () => {
    const db = v6Database()
    db.prepare(`INSERT INTO members (id, name) VALUES (1, 'Ram')`).run()
    db.prepare(`INSERT INTO members (id, name) VALUES (2, 'Sita')`).run()
    const ci = db.prepare(
      `INSERT INTO check_ins (id, member_id, checked_in_at, staff_id, source) VALUES (?, ?, ?, 1, 'member')`
    )
    // Ram: three check-ins on 03-01 inserted OUT of chronological order, so
    // "earliest" cannot be satisfied by simply keeping the lowest id.
    ci.run(10, 1, '2026-03-01 17:00:00')
    ci.run(11, 1, '2026-03-01 08:15:00') // earliest
    ci.run(12, 1, '2026-03-01 12:00:00')
    // Ram on the next day survives untouched.
    ci.run(13, 1, '2026-03-02 09:00:00')
    // Sita: a single check-in, plus a same-day duplicate.
    ci.run(14, 2, '2026-03-01 10:00:00') // earliest
    ci.run(15, 2, '2026-03-01 10:30:00')
    // Walk-ins on the same day: must ALL survive.
    ci.run(16, null, '2026-03-01 11:00:00')
    ci.run(17, null, '2026-03-01 11:05:00')

    runMigrations(db)

    const rows = db.prepare(`SELECT id, member_id, checked_in_at FROM check_ins ORDER BY id`).all()
    expect(rows.map((r) => r.id)).toEqual([11, 13, 14, 16, 17])

    // Exactly one row per (member, day) for identified members.
    const dupes = db
      .prepare(
        `SELECT COUNT(*) c FROM (
           SELECT member_id, date(checked_in_at) d, COUNT(*) n FROM check_ins
           WHERE member_id IS NOT NULL GROUP BY member_id, d HAVING n > 1)`
      )
      .get().c
    expect(dupes).toBe(0)

    // Earliest preserved.
    expect(
      db.prepare(`SELECT checked_in_at FROM check_ins WHERE id = 11`).get().checked_in_at
    ).toBe('2026-03-01 08:15:00')

    // The index is now in place and enforcing.
    expect(indexNames(db)).toContain('idx_check_ins_member_day')
    expect(() =>
      db
        .prepare(
          `INSERT INTO check_ins (member_id, checked_in_at, staff_id) VALUES (1, '2026-03-02 20:00:00', 1)`
        )
        .run()
    ).toThrow(/UNIQUE/i)

    // The clean-up is recorded on the audit trail.
    const audit = db
      .prepare(`SELECT detail FROM audit_log WHERE action = 'db:check-ins-deduplicated'`)
      .get()
    expect(audit).toBeTruthy()
    expect(JSON.parse(audit.detail).removedDuplicateCheckIns).toBe(3)
  })

  it('does not touch a check_ins table that is already clean', () => {
    const db = v6Database()
    db.prepare(`INSERT INTO members (id, name) VALUES (1, 'Ram')`).run()
    db.prepare(
      `INSERT INTO check_ins (id, member_id, checked_in_at, staff_id) VALUES (1, 1, '2026-03-01 08:00:00', 1)`
    ).run()
    runMigrations(db)
    expect(db.prepare(`SELECT COUNT(*) c FROM check_ins`).get().c).toBe(1)
    expect(
      db.prepare(`SELECT COUNT(*) c FROM audit_log WHERE action = 'db:check-ins-deduplicated'`).get()
        .c
    ).toBe(0)
  })
})

describe('schema constraints — migration is safe against data it cannot fix', () => {
  it('migrates a DB with duplicate members: index skipped, every member row intact', () => {
    const db = v6Database()
    const m = db.prepare(`INSERT INTO members (name, phone) VALUES (?, ?)`)
    m.run('Ram Bahadur', '9800000001')
    m.run('Ram Bahadur', '9800000001') // the violating pair — two real people?
    m.run('Sita Rai', '9800000002')

    expect(() => runMigrations(db)).not.toThrow()

    // Migration completed: version advanced, other indexes created.
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    const names = indexNames(db)
    expect(names).not.toContain('idx_members_name_phone')
    expect(names).toContain('idx_check_ins_member_day')
    expect(names).toContain('idx_pool_items_name_variant_active')
    expect(names).toContain('idx_rest_items_name_active')

    // Not one row of member data was lost or altered.
    expect(db.prepare(`SELECT COUNT(*) c FROM members`).get().c).toBe(3)
    expect(
      db.prepare(`SELECT COUNT(*) c FROM members WHERE name = 'Ram Bahadur'`).get().c
    ).toBe(2)

    // The skip is on the audit trail with enough detail to act on.
    const audit = db
      .prepare(`SELECT detail FROM audit_log WHERE action = 'db:index-skipped'`)
      .all()
      .map((r) => JSON.parse(r.detail))
    expect(audit.length).toBe(1)
    expect(audit[0].index).toBe('idx_members_name_phone')
    expect(audit[0].table).toBe('members')
    expect(audit[0].conflictingGroups).toBe(1)
  })

  it('skips (rather than fails on) an inventory table that already holds active duplicates', () => {
    const db = v6Database()
    const p = db.prepare(
      `INSERT INTO pool_inventory_items (name, category, variant, current_stock, is_active) VALUES (?, 'gear', ?, ?, 1)`
    )
    p.run('Goggles', null, 7)
    p.run('Goggles', '', 3) // NULL and '' are the same key ⇒ a violation
    const r = db.prepare(
      `INSERT INTO restaurant_inventory_items (name, category, current_stock, is_active) VALUES (?, 'bev', ?, 1)`
    )
    r.run('Tea leaves', 5)
    r.run('Tea leaves', 2)

    expect(() => runMigrations(db)).not.toThrow()
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)

    const names = indexNames(db)
    expect(names).not.toContain('idx_pool_items_name_variant_active')
    expect(names).not.toContain('idx_rest_items_name_active')
    // Stock is untouched — no row was merged or deleted.
    expect(db.prepare(`SELECT COUNT(*) c FROM pool_inventory_items`).get().c).toBe(2)
    expect(
      db.prepare(`SELECT SUM(current_stock) s FROM restaurant_inventory_items`).get().s
    ).toBe(7)

    const skipped = db
      .prepare(`SELECT detail FROM audit_log WHERE action = 'db:index-skipped'`)
      .all()
      .map((row) => JSON.parse(row.detail).index)
    expect(skipped.sort()).toEqual([
      'idx_pool_items_name_variant_active',
      'idx_rest_items_name_active'
    ])
  })
})

describe('schema constraints — idempotency', () => {
  it('running the migration twice is a no-op', () => {
    const db = v6Database()
    db.prepare(`INSERT INTO members (id, name) VALUES (1, 'Ram')`).run()
    const ci = db.prepare(
      `INSERT INTO check_ins (id, member_id, checked_in_at, staff_id) VALUES (?, 1, ?, 1)`
    )
    ci.run(1, '2026-03-01 09:00:00')
    ci.run(2, '2026-03-01 10:00:00')

    runMigrations(db)
    const version = db.pragma('user_version', { simple: true })
    const before = indexNames(db).sort()
    const rows = db.prepare(`SELECT id FROM check_ins ORDER BY id`).all()
    const auditCount = db.prepare(`SELECT COUNT(*) c FROM audit_log`).get().c

    expect(() => runMigrations(db)).not.toThrow()
    expect(db.pragma('user_version', { simple: true })).toBe(version)
    expect(indexNames(db).sort()).toEqual(before)
    expect(db.prepare(`SELECT id FROM check_ins ORDER BY id`).all()).toEqual(rows)
    expect(db.prepare(`SELECT COUNT(*) c FROM audit_log`).get().c).toBe(auditCount)
    expect(db.pragma('foreign_key_check')).toEqual([])
  })

  it('a full startup on an existing DB is repeatable and keeps user_version stable', () => {
    closeDatabase()
    __setUserDataDir(mkdtempSync(join(tmpdir(), 'refresh-sc-')))
    initDatabase()
    seed(getDb())
    expect(getDb().pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    closeDatabase()

    // Reopen: no pending migrations, indexes still present, no re-run damage.
    initDatabase()
    const db = getDb()
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    for (const idx of UNIQUE_INDEXES) expect(indexNames(db)).toContain(idx)
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok')
  })
})
