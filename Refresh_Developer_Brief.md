# REFRESH MANAGER — Developer Brief
## Technical Specification for Windows Desktop Application
### Version 1.0 · June 2026

---

## 1. PROJECT SUMMARY

Build **Refresh Manager** — a Windows desktop application for Refresh Recreation Center Pvt. Ltd. (Boudha, Kathmandu, Nepal). The app replaces a paper logbook system. It has two interfaces: a simplified Staff interface for front desk use, and a full Owner interface for reporting and management. Full product requirements in `Refresh_Software_PRD.md`.

---

## 2. RECOMMENDED TECH STACK

| Layer | Technology | Reason |
|---|---|---|
| **App Framework** | Electron.js | Windows desktop via web tech; easy packaging as .exe; no browser limitation |
| **Database** | SQLite via `better-sqlite3` | Local, serverless, fast synchronous reads, zero setup for end user |
| **Frontend** | HTML + CSS + Vanilla JS | Simple, no build toolchain overhead; easy for AI-assisted development |
| **Excel Export** | ExcelJS | Full Excel formatting support (bold headers, colors, multi-sheet) |
| **Charts (Owner)** | Chart.js | Lightweight; works in Electron renderer without extra config |
| **Security** | bcryptjs | PIN and password hashing before storage |
| **Packaging** | electron-builder | Generates Windows .exe installer; code signing optional |
| **WhatsApp** | `shell.openExternal()` | Opens pre-filled wa.me URL in system browser — no API key needed |

**Node version:** 18+ LTS  
**Electron version:** 28+ (latest stable)

---

## 3. PROJECT STRUCTURE

```
refresh-manager/
├── main.js                        # Electron entry point
├── preload.js                     # Context bridge (exposes safe IPC to renderer)
├── package.json
├── electron-builder.config.js     # Build config for .exe packaging
│
├── src/
│   ├── main/                      # Main process (Node.js / backend logic)
│   │   ├── database/
│   │   │   ├── db.js              # SQLite connection singleton
│   │   │   ├── schema.js          # CREATE TABLE statements + migrations
│   │   │   └── seed.js            # Initial product catalogue + default settings
│   │   ├── handlers/              # IPC handler modules (one per domain)
│   │   │   ├── auth.js
│   │   │   ├── transactions.js
│   │   │   ├── members.js
│   │   │   ├── inventory.js
│   │   │   ├── reports.js
│   │   │   ├── settings.js
│   │   │   └── whatsapp.js
│   │   └── utils/
│   │       ├── excel.js           # ExcelJS export functions
│   │       └── backup.js          # Database backup to configured folder
│   │
│   └── renderer/                  # Renderer process (HTML/CSS/JS UI)
│       ├── login/
│       │   ├── index.html
│       │   ├── style.css
│       │   └── login.js
│       ├── staff/
│       │   ├── index.html
│       │   ├── style.css
│       │   └── js/
│       │       ├── app.js         # Router + state manager
│       │       ├── transaction.js # New transaction screen
│       │       ├── members.js     # Member search screen
│       │       ├── inventory.js   # Stock view screen
│       │       └── eod.js         # End-of-day screen
│       └── owner/
│           ├── index.html
│           ├── style.css
│           └── js/
│               ├── app.js         # Router + state manager
│               ├── dashboard.js   # Home dashboard widgets
│               ├── transactions.js # Full transaction log + filters
│               ├── members.js     # Member management
│               ├── inventory.js   # Inventory management
│               ├── reports.js     # Report generation + export
│               └── settings.js    # All settings screens
│
├── assets/
│   ├── logo.png                   # Refresh logo for login screen
│   ├── icon.ico                   # App icon for taskbar + installer
│   └── fonts/                     # Any custom fonts bundled with app
│
└── data/                          # Created at runtime on user's machine
    ├── refresh.db                 # SQLite database file
    └── backups/                   # Auto-backup destination (default)
```

---

## 4. DATABASE SCHEMA

