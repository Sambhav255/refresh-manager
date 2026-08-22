# Refresh Manager — Engineering Work Order

**Target repo:** `Sambhav255/refresh-manager` (Electron 39 + React 19 + better-sqlite3)
**Prepared:** 2026-06-30
**Audience:** Claude Code (and any engineer picking this up)
**How to use:** Work top-down. P0 first — these affect money accuracy or risk data loss. Each item has a stable ID, the exact file(s), the problem, a concrete solution, and acceptance criteria. Treat acceptance criteria as the definition of done. Make one commit per item using the ID as a prefix (e.g. `P0-1: derive staff_id and amount server-side`).

---

## Context the agent must hold

This is the **system of record for a real business's cash**. Reception staff log in with a 4-digit PIN; the owner logs in with name + password. The app is offline-first (local SQLite at Electron `userData`, WAL mode). The renderer talks to the main process only through the typed `window.api` bridge in `src/preload/index.js`, and every handler is registered in `src/main/ipc/`. The in-memory session lives in `src/main/session.js` and is the single source of truth for *who is logged in and their role*.

**Architectural rule to enforce everywhere:** the renderer is untrusted for anything security- or money-sensitive. Identity (`staff_id`) and price (`amount`) must be established in the main process, never accepted from the renderer payload. Some handlers already do this correctly (`transactions:void`, `reconciliation:create`, the fallback in `restaurant:checkout`) — the job is to make the rest consistent.

Do **not** introduce a network dependency, an ORM, or a state-management library. Keep the better-sqlite3 + raw-SQL + IPC pattern. Keep all SQL parameterised (it already is).

---

# P0 — Money accuracy & data-loss risks (do these first)

## P0-1 — `staff_id` and `amount` are trusted from the renderer

**Files:** `src/main/ipc/transactions.js` (`transactions:create`), `src/main/ipc/members.js` (`members:add-membership`, `members:renew`), `src/main/ipc/restaurant-menu.js` (`restaurant:checkout`)

**Problem.** Each of these reads `staffId` from the IPC payload and writes it to the DB, while the authenticated session (returned by `requireStaffOrOwner()`) already knows the real user id. The renderer (`src/renderer/src/screens/staff-transaction.jsx`) passes `staffId: session?.userId`, and `amount` is derived client-side from the product list. A buggy or tampered renderer could record sales under the wrong staff member or at the wrong price. This corrupts the staff-activity report, the EOD reconciliation, and revenue totals — the exact numbers the owner trusts.

**Solution.**
1. In every money-writing handler, capture the session and use it: `const session = requireStaffOrOwner()` then `const staffId = session.userId`. **Delete `staffId` from the destructured payload** so it cannot be used by accident.
2. Re-derive `amount` server-side from the product/menu price rather than trusting the payload:
   - `transactions:create`: if `productId` is provided, look up `products.price` and use it as the authoritative amount. Keep accepting a payload `amount` **only** for product-less ad-hoc sales (none exist today, so default to the looked-up price).
   - `members:add-membership` / `members:renew`: already fall back to `product.price` via `amount ?? product.price`. Change this to **always** use `product.price` unless the owner role is explicitly overriding (see note below).
   - `restaurant:checkout`: ignore `i.price` from the cart; look up each line's price from `restaurant_menu_items` by `id` and compute the total server-side. Reject the line if the menu item is inactive or missing.
3. **Price-override allowance (optional, deliberate):** if you want to keep the ability to charge a custom amount (discounts), gate it behind the owner role — accept a payload `amountOverride` only when `session.role === 'owner'`, and record it in `transactions.notes` as `"price override: was Rs.X"`. Otherwise the price is the catalogue price. Discuss with the owner before enabling; default to no override.

**Acceptance criteria.**
- Selling/renewing/checking out while logged in as staff records that staff member's id regardless of any `staffId` in the payload.
- A `restaurant:checkout` call with a tampered `price` field still charges and records the catalogue price.
- Existing happy-path flows in `staff-transaction.jsx` and `staff-restaurant-pos.jsx` continue to work unchanged from the user's point of view.

---

## P0-2 — Restaurant checkout does not move inventory; menu and inventory are unlinked

**Files:** `src/main/ipc/restaurant-menu.js`, `src/main/db/migrations.js` (schema), `src/renderer/src/screens/owner-settings-restaurant-menu.jsx`

**Problem.** `restaurant:checkout` inserts a `transactions` row but never writes `restaurant_inventory_transactions` or decrements `restaurant_inventory_items`. Worse, `restaurant_menu_items` (what staff tap to sell) has no link to `restaurant_inventory_items` (what stock tracking uses). Result: restaurant stock never goes down on a sale, the `reports:inventory-turnover` restaurant section is always empty/wrong, and low-stock alerts for food never fire from real sales.

