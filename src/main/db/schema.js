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
  transaction_type TEXT NOT NULL CHECK(transaction_type IN ('membership','day_package','day_pass','pool_inventory','restaurant')),
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
`

export function initSchema(db) {
  db.exec(SCHEMA_SQL)
}
