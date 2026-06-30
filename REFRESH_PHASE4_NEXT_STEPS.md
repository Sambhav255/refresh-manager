# REFRESH MANAGER — Phase 4
## Next steps: commit → test → package → deploy → build further
### Read fully before opening Cursor

---

## STATUS SNAPSHOT

Phase 3 is complete. The full-stack Electron app is running at:
`/Users/sambhav/Desktop/Refresh Manager/refresh-manager/`

What exists and works:
- SQLite database with full schema + seed
- Auth: setup wizard, staff PIN, owner password, role-gated IPC
- All IPC handlers wired, preload bridge live
- Pricing manager (DB-driven, not hardcoded)
- Pool + restaurant dual inventory (dynamic, admin-managed)
- Bookings/calendar module (staff read-only, owner full CRUD)
- Ticket printing (silent print via hidden Electron window)
- Excel export, WhatsApp EOD
- No commits made yet

---

## STEP 1 — COMMIT PHASE 3 (do this before anything else) - this is already done i think, see what i have here and do accordingly: https://github.com/Sambhav255/refresh-manager

Phase 3 has no commits. Create one clean commit per area so the git log is readable
and you can roll back individual areas if needed.

```bash
cd "/Users/sambhav/Desktop/Refresh Manager/refresh-manager"

git add src/main/db/
git commit -m "feat(db): SQLite schema, seed, and better-sqlite3 setup (Area A)"

git add src/main/ipc/ src/preload/index.js src/renderer/src/lib/api.js
git commit -m "feat(ipc): full IPC handler suite + preload bridge + renderer api helper (Area C)"

git add src/renderer/src/App.jsx
git commit -m "feat(auth): setup wizard, PIN/password login, in-memory session, role guards (Area B)"

git add src/renderer/src/screens/
git commit -m "feat(pricing): DB-driven product prices, zero-price banner, pricing manager (Area D)"

git add src/renderer/src/screens/owner*Inventory* src/renderer/src/screens/ownerRestaurant*
git commit -m "feat(inventory): dual pool/restaurant inventory, dynamic add-item, dashboard revenue split (Feature 1)"

git add src/renderer/src/screens/*Booking* src/renderer/src/screens/*booking*
git commit -m "feat(bookings): calendar module, staff read-only view, owner CRUD, dashboard widget (Feature 2)"

git add src/renderer/ticket.html src/main/ipc/tickets*
git commit -m "feat(tickets): A6 ticket template, silent print IPC, print button on transaction success (Feature 3)"

git add .
git commit -m "feat(reports): Excel export via ExcelJS, WhatsApp EOD with wa.me URL"
```

If files span multiple areas (e.g. App.jsx was touched across B, C, D), just do a
single Phase 3 commit instead:

```bash
git add .
git commit -m "feat: Phase 3 complete — auth, IPC, pricing, dual inventory, bookings, tickets, exports"
```

---

## STEP 2 — COMPREHENSIVE TESTING

Run through every flow listed below before packaging. Fix everything that fails.
Work through them in order — later flows depend on earlier ones working.

---

### 2A — First-launch setup wizard

```
Action                                  Expected result
───────────────────────────────────────────────────────────────────────────────
npm run dev on a fresh DB (delete       Setup wizard appears, not login screen
refresh.db from userData if needed)
Enter owner name + password             Accepted, no validation errors
Confirm password mismatch               Inline error "Passwords do not match"
Enter first staff name + 4-digit PIN    Accepted
Submit setup                            Goes directly to owner dashboard
Run npm run dev again (DB exists)       Normal login screen appears, not wizard
```

**How to find userData path for testing:**
```js
// Add this temporarily to src/main/index.js to print the DB path on launch
const { app } = require('electron')
console.log('userData:', app.getPath('userData'))
```
Look in the console output for the path. Delete `refresh.db` from that folder to
trigger the setup wizard again.

---

### 2B — Authentication

