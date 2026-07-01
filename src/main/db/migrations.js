function hasColumn(db, table, column) {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((c) => c.name === column)
}

// P2-3: older databases were created before 'booking_deposit' was a valid
// transaction_type. SQLite cannot ALTER a CHECK constraint, so rebuild the
// table in place (ids preserved, so foreign-key references stay valid).
function migrateTransactionTypeCheck(db) {
  const row = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'transactions'`)
    .get()
  if (!row?.sql || row.sql.includes('booking_deposit')) return

  db.pragma('foreign_keys = OFF')
  db.transaction(() => {
    db.exec(`
      CREATE TABLE transactions_new (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        transaction_type TEXT NOT NULL CHECK(transaction_type IN ('membership','day_package','day_pass','pool_inventory','restaurant','booking_deposit')),
        source           TEXT NOT NULL DEFAULT 'pool' CHECK(source IN ('pool','restaurant')),
        customer_name    TEXT NOT NULL,
        phone            TEXT,
        product_id       INTEGER REFERENCES products(id),
        member_id        INTEGER REFERENCES members(id),
        amount           REAL NOT NULL,
        payment_method   TEXT NOT NULL CHECK(payment_method IN ('cash','qr')),
        staff_id         INTEGER NOT NULL REFERENCES users(id),
        notes            TEXT,
        is_voided        INTEGER DEFAULT 0,
        void_reason      TEXT,
        void_by          INTEGER REFERENCES users(id),
        void_at          TEXT,
        created_at       TEXT DEFAULT (datetime('now','localtime'))
      );
      INSERT INTO transactions_new
        (id, transaction_type, source, customer_name, phone, product_id, member_id, amount,
         payment_method, staff_id, notes, is_voided, void_reason, void_by, void_at, created_at)
        SELECT id, transaction_type, source, customer_name, phone, product_id, member_id, amount,
               payment_method, staff_id, notes, is_voided, void_reason, void_by, void_at, created_at
        FROM transactions;
      DROP TABLE transactions;
      ALTER TABLE transactions_new RENAME TO transactions;
    `)
  })()
  db.pragma('foreign_keys = ON')
}

export function runMigrations(db) {
  const cols = db.prepare(`PRAGMA table_info(memberships)`).all()
  if (!cols.some((c) => c.name === 'reminder_sent_at')) {
    db.exec(`ALTER TABLE memberships ADD COLUMN reminder_sent_at TEXT`)
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS cash_reconciliations (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      reconcile_date  TEXT NOT NULL,
      system_cash     REAL NOT NULL,
      physical_cash   REAL NOT NULL,
      discrepancy     REAL NOT NULL DEFAULT 0,
      reason          TEXT,
      staff_id        INTEGER REFERENCES users(id),
      created_at      TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS restaurant_menu_items (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      category    TEXT,
      price       REAL NOT NULL DEFAULT 0,
      is_active   INTEGER DEFAULT 1,
      sort_order  INTEGER DEFAULT 0,
      created_at  TEXT DEFAULT (datetime('now','localtime'))
    );
  `)

  const settings = [
    { key: 'backup_schedule', value: '23:59' },
    { key: 'backup_auto_enabled', value: 'true' },
    { key: 'last_backup_at', value: '' },
    { key: 'last_backup_status', value: '' },
    { key: 'last_backup_path', value: '' },
    {
      key: 'renewal_reminder_template',
      value: `नमस्ते [Name] जी! 🏊
Refresh Recreation Center मा तपाईंको [Membership Type] membership
[Date] मा expire हुँदैछ।

Renewal को लागि हामीलाई सम्पर्क गर्नुहोस्:
📞 9801010422
📍 Nayabasti, Boudha

धन्यवाद! — Refresh Team`
    },
    { key: 'session_timeout_minutes', value: '30' }
  ]

  const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)')
  for (const s of settings) {
    insert.run(s.key, s.value)
  }

  // P0-2: optional 1:1 link from a menu item to the pool/restaurant stock item
  // it draws down on sale.
  if (!hasColumn(db, 'restaurant_menu_items', 'inventory_item_id')) {
    db.exec(
      `ALTER TABLE restaurant_menu_items ADD COLUMN inventory_item_id INTEGER REFERENCES restaurant_inventory_items(id)`
    )
  }

  // P2-3: link a booking to the money transaction created for its deposit.
  if (!hasColumn(db, 'bookings', 'deposit_transaction_id')) {
    db.exec(
      `ALTER TABLE bookings ADD COLUMN deposit_transaction_id INTEGER REFERENCES transactions(id)`
    )
  }

  // P2-3: allow 'booking_deposit' transactions on pre-existing databases.
  migrateTransactionTypeCheck(db)
}
