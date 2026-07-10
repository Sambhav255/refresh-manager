# VERIFICATION.md — Independent verification of the P0–P3 hardening

**Produced under:** Phase 2 Work Order, Phase 0-C ("trust nothing, verify everything").
**Method:** Every verdict below was derived by reading the *actual code* on branch `harden-money-path` (HEAD `e4cfcdf`) and, where a test is cited, reading the test body to confirm it asserts real behaviour. The Phase-1 follow-up note's claims were **not** taken as evidence.
**Date:** 2026-07-02
**Verifier:** Claude Code (implementing agent)

## Ground truth (Phase 0-A)

| Fact | Finding |
|------|---------|
| Does commit `e4cfcdf` exist? | **Yes, locally only.** It is HEAD of local branch `harden-money-path`. |
| Is it pushed? | **No.** `origin` has only `main` (`8c54901`) and `prototype`. The branch is unpushed and no PR exists. |
| Does `main` still contain the original vulnerabilities? | **Yes.** All hardening lives solely in this one local, unreviewed squash commit. |
| Toolchain / native ABI (0-B) | Confirmed both states reachable. Electron ABI = 140, Node ABI = 127 (they differ). App path: `npm run postinstall` → Electron build. Test path: `npm rebuild better-sqlite3` → Node build. **Tree is currently left in the Electron (140) build so the app runs.** Tests were run under a Node build and pass 16/16. |

> **Risk:** the entire money-path hardening is a single point of failure until pushed and reviewed. See recommendation at the end.

## Test suite reality check (Phase 0-C, P3-1 scrutiny)

- `test/main-money.test.js`, `test/migration.test.js`, `test/backup-restore.test.js` — **16 tests, all pass** under the Node ABI build.
- Assertions are **real**, not `expect(true).toBe(true)`. Examples: tampered `amount: 99999` is asserted to persist as catalogue `300`; a forced overdraw is asserted to leave the transaction count and stock **unchanged**; pool sale asserts stock `10→7` and a matching `out` row.
- **Caveat (feeds 5-B):** the migration test's `oldDatabase()` fixture inserts only one `transactions` row and **no child rows** (memberships / inventory transactions) that reference `transactions`. So the id-preservation claim is checked, but **FK survival across the table rebuild is not actually exercised.**

## Verification matrix

Legend: **PASS** = criterion met and evidenced · **PARTIAL** = works but a required check/edge is missing · **FAIL** = not met · **N/F** = not found.