```
Action                                  Expected result
───────────────────────────────────────────────────────────────────────────────
Staff login: correct PIN                Goes to staff dashboard
Staff login: wrong PIN                  Inline error, no redirect
Staff login: try owner username         Should fail (not a valid staff PIN format)
Owner login: correct credentials        Goes to owner dashboard
Owner login: wrong password             Inline error, no redirect
Owner login: try staff PIN              Should fail
Esc key from any screen                 Returns to login
"Log out" button                        Returns to login, session cleared
Refresh app (Cmd+R in dev)              Returns to login (in-memory session cleared)
```

---

### 2C — New Transaction (staff)

```
Action                                  Expected result
───────────────────────────────────────────────────────────────────────────────
Open New Transaction before prices set  Yellow banner: "Prices not configured"
Set prices in Settings → Pricing Mgr   Prices appear in transaction dropdown
Open New Transaction after prices set   Product dropdown shows products + prices
Select "Membership" → pick product      Price auto-fills from DB
Customer name: leave blank              Should still save (name = "Walk-in")
Select "Cash" payment                   Button highlights
Select "QR" payment                     Button highlights, Cash deselects
Hit Confirm & Save                      Success screen appears
Success screen: "Print Ticket"          Ticket prints (or error if no printer)
Success screen: "Done"                  Returns to Staff Home
Success screen: "New transaction"       Resets wizard at step 0
```

**Verify in DB:**
Open a DB browser (TablePlus, DB Browser for SQLite) and check:
- `transactions` table has a new row with correct data
- `staff_id` matches the logged-in staff user's ID
- `created_at` has today's date with Nepal local time (not UTC)

---

### 2D — Membership transaction (specific)

```
Action                                  Expected result
───────────────────────────────────────────────────────────────────────────────
New Transaction → Membership            Step 2 shows membership products only
Pick "Swimming + Gym — Monthly"         Price appears
Enter member name + phone               Fields accept input
Confirm & Save                          Transaction + membership record created
Search that member immediately after    Member appears with "Active" badge
                                        Expiry date = today + 30 days
Search a non-existent member            "No results" empty state shown
```

---

### 2E — Today's Log and Owner Dashboard

```
Action                                  Expected result
───────────────────────────────────────────────────────────────────────────────
Enter 3 transactions (mix of cash/QR)   All appear in Today's Log
Today's Log total                       Matches sum of transactions
Owner Dashboard → revenue               Matches Today's Log total
Owner Dashboard revenue split           Pool revenue excludes restaurant sales
Owner Transactions screen               Shows all today's transactions with filters
Filter by "Cash"                        Only cash rows shown
Filter by "Membership"                  Only membership rows shown
```

---

### 2F — Inventory (pool)

```
Action                                  Expected result
───────────────────────────────────────────────────────────────────────────────
Owner Inventory: initial state          All seeded items with stock = 0
Add new item (custom name/category)     Appears in list immediately
Restock an item: +10                    Stock shows 10
Staff sells item via inventory          Stock decrements, transaction created
Stock drops below reorder level         Item highlighted red
Owner dashboard                         Low-stock alert shows item name
```

---

### 2G — Restaurant inventory (separate)

```
Action                                  Expected result
───────────────────────────────────────────────────────────────────────────────
Owner sidebar: Restaurant               Opens separate screen from pool inventory
Add a restaurant item                   Only appears in restaurant, not pool
Record restaurant sale                  Transaction created with source = 'restaurant'
Owner dashboard revenue                 Restaurant revenue shown separately from pool
Export restaurant report                Only restaurant transactions in the file
```

---

### 2H — Bookings

```
Action                                  Expected result
───────────────────────────────────────────────────────────────────────────────
Owner: create a booking (future date)   Appears in Upcoming list
Create a booking in the past            Should appear in All, not Upcoming
Staff Home: Bookings tile               Shows count of upcoming this week
Staff: open Bookings                    Read-only list visible
Staff: mark booking "Completed"         Status updates, badge changes
Owner: edit a booking                   Form pre-filled, changes save
Owner: cancel a booking                 Status = cancelled, shows in All not Upcoming
Owner dashboard upcoming widget         Shows next 2–3 bookings
```

---

### 2I — Ticket printing

