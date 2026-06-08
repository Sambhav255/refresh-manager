# REFRESH MANAGER — Cursor Handoff
## From prototype to Electron app
### Read this before opening Cursor

---

## 1. SITUATION ASSESSMENT

### What you have
Five JSX/JS files from Claude Design that contain the complete frontend logic:

| File | What it contains | Status |
|---|---|---|
| `app.jsx` | App shell, routing, Login, Window chrome | Working logic, needs module conversion |
| `ui.jsx` | Shared components (Icon, Badge, Avatar, AppHeader) | Working, needs CSS + module conversion |
| `screens-staff.jsx` | All 5 staff screens | Working, needs CSS + module conversion |
| `screens-owner.jsx` | All 6 owner screens | Working, needs CSS + module conversion |
| `data.js` | Sample data (transactions, members, inventory) | Working, will be replaced by real DB calls later |

### What's missing
- **CSS file** — the JSX references ~40 class names (`win`, `tiles`, `tile`, `badge`, `hdr`, `content`, `tbl`, etc.) but no `.css` file was uploaded. This is why login and some staff screens render blank. The working screenshots (owner dashboard, staff home tiles, wizard) had enough inline styles to survive; the others didn't. **Writing this CSS is the first task in Cursor.**
- **Module system** — files use `window.RM`, `window.Icon`, `Object.assign(window, {...})` (CDN globals). These need to become ES module imports/exports.
- **Backend** — no SQLite, no IPC handlers, no real data. Currently all mocked in `data.js`.

### What's working (confirmed by screenshots)
- Owner dashboard with KPI cards, transactions table, sidebar nav
- Staff home with tile grid and metric cards
- Transaction wizard (5 steps, confirmation state)
- Windows window chrome (title bar, controls)
- Overall visual design matches the spec

---

## 2. TARGET ARCHITECTURE

```
refresh-manager/               ← Electron-Vite project root
├── electron.vite.config.js
├── package.json
│
├── src/
│   ├── main/                  ← Electron main process (Node.js)
│   │   ├── index.js           ← Entry point, window creation
│   │   ├── database/
│   │   │   ├── db.js          ← SQLite connection (better-sqlite3)
│   │   │   ├── schema.js      ← CREATE TABLE statements
│   │   │   └── seed.js        ← Initial product catalogue
│   │   ├── handlers/          ← IPC handler modules
│   │   │   ├── auth.js
│   │   │   ├── transactions.js
│   │   │   ├── members.js
│   │   │   ├── inventory.js
│   │   │   ├── reports.js
│   │   │   ├── settings.js
│   │   │   └── whatsapp.js
│   │   └── utils/
│   │       ├── excel.js       ← ExcelJS export functions
│   │       └── backup.js
│   │
│   ├── preload/
│   │   └── index.js           ← Context bridge (exposes IPC to renderer)
│   │
│   └── renderer/              ← React frontend (Vite)
│       ├── index.html
│       └── src/
│           ├── main.jsx        ← createRoot entry
│           ├── App.jsx         ← Migrated from app.jsx
│           ├── app.css         ← THE MISSING CSS FILE (write this first)
│           ├── components/
│           │   └── ui.jsx      ← Migrated from ui.jsx
│           ├── screens/
│           │   ├── staff.jsx   ← Migrated from screens-staff.jsx
│           │   └── owner.jsx   ← Migrated from screens-owner.jsx
│           └── data/
│               └── mock.js     ← Migrated from data.js (temporary)
│
└── resources/
    └── icon.ico
```

---

## 3. STEP-BY-STEP BUILD PLAN

### Phase 1 — Project setup + CSS (Day 1)
Get the frontend working correctly in Electron with proper styling.

### Phase 2 — Frontend migration (Day 1–2)
Convert the CDN-based JSX files to proper ES modules. Fix blank screen bugs.

### Phase 3 — Database + IPC (Day 3–5)
Build the SQLite backend and connect it to the frontend via IPC.

### Phase 4 — Features (Day 6–10)
Excel export, WhatsApp EOD, auto-backup, packaging.

---

## 4. CURSOR SETUP — DO THIS FIRST

Open Terminal in Cursor and run these commands:

```bash
# 1. Create the electron-vite project
npm create @quick-start/electron@latest refresh-manager
# When prompted: select React template, JavaScript (not TypeScript)
cd refresh-manager

# 2. Install core dependencies
npm install better-sqlite3 bcryptjs exceljs

# 3. Install dev dependencies
npm install --save-dev @electron/rebuild

# 4. Rebuild native modules for Electron
npx electron-rebuild

# 5. Test the scaffold runs
npm run dev
```

You should see a blank Electron window. That confirms the setup works.

---

## 5. FILES TO COPY INTO THE PROJECT

After scaffold is created, copy your existing files here:

| Your file | Copy to |
|---|---|
| `app.jsx` | `src/renderer/src/App.jsx` (rename, then edit) |
| `ui.jsx` | `src/renderer/src/components/ui.jsx` |
| `screens-staff.jsx` | `src/renderer/src/screens/staff.jsx` |
| `screens-owner.jsx` | `src/renderer/src/screens/owner.jsx` |
| `data.js` | `src/renderer/src/data/mock.js` |

Also keep in the project root as reference (not imported anywhere):
- `Refresh_Software_PRD.md`
- `Refresh_Developer_Brief.md`

---

## 6. CLAUDE CODE PROMPTS — USE IN ORDER

Use these in Cursor's Claude Code panel (or CMD+K / CMD+L). Run them one at a time and confirm each works before moving to the next.

---

### PROMPT 1 — Write the CSS (do this first, it fixes the blank screens)

```
I have a React + Electron app called Refresh Manager. The renderer uses these CSS class names throughout the JSX files. Please create src/renderer/src/app.css with complete styles for all of them.

CLASS NAMES USED IN THE APP:
Layout: win, titlebar, tb-left, tb-title, tb-dot, win-controls, close, gl, app, body-wrap, content, sidebar, botnav, tab, t-label, nav-item, ni-icon, spacer, row, between, fade-in, scale-in

Header: hdr, hdr-brand, hdr-logo, hdr-name, hdr-right, hdr-user, ghost-btn

Typography: h1, sub, m-label, m-value, m-sub, pos, warn, muted, a-title, a-desc

Cards and tiles: metric, card, tile, accent-blue, accent-teal, dim, t-icon, t-title, t-sub

Tables: tbl (and its thead/tbody/th/td), tbl-foot, total, num, rowmenu

Badges: badge, b-active, b-exp, b-dead, b-cash, b-qr, b-mem

Avatar: avatar, av-active, av-exp, av-dead

Forms: field, input, select, steps, step (done/active states), toggle-row, toggle-btn (sel state), amount-box, a-label, a-value, btn, btn-primary, btn-ghost, btn-teal, btn-block

Alerts: alert, red, amber, green

Steps: steps, step (with .done and .active)

DESIGN TOKENS:
--bg: #f4f5f7
--card: #ffffff
--border: #e2e8f0
--text: #1a202c
--muted: #94a3b8
--sub: #64748b
--blue: #185FA5
--navy: #0C447C
--teal: #0F6E56

The app header is #0C447C navy. Cards are white with 1px #e2e8f0 border and 8px border-radius. The page background is #f4f5f7. Buttons use #185FA5. Tables have alternating row hover states. The staff bottom nav has 5 tabs with icons + labels. The owner has a 190px left sidebar. Active nav items have a 2px right border in #185FA5. Badge pills are fully rounded. Everything is flat design, no gradients, no shadows except subtle borders.

Import this CSS in src/renderer/src/main.jsx.
```

---

### PROMPT 2 — Convert ui.jsx to ES module

```
Convert src/renderer/src/components/ui.jsx from CDN globals to a proper ES module.

Currently it uses:
- window.lucide (CDN Lucide)
- Object.assign(window, {...}) to export components

Target:
- Import lucide-react: import { Home, Plus, ... } from 'lucide-react'
- Export components as named exports: export function Icon(...), export function Badge(...) etc.
- The Icon component currently renders SVG via innerHTML + useLayoutEffect. Replace this with direct lucide-react JSX components. Map the string icon names to lucide-react component names.
- Keep the WaveMark SVG as-is (it's a custom wave, not from lucide)
- Keep Window, AppHeader, SectionHead, Badge, PayBadge, Avatar components

Also run: npm install lucide-react

Make sure the Icon component accepts: name (string), size (number), color (string), style (object).
Use a lookup map or switch statement to map string names to lucide-react components.
```

