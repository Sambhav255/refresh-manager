# PROGRESS — running log for future Claude sessions

**Purpose:** a single place to learn what has happened to this codebase, why choices
were made, and how to work on it safely. **Append a dated entry at the top of the
"Session log" whenever you finish a chunk of work.** Keep it honest — record what was
verified vs. assumed, and what was deliberately *not* done.

---

## Orientation (read this first)

- **What it is:** offline-first Electron 39 + React 19 + better-sqlite3 desktop app —
  the **system of record for a real business's cash** (Refresh Recreation Center,
  Boudha, Kathmandu). Reception logs in with a 4-digit PIN; the owner with
  name + password. Local SQLite at Electron `userData`, WAL mode.
- **Architecture (do not change):** renderer → typed `window.api` bridge
  (`src/preload/index.js`) → `ipcMain.handle` channels in `src/main/ipc/*.js` →
  raw parameterised SQL via better-sqlite3. No ORM, no network dependency, no
  state-management library. Offline-first is a hard product requirement.
- **Security invariant:** the renderer is **untrusted** for identity (`staff_id`) and
  money (`amount`/price). Both are always derived in the main process from the
  authenticated session (`requireOwner`/`requireStaffOrOwner`) and the DB catalogue —
  never taken from the IPC payload. Every money/stock handler follows this; keep it.

## How to run / test (the native-ABI footgun)

`better-sqlite3` is a native addon. **Electron uses NODE_MODULE_VERSION 140; system
Node 22 uses 127** — one compiled binary serves one runtime. The npm scripts handle
it automatically:

- **Tests:** `npm test` (a `pretest` hook rebuilds better-sqlite3 for Node first).
- **App:** `npm run dev` / `npm start` (a `predev`/`prestart` hook rebuilds for Electron).
- If you ever hit a `NODE_MODULE_VERSION` error: `npm rebuild better-sqlite3` (for
  tests) or `npm run postinstall` (for the app). **Leave the tree built for Electron
  when you finish** so the app runs.
- **Gates:** `npm run lint` (0 errors required; some pre-existing patterns are
  warnings — see below), `npm run build` (bundling smoke). CI runs all three.

## Repo layout

- `src/main/` — main process: `ipc/*` handlers, `db/` (schema, migrations, seed),
  `session.js`, `audit.js`, `backup-archive.js`, `index.js`.
- `src/preload/index.js` — the **only** bridge exposed to the renderer (curated `api`
  object; the raw `ipcRenderer` bridge is deliberately not exposed).
- `src/renderer/src/` — React screens (`screens/`), `lib/api.js` (renderer-side api),
  components. Three HTML entries (`index/ticket/membership-card`) each carry a CSP.
- `test/` — Vitest suite. `helpers.js` spins up a temp-file DB with real
  schema+migrations and registers handlers; `electron-mock.js` fakes the Electron API
  so handlers run in plain Node. **Register any new IPC module in `helpers.js`.**
- `docs/` — process/history docs (work orders, verification, safety audit, this log).
- `DEPLOYMENT.md` (root) — reception-PC setup + operations runbook.

## Migrations — how to add one safely

`src/main/db/migrations.js` is a `PRAGMA user_version` ordered runner. To add a change:
append one entry to `MIGRATIONS`. If it **rebuilds a table referenced by foreign keys**
(e.g. a CHECK-constraint change on `transactions`), set `rebuildsReferencedTable: true`
— the runner toggles `foreign_keys` off/on around it, runs `foreign_key_check`, and
**recreates the report indexes afterward** (a DROP+RENAME rebuild silently drops them).
Guard each migration so it no-ops on an already-current DB (`schema.js` is the
fresh-DB baseline and is kept in sync). Always add/extend `test/migration.test.js`
against a **populated** fixture with FK children.

## Known-accepted decisions (don't "fix" these without reason)

- **In-memory auth throttles** (PIN: 5/30s; owner password: 5/60s) reset on app
  restart — acceptable for a single-kiosk physical-access threat model.
- **3 residual `npm audit` findings** (`esbuild` dev-only; `uuid` via `exceljs`,
  unreachable) — the only offered fix is a breaking `exceljs` **downgrade** that
  breaks report exports, so it's intentionally not applied.