```
Action                                  Expected result
───────────────────────────────────────────────────────────────────────────────
Complete a transaction                  "Print Ticket" button on success screen
Click Print Ticket (printer connected)  System print dialog or silent print
Click Print Ticket (no printer)         Error message shown, can still click Done
Ticket content                          Transaction ID, name, product, date/time,
                                        payment method, amount, validity note
```

---

### 2J — Pricing manager

```
Action                                  Expected result
───────────────────────────────────────────────────────────────────────────────
Settings → Pricing Manager             All seeded products listed at Rs. 0
Edit "Pool Day Pass" to Rs. 500        Saves inline
Price history button/expand            Shows old price (0) → new price (500)
Open New Transaction after change      Pool Day Pass now shows Rs. 500
Edit price again                       Price history shows two entries
```

---

### 2K — Excel export

```
Action                                  Expected result
───────────────────────────────────────────────────────────────────────────────
Owner Reports: Daily revenue            File opens in Excel with correct data
File name format                        Refresh_DailyRevenue_YYYY-MM-DD.xlsx
Summary sheet                          Totals, cash/QR split
Transactions sheet                     One row per transaction, totals at bottom
Member report export                   All members with status and expiry
Inventory report export                Pool items on one sheet, restaurant on another
```

---

### 2L — WhatsApp EOD

```
Action                                  Expected result
───────────────────────────────────────────────────────────────────────────────
Settings → WhatsApp number: not set     EOD button click shows "number not configured"
Set owner WhatsApp in Settings          Saves to DB
Click "Send to owner via WhatsApp"      Browser opens wa.me with pre-filled message
Message content                         Date, total, cash/QR split, transaction counts
```

---

### 2M — Edge cases and error states

```
Scenario                                Expected result
───────────────────────────────────────────────────────────────────────────────
Complete a transaction, then void it    Row marked voided, excluded from totals
New Transaction with no products set    Products dropdown empty, meaningful message
Extremely long customer name            Doesn't break layout
Run app with no internet                Everything works (no CDN dependencies)
Multiple windows of the same app        Only one window should open (verify this)
Delete refresh.db while app is running  Graceful error, not crash
```


---

## WAVE 1 QA RESULTS (2026-06-08)

Code audit of `refresh-manager/` against checklist 2A–2M. Interactive GUI tests not run; results inferred from source review. Full detail in `refresh-manager/QA_WAVE1.md`.

| Section | Result | Key finding |
|---------|--------|-------------|
| 2A Setup wizard | PASS | Wizard + `auth:needs-setup` wired |
| 2B Authentication | LIKELY-FAIL | Cmd+R keeps main-process session (expected login screen) |
| 2C New transaction | PASS | Wizard, banner, walk-in, payment, success flow |
| 2D Membership | PASS | Fixed member+membership IPC path; expiry off-by-one fixed |
| 2E Log & dashboard | PASS | Void filter in totals; payment filter added |
| 2F Pool inventory | LIKELY-FAIL | No staff sell UI (IPC exists) |
| 2G Restaurant | LIKELY-FAIL | No sale recording UI |
| 2H Bookings | PASS | Owner CRUD, staff read-only + complete |
| 2I Tickets | LIKELY-FAIL | Print errors not shown in UI |
| 2J Pricing | PASS | Inline edit + history |
| 2K Excel export | LIKELY-FAIL | Member/inventory exports lack data sheets |
| 2L WhatsApp EOD | PASS | Config check + wa.me message |
| 2M Edge cases | MIXED | Void/timezone PASS; offline fonts LIKELY-FAIL; single-instance fixed |

**Wave 1 fixes shipped:** membership expiry, single-instance lock, membership sale flow, payment filter on owner transactions.


---

## STEP 3 — FIX EVERYTHING FOUND IN TESTING

Before packaging, address all failures from Step 2. Common things to check:

**Nepal timezone:** Confirm all dates display in local Nepal time (UTC+5:45), not UTC.
Check the `created_at` values in the DB. If they're in UTC, transactions dated at
e.g. 10 PM will show as the next day in Kathmandu. Fix: use
`datetime('now','localtime')` in SQLite, or handle timezone in the main process.

**Membership expiry calculation:** If a monthly membership starts June 7, the end_date
should be July 7, not July 6. Off-by-one errors are common here.