### 4.1 `users`
```sql
CREATE TABLE users (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  role         TEXT NOT NULL CHECK(role IN ('owner', 'staff')),
  pin_hash     TEXT,           -- bcrypt hash; used for staff 4-digit PINs
  password_hash TEXT,          -- bcrypt hash; used for owner password
  is_active    INTEGER DEFAULT 1,
  created_at   TEXT DEFAULT (datetime('now', 'localtime'))
);
```

### 4.2 `products`
```sql
CREATE TABLE products (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  category      TEXT NOT NULL CHECK(category IN ('membership', 'day_package', 'day_pass')),
  sub_category  TEXT,          -- e.g. 'swimming_training', 'gym', 'combined', 'package'
  duration_days INTEGER,       -- NULL for day passes/packages; 15, 30, 90, 180, 365 for memberships
  price         REAL NOT NULL,
  is_active     INTEGER DEFAULT 1,
  created_at    TEXT DEFAULT (datetime('now', 'localtime')),
  updated_at    TEXT DEFAULT (datetime('now', 'localtime'))
);
```

### 4.3 `members`
```sql
CREATE TABLE members (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  phone       TEXT,
  gender      TEXT,
  notes       TEXT,
  photo_path  TEXT,            -- relative path to stored photo file
  created_at  TEXT DEFAULT (datetime('now', 'localtime'))
);
```

### 4.4 `memberships`
```sql
CREATE TABLE memberships (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id       INTEGER NOT NULL REFERENCES members(id),
  product_id      INTEGER NOT NULL REFERENCES products(id),
  transaction_id  INTEGER REFERENCES transactions(id),
  start_date      TEXT NOT NULL,
  end_date        TEXT NOT NULL,
  status          TEXT DEFAULT 'active' CHECK(status IN ('active','expired','paused','cancelled')),
  pause_start     TEXT,
  pause_end       TEXT,
  pause_reason    TEXT,
  created_at      TEXT DEFAULT (datetime('now', 'localtime'))
);
```

### 4.5 `transactions`
```sql
CREATE TABLE transactions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_type TEXT NOT NULL CHECK(transaction_type IN ('membership','day_package','day_pass','inventory')),
  customer_name   TEXT NOT NULL,
  phone           TEXT,
  product_id      INTEGER REFERENCES products(id),
  member_id       INTEGER REFERENCES members(id),
  amount          REAL NOT NULL,
  payment_method  TEXT NOT NULL CHECK(payment_method IN ('cash','qr')),
  staff_id        INTEGER NOT NULL REFERENCES users(id),
  notes           TEXT,
  is_voided       INTEGER DEFAULT 0,
  void_reason     TEXT,
  void_by         INTEGER REFERENCES users(id),
  void_at         TEXT,
  created_at      TEXT DEFAULT (datetime('now', 'localtime'))
);
```

### 4.6 `inventory_items`
```sql
CREATE TABLE inventory_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  category        TEXT NOT NULL,   -- 'swimwear_ladies', 'swimwear_gents', 'swimwear_children', 'accessories', 'equipment'
  variant         TEXT,            -- e.g. 'Size M', 'Large', 'Girls'
  current_stock   INTEGER DEFAULT 0,
  reorder_level   INTEGER DEFAULT 5,
  unit_cost       REAL DEFAULT 0,
  selling_price   REAL DEFAULT 0,
  is_active       INTEGER DEFAULT 1,
  created_at      TEXT DEFAULT (datetime('now', 'localtime'))
);
```

### 4.7 `inventory_transactions`
```sql
CREATE TABLE inventory_transactions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id         INTEGER NOT NULL REFERENCES inventory_items(id),
  txn_type        TEXT NOT NULL CHECK(txn_type IN ('in','out','adjustment')),
  quantity        INTEGER NOT NULL,
  reason          TEXT,            -- required for 'adjustment' type
  transaction_id  INTEGER REFERENCES transactions(id),  -- linked sale if txn_type = 'out'
  staff_id        INTEGER NOT NULL REFERENCES users(id),
  created_at      TEXT DEFAULT (datetime('now', 'localtime'))
);
```

