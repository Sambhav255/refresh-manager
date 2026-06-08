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
}
