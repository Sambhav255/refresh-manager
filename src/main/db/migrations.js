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

import { logWarn, logInfo } from '../diagnostics.js'
import { SALE_MODEL_SQL } from './schema.js'

function hasColumn(db, table, column) {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((c) => c.name === column)
}

function tableExists(db, table) {
  return !!db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table)
}

function indexExists(db, name) {
  return !!db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?`).get(name)
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

// ── v7: database-level uniqueness ────────────────────────────────────────────
//
// The IPC handlers already refuse most of these duplicates (and produce the
// friendly "already exists — restock it instead" message). These indexes are
// the last line of defence for everything a handler cannot see: direct DB
// access, restores, future code paths, and two writes racing between the
// SELECT check and the INSERT.
//
// SAFETY: `CREATE UNIQUE INDEX` throws if the data already violates it. Inside
// a migration that means the whole upgrade is rolled back and the app refuses
// to open — a far worse outcome than a missing index. So every index below is
// created through `tryCreateUniqueIndex`, which probes for violations first and
// SKIPS the index (recording a warning to diagnostics + the audit log) when it
// cannot be created without destroying user data. Only check_ins is
// de-duplicated automatically, because a repeat same-day check-in is by
// definition a mis-count with no information in it. Two members who share a
// name and phone might be two real people, so members is never de-duplicated.
const UNIQUENESS_VERSION = 7

const UNIQUE_INDEXES = [
  {
    // A repeat same-day check-in is a mis-count, never data. member_id is NULL
    // for walk-ins/day-passes; SQLite treats NULLs in a unique index as
    // distinct, so any number of anonymous check-ins per day still fit.
    name: 'idx_check_ins_member_day',
    table: 'check_ins',
    columns: ['member_id', 'checked_in_at'],
    create: `CREATE UNIQUE INDEX IF NOT EXISTS idx_check_ins_member_day
             ON check_ins(member_id, date(checked_in_at))`,
    // Rows with a NULL timestamp index as NULL ⇒ never collide, so they are
    // excluded from the probe too (keeps probe and index exactly in step).
    probe: `SELECT member_id, date(checked_in_at) AS day, COUNT(*) AS n
            FROM check_ins
            WHERE member_id IS NOT NULL AND checked_in_at IS NOT NULL
            GROUP BY member_id, date(checked_in_at)
            HAVING n > 1`
  },
  {
    // Mirrors pool-inventory:add-item — only ACTIVE items collide, and a NULL
    // variant is the same key as an empty one. Re-adding a retired item is
    // legitimate, so the index is partial on is_active.
    name: 'idx_pool_items_name_variant_active',
    table: 'pool_inventory_items',
    columns: ['name', 'variant', 'is_active'],
    create: `CREATE UNIQUE INDEX IF NOT EXISTS idx_pool_items_name_variant_active
             ON pool_inventory_items(name, IFNULL(variant, '')) WHERE is_active = 1`,
    probe: `SELECT name, IFNULL(variant, '') AS variant, COUNT(*) AS n
            FROM pool_inventory_items
            WHERE is_active = 1
            GROUP BY name, IFNULL(variant, '')
            HAVING n > 1`
  },
  {
    // Mirrors restaurant-inventory:add-item (no variant column here).
    name: 'idx_rest_items_name_active',
    table: 'restaurant_inventory_items',
    columns: ['name', 'is_active'],
    create: `CREATE UNIQUE INDEX IF NOT EXISTS idx_rest_items_name_active
             ON restaurant_inventory_items(name) WHERE is_active = 1`,
    probe: `SELECT name, COUNT(*) AS n
            FROM restaurant_inventory_items
            WHERE is_active = 1
            GROUP BY name
            HAVING n > 1`
  },
  {
    // Two people can genuinely share a name, so only a shared name AND phone is
    // a duplicate. requirePhone() normalises a blank phone to NULL; legacy rows
    // may still hold '' — excluded so an old empty string can't lock reception
    // out of registering a second member with the same name.
    name: 'idx_members_name_phone',
    table: 'members',
    columns: ['name', 'phone'],
    create: `CREATE UNIQUE INDEX IF NOT EXISTS idx_members_name_phone
             ON members(name, phone) WHERE phone IS NOT NULL AND phone <> ''`,
    probe: `SELECT name, phone, COUNT(*) AS n
            FROM members
            WHERE phone IS NOT NULL AND phone <> ''
            GROUP BY name, phone
            HAVING n > 1`
  }
]

// Record a skipped index where an operator will actually see it: the persistent
// diagnostics log (collectable from the reception PC) and the append-only audit
// trail. Both are best-effort — neither may break the migration.
function recordIndexSkipped(db, index, conflicts) {
  const detail = {
    index: index.name,
    table: index.table,
    conflictingGroups: conflicts.length,
    sample: conflicts.slice(0, 5)
  }
  logWarn(
    'db:migration',
    `Skipped unique index ${index.name}: existing data already violates it. ` +
      `No rows were changed; the handler-level check remains the only guard.`,
    detail
  )
  try {
    if (tableExists(db, 'audit_log')) {
      db.prepare(
        `INSERT INTO audit_log (actor_user_id, action, detail) VALUES (NULL, 'db:index-skipped', ?)`
      ).run(JSON.stringify(detail))
    }
  } catch {
    /* audit is tamper-evidence, not a transactional dependency */
  }
}

function columnExists(db, table, column) {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((c) => c.name === column)
}

// Returns 'created' | 'exists' | 'absent' | 'skipped'.
function tryCreateUniqueIndex(db, index) {
  if (!tableExists(db, index.table)) return 'absent'
  if (indexExists(db, index.name)) return 'exists'
  // An older database may predate a column this index spans (pool variant, for
  // one). ensureUniquenessIndexes is re-run after every table rebuild, so
  // skipping here is not a permanent loss — the index appears on the pass after
  // the column does.
  for (const column of index.columns || []) {
    if (!columnExists(db, index.table, column)) return 'absent'
  }
  const conflicts = db.prepare(index.probe).all()
  if (conflicts.length) {
    recordIndexSkipped(db, index, conflicts)
    return 'skipped'
  }
  db.exec(index.create)
  return 'created'
}

// Idempotent: creates whichever uniqueness indexes are missing and creatable.
// Also re-run by the runner after any table rebuild, since a DROP+RENAME
// silently drops the rebuilt table's indexes.
export function ensureUniquenessIndexes(db) {
  const results = {}
  for (const index of UNIQUE_INDEXES) results[index.name] = tryCreateUniqueIndex(db, index)
  return results
}

// Collapse historical duplicate same-day check-ins, keeping the EARLIEST row
// per (member_id, local day) — earliest by timestamp, id as the tie-break so
// the result is deterministic even when two rows share a second. Walk-ins
// (member_id NULL) are untouched: they do not collide and there is no way to
// tell two anonymous visitors apart. Nothing references check_ins(id), so the
// delete cannot orphan anything.
function dedupeCheckIns(db) {
  if (!tableExists(db, 'check_ins')) return 0
  const result = db
    .prepare(
      `DELETE FROM check_ins
       WHERE member_id IS NOT NULL
         AND checked_in_at IS NOT NULL
         AND id NOT IN (
           SELECT keep_id FROM (
             SELECT id AS keep_id,
                    ROW_NUMBER() OVER (
                      PARTITION BY member_id, date(checked_in_at)
                      ORDER BY checked_in_at ASC, id ASC
                    ) AS rn
             FROM check_ins
             WHERE member_id IS NOT NULL AND checked_in_at IS NOT NULL
           )
           WHERE rn = 1
         )`
    )
    .run()
  return result.changes
}

function addUniquenessConstraints(db) {
  const removed = dedupeCheckIns(db)
  if (removed > 0) {
    const detail = { removedDuplicateCheckIns: removed, kept: 'earliest per member per day' }
    logInfo('db:migration', `De-duplicated ${removed} same-day check-in row(s)`, detail)
    try {
      if (tableExists(db, 'audit_log')) {
        db.prepare(
          `INSERT INTO audit_log (actor_user_id, action, detail) VALUES (NULL, 'db:check-ins-deduplicated', ?)`
        ).run(JSON.stringify(detail))
      }
    } catch {
      /* best-effort */
    }
  }
  ensureUniquenessIndexes(db)
}

// ── v8: the sale model (lines + payments + price rules) ─────────────────────
//
// A sale used to BE one product and one amount, so three tickets in one go, a
// day pass mixed with goggles, an adult and a child on the same sale, a
// discount, and part-payment now with the rest later were all impossible — the
// same missing concept five times over. transaction_lines and
// transaction_payments supply it; price_rules lets the owner say what a child
// or a Saturday costs instead of that living in code.
//
// `transactions` is deliberately NOT touched: amount stays the sale total,
// denormalised from the lines, because every report, the EOD breakdown and the
// WhatsApp message read it. The DDL is shared with schema.js (SALE_MODEL_SQL)
// so a fresh database and an upgraded one cannot drift apart.
function addSaleModel(db) {
  // Every real database has `transactions` (schema.js creates it before any
  // migration runs); a partial one is a fixture. Guarding rather than throwing
  // keeps this step in line with every other migration here, which no-ops on
  // what it cannot find instead of failing an upgrade.
  if (!tableExists(db, 'transactions')) return
  db.exec(SALE_MODEL_SQL)
  // One rule per product/tier/day/start-date, so pricing:set-rule is an upsert
  // and two writes racing cannot leave two rules fighting over the same slot.
  // A UNIQUE index can only throw on data that already violates it, and this
  // table is created empty a line above — so unlike the v7 indexes it needs no
  // probe. It lives here rather than in schema.js because schema.js runs
  // outside the snapshot/rollback window (see the note at the top of it).
  // IFNULL maps the "any tier"/"any day" wildcards onto values, since SQLite
  // treats NULLs in a unique index as distinct from each other.
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_price_rules_key
      ON price_rules(product_id, IFNULL(tier, ''), IFNULL(day_of_week, -1), active_from)
  `)
  backfillSaleLines(db)
}