### 4.8 `price_history`
```sql
CREATE TABLE price_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id  INTEGER NOT NULL REFERENCES products(id),
  old_price   REAL NOT NULL,
  new_price   REAL NOT NULL,
  changed_by  INTEGER NOT NULL REFERENCES users(id),
  changed_at  TEXT DEFAULT (datetime('now', 'localtime'))
);
```

### 4.9 `settings`
```sql
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
-- Seeded with default values at first run
```

---

## 5. IPC CHANNEL REFERENCE

All communication between renderer (UI) and main process (backend) uses Electron IPC via `ipcRenderer.invoke()` (two-way) or `ipcRenderer.send()` (fire-and-forget). All handlers are registered in `main.js` using `ipcMain.handle()`.

### Auth
| Channel | Direction | Payload | Returns |
|---|---|---|---|
| `auth:login` | R→M | `{ role, pin?, password?, username? }` | `{ success, user, token }` |
| `auth:logout` | R→M | `{ userId }` | `{ success }` |
| `auth:change-pin` | R→M | `{ staffId, newPin }` | `{ success }` |
| `auth:change-password` | R→M | `{ newPassword }` | `{ success }` |

### Transactions
| Channel | Direction | Payload | Returns |
|---|---|---|---|
| `transactions:create` | R→M | `{ type, customerId?, name, phone, productId, memberId?, amount, paymentMethod, notes, staffId }` | `{ success, transactionId }` |
| `transactions:list` | R→M | `{ dateFrom, dateTo, type?, staffId?, paymentMethod? }` | `{ transactions[] }` |
| `transactions:today-summary` | R→M | `{}` | `{ total, cash, qr, byType{} }` |
| `transactions:void` | R→M | `{ transactionId, reason, ownerId }` | `{ success }` |

### Members
| Channel | Direction | Payload | Returns |
|---|---|---|---|
| `members:create` | R→M | `{ name, phone, gender, notes, photoPath? }` | `{ success, memberId }` |
| `members:search` | R→M | `{ query }` | `{ members[] }` | 
| `members:get` | R→M | `{ memberId }` | `{ member, activeMembership? }` |
| `members:update` | R→M | `{ memberId, fields{} }` | `{ success }` |
| `members:add-membership` | R→M | `{ memberId, productId, startDate, transactionId }` | `{ success, membershipId }` |
| `members:renew` | R→M | `{ membershipId, newStartDate, transactionId }` | `{ success }` |
| `members:pause` | R→M | `{ membershipId, pauseStart, pauseReason }` | `{ success }` |
| `members:resume` | R→M | `{ membershipId, pauseEnd }` | `{ success }` |
| `members:expiring-soon` | R→M | `{ days }` | `{ members[] }` |

### Inventory
| Channel | Direction | Payload | Returns |
|---|---|---|---|
| `inventory:list` | R→M | `{ category? }` | `{ items[] }` |
| `inventory:restock` | R→M | `{ itemId, quantity, staffId }` | `{ success, newStock }` |
| `inventory:sell` | R→M | `{ itemId, quantity, transactionId, staffId }` | `{ success, newStock }` |
| `inventory:adjust` | R→M | `{ itemId, newQuantity, reason, staffId }` | `{ success }` |
| `inventory:add-item` | R→M | `{ name, category, variant, reorderLevel, unitCost, sellingPrice }` | `{ success, itemId }` |
| `inventory:update-price` | R→M | `{ itemId, newPrice }` | `{ success }` |
| `inventory:low-stock` | R→M | `{}` | `{ items[] }` |

### Products & Pricing
| Channel | Direction | Payload | Returns |
|---|---|---|---|
| `products:list` | R→M | `{ category?, activeOnly? }` | `{ products[] }` |
| `products:update-price` | R→M | `{ productId, newPrice, ownerId }` | `{ success }` |
| `products:add` | R→M | `{ name, category, subCategory, durationDays, price }` | `{ success, productId }` |
| `products:toggle-active` | R→M | `{ productId, isActive }` | `{ success }` |
| `products:price-history` | R→M | `{ productId }` | `{ history[] }` |

