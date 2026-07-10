# SAFETY_AUDIT.md — Independent code-grounded safety review

**Produced under:** Phase 2 Work Order, Phase 1.
**Scope:** branch `harden-money-path` @ `e4cfcdf`. Findings are from reading the actual code, not the follow-up note.
**Date:** 2026-07-02
**Legend:** ✅ OK · ⚠️ Risk (accept/monitor) · ❌ Defect (ticketed into a Phase 2/3 item).

---

## 1-A — Data-loss surface

| # | Finding | Verdict | Ticket |
|---|---------|---------|--------|
| Restore integrity | Restore validates only the 16-byte `SQLite format 3\0` header (`backup.js:isSqliteFile`). A header-valid but corrupt file would overwrite good data. No `integrity_check`/`quick_check` on the backup before `closeDatabase()`+copy. | ❌ | **2-A** |
| Backup integrity at creation | `performBackup` checkpoints, `copyFileSync`, prunes, and marks `last_backup_status='success'` with **no** verification that the written file opens/passes `quick_check`. A silently-corrupt live DB yields silently-corrupt backups. | ❌ | **2-B** |
| Photo coverage in DR | Backups copy **only** `refresh.db`. Member photos in `userData/photos/` are **not** included. A machine failure loses every member photo. | ❌ (decision) | **2-B** |
| Cron catch-up | Backup scheduler has a catch-up path (`index.js:shouldRunCatchupBackup`). The expiry job runs **at startup** (`startMaintenanceScheduler` calls `expireLapsedMemberships()` before scheduling cron), so an overnight-off PC still expires on next launch. | ✅ | — |

## 1-B — The `booking_deposit` CHECK migration (audited hardest)

`migrations.js:migrateTransactionTypeCheck` performs the 12-step-style rebuild. Against the 1-B checklist:

| Requirement | Status |
|-------------|--------|
| Runs inside a transaction | ✅ `db.transaction(() => …)()` |
| Idempotent | ✅ early-returns when `transactions` DDL already contains `booking_deposit` |
| `id`s preserved | ✅ explicit `INSERT INTO transactions_new (id, …) SELECT id, … FROM transactions` |
| `foreign_keys=OFF` **outside** the txn, `ON` after | ✅ pragma at line 17 (outside), re-enabled line 48 |
| **`PRAGMA foreign_key_check` after rebuild** | ❌ **absent** |
| Tested against a **populated** DB with FK children | ❌ fixture has no memberships/inventory rows referencing `transactions` |

**Assessment:** because ids are preserved, existing FK references (`memberships.transaction_id`, `pool_inventory_transactions.transaction_id`, `restaurant_inventory_transactions.transaction_id`, `bookings.deposit_transaction_id`) remain valid in practice — so this is *probably correct*. But for a cash ledger, "probably" is not the bar. It is **unverified**. → **2-C** (add `foreign_key_check`) and **5-B** (populated-fixture test).