- **Lint warnings** (~13): a few screens define small helper components in render and
  the data-loading screens `setState` in an effect. Downgraded to warnings so lint
  gates *new* errors; tracked, not blocking.
- **`window.prompt` is unsupported in Electron** (throws) — never use it; use an
  in-app card/modal for input (see `owner-members.jsx` pause flow).
- **Backups:** if an owner passphrase is set, backups are AES-256-GCM encrypted
  `.rmbak` bundles of DB + photos; otherwise a plain `.db`. Restore verifies integrity
  before touching live data, then closes/replaces/relaunches.

---

## Session log (newest first)

### 2026-07-10 — Repo cleanup + this log
- Merged PR #1 (all work below) into `main` after CI passed (lint-test 3m38s green).
  Deleted the `harden-money-path` branch.
- Moved process/history docs into `docs/`; kept `README.md` + `DEPLOYMENT.md` at root;
  removed `.DS_Store`. Created this running log.
- **Tests at merge:** 59 passing (14 files). Lint: 0 errors. Build: OK.

### 2026-07-10 — Multi-agent end-to-end review + fixes (commit `5500561`)
Three parallel review agents (security / main-process correctness / renderer wiring).
Every CRITICAL/HIGH + actionable MEDIUM verified against code and fixed, each with a
regression test. Highlights:
- **CRITICAL:** rejected voiding an already-refunded sale (double-reversal corrupted
  every revenue total); fixed `photos:save` path traversal (validate integer memberId
  + member exists).
- **HIGH:** owner-password brute-force throttle; session-derived `staffId` + quantity
  validation across 5 inventory handlers (one accepted negative qty → silently *added*
  stock); `sandbox:true` on the main window; deposit-transaction resurrection guard in
  `bookings.js`; inventory-turnover now uses **sale-time** unit price (migration v6
  adds `unit_price`) and nets refunds out.
- **MEDIUM:** index recreation after table rebuilds; qty caps (≤999); booking-status
  auditing; removed raw `window.electron` bridge from preload; renderer screens now
  surface mutation failures; details in `docs/SAFETY_AUDIT.md` → "Round 2".
- Verified clean: IPC wiring (all api methods trace to a handler), parameterised SQL,
  authz gating, backup crypto, CSP, phone sanitisation.

### 2026-07-02 → 07-10 — Phase 2 work order (verify / harden / extend)
Executed the Phase 2 mandate (`docs/REFRESH_MANAGER_PHASE2_WORKORDER.md`) under a
"trust nothing, verify everything" rule. Deliverables `docs/VERIFICATION.md` and
`docs/SAFETY_AUDIT.md`.
- **Phase 2 hardening:** `user_version` migrations + `foreign_key_check` (2-D/2-C);
  restore + backup `integrity_check` (2-A/2-B); encrypted backups w/ photos (2-F);
  audit log + reconciliation-aware voids (2-E); EOD iterates real transaction types
  (2-H).
- **Phase 3–6:** attendance check-ins + footfall KPI (3-A); membership pause/resume
  (3-B); partial+full refunds w/ atomic stock restore (3-C); configurable 58/80/A4
  receipts (3-D); reminder history (3-E); touch-friendly idle timer (3-F); cohort
  analytics + indexes (Phase 4); more tests + blocking-lint CI + build smoke + auto
  ABI scripts (Phase 5); deployment/ops docs + stale-backup monitor (Phase 6). Owner
  UI wired for refunds, pause/resume, and the audit-log viewer.

### ~2026-06-30 → 07-02 — Original engineering work order (P0–P3)
`docs/Refresh_Manager_Engineering_Work_Order_Formatted.md` +
`docs/Refresh_Manager_Work_Order_Followup.md`. Server-side `staff_id`/`amount`;
atomic restaurant inventory draw-down; safe backup restore; negative-stock guards;
membership expiry job; real Excel exports; reconciling EOD; PIN throttle + dup guard;
guided reminders; CSP; DB-loss handling; booking-deposit transactions; first Vitest
suite + CI. (Pre-history and QA baseline: `docs/QA_WAVE1.md`, git log.)
