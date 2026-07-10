# Refresh Manager

Desktop management software for **Refresh Recreation Center**, Boudha, Kathmandu. Built with Electron + React, runs entirely offline with a local SQLite database.

---

## Features

### Staff
- **New transaction** — sell day passes, day packages, or memberships in a 5-step wizard with optional member photo
- **Member search** — look up any member by name or phone, see active membership and expiry
- **Today's log** — live list of all transactions for the current shift
- **End of day** — cash reconciliation followed by a WhatsApp summary sent to the owner
- **Inventory** — read-only view of pool stock levels with low-stock alerts
- **Bookings** — upcoming event bookings for the next 14 days
- **Restaurant POS** — tap-to-add menu order, choose payment method, one-tap checkout

### Owner / Admin
- **Dashboard** — daily KPIs (pool + restaurant revenue), recent transactions, backup status, renewal reminders, and low-stock alerts at a glance
- **Transactions** — full transaction history with filters (date, type, staff, payment); void any transaction with reason
- **Members** — complete member list with status filters, membership history, and one-click WhatsApp renewal reminders
- **Bookings** — create and manage event/group bookings with deposit tracking
- **Pool inventory** — restock, adjust, or add items; full transaction history per item
- **Restaurant** — manage restaurant inventory separately from pool inventory
- **Reports** — seven report types (daily, monthly, custom range, member retention, inventory turnover, bookings, staff activity) with one-click Excel export
- **Settings**
  - Pricing manager — update product prices with change history
  - Staff PINs — add, deactivate, or re-PIN staff accounts
  - WhatsApp number — owner number for EOD reports and renewal reminders
  - Renewal reminder template — customisable Nepali WhatsApp message
  - Restaurant menu — add/edit/toggle menu items for staff POS
  - Backup settings — folder path, daily schedule, auto-backup toggle
  - Business info — name, address, phone (used on printed tickets)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Shell | Electron 39 |
| UI | React 19, lucide-react |
| Database | SQLite via better-sqlite3 |
| Bundler | electron-vite / Vite 7 |
| Packaging | electron-builder |
| Reports | ExcelJS |
| Auth | bcryptjs |
| Scheduler | node-cron |

---

## Getting Started

### Prerequisites

- Node.js 20+
- npm 10+

### Install

```bash
npm install
```

### Development

```bash
npm run dev
```

The app opens in a frameless window. Press **Esc** at any time to return to the login screen.

### Lint & Format

```bash
npm run lint
npm run format
```

---

## Building

```bash
# Windows (.exe installer)
npm run build:win

# macOS (.dmg)
npm run build:mac

# Linux (.AppImage / .deb / .snap)
npm run build:linux
```

Output goes to `dist-app/`.

---

## Project Structure