// Give every pre-sale-model transaction exactly one line and one payment, so
// the history renders through the same code path as anything sold from now on
// (a sale with no lines would otherwise show as an empty basket, and one with
// no payments would show as unpaid — permanently outstanding).
//
// Idempotent by construction: both statements skip any transaction that already
// has a row, so re-running back-fills only what a later import left behind.
function backfillSaleLines(db) {
  // Historic pool/restaurant sales stored no item id at all — only a note like
  // "Tea x2" — so ref_id is whatever product_id the row had (often NULL) and
  // the description falls back to the note. Reconstructing item ids from that
  // free text would be a guess, and a wrong guess is worse than an honest gap.
  // The product name is the best description available, but a database old
  // enough to predate the products table has to back-fill from the note alone.
  const describe = tableExists(db, 'products')
    ? `COALESCE((SELECT p.name FROM products p WHERE p.id = t.product_id), NULLIF(t.notes, ''), t.transaction_type)`
    : `COALESCE(NULLIF(t.notes, ''), t.transaction_type)`
  db.exec(`
    INSERT INTO transaction_lines
      (transaction_id, kind, ref_id, description, quantity, unit_price, line_discount, line_total, created_at)
    SELECT t.id,
           CASE WHEN t.transaction_type = 'membership' THEN 'membership' ELSE 'product' END,
           t.product_id,
           ${describe},
           1, t.amount, 0, t.amount, t.created_at
    FROM transactions t
    WHERE NOT EXISTS (SELECT 1 FROM transaction_lines l WHERE l.transaction_id = t.id)
  `)

  // The old model could only record money that had already been taken, so every
  // historic sale is paid in full, by the method and on the date of the header.
  // staff_id is dropped (NULL) rather than carried over for the handful of rows
  // whose staff user no longer exists — a foreign-key failure here would roll
  // back the entire upgrade over a name nobody will read.
  const staffExpr = tableExists(db, 'users')
    ? `(SELECT u.id FROM users u WHERE u.id = t.staff_id)`
    : 'NULL'
  db.exec(`
    INSERT INTO transaction_payments (transaction_id, amount, payment_method, paid_at, staff_id)
    SELECT t.id, t.amount, t.payment_method, t.created_at,
           ${staffExpr}
    FROM transactions t
    WHERE NOT EXISTS (SELECT 1 FROM transaction_payments tp WHERE tp.transaction_id = t.id)
  `)
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
  },
  {
    // Database-level uniqueness behind the handler checks (see UNIQUE_INDEXES
    // above): one check-in per member per local day, one ACTIVE inventory item
    // per name(+variant), one member per name+phone. Historical duplicate
    // check-ins are collapsed first; any index the existing data cannot satisfy
    // is skipped with a logged warning rather than failing the upgrade.
    name: 'v7: uniqueness indexes + check-in de-duplication',
    rebuildsReferencedTable: false,
    up: addUniquenessConstraints
  },
  {
    // Purely additive: three new tables plus a back-fill. Nothing existing is
    // altered, so no table rebuild and no foreign-key toggling.
    name: 'v8: sale lines, payments and price rules',
    rebuildsReferencedTable: false,
    up: addSaleModel
  },
  {
    // H-40: cash reconciliation previously compared the physical count
    // straight against today's cash sales, so a drawer that legitimately
    // started the day with a float showed as "over" by exactly that float.
    // opening_float is additive and defaults to 0, so every historic row (and
    // any caller that doesn't pass it) keeps its original discrepancy.
    name: 'v9: opening_float on cash_reconciliations',
    rebuildsReferencedTable: false,
    up: (db) => {
      // Guard the table's existence too, not just the column: every real
      // database gets cash_reconciliations from v1's backfillBaseline long
      // before it reaches v9, but a minimal test fixture that starts at a
      // later user_version (see schema-constraints.test.js's v6Database)
      // never ran v1 and has no such table — no-op rather than throw, same
      // pattern as addSaleModel's transactions guard above.
      if (!tableExists(db, 'cash_reconciliations')) return
      if (!hasColumn(db, 'cash_reconciliations', 'opening_float')) {
        db.exec(`ALTER TABLE cash_reconciliations ADD COLUMN opening_float REAL NOT NULL DEFAULT 0`)
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
      // Same hazard for the uniqueness indexes, but only once the DB has
      // reached the version that introduced them (a no-op on the way up from an
      // old install; correct for any future rebuild migration).
      if (version + 1 >= UNIQUENESS_VERSION) ensureUniquenessIndexes(db)
    }

    version++
  }
}