### Reports & Export
| Channel | Direction | Payload | Returns |
|---|---|---|---|
| `reports:daily` | R→M | `{ date }` | `{ summary, transactions[] }` |
| `reports:monthly` | R→M | `{ year, month }` | `{ summary, byWeek[], byProduct[] }` |
| `reports:custom` | R→M | `{ dateFrom, dateTo, filters{} }` | `{ summary, transactions[] }` |
| `reports:export-excel` | R→M | `{ reportType, data, savePath? }` | `{ success, filePath }` |

### Settings
| Channel | Direction | Payload | Returns |
|---|---|---|---|
| `settings:get` | R→M | `{ key }` | `{ value }` |
| `settings:set` | R→M | `{ key, value }` | `{ success }` |
| `settings:get-all` | R→M | `{}` | `{ settings{} }` |

### WhatsApp & Backup
| Channel | Direction | Payload | Returns |
|---|---|---|---|
| `whatsapp:send-eod` | R→M | `{ date? }` | `{ success }` (opens browser) |
| `backup:create` | R→M | `{ destinationPath? }` | `{ success, filePath }` |
| `backup:set-path` | R→M | `{ path }` | `{ success }` |

---

## 6. DEFAULT SEED DATA

Run `seed.js` on first launch (check for `settings.seeded = true` flag).

### Products to seed:
```javascript
const products = [
  // Swimming Training
  { name: 'Beginner Training', category: 'membership', sub_category: 'swimming_training', duration_days: 15,  price: 0 },
  { name: 'Beginner Training', category: 'membership', sub_category: 'swimming_training', duration_days: 30,  price: 0 },
  { name: 'Advanced Training', category: 'membership', sub_category: 'swimming_training', duration_days: 15,  price: 0 },
  { name: 'Advanced Training', category: 'membership', sub_category: 'swimming_training', duration_days: 30,  price: 0 },
  // Gym Only
  { name: 'Gym Only',          category: 'membership', sub_category: 'gym',               duration_days: 30,  price: 0 },
  { name: 'Gym Only',          category: 'membership', sub_category: 'gym',               duration_days: 90,  price: 0 },
  { name: 'Gym Only',          category: 'membership', sub_category: 'gym',               duration_days: 180, price: 0 },
  { name: 'Gym Only',          category: 'membership', sub_category: 'gym',               duration_days: 365, price: 0 },
  // Swimming + Gym
  { name: 'Swimming + Gym',    category: 'membership', sub_category: 'combined',          duration_days: 30,  price: 0 },
  { name: 'Swimming + Gym',    category: 'membership', sub_category: 'combined',          duration_days: 90,  price: 0 },
  { name: 'Swimming + Gym',    category: 'membership', sub_category: 'combined',          duration_days: 180, price: 0 },
  { name: 'Swimming + Gym',    category: 'membership', sub_category: 'combined',          duration_days: 365, price: 0 },
  // Day Packages
  { name: 'Sauna + Steam + Jacuzzi',    category: 'day_package', sub_category: 'package', duration_days: null, price: 0 },
  { name: 'Swimming + Sauna + Steam',   category: 'day_package', sub_category: 'package', duration_days: null, price: 0 },
  { name: 'Whole Package',              category: 'day_package', sub_category: 'package', duration_days: null, price: 0 },
  // Day Passes
  { name: 'Pool Day Pass', category: 'day_pass', sub_category: 'pass', duration_days: null, price: 0 },
  { name: 'Gym Day Pass',  category: 'day_pass', sub_category: 'pass', duration_days: null, price: 0 },
];
// NOTE: All prices seeded as 0 — owner sets real prices on first login via Settings > Pricing Manager
```