**Void should exclude from revenue:** Any voided transaction should not appear in
any totals, summaries, or exports. Verify with `WHERE is_voided = 0` in every query.

**Staff can't access owner IPC:** Try calling an owner-only channel from the staff
session (e.g. via DevTools console). Should return `{ success: false, error: 'Unauthorized' }`.

**better-sqlite3 version:** The installed version must match the Electron version.
Run `npx electron-rebuild` again if you've updated either.

**Ticket.html offline:** Open the ticket file directly in a browser with no internet.
It must render correctly without any CDN scripts.

---

## STEP 4 — WINDOWS PACKAGING

The app runs on Mac in dev. It needs to be packaged as a Windows `.exe` installer
for the reception desk PC.

### 4A — Install electron-builder

```bash
npm install --save-dev electron-builder
```

### 4B — Create electron-builder config

Create `electron-builder.config.js` in the project root:

```js
module.exports = {
  appId: 'com.refreshrecreation.manager',
  productName: 'Refresh Manager',
  copyright: 'Refresh Recreation Center Pvt. Ltd.',

  directories: {
    output: 'dist-app',
    buildResources: 'resources',
  },

  files: [
    'out/**/*',           // electron-vite build output
    'src/renderer/ticket.html',
    'package.json',
  ],

  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'resources/icon.ico',
  },

  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Refresh Manager',
    installerHeader: 'resources/installer-header.bmp',   // optional
  },

  // Rebuild native modules (better-sqlite3) for the target Electron + arch
  afterPack: async (context) => {
    const { execSync } = require('child_process');
    execSync('npx electron-rebuild -f -w better-sqlite3', {
      cwd: context.appOutDir,
      stdio: 'inherit',
    });
  },

  // Exclude dev-only packages from the app bundle
  buildDependenciesFromSource: true,
};
```

### 4C — Add build script to package.json

```json
"scripts": {
  "dev": "electron-vite dev",
  "build": "electron-vite build",
  "build:win": "electron-vite build && electron-builder --win --x64",
  "preview": "electron-vite preview"
}
```

### 4D — App icon

The installer needs a `resources/icon.ico` file.
Create one from any PNG (the Refresh wave logo at minimum):

```bash
# Option 1: Use an online converter (png2ico.com)
# Upload a square PNG (256×256 minimum), download the .ico

# Option 2: If you have ImageMagick installed
convert resources/icon.png -define icon:auto-resize=256,128,64,48,32,16 resources/icon.ico
```

Put the `.ico` file at `resources/icon.ico` before building.

### 4E — Cross-compile from Mac to Windows

Building a Windows `.exe` from a Mac requires one of these approaches:

**Option A — GitHub Actions (recommended, free)**

Create `.github/workflows/build-win.yml`:

```yaml
name: Build Windows

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  build-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install dependencies
        run: npm ci

      - name: Rebuild native modules
        run: npx electron-rebuild

      - name: Build
        run: npm run build:win

      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: refresh-manager-win
          path: dist-app/*.exe
```

Push to GitHub → Actions tab → download the `.exe` artifact when the build completes.
This is the most reliable approach for cross-compiling native modules.

**Option B — Build directly on the Windows PC**

If the reception PC has Node.js installed:
1. Clone or copy the project to the PC
2. `npm install`
3. `npx electron-rebuild`
4. `npm run build:win`
5. Find the installer in `dist-app/`

This avoids cross-compilation entirely.

**Option C — Docker (intermediate)**

Use a Windows Docker container on Mac. More setup but avoids GitHub.
Only recommended if you're comfortable with Docker.

### 4F — Test the installer

Once the `.exe` is built:
1. Run it on a Windows machine (not the Mac)
2. Install to default location
3. Launch from the desktop shortcut
4. Verify the setup wizard appears (fresh install = no DB)
5. Run through the full testing checklist from Step 2

---

## STEP 5 — PRE-DEPLOYMENT SETUP GUIDE

Do this on the reception PC after installing the `.exe`:

### First launch
1. Run Refresh Manager from the desktop shortcut
2. Setup wizard appears
3. Enter owner name and a strong password (write it down and keep it safe)
4. Enter first staff member name and a 4-digit PIN
5. Click "Complete setup" → owner dashboard opens