**Solution (two-phase — ship Phase A, then B when the owner is ready).**

*Phase A — make turnover correct without forcing a full BOM.* Add an optional link column so a menu item can point at the inventory item it draws down 1:1:
```sql
ALTER TABLE restaurant_menu_items ADD COLUMN inventory_item_id INTEGER REFERENCES restaurant_inventory_items(id);
```
(Add this in `runMigrations` with the same `PRAGMA table_info` guard already used for `reminder_sent_at`.) In the menu editor UI, add an optional "Linked stock item" dropdown. In `restaurant:checkout`, wrap everything in a single `db.transaction(() => { ... })`: insert the sale transaction, then for each cart line whose menu item has an `inventory_item_id`, insert an `out` row in `restaurant_inventory_transactions` and decrement `restaurant_inventory_items.current_stock` by the quantity (clamp per P0-4).

*Phase B — recipes/BOM (only if the owner wants ingredient-level tracking).* Introduce a `menu_item_ingredients(menu_item_id, inventory_item_id, qty_per_unit)` table and draw down each ingredient. Defer unless requested; Phase A covers the common case (Tea, Coffee, bottled drinks sold 1:1).

**Acceptance criteria.**
- A checkout of 2× a linked menu item reduces that inventory item's `current_stock` by 2 and creates a matching `out` inventory transaction, all in one DB transaction (crash mid-way leaves neither).
- `reports:inventory-turnover` shows the sold quantity and revenue for linked restaurant items.
- Menu items with no linked stock item still sell fine (no inventory movement) — backward compatible.

---

## P0-3 — Backup *restore* can corrupt or silently no-op the database

**File:** `src/main/ipc/backup.js` (`backup:restore`), and `src/main/index.js` for relaunch wiring.

**Problem.** Restore does `copyFileSync(backupFilePath, livePath)` over the live `refresh.db` while better-sqlite3 still holds it open in WAL mode, and it does **not** remove the stale `refresh.db-wal` / `refresh.db-shm` sidecars. On Windows the copy can throw `EBUSY` (file locked). Even on success, the open connection keeps serving old data until restart, and a leftover WAL can replay over the restored file on next open. This is the one operation where a mistake destroys the business's records.