### Inventory items to seed:
```javascript
const inventoryItems = [
  { name: 'Ladies Costume', category: 'swimwear_ladies',    variant: 'Full Body', current_stock: 0, reorder_level: 3 },
  { name: 'Ladies Costume', category: 'swimwear_ladies',    variant: 'Half',      current_stock: 0, reorder_level: 3 },
  { name: 'Gents Costume',  category: 'swimwear_gents',     variant: null,        current_stock: 0, reorder_level: 3 },
  { name: 'Baby Costume',   category: 'swimwear_children',  variant: 'Girls',     current_stock: 0, reorder_level: 3 },
  { name: 'Baby Costume',   category: 'swimwear_children',  variant: 'Boys',      current_stock: 0, reorder_level: 3 },
  { name: 'Goggles',        category: 'accessories',        variant: 'Adult Large', current_stock: 0, reorder_level: 5 },
  { name: 'Goggles',        category: 'accessories',        variant: 'Adult Small', current_stock: 0, reorder_level: 5 },
  { name: 'Goggles',        category: 'accessories',        variant: 'Baby',        current_stock: 0, reorder_level: 5 },
  { name: 'Swimming Cap',   category: 'accessories',        variant: 'Large',     current_stock: 0, reorder_level: 5 },
  { name: 'Swimming Cap',   category: 'accessories',        variant: 'Small',     current_stock: 0, reorder_level: 5 },
  { name: 'Nose Pin',       category: 'accessories',        variant: null,        current_stock: 0, reorder_level: 10 },
  { name: 'Floating Tube',  category: 'equipment',          variant: null,        current_stock: 0, reorder_level: 2 },
];
```

### Default settings to seed:
```javascript
const defaultSettings = [
  { key: 'business_name',       value: 'Refresh Recreation Center' },
  { key: 'business_phone',      value: '+977 9801010422' },
  { key: 'business_address',    value: 'Nayabasti, Boudha, Kathmandu' },
  { key: 'whatsapp_owner_number', value: '' },       // Owner sets this
  { key: 'eod_auto_send_time',  value: '' },         // e.g. '21:00'; empty = manual only
  { key: 'backup_path',         value: '' },         // Owner sets this
  { key: 'backup_auto_daily',   value: 'true' },
  { key: 'currency_symbol',     value: 'Rs.' },
  { key: 'expiry_warning_days', value: '5' },
  { key: 'seeded',              value: 'true' },
];
```

---

## 7. WHATSAPP EOD IMPLEMENTATION

```javascript
// src/main/handlers/whatsapp.js

const { shell } = require('electron');
const db = require('../database/db');

function generateEODMessage(date) {
  const dateStr = date || new Date().toLocaleDateString('en-GB');

  // Query today's totals
  const summary = db.prepare(`
    SELECT
      SUM(amount) as total,
      SUM(CASE WHEN payment_method = 'cash' THEN amount ELSE 0 END) as cash,
      SUM(CASE WHEN payment_method = 'qr'   THEN amount ELSE 0 END) as qr,
      COUNT(*) as count,
      SUM(CASE WHEN transaction_type = 'membership'   THEN amount ELSE 0 END) as membership_rev,
      SUM(CASE WHEN transaction_type = 'day_package'  THEN amount ELSE 0 END) as package_rev,
      SUM(CASE WHEN transaction_type = 'day_pass'     THEN amount ELSE 0 END) as pass_rev,
      SUM(CASE WHEN transaction_type = 'membership'   THEN 1 ELSE 0 END) as membership_count,
      SUM(CASE WHEN transaction_type = 'day_package'  THEN 1 ELSE 0 END) as package_count,
      SUM(CASE WHEN transaction_type = 'day_pass'     THEN 1 ELSE 0 END) as pass_count
    FROM transactions
    WHERE date(created_at) = date('now', 'localtime')
    AND is_voided = 0
  `).get();

  const staffRow = db.prepare(`
    SELECT u.name FROM transactions t
    JOIN users u ON t.staff_id = u.id
    WHERE date(t.created_at) = date('now', 'localtime')
    ORDER BY t.created_at DESC LIMIT 1
  `).get();

  const message = 
`🏊 Refresh Recreation Center
📅 Daily Summary — ${dateStr}

💰 REVENUE
Total: Rs. ${summary.total || 0}
  • Cash: Rs. ${summary.cash || 0}
  • QR: Rs. ${summary.qr || 0}

📋 TRANSACTIONS (${summary.count || 0} total)
  • Memberships: ${summary.membership_count || 0} — Rs. ${summary.membership_rev || 0}
  • Day Packages: ${summary.package_count || 0} — Rs. ${summary.package_rev || 0}
  • Day Passes: ${summary.pass_count || 0} — Rs. ${summary.pass_rev || 0}