---

### PROMPT 3 — Convert data.js to ES module

```
Convert src/renderer/src/data/mock.js from a window global to an ES module.

Currently: window.RM = (function() { ... })()
Target: export const transactions = [...], export const members = [...], etc. as named exports.
Also export: export function fmt(n) { return "Rs. " + n.toLocaleString("en-IN"); }
Export a products object too.

No other changes — keep all the sample data identical.
```

---

### PROMPT 4 — Convert screens-staff.jsx to ES module

```
Convert src/renderer/src/screens/staff.jsx to an ES module.

Currently uses:
- window.RM.transactions, window.RM.members, window.RM.products, window.RM.fmt, window.RM.eod
- window.Icon, window.useLucide, window.Badge, window.PayBadge, window.Avatar, window.SectionHead

Replace all window.* references with:
- import { transactions, members, products, eod, fmt } from '../data/mock'
- import { Icon, Badge, PayBadge, Avatar, SectionHead } from '../components/ui'
- Remove all useLucide() calls (they were no-ops anyway)

Export each screen as a named export:
export function StaffHome(...) {...}
export function NewTransaction(...) {...}
export function MemberSearch(...) {...}
export function TodaysLog(...) {...}
export function EndOfDay(...) {...}

Keep all logic identical. Only change: global references → imports.
```

---

### PROMPT 5 — Convert screens-owner.jsx to ES module

```
Same conversion as staff screens. Convert src/renderer/src/screens/owner.jsx to an ES module.

Replace all window.RM.* and window.Icon etc. with proper imports from '../data/mock' and '../components/ui'.

Export: OwnerDashboard, OwnerTransactions, OwnerMembers, OwnerInventory, OwnerReports, OwnerSettings as named exports.
```

---

### PROMPT 6 — Convert App.jsx and fix blank screens

```
Convert src/renderer/src/App.jsx to a proper ES module and fix the blank screen bugs.

Import everything it needs:
- import React, { useState, useEffect } from 'react'
- import { WaveMark, Icon, AppHeader } from './components/ui'
- import { StaffHome, NewTransaction, MemberSearch, TodaysLog, EndOfDay } from './screens/staff'
- import { OwnerDashboard, OwnerTransactions, OwnerMembers, OwnerInventory, OwnerReports, OwnerSettings } from './screens/owner'
- import './app.css'

Remove all window.* references and Object.assign calls.

Keep: Login, StaffInventory, StaffApp, OwnerApp, App components.

Fix known bugs:
1. Login blank screen: the Login component content (logo + buttons) is not rendering. Ensure the outer div has min-height and proper flexbox so content is visible even before CSS custom properties load.
2. Staff home blank: the StaffHome tiles sometimes don't render on first mount. Add a key prop to force correct mounting.

The main entry file src/renderer/src/main.jsx should import App and render it:
  import React from 'react'
  import ReactDOM from 'react-dom/client'
  import App from './App'
  import './app.css'
  ReactDOM.createRoot(document.getElementById('root')).render(<App />)
```

---

### PROMPT 7 — Set up SQLite database (start of backend)

```
Set up the SQLite database for Refresh Manager in the Electron main process.

Create src/main/database/db.js:
- Use better-sqlite3
- Store the database file at: path.join(app.getPath('userData'), 'refresh.db')
- Export a singleton db connection
- Handle first-run by calling initSchema() and seedData() if not already seeded

Create src/main/database/schema.js with CREATE TABLE IF NOT EXISTS statements for these tables:
users, products, members, memberships, transactions, inventory_items, inventory_transactions, price_history, settings

Use the exact schema from the developer brief (see Refresh_Developer_Brief.md in the project root).

Create src/main/database/seed.js that:
1. Checks if settings table has key 'seeded' = 'true'
2. If not: inserts all 17 products (all priced at 0), all 12 inventory items, and the default settings
3. Sets seeded = 'true'

All prices seeded as 0 — owner will set real prices on first login.
```

