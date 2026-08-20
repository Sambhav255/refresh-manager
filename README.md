# Refresh Manager

Desktop management software for **Refresh Recreation Center**, Boudha, Kathmandu. Electron + React, running entirely offline against a local SQLite database.

One machine at the reception desk runs the whole business: pool and gym entry, memberships, a restaurant till, stock for both, event bookings, and the owner's reporting and settings.

> **New to this codebase?** Read [ABOUT.md](ABOUT.md) — it covers what was built, every bug found and fixed, and the reasoning behind the decisions that aren't obvious from the code.

---

## Features

### Staff (front desk)

- **New transaction** — day passes, day packages and memberships in a 5-step wizard, with an optional member photo. When the customer looks like someone already on file, it offers to add the membership to that record instead of creating a duplicate.
- **Member search** — by name or phone; shows the active membership and expiry, or what a lapsed member last held and when it ended.
- **Today's log** — every transaction of the current shift, with a running total.
- **End of day** — cash reconciliation, then a WhatsApp summary to the admin. The itemised breakdown always reconciles to the headline total.
- **Restaurant POS** — tap to add, adjust quantities, pick a payment method, one-tap checkout. Linked stock draws down automatically.
- **Sell item** — pool stock (goggles, caps, costumes) sold over the counter.
- **Inventory** — read-only stock levels with low-stock alerts.
- **Bookings** — upcoming events for the next 14 days.

### Admin

- **Dashboard** — daily KPIs (pool and restaurant revenue, footfall), alerts for renewals, low stock, upcoming bookings and backup health. Alerts navigate to the screen that resolves them.
- **Transactions** — full history with filters for date range (including custom), type, staff and payment method; pagination; an optional view of voided rows. Void with a reason, or refund in full or part.
- **Members** — list with status filters including Paused, membership history, pause/resume, and one-click WhatsApp renewal reminders.
- **Bookings** — create and manage events with deposit tracking and balance due. Cancelling asks first and states what happens to the deposit.
- **Inventory** (pool and restaurant, separately) — restock, adjust stock with a mandatory reason, set selling prices, and a per-item movement history showing every change, who made it and why.
- **Restaurant menu** — items, prices, availability, and the link from a menu item to the stock it consumes.
- **Reports** — seven types (daily, monthly, custom range, member retention, inventory turnover, bookings, staff activity) with Excel export.
- **Settings** — pricing with change history, staff and admin accounts, WhatsApp number, renewal-reminder template, backup schedule and encryption, business details, and an audit log.

---

## Tech stack

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
| Tests | Vitest (unit/IPC), Playwright (end-to-end, drives the real app) |

---

## Getting started

**Prerequisites:** Node.js 20+, npm 10+

```bash
npm install
npm run dev
```

The app opens in a frameless window. Press **Esc** to return to the login screen (except while typing in a field).

On first launch a setup wizard creates the admin account and the first staff PIN. There is no password reset, so record those credentials somewhere safe.

### Commands

| Command | What it does |
|---|---|
| `npm run dev` | Run in development |
| `npm run build` | Build the bundle into `out/` |
| `npm test` | Unit + IPC suite (Vitest) |
| `npm run lint` / `npm run format` | ESLint / Prettier |
| `npm run build:mac` / `build:win` / `build:linux` | Package for distribution |

---

## Architecture

```
src/
├── main/                  # Electron main process — owns the database
│   ├── index.js           # Window, single-instance lock, cron backup
│   ├── db/
│   │   ├── schema.js      # Base tables (safe on every startup)
│   │   ├── migrations.js  # Versioned via PRAGMA user_version
│   │   ├── update-safety.js # Snapshot + rollback around migrations
│   │   └── seed.js        # Default products, stock and settings
│   ├── ipc/               # One module per domain; all business logic
│   ├── session.js         # In-memory session (admin role is 'owner' internally)
│   ├── audit.js           # Append-only audit trail
│   └── diagnostics.js     # Persistent log for support
├── preload/index.js       # The ONLY bridge: a curated, typed API surface
├── shared/                # Imported by BOTH processes — keep electron-free
│   └── transaction-types.js
└── renderer/src/
    ├── App.jsx            # Setup wizard, login, staff/admin router
    ├── lib/api.js         # Thin wrapper over the preload bridge
    ├── components/ui.jsx  # Shared primitives
    └── screens/           # staff-*.jsx and owner-*.jsx
```