👤 Staff on duty: ${staffRow?.name || 'N/A'}

— Sent from Refresh Manager`;

  return message;
}

ipcMain.handle('whatsapp:send-eod', (event, { date } = {}) => {
  const ownerNumber = db.prepare(`SELECT value FROM settings WHERE key = 'whatsapp_owner_number'`).get()?.value;
  if (!ownerNumber) return { success: false, error: 'Owner WhatsApp number not configured in Settings.' };

  const message = generateEODMessage(date);
  const encoded = encodeURIComponent(message);
  const url = `https://wa.me/${ownerNumber}?text=${encoded}`;

  shell.openExternal(url);
  return { success: true };
});
```

---

## 8. EXCEL EXPORT IMPLEMENTATION

```javascript
// src/main/utils/excel.js — example for Daily Revenue Report

const ExcelJS = require('exceljs');
const { dialog } = require('electron');
const path = require('path');

const BRAND_BLUE = '001F5B';    // Dark navy header
const BRAND_LIGHT = 'E8F4FD';  // Light blue alternating rows

async function exportDailyRevenue(event, { date, transactions, summary }) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Refresh Manager';

  // Sheet 1: Summary
  const summarySheet = workbook.addWorksheet('Summary');
  summarySheet.columns = [
    { header: 'Category', key: 'category', width: 25 },
    { header: 'Count',    key: 'count',    width: 12 },
    { header: 'Amount (NPR)', key: 'amount', width: 18 },
  ];
  // Style header row
  summarySheet.getRow(1).eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_BLUE } };
    cell.font = { color: { argb: 'FFFFFF' }, bold: true };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  summarySheet.getRow(1).height = 24;
  // Add summary data...

  // Sheet 2: Transaction Detail
  const detailSheet = workbook.addWorksheet('Transactions');
  detailSheet.columns = [
    { header: '#',              key: 'id',             width: 8 },
    { header: 'Time',           key: 'time',           width: 12 },
    { header: 'Customer',       key: 'customer',       width: 22 },
    { header: 'Phone',          key: 'phone',          width: 16 },
    { header: 'Type',           key: 'type',           width: 16 },
    { header: 'Product',        key: 'product',        width: 28 },
    { header: 'Amount (NPR)',   key: 'amount',         width: 16 },
    { header: 'Payment',        key: 'payment',        width: 12 },
    { header: 'Staff',          key: 'staff',          width: 16 },
    { header: 'Notes',          key: 'notes',          width: 22 },
  ];
  // Style headers same as above...
  // Add transaction rows with alternating fill...

  // Add totals row
  const totalRow = detailSheet.addRow({ customer: 'TOTAL', amount: summary.total });
  totalRow.font = { bold: true };

  // Save dialog
  const { filePath } = await dialog.showSaveDialog({
    defaultPath: `Refresh_DailyRevenue_${date}.xlsx`,
    filters: [{ name: 'Excel', extensions: ['xlsx'] }],
  });

  if (filePath) {
    await workbook.xlsx.writeFile(filePath);
    return { success: true, filePath };
  }
  return { success: false };
}
```

---

## 9. SECURITY MODEL

| Rule | Implementation |
|---|---|
| Passwords and PINs never stored in plain text | bcryptjs hash before INSERT; compare with `bcrypt.compare()` on login |
| Staff cannot access owner IPC handlers | Each handler checks `event.sender` session role before executing |
| Transactions cannot be deleted by staff | `is_voided` flag only; hard delete never exposed; void requires owner session |
| All voids are audited | `void_reason`, `void_by`, `void_at` columns always written |
| Price changes are logged | Trigger-equivalent: write to `price_history` on every UPDATE to `products.price` |
| Session management | Simple in-memory session object in main process; cleared on logout or app close |

---

## 10. DISPLAY LOGIC — KEY UI RULES

### Product Label in UI
When displaying a product to staff in a dropdown, format as:
- Membership: `"{name} — {duration_label}"` e.g. `"Gym Only — 3 Months"` or `"Beginner Training — 15 Days"`
- Day Package: just the package name e.g. `"Whole Package"`  
- Day Pass: `"Pool Day Pass"`, `"Gym Day Pass"`

Duration labels:
- 15 days → `"15 Days"`
- 30 days → `"Monthly"`
- 90 days → `"3 Months"`
- 180 days → `"6 Months"`
- 365 days → `"1 Year"`

### Membership Status Badge Colors
| Status | Badge Color |
|---|---|
| Active | Green (#22c55e) |
| Expiring Soon (≤5 days) | Amber (#f59e0b) |
| Expired | Red (#ef4444) |
| Paused | Grey (#6b7280) |

### Date Calculations
- All dates stored as ISO strings: `YYYY-MM-DD`
- End date = start date + `duration_days` (inclusive)
- "Expiring Soon" = `end_date <= today + expiry_warning_days setting`
- Use local timezone for all date operations (Nepal is UTC+5:45)

---

## 11. MAIN.JS STRUCTURE

```javascript
// main.js — skeleton

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