---

### PROMPT 8 — Build IPC handlers (transactions + members)

```
Build the IPC handlers for transactions and members in the Electron main process.

Reference the IPC channel names in Refresh_Developer_Brief.md (Section 5).

Create src/main/handlers/transactions.js with ipcMain.handle() for:
- transactions:create
- transactions:list (accepts dateFrom, dateTo, type, staffId, paymentMethod filters)
- transactions:today-summary
- transactions:void (owner only — sets is_voided=1, logs reason)

Create src/main/handlers/members.js with ipcMain.handle() for:
- members:create
- members:search (fuzzy search on name and phone)
- members:get
- members:add-membership (calculates end_date from product duration_days)
- members:expiring-soon (returns members where end_date <= today + N days)

Register both handler files in src/main/index.js.

Use the database schema from schema.js. All dates stored as ISO strings YYYY-MM-DD. Nepal timezone is UTC+5:45 — use local date for all date operations.
```

---

### PROMPT 9 — Connect frontend to IPC (replace mock data)

```
Replace the mock data in the frontend with real IPC calls.

Create src/renderer/src/api.js that wraps all window.api calls:
- Each function calls window.api.* (the context bridge methods from preload)
- Include loading and error states

Update the preload file src/preload/index.js to expose the IPC channels via contextBridge (see the preload skeleton in Refresh_Developer_Brief.md Section 12).

Update the Staff NewTransaction screen to:
1. Load products from window.api.listProducts() on mount
2. On Confirm & Save: call window.api.createTransaction() with the form data
3. Show success state only after IPC confirms success

Update Owner Dashboard to load real today-summary and recent transactions via IPC instead of mock data.

Keep mock data as a fallback if IPC returns an error (for development).
```

---

### PROMPT 10 — Add Excel export

```
Build the Excel export function for the daily revenue report.

Install: npm install exceljs

Create src/main/utils/excel.js with an exportDailyRevenue function:
- Takes { date, transactions, summary } as input
- Creates an ExcelJS workbook with two sheets: "Summary" and "Transactions"
- Summary sheet: revenue total, cash/QR split, count by transaction type
- Transactions sheet: all columns (ID, time, customer, product, amount, payment, staff)
- Header row: bold, background #0C447C (navy), white text
- Alternating row fills for readability
- Total row at the bottom of transactions sheet
- Opens a save dialog (dialog.showSaveDialog) with default filename Refresh_DailyRevenue_YYYY-MM-DD.xlsx

Register an IPC handler: reports:export-excel
Add to preload: exportExcel: (data) => ipcRenderer.invoke('reports:export-excel', data)

Add "Export Excel" button functionality to the Owner Reports screen that calls this handler.
```

---

### PROMPT 11 — WhatsApp EOD report

```
Build the WhatsApp end-of-day report feature.

Create src/main/handlers/whatsapp.js:
- IPC handler: whatsapp:send-eod
- Queries today's transaction summary from the database
- Formats the message exactly as specified in Refresh_Developer_Brief.md Section 7
- Gets the owner's WhatsApp number from the settings table (key: whatsapp_owner_number)
- Opens: https://wa.me/{number}?text={encodedMessage} via shell.openExternal()
- Returns { success: true } if number is configured, or { success: false, error: '...' } if not

Update the Staff End of Day screen:
- The "Send to owner via WhatsApp" button calls window.api.sendEODReport()
- If it fails with "number not configured", show a message: "Owner WhatsApp number not set up yet. Ask the owner to set it in Settings."
- On success, show the "Report sent" confirmation state
```

---

### PROMPT 12 — Package as Windows .exe

```
Configure electron-builder to package Refresh Manager as a Windows installer.

Install: npm install --save-dev electron-builder

Create electron-builder.config.js in the project root with the configuration from Refresh_Developer_Brief.md Section 13.

Add to package.json scripts:
"build:win": "electron-vite build && electron-builder --win"

Make sure:
- The app icon is at resources/icon.ico (create a placeholder if needed)
- The SQLite database path uses app.getPath('userData') — it must NOT be inside the app bundle
- Native modules (better-sqlite3) are rebuilt for the target Electron version before packaging: add "afterPack" hook that runs electron-rebuild

Run: npm run build:win

The output will be in dist/ — a .exe installer and/or portable .exe.
```