### Rules this codebase holds to

These are not style preferences — several were learned from bugs that reached a working tree.

1. **Money and identity are derived in main, never accepted from the renderer.** Handlers re-read the price from the product catalogue and take `staff_id` from the session. A payload's `amount` or `staffId` is ignored. A buggy or tampered renderer cannot mis-price a sale or attribute it to someone else.
2. **Handlers validate their own input.** The main process is the last line of defence: blank names, negative money, text in numeric columns and absurd quantities are rejected there, not only in a form.
3. **Multi-write operations run in one `db.transaction()`.** A failure must leave nothing behind — no orphaned member, no stock movement without its sale.
4. **All timestamps are local** (`datetime('now','localtime')`). The business closes at midnight Kathmandu time, not midnight UTC.
5. **No silent no-ops.** Every early return in a click path either shows a message or corresponds to a visibly disabled control.
6. **Anything both processes need lives in `src/shared/`.** Parallel copies drift — that is how the End of Day screen and the WhatsApp report came to disagree about the same day.

---

## Testing

Two layers, because they catch different things.

```bash
npm test                                  # 305 unit/IPC tests
npx electron-rebuild -f -w better-sqlite3 # switch the native module back
node test/e2e/verify-fixes.mjs            # and the other suites
```

**Unit/IPC (Vitest, 32 files).** Exercises the real handlers against a temp database using a small Electron mock. Covers money derivation, refunds and voids, backup and restore, migrations, security and reports.

**End-to-end (Playwright, 10 suites, 182 checks).** Launches the built Electron app and drives the actual UI. Each launch gets its own `--user-data-dir`, so runs never touch real data and several can run at once.

This second layer exists for a specific reason: both of the worst bugs ever found in this app lived in the payload the renderer sent to main. Every handler test passed while the app was unusable. **Unit-green does not mean working.**

### ⚠️ The ABI trap

`better-sqlite3` is a native module and must be compiled for **Node's** ABI to run Vitest, but for **Electron's** ABI to run the app or any E2E script. These states are mutually exclusive.

- `npm test` rebuilds for Node automatically (its `pretest` hook).
- Afterwards, before running the app or E2E: `npx electron-rebuild -f -w better-sqlite3`.
- **Do not rely on `electron-builder install-app-deps`** — it has been observed reporting success without actually rebuilding. `electron-rebuild -f` is the reliable command.

If the app starts and immediately reports a database error mentioning `NODE_MODULE_VERSION`, this is why.

---

## Data and safety

- The database lives at `app.getPath('userData')/refresh.db` — outside the repo, never in it.
- **Backups** run on a schedule and can be encrypted (AES-GCM, authenticated). A restore verifies the file is a valid SQLite database before replacing anything, and is gated behind an admin password.
- **Migrations** snapshot a populated database first and roll back on failure, refusing to start rather than running against half-migrated data. A database written by a newer version is refused outright.
- **Uniqueness constraints** that existing data already violates are skipped and logged rather than forced — the app will not delete a customer record to satisfy an index.

---

## Documentation

| File | Contents |
|---|---|
| [ABOUT.md](ABOUT.md) | Project history, every bug found and fixed, and the decisions taken |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Packaging and installation on the venue machine |
| [docs/qa/QA_REPORT.md](docs/qa/QA_REPORT.md) | The full QA sweep — 55 bugs with root cause and `file:line` |
| [docs/qa/MONEY_AUDIT.md](docs/qa/MONEY_AUDIT.md) | Adversarial audit of every cash and stock path |
| [docs/qa/SHIP_READINESS.md](docs/qa/SHIP_READINESS.md) | Test plan, fix status, and what still needs a human |
| [docs/qa/findings-staff.md](docs/qa/findings-staff.md) | Detailed staff-screen findings |