// Import all handler modules
const { registerAuthHandlers }         = require('./src/main/handlers/auth');
const { registerTransactionHandlers }  = require('./src/main/handlers/transactions');
const { registerMemberHandlers }       = require('./src/main/handlers/members');
const { registerInventoryHandlers }    = require('./src/main/handlers/inventory');
const { registerReportHandlers }       = require('./src/main/handlers/reports');
const { registerSettingsHandlers }     = require('./src/main/handlers/settings');
const { registerWhatsappHandlers }     = require('./src/main/handlers/whatsapp');

const { initDatabase } = require('./src/main/database/schema');
const { seedDatabase }  = require('./src/main/database/seed');
const { setupAutoBackup } = require('./src/main/utils/backup');

let mainWindow;

function createLoginWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 600,
    resizable: false,
    frame: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile('src/renderer/login/index.html');
}

function createStaffWindow() { /* similar; load staff/index.html; set size 1280x800 */ }
function createOwnerWindow() { /* similar; load owner/index.html; set size 1440x900 */ }

app.whenReady().then(() => {
  initDatabase();
  seedDatabase();
  registerAuthHandlers(createStaffWindow, createOwnerWindow);
  registerTransactionHandlers();
  registerMemberHandlers();
  registerInventoryHandlers();
  registerReportHandlers();
  registerSettingsHandlers();
  registerWhatsappHandlers();
  setupAutoBackup();
  createLoginWindow();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
```

---

## 12. PRELOAD.JS (Context Bridge)

```javascript
// preload.js — exposes safe IPC calls to renderer

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Auth
  login:           (data) => ipcRenderer.invoke('auth:login', data),
  logout:          (data) => ipcRenderer.invoke('auth:logout', data),

  // Transactions
  createTransaction:    (data) => ipcRenderer.invoke('transactions:create', data),
  listTransactions:     (data) => ipcRenderer.invoke('transactions:list', data),
  getTodaySummary:      ()     => ipcRenderer.invoke('transactions:today-summary'),
  voidTransaction:      (data) => ipcRenderer.invoke('transactions:void', data),

  // Members
  createMember:    (data) => ipcRenderer.invoke('members:create', data),
  searchMembers:   (data) => ipcRenderer.invoke('members:search', data),
  getMember:       (data) => ipcRenderer.invoke('members:get', data),
  updateMember:    (data) => ipcRenderer.invoke('members:update', data),
  addMembership:   (data) => ipcRenderer.invoke('members:add-membership', data),
  renewMembership: (data) => ipcRenderer.invoke('members:renew', data),
  getExpiringSoon: (data) => ipcRenderer.invoke('members:expiring-soon', data),

  // Products
  listProducts:    (data) => ipcRenderer.invoke('products:list', data),
  updatePrice:     (data) => ipcRenderer.invoke('products:update-price', data),

  // Inventory
  listInventory:   (data) => ipcRenderer.invoke('inventory:list', data),
  restockItem:     (data) => ipcRenderer.invoke('inventory:restock', data),
  adjustStock:     (data) => ipcRenderer.invoke('inventory:adjust', data),
  getLowStock:     ()     => ipcRenderer.invoke('inventory:low-stock'),

  // Reports
  getDailyReport:  (data) => ipcRenderer.invoke('reports:daily', data),
  getMonthlyReport:(data) => ipcRenderer.invoke('reports:monthly', data),
  exportExcel:     (data) => ipcRenderer.invoke('reports:export-excel', data),

  // Settings
  getSetting:      (data) => ipcRenderer.invoke('settings:get', data),
  setSetting:      (data) => ipcRenderer.invoke('settings:set', data),
  getAllSettings:   ()     => ipcRenderer.invoke('settings:get-all'),

  // WhatsApp + Backup
  sendEODReport:   (data) => ipcRenderer.invoke('whatsapp:send-eod', data),
  createBackup:    (data) => ipcRenderer.invoke('backup:create', data),
});
```

---

## 13. PACKAGING — ELECTRON BUILDER CONFIG

```javascript
// electron-builder.config.js