---

## 7. KNOWN BUGS TO FIX (before Prompt 6)

| Bug | Screen | Cause | Fix |
|---|---|---|---|
| Blank login | login.png | Missing CSS for `.win` and login layout | Writing app.css (Prompt 1) fixes this |
| Blank staff home | staff-home.png | CSS missing + possibly Icon component mounting race | app.css + removing useLucide() calls |
| "Log out" button wraps to two lines | staff-home2.png | Width constraint on `hdr-right` | Add `white-space: nowrap` to `.ghost-btn` |
| Window header doesn't show in staff-home2 | staff-home2.png | Missing `.hdr` CSS or layout flex issue | Covered by Prompt 1 CSS |

---

## 8. FILES IN THE CURSOR PROJECT (final list)

```
refresh-manager/
├── Refresh_Software_PRD.md          ← context only, not imported
├── Refresh_Developer_Brief.md       ← context only, not imported
├── electron.vite.config.js          ← scaffold generated
├── package.json
├── src/
│   ├── main/
│   │   ├── index.js
│   │   ├── database/
│   │   │   ├── db.js
│   │   │   ├── schema.js
│   │   │   └── seed.js
│   │   ├── handlers/
│   │   │   ├── auth.js
│   │   │   ├── transactions.js
│   │   │   ├── members.js
│   │   │   ├── inventory.js
│   │   │   ├── reports.js
│   │   │   ├── settings.js
│   │   │   └── whatsapp.js
│   │   └── utils/
│   │       ├── excel.js
│   │       └── backup.js
│   ├── preload/
│   │   └── index.js
│   └── renderer/
│       └── src/
│           ├── main.jsx
│           ├── App.jsx              ← migrated from app.jsx
│           ├── app.css              ← NEW — written in Prompt 1
│           ├── components/
│           │   └── ui.jsx           ← migrated from ui.jsx
│           ├── screens/
│           │   ├── staff.jsx        ← migrated from screens-staff.jsx
│           │   └── owner.jsx        ← migrated from screens-owner.jsx
│           └── data/
│               └── mock.js          ← migrated from data.js
```

---

## 9. ROUGH TIME ESTIMATE

| Phase | Prompts | Estimated time with Claude Code |
|---|---|---|
| Phase 1: CSS + setup | 1–2 | 30–45 min |
| Phase 2: Module migration | 3–6 | 1–2 hours |
| Phase 3: DB + IPC | 7–9 | 2–4 hours |
| Phase 4: Features | 10–12 | 2–3 hours |
| Testing + polish | — | 1–2 hours |
| **Total** | | **~8–12 hours active work** |

Most of this is review time, not writing time. Claude Code writes fast. Your job is testing each screen after each prompt, not writing code.

---

## 10. TESTING CHECKLIST (use after each phase)

### After Phase 1–2 (frontend working):
- [ ] Login screen shows logo + two login buttons
- [ ] Staff Login → home tiles render with icons
- [ ] New Transaction wizard goes through all 5 steps
- [ ] Transaction save → confirmation screen → Done returns to home
- [ ] Member Search shows results
- [ ] Today's Log shows transaction table
- [ ] End of Day shows totals
- [ ] Owner Login → dashboard loads with KPIs + transactions
- [ ] Owner sidebar navigation works for all 6 screens
- [ ] Esc key returns to login screen

### After Phase 3 (database connected):
- [ ] New transaction saves to SQLite (check with DB browser)
- [ ] Today's log loads from DB (not mock data)
- [ ] Owner dashboard totals match what was entered
- [ ] New member registers and appears in member list
- [ ] Member expiry warning appears for test records

### After Phase 4 (features):
- [ ] Export Excel → file opens in Excel with correct data
- [ ] WhatsApp EOD → browser opens with pre-filled message
- [ ] .exe installer runs on a clean Windows machine

---

*Cursor handoff prepared June 2026 — Refresh Recreation Center Pvt. Ltd.*
*Stack: Electron-Vite + React + SQLite (better-sqlite3) + ExcelJS*