### Configure before first real transaction

**Settings → Pricing Manager:**
Set real prices for every product. All are seeded at Rs. 0. Go through each:
- Pool Day Pass
- Gym Day Pass
- All day packages (Sauna+Steam+Jacuzzi, Swimming+Sauna+Steam, Whole Package)
- All membership tiers

**Settings → WhatsApp number:**
Enter the owner's WhatsApp number in international format: `9779801010422`
(977 = Nepal country code, no + or spaces)

**Settings → Backup settings:**
Set a backup folder — recommended: a USB drive or a folder that syncs to Google Drive.
Enable auto-backup (daily).

**Settings → Business info:**
Confirm name, address, phone are correct (pre-filled from seed data).

**Settings → Manage Staff:**
Add a PIN for each reception staff member who will use the app.

**Pool Inventory:**
- Add current stock counts for all items (Restock each item to current real quantity)
- Set selling prices for items you sell (goggles, caps, etc.)
- Add any items not in the seeded list

**Restaurant Inventory:**
- Add real menu items (Momo, Tea, Coffee, etc.) with current stock and prices

### Day 1 operations walkthrough (train staff on this)

```
Staff logs in          → 4-digit PIN
Walk-in customer       → New Transaction → pick type → pick product
                          → customer name (can leave blank for walk-in)
                          → Cash or QR → Confirm & Save → Print Ticket
Member signs up        → New Transaction → Membership → fill name + phone
                          → Confirm & Save → member now searchable
Customer arrives       → Search Member → confirm Active status → let in
                          (show them the green Active badge)
End of shift           → End of Day tab → review totals
                          → Send to owner via WhatsApp
```

---

## STEP 6 — PHASE 4 FEATURE ROADMAP

After the app is deployed and being used, build these in priority order.

---

### PRIORITY 1 — Auto-backup (build before anything else)

Without a backup system, a PC failure loses all data. This is the most critical
missing piece post-deployment.

**What to build:**
- Auto-backup runs once daily at a configurable time (default: 11:59 PM)
- Copies `refresh.db` to the configured backup folder with a timestamp filename:
  `refresh_backup_2026-06-07.db`
- Keeps the last 30 backups, deletes older ones
- Owner dashboard shows: "Last backup: Today 11:59 PM ✓" or "Backup failed — check settings"
- Manual backup button in Settings → Backup

**IPC channels needed:**
```
backup:create     → {}                    → { success, filePath }
backup:list       → {}                    → { backups[] }    // list existing backup files
backup:restore    → { backupFilePath }    → { success }      // owner-only, dangerous op
backup:get-status → {}                    → { lastBackupAt, lastBackupPath, status }
```

**Implementation notes:**
- Use `node-cron` or a simple `setInterval` in main process for scheduling
- `backup:restore` should require the owner to confirm with their password before
  overwriting the live DB — data loss risk
- The backup folder path is already in the settings table (`backup_path` key)

---

### PRIORITY 2 — WhatsApp renewal reminders to members

Members frequently forget to renew. A WhatsApp message 3–5 days before expiry would
significantly reduce churn.

**What to build:**
- Each morning when the app opens, check for memberships expiring in the next 5 days
- For each expiring membership where the member has a phone number:
  - Show owner a list: "3 members expiring soon — send renewal reminders?"
  - One button: "Send all reminders" → for each member, opens wa.me with a
    pre-filled renewal reminder message
  - Or: individual "Send reminder" button per member on the Members screen

**Message template (editable by owner in Settings):**
```
नमस्ते [Name] जी! 🏊
Refresh Recreation Center मा तपाईंको [Membership Type] membership
[Date] मा expire हुँदैछ।

Renewal को लागि हामीलाई सम्पर्क गर्नुहोस्:
📞 9801010422
📍 Nayabasti, Boudha

धन्यवाद! — Refresh Team
```

**Implementation notes:**
- This is entirely client-side (no server needed) — uses `shell.openExternal(wa.me URL)`
- The app opens a new WhatsApp pre-filled for each member sequentially
- The owner clicks Send in WhatsApp for each one (WhatsApp Business API not required)
- Store `reminder_sent_at` per membership to avoid sending duplicates daily