**Solution.** Make restore a close-replace-relaunch sequence:
1. Verify the owner password (already done) and that the backup file exists and is a valid SQLite file (cheap check: first 16 bytes equal `SQLite format 3\0`).
2. `db.pragma('wal_checkpoint(TRUNCATE)')` then **close the connection**: add an exported `closeDatabase()` in `src/main/db/index.js` that calls `db.close()` and sets `db = null`.
3. Delete the live sidecars if present: `refresh.db-wal`, `refresh.db-shm`.
4. `copyFileSync(backupFilePath, livePath)`.
5. Also delete any `*-wal`/`*-shm` that may have been copied alongside (there shouldn't be, since backups are checkpointed, but be defensive).
6. `app.relaunch(); app.exit(0)` so the app reopens cleanly against the restored file. Return a result that lets the renderer show "Restoring… the app will restart" before relaunch.

**Acceptance criteria.**
- Restoring a backup on Windows succeeds without `EBUSY`.
- After restore + automatic relaunch, the data shown is the backup's data (verify by restoring a backup taken before a known transaction and confirming that transaction is gone).
- Restoring a non-SQLite or truncated file is rejected with a clear error and the live DB is left untouched.

---

## P0-4 — Inventory can go negative; no guard on sell/adjust

**Files:** `src/main/ipc/inventory-pool.js` (`pool-inventory:sell`), `src/main/ipc/restaurant-menu.js` (checkout draw-down from P0-2)

**Problem.** Sell/decrement does `current_stock = current_stock - ?` with no check, so stock can silently go negative, masking miscounts and corrupting turnover math.

**Solution.** Before decrementing inside the existing `db.transaction`, read `current_stock` and throw a clear error if `quantity > current_stock` (`Not enough stock: only N left`). For owner adjustments (`pool-inventory:adjust`) allow any value (that's a deliberate correction) but never allow it to set a negative number — reject `newQuantity < 0`.

**Acceptance criteria.** Attempting to sell more than is in stock returns a descriptive error and writes nothing. Adjust rejects negative targets.

---

# P1 — Correctness & security

## P1-1 — Memberships never expire automatically

**Files:** new `src/main/ipc/maintenance.js` (or extend `members.js`), called from `src/main/index.js`; also fix the "active" lookups in `src/main/ipc/members.js`.

**Problem.** Nothing flips `memberships.status` from `active` to `expired` when `end_date` passes. Two consequences:
1. `members:search` and `members:list-all` select the latest membership by `status='active'` **without** an `end_date >= today` filter, so a lapsed member displays as Active at reception — staff could wave through someone whose membership ended.
2. `reports:retention` / churn logic keys off `status != 'active'`, which is almost never true, so churn is undercounted and retention is inflated.

**Solution.**
1. Add a startup + daily job that runs `UPDATE memberships SET status='expired' WHERE status='active' AND end_date < date('now','localtime')`. Hook it into `app.whenReady()` in `index.js` right after `initDatabase()`, and schedule it via the existing `node-cron` setup (run it just after midnight, e.g. `5 0 * * *`).
2. Defence in depth: in `members:search` and `members:list-all`, add `AND ms.end_date >= today` to the active-membership subquery so display is correct even between job runs (mirror what `fetchActiveMembership` already does correctly).

**Acceptance criteria.** A member whose `end_date` is yesterday shows as **Expired** in search immediately after the job runs and is excluded from the active subquery regardless. Retention report churn count reflects genuinely lapsed-and-not-renewed members.

---

## P1-2 — Advanced report Excel exports are near-empty

**File:** `src/main/ipc/reports.js` (`exportToExcel` and the report handlers' return shapes).

**Problem.** `exportToExcel` only knows how to render Summary, Transactions, ByWeek, and ByProduct sheets. The retention, inventory-turnover, bookings, and staff-activity reports return data under different keys (`due/renewed/churned`, `pool/restaurant/lowStock`, `bookings/summary`, `staff/transactions`), so their Excel files come out with just a sparse Summary sheet — confirmed in `QA_WAVE1.md` as "summary-only".

**Solution.** Add sheet builders and dispatch on `reportType` inside `exportToExcel`:
- `retention` → a "Retention" summary sheet (due, renewed, rate) + a "Churned Members" sheet (name, phone, product, end date).
- `inventory-turnover` → "Pool Items", "Restaurant Items", "Low Stock" sheets.
- `bookings` → "Bookings" sheet (all columns) + status breakdown summary.
- `staff-activity` → "Staff Totals" sheet + the existing Transactions sheet.
Reuse `styleHeaderRow` / `applyAlternatingRows`. Keep the generic Summary/Transactions path as the default for daily/monthly/custom.

**Acceptance criteria.** Exporting each of the seven report types produces a workbook whose sheets contain the same data shown on screen. No report exports an empty or single-sparse-sheet file.

---

## P1-3 — EOD WhatsApp total doesn't reconcile with its own breakdown

**File:** `src/main/ipc/whatsapp.js` (`generateEODMessage`).

**Problem.** `total` sums *all* non-voided transactions (including `restaurant` and any `pool_inventory`), but the itemised lines only show membership / day_package / day_pass. So `Total` is larger than the sum of the lines whenever there's restaurant revenue, which looks like a bug to the owner reading it on their phone.

**Solution.** Add explicit lines for Restaurant revenue (and pool-inventory/“Other” if non-zero) so the breakdown sums to the printed total. Also add cash-vs-QR split per the existing pattern. Optionally include the day's cash-reconciliation discrepancy if one was recorded (`cash_reconciliations` for `today`).

**Acceptance criteria.** For any day with mixed pool + restaurant sales, the line items in the WhatsApp message add up exactly to the `Total`.

---

## P1-4 — PIN login has no throttling and silent-collision risk

**File:** `src/main/ipc/auth.js` (`auth:login`, `auth:add-staff`, `auth:change-pin`).

**Problem.** (a) Login iterates all active staff and returns the **first** PIN match — if two staff share a PIN, sales are attributed to whoever sorts first, silently. (b) No attempt limiting on a 4-digit space (10k combos) means someone with the kiosk could brute force. This is low severity (physical-access threat model) but cheap to harden.

**Solution.**
1. Prevent duplicate PINs: on `add-staff` / `change-pin`, compare the new PIN against existing active staff hashes and reject duplicates with "That PIN is already in use."
2. Add simple in-memory throttling in the main process: track failed PIN attempts; after N (e.g. 5) consecutive failures, impose a short cooldown (e.g. 30s) before accepting another attempt. Reset on success. Keep it in memory (no schema change).

**Acceptance criteria.** Two staff cannot end up with the same PIN. After 5 wrong PINs, the next attempt is rejected with a "try again shortly" message for the cooldown window.

---

## P1-5 — `reminders:send-all` opens many browser tabs and marks "sent" before sending

**File:** `src/main/ipc/reminders.js` (`reminders:send-all`, `reminders:send-one`).

**Problem.** The loop calls `shell.openExternal(wa.me/...)` once per member — opening 10–30 tabs/windows at once — and immediately sets `reminder_sent_at`, even though `wa.me` only *opens* a pre-filled chat that the owner must still manually send. So `reminder_sent_at` is unreliable and blocks legitimate re-sends.

**Solution.** Change "send all" to a guided one-at-a-time flow: return the list to the renderer and have the UI open each `wa.me` link on an explicit "Next" tap, marking `reminder_sent_at` only after the owner confirms they sent it. If a true bulk action is desired, at minimum throttle `openExternal` calls (e.g. 800ms apart) and make `reminder_sent_at` mean "queued on {date}" rather than "delivered". Add a way to clear/resend a reminder.

**Acceptance criteria.** The owner is never hit with a burst of simultaneous tabs. A reminder isn't marked sent unless the owner actually proceeded. Re-sending is possible.

---

## P1-6 — No Content-Security-Policy in the renderer

**Files:** `src/renderer/index.html`, `ticket.html`, `membership-card.html`.

**Problem.** No CSP meta tag. Low risk today (offline, no remote content, Google Fonts already removed per QA), but a defence-in-depth gap, and Electron warns about it.

**Solution.** Add a strict CSP `<meta>` to each HTML entry: default-src 'self'; allow `'unsafe-inline'` for styles only if the app relies on inline styles (it does — keep `style-src 'self' 'unsafe-inline'`), `img-src 'self' data: file:` (member photos use `file://`), and no remote `script-src`. Verify the app still renders and photos/tickets still load.

**Acceptance criteria.** App runs with the CSP in place; the Electron "Insecure CSP" warning is gone; photos, tickets, and the membership card still render.

---

# P2 — Functional gaps / next features

## P2-1 — Staff cannot sell pool inventory items (dead code path)

**Files:** `src/preload/index.js` exposes `sellPoolItem`, and `src/main/ipc/inventory-pool.js` implements `pool-inventory:sell`, but **nothing in the renderer calls it** (not even wrapped in `src/renderer/src/lib/api.js`). `QA_WAVE1.md` flags 2F as LIKELY-FAIL for this reason.

**Problem.** Goggles, caps, etc. can be stocked but not sold through the app — staff have no UI, so those sales either don't happen in-app or get mis-logged as something else.

**Solution.** Add an "Add item" path to the staff New Transaction wizard (or a small "Sell item" tile) that: lists active pool inventory items with a selling price > 0, lets staff pick quantity, and on confirm runs a **single** atomic operation that (a) creates a `transactions` row (`transaction_type='pool_inventory'`, source `'pool'`, amount = qty × server-looked-up `selling_price`, `staff_id` from session) and (b) calls the sell draw-down. Wire `sellPoolItem` into `api.js`. Apply the P0-1 (server-side amount/staff) and P0-4 (no negative stock) rules. Ideally move the create+draw-down into one main-process handler so it's one DB transaction rather than two IPC round-trips.

**Acceptance criteria.** Staff can sell a goggle from the POS; stock drops by the quantity; the sale appears in Today's Log and reports with the correct amount and staff; selling beyond stock is blocked.

---

## P2-2 — Graceful handling when the DB file is deleted/unavailable at runtime

**Files:** `src/main/db/index.js`, `src/main/index.js`. `QA_WAVE1.md` lists this as LIKELY-FAIL.

**Problem.** If the `refresh.db` file is removed or the disk/USB it lives on disconnects while running, the next query throws an unhandled error and the app becomes unusable with no message.

**Solution.** Wrap the IPC `wrap()` helpers so a DB-level failure returns a structured `{ success:false, error:'Database unavailable' }` instead of crashing, and add a global `process.on('uncaughtException')` / `unhandledRejection` handler in `index.js` that surfaces a dialog ("Database connection lost — please restart the app") rather than dying silently. Consider a lightweight health check on focus that verifies `getDb().pragma('quick_check')`.

**Acceptance criteria.** Deleting the DB file while the app is open results in a clear error dialog, not a frozen/blank window.

---

## P2-3 — Booking deposits don't create a money transaction

**Files:** `src/main/ipc/bookings.js`, `reports`/EOD.

**Problem (verify during implementation).** Bookings store `deposit_paid`/`deposit_method` on the booking row, but a deposit taken at reception is real cash/QR that should appear in the daily totals and EOD reconciliation. If it isn't also written to `transactions`, the cash drawer won't reconcile on days with booking deposits.

**Solution.** When a booking is created/updated with a non-zero `deposit_paid`, also insert a `transactions` row (a `booking_deposit` type — add it to the `transaction_type` CHECK constraint via migration, or reuse an existing type with a clear note) so deposits flow into daily revenue and EOD. Avoid double-counting on the final settlement.

**Acceptance criteria.** A booking deposit taken today appears in Today's Log, the daily report, and the EOD WhatsApp total; the cash reconciliation matches the physical drawer.

---

## P2-4 — "By week" buckets by day-of-month, not real weeks

**File:** `src/main/ipc/reports.js` (`fetchByWeek`).

**Problem.** `(day-1)/7 + 1` produces 1–7, 8–14… buckets, not ISO weeks. Acceptable as a simplification but mislabels "weeks" in the monthly report.

**Solution.** Either relabel the column "Period (days 1–7, 8–14, …)" to be honest, or compute real week-of-month using `strftime('%W')` / day-of-week math. Lowest effort: relabel. Do this only after P0/P1.

**Acceptance criteria.** The monthly report's weekly grouping is either correctly ISO-weeked or honestly labelled.

---

# P3 — Engineering hygiene (do alongside, not blocking go-live)

## P3-1 — No automated tests on a money-handling app

**Problem.** There is no test script and no tests. Every fix above is currently verified only by hand.

**Solution.** Add a minimal main-process test harness (Vitest works well with electron-vite; run the DB/IPC logic against an in-memory or temp-file better-sqlite3 instance without launching Electron). Prioritise tests for: server-side amount/staff derivation (P0-1), checkout inventory draw-down atomicity (P0-2), backup restore round-trip (P0-3), negative-stock guard (P0-4), and membership expiry (P1-1). Add `"test": "vitest run"` to `package.json` and a GitHub Actions workflow that runs lint + test on push.

**Acceptance criteria.** `npm test` runs green locally and in CI; the five P0/P1 behaviours have at least one test each.

## P3-2 — Consistent error surfacing & input validation at the boundary

**Problem.** Handlers vary in how much they validate payloads; some assume well-formed input from the renderer.

**Solution.** Add light payload validation at the top of money-writing handlers (positive integers for ids and quantities, known enum values for `paymentMethod`/`type`). Keep it minimal and centralised — a small `assert(cond, msg)` helper per IPC module is enough. Don't over-engineer into a schema library.

**Acceptance criteria.** Malformed IPC payloads return descriptive `{success:false,error}` rather than throwing raw SQLite/JS errors.

---

# Suggested execution order

1. **P0-1** (server-side staff/amount) — small, high-leverage, unblocks trust in every number.
2. **P0-4** (negative-stock guard) — tiny, and P0-2 depends on it.
3. **P0-2 Phase A** (restaurant inventory draw-down + link).
4. **P0-3** (safe restore) — isolated, high-stakes.
5. **P1-1** (expiry job + active-lookup fix).
6. **P1-2** (report exports), **P1-3** (EOD reconcile), **P1-5** (reminders flow).
7. **P1-4**, **P1-6** (security hardening).
8. **P2** features as the owner prioritises (P2-1 pool sell is the most user-visible).
9. **P3** tests + hygiene, ideally landing tests *with* each P0/P1 fix rather than after.

# What NOT to change
- The IPC + raw-SQL + better-sqlite3 architecture (it's appropriate and clean).
- WAL mode, the backup pruning (`MAX_BACKUPS = 30`), single-instance lock, or the `clearSession()`-on-reload behaviour (these are correct).
- The role-gate pattern (`requireOwner` / `requireStaffOrOwner`) — extend it, don't replace it.
- Don't add online/cloud dependencies; offline-first is a hard product requirement for this site.

---

## One-paragraph summary for the commit/PR description

This work order hardens Refresh Manager's money path and data safety. The headline fixes: stop trusting `staff_id`/`amount` from the renderer and derive both from the authenticated session and product catalogue (P0-1); make restaurant checkout actually move inventory atomically (P0-2); make database restore safe on Windows by closing, replacing, clearing WAL sidecars, and relaunching (P0-3); prevent negative stock (P0-4); expire memberships on a schedule so reception and reports stop treating lapsed members as active (P1-1); and make the advanced report exports contain real data (P1-2). Security hardening (PIN throttling, CSP), the missing staff pool-sell UI, graceful DB-loss handling, and a first test suite follow.
Done