**Foundation smell:** `migrations.js` detects state via `PRAGMA table_info` column probes and a DDL-string match. This cannot express CHECK changes or ordered multi-step migrations safely. → **2-D** (adopt `PRAGMA user_version` sequential migrations; skeleton already in the work order's Appendix A).

## 1-C — Money-path integrity & audit trail

| Finding | Verdict | Ticket |
|---------|---------|--------|
| Trust gap closed everywhere money is written (transactions, checkout, member add/renew, pool sell-item, booking deposit) — all derive staff from session and price from the catalogue. | ✅ | — |
| **No audit trail** for: backup **restore** (rewrites the whole ledger behind one password), settings changes (incl. WhatsApp number & prices), staff add/deactivate/PIN-change. Only `void_by/void_at` and `price_history` exist. | ❌ | **2-E** |
| **Voids have no reconciliation lock / time limit** — an owner can void a transaction on a day already closed via EOD/`cash_reconciliations`, silently changing a reported day. | ❌ | **2-E** |

## 1-D — Privacy / PII at rest

| Finding | Verdict | Ticket |
|---------|---------|--------|
| DB stores names, phones, gender, notes, photos in **plaintext**. Backups are plaintext `.db` copies that routinely land on USB / Google-Drive-synced folders → **customer PII leaves the premises unencrypted.** | ⚠️→❌ | **2-F** |

Recommendation: document posture + restrict backup folder (min), password-protected backup archives (viable), SQLCipher at-rest (owner decision — kiosk key-management is the hard part; a key beside the DB protects nothing). **Do not silently adopt SQLCipher.**

## 1-E — Auth & session

| Finding | Verdict | Ticket |
|---------|---------|--------|
| PIN throttling is **in-memory** (`auth.js`) → cleared on app restart. Acceptable for a physical-access kiosk threat model; state it plainly. | ⚠️ | (note) |
| Duplicate-PIN guard genuinely prevents two staff colliding (bcrypt-compares new PIN against all active staff hashes). | ✅ | — |
| Idle timer resets on `mousemove` + `keydown` (`App.jsx`), **not** `click`/`touchstart`. Mouse work is covered; a **touchscreen-only** kiosk could log out mid-task. | ⚠️ | **3-F** |

## 1-F — Crash & corruption recovery

| Finding | Verdict |
|---------|---------|
| `process.on('uncaughtException')` + `unhandledRejection` → `reportDatabaseLoss` dialog; `isDatabaseHealthy()` (`quick_check`) probed on window focus. | ✅ |
| Each IPC module's `wrap()` converts thrown errors (incl. `getDb()` "Database not initialized") into `{success:false,error}` for the renderer. | ✅ |

## 1-G — Electron hardening

| Finding | Verdict |
|---------|---------|
| Main window: `webPreferences` sets only `sandbox:false` + preload ⇒ relies on Electron secure defaults (`contextIsolation:true`, `nodeIntegration:false`). `sandbox:false` is required for the Node-using preload bridge. | ✅ (note why) |
| Ticket & membership-card windows (`tickets.js`): `sandbox:true`, no `nodeIntegration`. | ✅ |
| CSP present & strict on all three HTML entries; no remote `script-src`. | ✅ |
| `shell.openExternal` (wa.me) builds URLs from `replace(/\D/g,'')`-sanitised digits ⇒ no scheme/URL injection via a crafted phone field. | ✅ |

---

## Findings → Phase 2/3 ticket rollup

| Ticket | Title | Severity |
|--------|-------|----------|
| **2-A** | Restore runs `integrity_check` on the backup before clobbering | High (data loss) |
| **2-B** | Backup verifies its output; DR covers photos; periodic live-DB integrity probe | High |
| **2-C** | Add `foreign_key_check` to the CHECK rebuild (+ **5-B** populated-fixture test) | High (ledger) |
| **2-D** | Adopt `PRAGMA user_version` sequential migrations | Medium (foundation) |
| **2-E** | Append-only `audit_log` + reconciliation-aware voids | High (tamper-evidence) |
| **2-F** | PII / backup-privacy posture + password-protected archives | High (privacy) |
| **2-H** | EOD/report breakdowns iterate real `transaction_type`s (named lines) | Medium |
| **3-F** | Idle timer also resets on `click`/`touchstart` | Low |

Nothing found requires reverting any Phase-1 work. The money path itself is sound; the gaps are in **verification, backup/restore integrity, tamper-evidence, and privacy** — plus the Phase 3+ product features the owner's KPIs need.

---

# Round 2 — Multi-agent end-to-end review (2026-07-10)

After the Phase 2–6 work landed, three independent agents (security, main-process
correctness, renderer/wiring) re-reviewed the whole tree. Every CRITICAL/HIGH and
every actionable MEDIUM was verified against the code and fixed in commit
`5500561`, each with a regression test. Status below is **post-fix**.

## Critical — fixed

| Finding | Fix | Test |
|---------|-----|------|
| **Refund-then-void double-reversal** — voiding an already-refunded sale hid the original but left the negative refund row live, so every revenue total (reports, EOD, reconciliation) understated by the refunded amount. | `transactions:void` rejects a sale that has live refund rows. | `refund.test.js` "rejects voiding a sale that has been refunded" |
| **`photos:save` path traversal** — a crafted `memberId` (`../../evil`) wrote attacker-controlled bytes anywhere the OS user could write. | Coerce to positive integer + require the member to exist. | `security.test.js` "photos:save path traversal" |

## High — fixed

| Finding | Fix | Test |
|---------|-----|------|
| Owner password login had **no brute-force throttle** (PINs did). | 5 failures → 60s cooldown, keyed to the password branch. | `security.test.js` "owner password lockout" |
| Five inventory handlers (`pool restock/adjust`, `restaurant restock/sell/adjust`) trusted `staffId` from the payload and skipped quantity validation; `restaurant-inventory:sell` accepted a **negative** quantity that silently *added* stock via an `out` row. | Session-derived `staffId`, `Number.isInteger`/`> 0` guards, stock floor. | `security.test.js` "inventory handlers derive staff from session" |
| Main window ran with `sandbox: false`. | `sandbox: true` (preload is contextBridge/ipcRenderer-only). | manual smoke |
| `syncDepositTransaction` could resurrect a refunded/owner-voided deposit on any booking edit, double-counting reversed money. | Skip reinstating refunded/owner-voided rows; keep the zero→re-add flow. | `booking-deposit.test.js` "a refunded deposit is never resurrected" |
| Inventory-turnover revenue used the **current** selling price for historic sales and never netted refunds. | Migration v6 adds `unit_price` (recorded at sale, carried onto refund reversals); report uses it and nets reversals out. | `refund.test.js` "turnover report uses the sale-time price" |

## Medium — fixed

Index recreation after any table-rebuild migration; per-line quantity caps (≤999)
on checkout/sell-item; `bookings:update-status` audit-logged; raw `window.electron`
bridge removed from preload (curated `api` only); six renderer screens now surface
mutation failures instead of silently closing modals; `window.prompt` (throws in
Electron) replaced with an in-app pause-reason card.

## Verified clean (no change needed)

IPC wiring end-to-end (all 76 `api` methods trace to a registered handler); SQL
fully parameterized (dynamic `SET` clauses use hardcoded column allowlists); every
handler is `requireOwner`/`requireStaffOrOwner` gated; backup crypto sound (fresh
salt+IV per backup, GCM auth verified before any length-parsing of untrusted
bytes); CSP strict on all HTML entries; `shell.openExternal` phone numbers
digit-sanitized; refund `refundedSoFar` math and date/DST handling correct.

## Known-accepted (not fixed, by design)

- **`npm audit`**: 3 residual findings (1 low `esbuild`, 2 moderate `uuid` via
  `exceljs`). `esbuild` is dev-server-only (not shipped); `uuid`'s bug needs a
  caller-supplied `buf` which `exceljs` never does. The only offered "fix" is a
  breaking `exceljs` **downgrade** to 3.4.0 that would break report exports, so it
  is deliberately not applied.
- **In-memory throttles** (PIN + owner password) reset on app restart — acceptable
  for a single-kiosk physical-access threat model; documented, not persisted.