---

### PRIORITY 3 — Member photo and membership card

**Member photo:**
- When adding or editing a member, a "Add photo" button appears
- Options: (a) take webcam photo using `getUserMedia`, (b) upload from file
- Photo saved to a `photos/` subfolder in userData, path stored in `members.photo_path`
- Small avatar photo shown on member card in search results and member detail view

**Membership card printing:**
After a membership is created, an option to print a physical membership card.
Same mechanism as ticket printing (hidden window → print).

Card layout (credit card size, A4 landscape scaled):
```
┌──────────────────────────────────────┐
│  ≋ REFRESH RECREATION CENTER         │
│    Boudha, Kathmandu                 │
│  ─────────────────────────────────   │
│  [PHOTO]  Rajesh Kumar               │
│           Swimming + Gym             │
│           Member ID: #47             │
│           Valid: 01 Jun – 30 Jun 26  │
└──────────────────────────────────────┘
```

---

### PRIORITY 4 — Cash reconciliation at end of day

Currently, End of Day shows the system's total but doesn't confirm it against
physical cash in the drawer.

**What to build:**
A cash reconciliation step in the End of Day flow (new optional screen before
the WhatsApp send):

1. System shows: "System total (Cash): Rs. 4,100"
2. Staff enters: "Physical cash count: Rs. ____"
3. If they match: ✓ green — "Cash balanced"
4. If they don't: amber warning — "Discrepancy of Rs. X. Note the reason:"
   → text field for reason (short/over, refund given, error, etc.)
5. This reconciliation is saved to a `cash_reconciliations` table
6. Owner can see reconciliation history in Reports

**New DB table:**
```sql
CREATE TABLE IF NOT EXISTS cash_reconciliations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  reconcile_date  TEXT NOT NULL,
  system_cash     REAL NOT NULL,
  physical_cash   REAL NOT NULL,
  discrepancy     REAL GENERATED ALWAYS AS (physical_cash - system_cash) VIRTUAL,
  reason          TEXT,
  staff_id        INTEGER REFERENCES users(id),
  created_at      TEXT DEFAULT (datetime('now','localtime'))
);
```

---

### PRIORITY 5 — Restaurant menu and POS

Currently the restaurant module tracks inventory but doesn't have a menu-based
point-of-sale. To fully separate the restaurant from ad-hoc inventory sales:

**What to build:**
- Owner: Settings → Restaurant Menu — a list of menu items with prices
  (separate from raw inventory items — these are things you SELL, not track stock of)
- Staff: a "Restaurant" tab or tile that opens a simple POS:
  - Grid of menu items (momo, tea, coffee, etc.) with prices
  - Tap to add to order, adjust quantity
  - Payment method (cash/QR)
  - Confirm → transaction created (source = 'restaurant')
  - Optional: print kitchen receipt (simpler version of the ticket)
- Revenue shows in restaurant column on dashboard

**New DB table:**
```sql
CREATE TABLE IF NOT EXISTS restaurant_menu_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  category    TEXT,
  price       REAL NOT NULL DEFAULT 0,
  is_active   INTEGER DEFAULT 1,
  sort_order  INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now','localtime'))
);
```

---

### PRIORITY 6 — Staff management improvements

**What to build:**
- Owner Settings → Manage Staff: view all staff, see which PIN belongs to whom
- Deactivate a staff account (they can no longer log in)
- Reset a PIN (owner sets a new temporary PIN, staff changes on next login)
- Staff activity log: which staff member logged which transactions
  (already tracked via `staff_id` in transactions — just needs a UI to show it)
- Owner can filter any report by staff member

---

### PRIORITY 7 — Advanced reporting

**What to build:**

*Monthly summary report:*
- Revenue by week (4 weeks)
- Top 5 products by count and by revenue
- New members vs renewals
- Pool vs restaurant split
- All exportable to Excel

*Member retention report:*
- How many memberships were due for renewal this month
- How many actually renewed (retention rate %)
- Churned members list (expired, not renewed)