| ID | Acceptance criterion (summarised) | Verdict | Evidence (file:func / test) |
|----|-----------------------------------|---------|------------------------------|
| **P0-1** | Sale/renew/checkout records session staff & catalogue price regardless of payload | **PASS** | `transactions.js:transactions:create` (staffId not destructured; amount re-read from `products.price`), `restaurant-menu.js:restaurant:checkout` (price from `restaurant_menu_items`), `members.js` (`product.price`, `session.userId`). Tests: "ignores payload staffId and payload amount", "ignores payload price and staffId", "records catalogue price and session staff". |
| **P0-2** | Checkout draws down linked stock 1:1 atomically; unlinked items still sell | **PASS** | `restaurant-menu.js` single `db.transaction`; `inventory_item_id` link. Tests: "draws down… 1:1", "rolls back the whole sale if a line would overdraw", "sells an unlinked menu item". |
| **P0-3** | Restore is close→replace→relaunch; bad/short file rejected; live DB untouched on failure | **PASS** (+gap) | `backup.js:backup:restore` (password → magic-byte → `wal_checkpoint(TRUNCATE)` → `closeDatabase()` → remove sidecars → copy → relaunch). Tests: restore round-trip, non-SQLite reject, wrong-password reject. **Gap → 2-A:** only the 16-byte header is checked; no `integrity_check` on the backup before clobbering. |
| **P0-4** | Overdraw sell rejected & writes nothing; adjust rejects negative target | **PASS** | `inventory-pool.js:pool-inventory:sell/sell-item/adjust`, `restaurant-menu.js` draw-down guard. Tests: "rejects selling more than in stock and writes nothing", "rejects an adjustment to a negative target". |
| **P1-1** | Lapsed active memberships flip to expired (startup + cron); active lookups filter `end_date >= today` | **PASS** | `maintenance.js:expireLapsedMemberships` (only touches `status='active'`), scheduled in `index.js` (startup call + `5 0 * * *`), defence-in-depth `AND ms.end_date >= ?` in `members.js` search/list. Tests: expiry flip + "does not show a lapsed member as active". |
| **P1-2** | Each of 7 report types exports sheets with real data | **PASS** (no test) | `reports.js`: `addRetentionSheets`, `addInventoryTurnoverSheets`, `addBookingsSheets`, `addStaffTotalsSheet` + `switch(reportType)` dispatch. Verified by code read only → **5-A** should add tests. |
| **P1-3** | EOD line items sum exactly to the printed total | **PASS** (+enhancement) | `whatsapp.js:generateEODMessage`: membership/package/pass/restaurant lines + an "Other" bucket = `total − itemised`, so lines always reconcile. **Enhancement → 2-H:** `booking_deposit` and `pool_inventory` fold into "Other" rather than named lines. |
| **P1-4** | No duplicate PINs; cooldown after N failures | **PASS** | `auth.js:assertPinUnique` (on setup/add-staff/change-pin), in-memory `MAX_PIN_ATTEMPTS=5` / `PIN_COOLDOWN_MS=30000`. |
| **P1-5** | No burst of tabs; not marked sent unless owner proceeds; re-send possible | **PASS** | `reminders.js`: `send-all` returns the list (no burst), `send-one` marks after opening, `reminders:clear` resets for re-send. |
| **P1-6** | Strict CSP on all HTML entries; Electron CSP warning gone | **PASS** | `<meta http-equiv="Content-Security-Policy">` in `index.html`, `ticket.html`, `membership-card.html`; no remote `script-src`; `img-src 'self' data: file:`. |
| **P2-1** | Staff can sell a pool item; stock drops; correct amount/staff; overdraw blocked | **PASS** | `inventory-pool.js:pool-inventory:sell-item` (create + draw-down in one `db.transaction`), wired `preload → api.js → staff-sell-item.jsx → App.jsx`. Test: "creates the sale and draws down stock in one operation". |
| **P2-2** | DB file loss → clear dialog, not frozen window; IPC returns structured error | **PASS** | `db/index.js:isDatabaseHealthy` (`quick_check`), `closeDatabase`; `index.js` focus probe + `uncaughtException`/`unhandledRejection` → `reportDatabaseLoss` dialog; every IPC module's `wrap()` returns `{success:false,error}`. |
| **P2-3** | `booking_deposit` added to CHECK preserving ids/FKs; deposit creates a transaction | **PARTIAL → 2-C** | `migrations.js:migrateTransactionTypeCheck` is transactional, idempotent (guards on `sql.includes('booking_deposit')`), id-preserving (`INSERT … (id,…) SELECT id,…`), toggles `foreign_keys` OFF/ON around the rebuild. **Missing:** no `PRAGMA foreign_key_check` after the rebuild; **not tested against a populated DB with FK children.** `bookings.js:syncDepositTransaction` is correct & idempotent. |
| **P2-4** | Weekly grouping honestly labelled or true ISO weeks | **PASS** | `reports.js:addByWeekSheet` labels "Period (days 1–7, 8–14, …)" and "Days X–Y". |
| **P3-1** | `npm test` green; ≥1 test per key P0/P1 behaviour | **PASS** (+caveat) | 16 tests green; caveat on migration fixture realism above. |
| **P3-2** | Malformed payloads return descriptive `{success,error}`, not raw errors | **PARTIAL** | Inline validation exists in money handlers (integer qty > 0, existence, active-item checks). No central `assert()` helper; some enum validation (e.g. `transaction_type`) relies on the DB CHECK throwing, surfaced via `wrap()`. Acceptable but not the "friendly message" bar. |

## Summary

- **13 of 15 items PASS** on their original acceptance criteria.
- **P2-3 is PARTIAL** — the rebuild is very probably safe (ids preserved ⇒ FK references stay valid) but is **unverified** by `foreign_key_check` and **untested** against FK children. Per Work-Order 1-B this must be hardened under **2-C**.
- **P3-2 is PARTIAL** — light inline validation only.
- Confirmed **real, non-cosmetic gaps** for Phase 2 to close: **2-A** (restore integrity), **2-B** (backup integrity + photo DR), **2-C** (FK-check on the CHECK rebuild), **2-H** (named EOD lines), plus the analysis/feature work in Phases 3–6.

**Top recommendation (Phase 0-A step 2):** push `harden-money-path` and open a Draft PR **before** any further code changes, so this work stops being a single unreviewed local commit. This is an outward-facing action on the owner's repo and is awaiting explicit go-ahead.