module.exports = {
  appId: 'com.refreshrecreation.manager',
  productName: 'Refresh Manager',
  directories: { output: 'dist' },
  files: [
    'main.js',
    'preload.js',
    'src/**/*',
    'assets/**/*',
    'package.json',
  ],
  win: {
    target: 'nsis',           // Creates standard Windows installer
    icon: 'assets/icon.ico',
  },
  nsis: {
    oneClick: false,           // User chooses install location
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Refresh Manager',
  },
  extraResources: [
    { from: 'data/', to: 'data/', filter: ['**/*'] },  // Bundle empty data dir
  ],
};
```

---

## 14. DEVELOPMENT PHASES & MILESTONES

| Phase | Duration | Scope | Done When |
|---|---|---|---|
| **Phase 1** — Foundation | Week 1–2 | Electron scaffold, SQLite schema + seed, login screen, auth handlers, preload bridge | App opens, login works for both roles, DB initialises correctly |
| **Phase 2** — Staff Core | Week 3–4 | Staff interface: home screen, new transaction flow, today's log, member search | Staff can log a full walk-in transaction and membership sale end-to-end |
| **Phase 3** — Owner Core | Week 5–6 | Owner dashboard, transaction log with filters, member list, expiry alerts, basic settings | Owner can see revenue summary, filter transactions, edit prices |
| **Phase 4** — Inventory | Week 7 | Inventory module (both staff view and owner management), low-stock alerts | Staff can view stock; owner can restock and adjust; low-stock alerts appear on dashboard |
| **Phase 5** — Export & Ops | Week 8 | Excel export (all report types), WhatsApp EOD, auto-backup, packaging | All exports work; EOD WhatsApp opens correctly; .exe installer builds and installs cleanly |
| **Phase 6** — Polish | Week 9 | QA, edge cases, error handling, loading states, empty state UI, receipt display | No crashes on common workflows; all error states handled gracefully |

---

## 15. OPEN QUESTIONS FOR OWNER (ANSWERS NEEDED BEFORE OR DURING BUILD)

| # | Question | Needed For |
|---|---|---|
| 1 | Exact pricing for all 17 products | Pre-populating seed data (can also be set post-install) |
| 2 | Swimwear size variants needed (S/M/L/XL only, or others?) | Inventory item setup |
| 3 | Can staff apply a discount? If yes, freely or with owner override code? | Transaction form logic |
| 4 | Is there a receipt printer at reception? Model/brand? | Receipt print feature |
| 5 | How many staff will have their own PIN at launch? | User setup |
| 6 | Should membership pausing be available in v1? | Membership logic complexity |
| 7 | Owner's WhatsApp number for EOD report | Settings configuration |
| 8 | Preferred backup folder location (e.g. USB drive, specific folder)? | Backup configuration |

---

*Developer Brief prepared June 2026 · Refresh Recreation Center Pvt. Ltd.*
*Reference document: Refresh_Software_PRD.md*
*Stack: Electron + SQLite + ExcelJS · Target: Windows 10+*