*Inventory turnover report:*
- Items sold per month, revenue per item
- Items below reorder level
- Restock history

*Booking report:*
- Bookings per month, by status
- Revenue from group bookings (deposit collected vs total expected)

---

## STEP 7 — TECHNICAL DEBT TO ADDRESS BEFORE PHASE 5

Before building more features, address these architectural issues:

**Loading states:** Every IPC call should have a loading state in the UI.
Currently if the DB is slow, screens might show stale mock data or nothing.
Add a `useEffect` + loading spinner pattern to all screens that fetch data.

**Error boundaries:** If a screen throws an error, the whole app shouldn't crash.
Add a React error boundary component wrapping each screen.

**Form validation:** All forms (new transaction, new member, add inventory item,
new booking) need client-side validation before IPC calls:
- Required fields marked and validated
- Phone numbers: 10 digits, Nepal format
- PINs: exactly 4 digits, numeric only
- Prices: non-negative numbers only
- Dates: valid date format, booking date must be in the future

**Empty states:** Every list or table needs an empty state:
- No transactions today: "No transactions recorded yet today"
- No members found: "No members match your search"
- No upcoming bookings: "No bookings in the next 7 days"

**Keyboard shortcuts for staff (high impact for reception speed):**
```
N  → New Transaction (from anywhere in staff mode)
M  → Member Search
L  → Today's Log
E  → End of Day
Enter → advance wizard step / confirm dialog
Esc → go back one step / return to home
```

**Session timeout:** Currently the session never expires. Add an optional
auto-logout after N minutes of inactivity (configurable in Settings, default 30 min).
This prevents the case where a staff member walks away from an unlocked reception desk.

---

## FILE REFERENCE

```
refresh-manager/
├── electron-builder.config.js      ← create in Step 4
├── resources/
│   └── icon.ico                    ← create in Step 4
├── src/
│   ├── main/
│   │   ├── index.js
│   │   ├── db/
│   │   │   ├── db.js
│   │   │   ├── schema.js
│   │   │   └── seed.js
│   │   └── ipc/
│   │       ├── auth.js
│   │       ├── transactions.js
│   │       ├── members.js
│   │       ├── products.js
│   │       ├── pool-inventory.js
│   │       ├── restaurant-inventory.js
│   │       ├── bookings.js
│   │       ├── reports.js
│   │       ├── settings.js
│   │       ├── tickets.js
│   │       └── whatsapp.js
│   ├── preload/
│   │   └── index.js
│   └── renderer/
│       ├── ticket.html
│       └── src/
│           ├── App.jsx
│           ├── app.css
│           ├── lib/
│           │   └── api.js
│           ├── components/
│           │   └── ui.jsx
│           └── screens/
│               ├── staff*.jsx
│               └── owner*.jsx
└── .github/
    └── workflows/
        └── build-win.yml           ← create in Step 4 (GitHub Actions build)
```

---

## WHAT TO HAND TO CURSOR FOR PHASE 4

When starting the next Cursor session, paste this prompt:

```
Read this file fully before doing anything:
REFRESH_CURSOR_PHASE3.md (project context and completed Phase 3 spec)

Phase 3 is complete and committed. The app builds and runs correctly.
The project is at /Users/sambhav/Desktop/Refresh Manager/refresh-manager/

Today's goal: Phase 4 — auto-backup, renewal reminders, cash reconciliation,
and packaging as a Windows .exe.

Start by reading all files in src/ to understand the current codebase,
then present a task plan for Phase 4 in this order:

1. Auto-backup (daily scheduled DB copy + manual backup + backup status widget)
2. Cash reconciliation (EOD cash count screen + DB table + owner history view)
3. WhatsApp renewal reminders (expiring member list + send reminder per member)
4. Windows packaging (electron-builder config + GitHub Actions workflow)

Read the in-depth next-steps document for the full spec of each feature before
planning. Wait for approval before writing any code.
Do not skip loading states, empty states, and form validation — add these to
any screen you touch.
```

---

*Prepared June 2026 · Refresh Recreation Center Pvt. Ltd.*
*Phase 3 complete → Phase 4: stabilise, backup, package, deploy*
