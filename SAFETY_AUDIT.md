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
