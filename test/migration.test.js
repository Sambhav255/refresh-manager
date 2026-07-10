import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../src/main/db/migrations.js'

// Build a database shaped like an OLD install (before this work order): the
// transactions CHECK has no 'booking_deposit', memberships has no
// reminder_sent_at, restaurant_menu_items has no inventory_item_id, and bookings
// has no deposit_transaction_id. Crucially it is POPULATED with child rows that
// reference transactions(id) via foreign keys, so the CHECK-constraint table
// rebuild is exercised against real referential integrity (2-C / 5-B).
function oldDatabase() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE members (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE restaurant_inventory_items (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE pool_inventory_items (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE transactions (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_type TEXT NOT NULL CHECK(transaction_type IN ('membership','day_package','day_pass','pool_inventory','restaurant')),
      source           TEXT NOT NULL DEFAULT 'pool' CHECK(source IN ('pool','restaurant')),
      customer_name    TEXT NOT NULL,
      phone            TEXT,
      product_id       INTEGER,
      member_id        INTEGER,
      amount           REAL NOT NULL,
      payment_method   TEXT NOT NULL CHECK(payment_method IN ('cash','qr')),
      staff_id         INTEGER NOT NULL,
      notes            TEXT,
      is_voided        INTEGER DEFAULT 0,
      void_reason      TEXT,
      void_by          INTEGER,
      void_at          TEXT,
      created_at       TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE memberships (
      id INTEGER PRIMARY KEY, member_id INTEGER, product_id INTEGER,
      transaction_id INTEGER REFERENCES transactions(id),
      start_date TEXT, end_date TEXT, status TEXT
    );
    CREATE TABLE pool_inventory_transactions (
      id INTEGER PRIMARY KEY, item_id INTEGER, txn_type TEXT, quantity INTEGER,
      transaction_id INTEGER REFERENCES transactions(id), staff_id INTEGER
    );
    CREATE TABLE restaurant_inventory_transactions (
      id INTEGER PRIMARY KEY, item_id INTEGER, txn_type TEXT, quantity REAL,
      transaction_id INTEGER REFERENCES transactions(id), staff_id INTEGER
    );
    CREATE TABLE bookings (id INTEGER PRIMARY KEY, booking_name TEXT, deposit_paid REAL);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
  `)
  db.prepare(`INSERT INTO users (id, name) VALUES (1,'Staff')`).run()
  db.prepare(`INSERT INTO members (id, name) VALUES (1,'Ram')`).run()
  db.prepare(`INSERT INTO pool_inventory_items (id, name) VALUES (1,'Goggles')`).run()
  db.prepare(
    `INSERT INTO transactions (id, transaction_type, source, customer_name, amount, payment_method, staff_id)
     VALUES (7, 'restaurant', 'restaurant', 'Walk-in', 250, 'cash', 1)`
  ).run()
  // Child rows that reference transactions(id=7) — must survive the rebuild.
  db.prepare(
    `INSERT INTO memberships (id, member_id, product_id, transaction_id, status)
     VALUES (1, 1, 1, 7, 'active')`
  ).run()
  db.prepare(
    `INSERT INTO pool_inventory_transactions (id, item_id, txn_type, quantity, transaction_id, staff_id)
     VALUES (1, 1, 'out', 2, 7, 1)`
  ).run()
  return db
}

describe('migrations — upgrading a pre-existing database', () => {
  it("adds 'booking_deposit' to the transaction_type CHECK, preserving data, ids, and FKs", () => {
    const db = oldDatabase()

    // Sanity: the old CHECK really rejects booking_deposit.
    expect(() =>
      db
        .prepare(
          `INSERT INTO transactions (transaction_type, source, customer_name, amount, payment_method, staff_id)
           VALUES ('booking_deposit','pool','X',100,'cash',1)`
        )
        .run()
    ).toThrow()

    runMigrations(db)

    // Existing row survived with the same id.
    const row = db.prepare('SELECT * FROM transactions WHERE id = 7').get()
    expect(row.customer_name).toBe('Walk-in')
    expect(row.amount).toBe(250)

    // 2-C: the rebuild must not have orphaned any child references.
    expect(db.pragma('foreign_key_check')).toEqual([])
    expect(
      db.prepare('SELECT transaction_id FROM memberships WHERE id = 1').get().transaction_id
    ).toBe(7)
    expect(
      db.prepare('SELECT transaction_id FROM pool_inventory_transactions WHERE id = 1').get()
        .transaction_id
    ).toBe(7)

    // booking_deposit is now accepted.
    expect(() =>
      db
        .prepare(
          `INSERT INTO transactions (transaction_type, source, customer_name, amount, payment_method, staff_id)
           VALUES ('booking_deposit','pool','Party',500,'cash',1)`
        )
        .run()
    ).not.toThrow()

    // The invalid type is still rejected (constraint intact, not dropped).
    expect(() =>
      db
        .prepare(
          `INSERT INTO transactions (transaction_type, source, customer_name, amount, payment_method, staff_id)
           VALUES ('nonsense','pool','X',1,'cash',1)`
        )
        .run()
    ).toThrow()
  })

  it('adds the new columns, bumps user_version, and is idempotent on a second run', () => {
    const db = oldDatabase()
    runMigrations(db)
    const menuCols = db
      .prepare(`PRAGMA table_info(restaurant_menu_items)`)
      .all()
      .map((c) => c.name)
    const bookingCols = db
      .prepare(`PRAGMA table_info(bookings)`)
      .all()
      .map((c) => c.name)
    const memberCols = db
      .prepare(`PRAGMA table_info(memberships)`)
      .all()
      .map((c) => c.name)
    expect(menuCols).toContain('inventory_item_id')
    expect(bookingCols).toContain('deposit_transaction_id')
    expect(memberCols).toContain('reminder_sent_at')

    // 2-D: user_version advanced to the number of migrations.
    const version = db.pragma('user_version', { simple: true })
    expect(version).toBeGreaterThanOrEqual(1)

    // Running again must not throw, rebuild, or advance the version.
    expect(() => runMigrations(db)).not.toThrow()
    expect(db.pragma('user_version', { simple: true })).toBe(version)
    expect(db.pragma('foreign_key_check')).toEqual([])
  })
})