```
src/
├── main/                   # Electron main process
│   ├── index.js            # App entry, window creation, backup scheduler
│   ├── session.js          # In-memory session (owner / staff)
│   ├── db/
│   │   ├── schema.js       # CREATE TABLE statements
│   │   ├── seed.js         # Default products, inventory items, settings
│   │   ├── migrations.js   # Additive schema migrations
│   │   └── index.js        # DB init, WAL mode
│   └── ipc/
│       ├── index.js        # Registers all IPC handlers
│       ├── auth.js         # Login, setup wizard, staff management
│       ├── transactions.js # Create, list, void, today summary
│       ├── members.js      # Members, memberships, expiry queries
│       ├── products.js     # List, price update, price history
│       ├── bookings.js     # Event bookings CRUD
│       ├── inventory-pool.js        # Pool stock in/out/adjust
│       ├── inventory-restaurant.js  # Restaurant stock in/out/adjust
│       ├── restaurant-menu.js       # Menu items + POS checkout
│       ├── reports.js      # All reports + Excel export
│       ├── whatsapp.js     # EOD message via wa.me deep link
│       ├── reminders.js    # Membership renewal WhatsApp reminders
│       ├── tickets.js      # Print receipt + membership card
│       ├── photos.js       # Save / retrieve member photos
│       ├── reconciliation.js # Cash reconciliation records
│       ├── backup.js       # DB backup / restore
│       ├── settings.js     # Key-value settings store
│       └── utils.js        # Shared date / formatting helpers
│
├── preload/
│   └── index.js            # Exposes typed window.api to renderer
│
└── renderer/
    ├── index.html          # App shell with stage scaler
    ├── ticket.html         # Printable receipt template
    ├── membership-card.html # Printable membership card template
    └── src/
        ├── App.jsx         # Root: setup wizard, login, staff/owner router
        ├── app.css         # All styles (design tokens, components, layout)
        ├── main.jsx        # React root mount
        ├── components/
        │   ├── ui.jsx      # Icon, Badge, Avatar, Window, AppHeader, SectionHead
        │   └── ScreenErrorBoundary.jsx
        ├── lib/
        │   ├── api.js      # Typed wrappers around window.api IPC calls
        │   ├── format.js   # fmt(), todayLocal(), date formatters
        │   └── validate.js # PIN, phone, price, date validators
        ├── data/
        │   └── mock.js     # Static UI config (settings cards, report cards)
        └── screens/
            ├── staff.jsx           # StaffHome tiles + barrel export
            ├── staff-transaction.jsx
            ├── staff-members.jsx
            ├── staff-log.jsx
            ├── staff-eod.jsx
            ├── staff-bookings.jsx
            ├── staff-restaurant-pos.jsx
            ├── owner.jsx           # Owner barrel export
            ├── owner-dashboard.jsx
            ├── owner-transactions.jsx
            ├── owner-members.jsx
            ├── owner-bookings.jsx
            ├── owner-inventory.jsx
            ├── owner-restaurant.jsx
            ├── owner-reports.jsx
            ├── owner-settings-main.jsx
            ├── owner-settings-pricing.jsx
            ├── owner-settings-staff.jsx
            ├── owner-settings-extras.jsx
            ├── owner-settings-backup.jsx
            └── owner-settings-restaurant-menu.jsx
```

---

## Database

The SQLite database lives at the Electron `userData` path:

- **Windows:** `%APPDATA%\refresh-manager\refresh.db`
- **macOS:** `~/Library/Application Support/refresh-manager/refresh.db`

Member photos are stored alongside it in a `photos/` subfolder.

Backups are plain `.db` file copies placed in whichever folder is configured in Settings → Backup. Up to 30 backups are kept; older ones are pruned automatically.

---

## First Run

On first launch a setup wizard collects:

1. **Owner name** — becomes the login username
2. **Owner password** — hashed with bcrypt (min 4 characters)
3. **First staff name + 4-digit PIN**

After setup the app seeds default products (memberships, day packages, day passes), pool inventory items, and restaurant inventory items with prices set to Rs. 0. Set real prices in **Settings → Pricing manager** before going live.

---

## Authentication

| Role | Credential | Access |
|---|---|---|
| Staff | 4-digit PIN | Transactions, member search, EOD, bookings, restaurant POS |
| Owner | Name + password | Everything above + reports, settings, void, inventory management |

The session auto-expires after an idle timeout (default 30 minutes, configurable in Settings). Press **Esc** to log out immediately.

---

## Documentation

- **[DEPLOYMENT.md](DEPLOYMENT.md)** — reception-PC setup and operations runbook.
- **[docs/PROGRESS.md](docs/PROGRESS.md)** — running log of what has changed, why, and how to work on this codebase safely (**start here if you're picking this up**).
- **[docs/VERIFICATION.md](docs/VERIFICATION.md)** / **[docs/SAFETY_AUDIT.md](docs/SAFETY_AUDIT.md)** — verification matrix and security/correctness audit (incl. the multi-agent review round).
- **[docs/](docs/)** — original + Phase-2 engineering work orders and follow-up notes.

### Developer quickstart

```bash
npm install
npm run dev      # runs the app (auto-rebuilds better-sqlite3 for Electron)
npm test         # 59 tests (auto-rebuilds better-sqlite3 for Node)
npm run lint     # 0 errors expected
npm run build    # production bundle
```

> `better-sqlite3` is native; Electron and Node use different ABIs. The `predev`/`prestart` and `pretest` scripts rebuild it automatically for each — see `docs/PROGRESS.md` if you hit a `NODE_MODULE_VERSION` error.
