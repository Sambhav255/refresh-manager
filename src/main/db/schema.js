// Base table definitions for a brand-new database. Everything here is
// CREATE ... IF NOT EXISTS and runs against EVERY database on every startup,
// *before* the pre-update snapshot is taken (see db/index.js) — so nothing in
// this file may ever fail on pre-existing data.
//
// That is why the uniqueness indexes (one check-in per member per local day,
// one ACTIVE inventory item per name/variant, one member per name+phone) live
// in migrations.js and not here: creating a UNIQUE index throws when existing
// rows violate it, and a throw from this file would happen outside the
// snapshot/rollback window. The migration runner creates them for fresh and
// upgraded databases alike, de-duplicating or skipping as appropriate.

// ── Sale model: a sale is a header + lines + payments ────────────────────────
//
// `transactions` holds one product and one amount, which cannot express three
// tickets in one go, a day pass mixed with goggles, a child priced differently
// from an adult on the same sale, a discount, or part-payment now with the rest
// later — all the same missing concept. These three tables add it WITHOUT
// changing `transactions`: the header stays exactly as it is (amount is still
// the sale total, denormalised from the lines) so every existing report, the
// EOD breakdown and the WhatsApp message keep reading the column they read now.
//
// The DDL lives in its own constant because migrations.js must create the same
// tables on an already-populated database; two copies would drift apart.
export const SALE_MODEL_SQL = `
CREATE TABLE IF NOT EXISTS transaction_lines (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id  INTEGER NOT NULL REFERENCES transactions(id),
  -- What was sold. ref_id points into products / pool_inventory_items /
  -- restaurant_menu_items accordingly; it is nullable because a back-filled
  -- historic line (a pre-sale-model restaurant or pool sale) recorded only a
  -- note, never an item id.
  kind            TEXT NOT NULL CHECK(kind IN ('product','pool_item','menu_item','membership')),
  ref_id          INTEGER,
  -- Frozen at sale time: renaming a product later must not rewrite history.
  description     TEXT NOT NULL,
  tier            TEXT CHECK(tier IN ('adult','child') OR tier IS NULL),
  quantity        INTEGER NOT NULL DEFAULT 1 CHECK(quantity > 0),
  unit_price      REAL NOT NULL DEFAULT 0,
  -- Absolute rupees off this line (never a percentage, never per unit), with
  -- the reason the handler insists on. line_total = unit_price * quantity
  -- - line_discount, and may only be negative on a back-filled refund row.
  line_discount   REAL NOT NULL DEFAULT 0 CHECK(line_discount >= 0),
  discount_reason TEXT,
  line_total      REAL NOT NULL DEFAULT 0,
  created_at      TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS transaction_payments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id),
  -- Negative only on back-filled refunds (money out); handlers reject <= 0.
  amount         REAL NOT NULL,
  payment_method TEXT NOT NULL CHECK(payment_method IN ('cash','qr')),
  paid_at        TEXT DEFAULT (datetime('now','localtime')),
  -- Who took the money — the session user, never the payload. Nullable ONLY so
  -- the migration back-fill of a legacy row whose staff user has since vanished
  -- cannot fail an upgrade; every row the handlers write has it set.
  staff_id       INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS price_rules (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id  INTEGER NOT NULL REFERENCES products(id),
  -- NULL tier = everyone; NULL day_of_week = every day (0 = Sunday … 6 = Sat).
  tier        TEXT CHECK(tier IN ('adult','child') OR tier IS NULL),
  day_of_week INTEGER CHECK(day_of_week IS NULL OR (day_of_week BETWEEN 0 AND 6)),
  price       REAL NOT NULL CHECK(price >= 0),
  -- A rule applies from this date on, so a price change can be entered ahead of
  -- time without rewriting what yesterday's sales were charged.
  active_from TEXT NOT NULL DEFAULT (date('now','localtime')),
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_txn_lines_txn ON transaction_lines(transaction_id);
CREATE INDEX IF NOT EXISTS idx_txn_payments_txn ON transaction_payments(transaction_id);
CREATE INDEX IF NOT EXISTS idx_price_rules_lookup ON price_rules(product_id, active_from);
`

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK(role IN ('owner','staff')),
  pin_hash      TEXT,
  password_hash TEXT,
  is_active     INTEGER DEFAULT 1,
  created_at    TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS products (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  category      TEXT NOT NULL CHECK(category IN ('membership','day_package','day_pass')),
  sub_category  TEXT,
  duration_days INTEGER,
  price         REAL NOT NULL DEFAULT 0,
  is_active     INTEGER DEFAULT 1,
  created_at    TEXT DEFAULT (datetime('now','localtime')),
  updated_at    TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS members (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  phone       TEXT,
  gender      TEXT,
  notes       TEXT,
  photo_path  TEXT,
  created_at  TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS transactions (
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

CREATE TABLE IF NOT EXISTS memberships (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id      INTEGER NOT NULL REFERENCES members(id),
  product_id     INTEGER NOT NULL REFERENCES products(id),
  transaction_id INTEGER REFERENCES transactions(id),
  start_date     TEXT NOT NULL,
  end_date       TEXT NOT NULL,
  status         TEXT DEFAULT 'active' CHECK(status IN ('active','expired','paused','cancelled')),
  pause_start    TEXT,
  pause_end      TEXT,
  pause_reason   TEXT,
  created_at     TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS pool_inventory_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  category      TEXT NOT NULL,
  variant       TEXT,
  current_stock INTEGER DEFAULT 0,
  reorder_level INTEGER DEFAULT 5,
  unit_cost     REAL DEFAULT 0,
  selling_price REAL DEFAULT 0,
  is_active     INTEGER DEFAULT 1,
  created_at    TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS pool_inventory_transactions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id        INTEGER NOT NULL REFERENCES pool_inventory_items(id),
  txn_type       TEXT NOT NULL CHECK(txn_type IN ('in','out','adjustment')),
  quantity       INTEGER NOT NULL,
  reason         TEXT,
  transaction_id INTEGER REFERENCES transactions(id),
  staff_id       INTEGER NOT NULL REFERENCES users(id),
  unit_price     REAL,
  created_at     TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS restaurant_inventory_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  category      TEXT NOT NULL,
  unit          TEXT DEFAULT 'pcs',
  current_stock REAL DEFAULT 0,
  reorder_level REAL DEFAULT 5,
  unit_cost     REAL DEFAULT 0,
  selling_price REAL DEFAULT 0,
  is_active     INTEGER DEFAULT 1,
  created_at    TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS restaurant_inventory_transactions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id        INTEGER NOT NULL REFERENCES restaurant_inventory_items(id),
  txn_type       TEXT NOT NULL CHECK(txn_type IN ('in','out','adjustment')),
  quantity       REAL NOT NULL,
  reason         TEXT,
  transaction_id INTEGER REFERENCES transactions(id),
  staff_id       INTEGER NOT NULL REFERENCES users(id),
  unit_price     REAL,
  created_at     TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS bookings (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_name      TEXT NOT NULL,
  contact_person    TEXT,
  contact_phone     TEXT,
  booking_date      TEXT NOT NULL,
  time_slot         TEXT,
  num_people        INTEGER,
  facilities_booked TEXT,
  status            TEXT DEFAULT 'pending' CHECK(status IN ('pending','confirmed','completed','cancelled')),
  deposit_paid      REAL DEFAULT 0,
  deposit_method    TEXT CHECK(deposit_method IN ('cash','qr',NULL)),
  total_expected    REAL DEFAULT 0,
  notes             TEXT,
  deposit_transaction_id INTEGER REFERENCES transactions(id),
  created_by        INTEGER REFERENCES users(id),
  created_at        TEXT DEFAULT (datetime('now','localtime')),
  updated_at        TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS price_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id  INTEGER NOT NULL REFERENCES products(id),
  old_price   REAL NOT NULL,
  new_price   REAL NOT NULL,
  changed_by  INTEGER NOT NULL REFERENCES users(id),
  changed_at  TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
${SALE_MODEL_SQL}
`

export function initSchema(db) {
  db.exec(SCHEMA_SQL)
}
