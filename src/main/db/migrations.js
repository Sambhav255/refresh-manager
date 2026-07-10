// Database migrations — versioned with PRAGMA user_version (2-D).
//
// Each entry in MIGRATIONS is applied once, in order, inside its own
// transaction; the runner bumps user_version as part of that same transaction
// so a failure rolls the version back too. Migrations that rebuild a table
// referenced by foreign keys set `rebuildsReferencedTable: true` — the runner
// disables foreign_keys *outside* the transaction (a no-op inside one), runs
// the rebuild, then verifies with PRAGMA foreign_key_check before re-enabling
// (2-C). Adding a future migration is a one-line append to MIGRATIONS.
//
// v1 backfills every additive change made before user_version existed, so a
// pre-existing v1.0.0 production DB (user_version 0, columns already present)
// and a brand-new DB (schema.js already current) both converge to the same
// final version. Every v1 step is individually guarded/idempotent.

function hasColumn(db, table, column) {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((c) => c.name === column)
}

// P2-3 / 2-C: SQLite cannot ALTER a CHECK constraint, so rebuild the table in
// place (ids preserved ⇒ foreign-key references stay valid). FK toggling and
// the post-rebuild foreign_key_check are handled by the runner.
function migrateTransactionTypeCheck(db) {
  const row = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'transactions'`)
    .get()
  if (!row?.sql || row.sql.includes('booking_deposit')) return

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
}

// 3-C: add 'refund' to the CHECK and a refunds_transaction_id link column. Same
// rebuild recipe as above; guarded so it is a no-op once applied.
function migrateRefundSupport(db) {
  const row = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'transactions'`)
    .get()
  const hasRefundType = row?.sql?.includes("'refund'")
  const hasLinkColumn = db
    .prepare(`PRAGMA table_info(transactions)`)
    .all()
    .some((c) => c.name === 'refunds_transaction_id')
  if (hasRefundType && hasLinkColumn) return

  db.exec(`
    CREATE TABLE transactions_new (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_type TEXT NOT NULL CHECK(transaction_type IN ('membership','day_package','day_pass','pool_inventory','restaurant','booking_deposit','refund')),
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
      refunds_transaction_id INTEGER REFERENCES transactions(id),
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
}

// 4-C hot-path indexes. Split out (and idempotent) because a table rebuild
// (DROP + RENAME, as used for CHECK-constraint changes) silently drops every
// index on that table — the runner re-runs this after any rebuild migration so
// a future rebuild can't leave the DB unindexed.
function createReportIndexes(db) {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_txn_created ON transactions(created_at);
    CREATE INDEX IF NOT EXISTS idx_txn_member ON transactions(member_id);
    CREATE INDEX IF NOT EXISTS idx_txn_staff ON transactions(staff_id);
    CREATE INDEX IF NOT EXISTS idx_txn_product ON transactions(product_id);
    CREATE INDEX IF NOT EXISTS idx_txn_type ON transactions(transaction_type);
    CREATE INDEX IF NOT EXISTS idx_ms_member ON memberships(member_id);
    CREATE INDEX IF NOT EXISTS idx_ms_status_end ON memberships(status, end_date);
  `)
  // Column arrives in v4 — earlier rebuild passes (v1) must not fail on it.
  if (hasColumn(db, 'transactions', 'refunds_transaction_id')) {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_txn_refunds ON transactions(refunds_transaction_id)`)
  }
}

function backfillBaseline(db) {
  if (!hasColumn(db, 'memberships', 'reminder_sent_at')) {
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
  for (const s of settings) insert.run(s.key, s.value)

  // P0-2: optional 1:1 link from a menu item to the stock item it draws down.
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

const MIGRATIONS = [
  {
    name: 'v1: baseline additive backfill + booking_deposit CHECK',
    rebuildsReferencedTable: true,
    up: backfillBaseline
  },
  {
    // 2-E: append-only tamper-evidence log for sensitive actions (restore,
    // settings/staff/PIN changes, voids, reminders). IF NOT EXISTS so a restore
    // that pre-creates it (to log the restore itself) stays compatible.
    name: 'v2: audit_log',
    rebuildsReferencedTable: false,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS audit_log (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          actor_user_id INTEGER REFERENCES users(id),
          action        TEXT NOT NULL,
          detail        TEXT,
          created_at    TEXT DEFAULT (datetime('now','localtime'))
        );
      `)
    }
  },
  {
    // 3-A: attendance logging — the app records sales, not visits, so footfall
    // and utilisation KPIs are otherwise impossible. member_id is nullable so a
    // day-pass/walk-in can still be counted.
    name: 'v3: check_ins',
    rebuildsReferencedTable: false,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS check_ins (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          member_id     INTEGER REFERENCES members(id),
          checked_in_at TEXT DEFAULT (datetime('now','localtime')),
          staff_id      INTEGER REFERENCES users(id),
          source        TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_check_ins_member ON check_ins(member_id, checked_in_at);
        CREATE INDEX IF NOT EXISTS idx_check_ins_at ON check_ins(checked_in_at);
      `)
    }
  },
  {
    // 3-C: add 'refund' to the transaction_type CHECK and a refunds_transaction_id
    // link column. Guarded/idempotent so a fresh DB (schema.js already current)
    // does not rebuild.
    name: 'v4: refund transaction type + link column',
    rebuildsReferencedTable: true,
    up: migrateRefundSupport
  },
  {
    // 4-C: secondary indexes for the hot report/query paths. Created after the
    // v4 transactions rebuild so they survive it.
    name: 'v5: report indexes',
    rebuildsReferencedTable: false,
    up: createReportIndexes
  },
  {
    // Turnover accuracy: record the unit price actually charged on each stock
    // movement, so the inventory-turnover report doesn't drift when the owner
    // later changes an item's selling price, and refund reversals can be netted
    // at the price of the original sale. Historic rows stay NULL (the report
    // falls back to the current selling price for them).
    name: 'v6: unit_price on inventory transactions',
    rebuildsReferencedTable: false,
    up: (db) => {
      if (!hasColumn(db, 'pool_inventory_transactions', 'unit_price')) {
        db.exec(`ALTER TABLE pool_inventory_transactions ADD COLUMN unit_price REAL`)
      }
      if (!hasColumn(db, 'restaurant_inventory_transactions', 'unit_price')) {
        db.exec(`ALTER TABLE restaurant_inventory_transactions ADD COLUMN unit_price REAL`)
      }
    }
  }
]

// The schema version this build understands. A DB whose user_version exceeds
// this was written by a newer app and must not be opened (downgrade guard).
export const SCHEMA_VERSION = MIGRATIONS.length

// Number of migrations a given DB still has to apply (0 = up to date).
export function pendingMigrationCount(db) {
  const version = db.pragma('user_version', { simple: true })
  return Math.max(0, MIGRATIONS.length - version)
}

export function runMigrations(db) {
  let version = db.pragma('user_version', { simple: true })

  while (version < MIGRATIONS.length) {
    const migration = MIGRATIONS[version]

    // foreign_keys pragma is a no-op inside a transaction, so toggle it here.
    if (migration.rebuildsReferencedTable) db.pragma('foreign_keys = OFF')

    const apply = db.transaction(() => {
      migration.up(db)
      db.pragma(`user_version = ${version + 1}`)
    })
    apply()

    if (migration.rebuildsReferencedTable) {
      const problems = db.pragma('foreign_key_check')
      if (problems.length) {
        throw new Error(
          `Migration "${migration.name}" left dangling foreign keys: ${JSON.stringify(problems)}`
        )
      }
      db.pragma('foreign_keys = ON')
      // A DROP+RENAME rebuild silently drops the rebuilt table's indexes —
      // recreate them (idempotent) so no rebuild can leave the DB unindexed.
      createReportIndexes(db)
    }

    version++
  }
}
