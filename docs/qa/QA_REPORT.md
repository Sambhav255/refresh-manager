# Refresh Manager — full QA sweep

**Date:** 2026-08-18/19 · **Build:** working tree on `main` (18 uncommitted files at time of sweep)
**Method:** five parallel agents drove the **real Electron app** through Playwright's `_electron` API. Every launch used its own `--user-data-dir`, so no run touched the production `refresh.db`.

**Coverage:** 25 screens · ~470 individual checks. Screenshots and the one-off reproduction scripts were run artefacts and have since been removed; the maintained suites below replace them.
**Result: 55 bugs — 2 P0, 12 P1, 22 P2, 19 P3.** **24 are fixed and verified**; the rest are documented for triage.

**Verification status:** `verify-fixes.mjs` 10/10 · `verify-fixes-2.mjs` 15/15 · unit suite 77/77 · eslint 0 errors · **zero console errors at runtime**.

| Artefact | Location |
|---|---|
| Harness | `test/e2e/harness.mjs` |
| Fix verification | `test/e2e/verify-fixes*.mjs`, `test/e2e/sweep-reports-settings.mjs` |
| Staff-area detail | `docs/qa/findings-staff.md` |

> **Reproducing:** `node test/e2e/verify-fixes.mjs`. The harness needs `better-sqlite3` built for **Electron's** ABI (`npx electron-rebuild -f -w better-sqlite3`). Running `npm test` rebuilds it for the **Node** ABI and will break the harness until you run that command again. `npm run dev` self-heals via its `predev` hook.

---

# FIXED AND VERIFIED

All four verified against the running app by `test/e2e/verify-fixes.mjs` — **10/10 checks pass, zero console errors**. Full unit suite still green (77 tests, 17 files).

### ✅ P0-1 — Owner dashboard crashed on every single mount
The owner's landing screen showed only *"Something went wrong — Cannot read properties of null (reading 'status')"*. **"Try again" could never recover it**, because remounting restored the same initial state. Reproduced in all six states tested, including after a successful backup — so no amount of data could fix it.

The `alerts` array is built at `owner-dashboard.jsx:115-165`, **above** the `if (loading)` guard at line 166. On first render `backupStatus` is still `null` (line 15) and `backupStale` is `false` (line 16), so both preceding branches fail and control always reached the unguarded `else`. Lines 133 and 142 already used `backupStatus?.`; line 147 did not.

**Fix:** optional chaining at `owner-dashboard.jsx:147`, matching its neighbours.

### ✅ P0-2 — Restaurant POS could not complete a single sale
Every **Confirm order** failed with `Menu item not found: <item>`. No transaction written, no stock moved — the entire restaurant revenue path was dead, and none of it reached Today's Log, End of Day, the WhatsApp report or any owner report.

`staff-restaurant-pos.jsx:115` built the payload as `{name, price, quantity}`, dropping `id` — while `restaurant-menu.js:99` resolves each line by exactly `i.id`. Cart entries always carried an `id` (`addToCart` spreads the full menu item). This was a regression from the hardening change that made the handler re-derive prices from the catalogue.

**Fix:** send `{ id: c.id, quantity: c.quantity }`. Verified end-to-end: order completes, transaction written, linked stock drew down 20 → 19.

### ✅ P1-3 — Product column read "undefined — Monthly" or was blank
Affected Today's Log, owner Transactions, the dashboard's recent-transactions list, **and every report and Excel export**. `productDisplayName` reads `product.name`, but the queries alias it to `product_name`, so memberships rendered `undefined — Monthly` and everything else rendered blank.

Found in **three** places: `transactions.js:23`, `reports.js:27`, `reports.js:144`. The two in `reports.js` were in the area whose agent never reported — found by direct inspection.

**Fix:** added a shared `productFromRow(row)` helper in `utils.js` and used it at all three sites. Transactions with no `product_id` now fall back to `notes` ("Tea x1") instead of the raw enum `restaurant`.

### ✅ P1-4 — Voiding a refund silently inflated revenue
`transactions:void` accepted a `refund` row. Since all totals filter `is_voided = 0`, voiding the refund removed the negative correction and the original sale counted as full revenue again — money the business had already paid back reappearing as income.

Measured: a correct day total of Rs. 16,100 jumped to **Rs. 26,100** after one void, persisting across restarts. Not reachable from the shipped UI (`owner-transactions.jsx:162` hides the button), but the only protection was renderer-side — contradicting the file's own stated principle that money rules live in main so "a tampered/buggy renderer cannot mis-price".

**Fix:** reject voids of `transaction_type = 'refund'` in `transactions.js`, mirroring the existing "Cannot refund a refund" guard.

### ✅ P1-5 — End of Day breakdown hid restaurant and pool-item revenue
Headline total and Cash/QR split were right, but the itemised lines only covered memberships/packages/passes. Measured: total Rs. 2,300, lines summing to Rs. 1,700 — **Rs. 600 invisible on the screen used to hand over cash**. The WhatsApp report the owner receives *did* include those lines, so staff and owner saw different breakdowns of the same day.

**Fix:** the label map and display order now live in `src/shared/transaction-types.js`, imported by **both** `whatsapp.js` and `staff-eod.jsx`, so the message and the screen cannot diverge again. The breakdown is built from the types actually present, so a future transaction type can never be silently dropped. Verified: `total=1000 lines=1000` with both Day Passes and Pool Items itemised.

### ✅ P1-6 — Restock quantity carried over and restocked the WRONG item
`restockQty` was cleared only on success. Typing `77` for item A, cancelling, then opening Restock on item B left `77` in the box — one click set **B** to 77. Confirmed live on "Nose Pin". Made worse by the panel not naming its target.

**Fix:** `openRestock`/`closeRestock` reset the quantity whenever the target changes and on Cancel, in both inventory screens. The panel now shows the item name, variant/unit and current stock.

### ✅ P1-7 — Inventory and booking handlers accepted junk
Both add handlers inserted whatever they received: blank names, `sellingPrice: -100`, and `'abc'` stored as TEXT in a numeric column (rendering **"Rs. NaN"**). Text in `reorder_level` also silently corrupted the low-stock query, since SQLite orders all numbers below all text. Restock had no upper bound — `1e21` passed `Number.isInteger`. Bookings accepted garbage dates (invisible to every ranged query), negative deposits and negative party sizes, and `bookings:update` reported success for rows that don't exist.

**Fix:** shared `requireText` / `requireAmount` / `requireRestockQuantity` guards in `utils.js`, applied across pool inventory, restaurant inventory, products and bookings; restock capped at 100,000; stock adjustments now require a reason; `changes === 0` now throws "not found". All ten guards verified rejecting their bad input.

### ✅ P1-8 — Setup wizard could permanently lock an owner out
`"  Sambhav  "` was stored verbatim. The header rendered `Sambhav · Admin` (HTML collapses whitespace) so the padding was invisible, but the next login with `Sambhav` failed with "Incorrect password". With no password-reset flow and `auth:setup` refusing to run twice, **the only recovery was deleting `refresh.db`.**

**Fix:** names trimmed before validation and insert (matching `auth:add-admin`), 60-character cap, and the `hasUsers()` check moved *inside* the transaction so two concurrent submits can't both create an owner. Renderer also gained an in-flight ref, required-field-first validation, Enter-to-submit, and digit-only PIN filtering.

### ✅ P1-9 — Seeded pool stock was unsellable with no way to fix it
All 12 seeded items ship at `selling_price = 0`; Sell Item filters to `> 0`, so staff saw "No sellable items" on a fresh install. The owner's Pool Inventory had **no price-edit control** — the only route was creating a duplicate item. The capable handler existed and was bridged, with zero call sites.

**Fix:** added a per-row **Price** control wired to the existing `updatePoolItem` handler, plus a "not sellable" marker on Rs. 0 rows. `updatePoolItem`/`adjustPoolItem` (and restaurant equivalents) are now wrapped in `api.js`.

### ✅ Also fixed in this round
- **Paused members were filed under "Expired"** and had no filter option — status derivation is now a single helper shared by the filter and the row, with a "Paused" option added.
- **Members search concatenated name and phone**, so `rai9841` matched a string in neither field. Now matched independently.
- **Minimise/Maximise did nothing** on a frameless window with no OS fallback — added `window:minimize` / `window:toggle-maximize` IPC, preload bridge and handlers.
- **A long account name pushed "Log out" off-screen**, leaving no visible way to exit — `.hdr-user` now shrinks and ellipsises.
- **Dashboard hardcoded a 5-day expiry window**, disagreeing with Members; it now honours `expiry_warning_days`.
- **Dashboard footer showed the top-5 total labelled "today"** (Rs. 4,600 vs a real Rs. 29,100) — relabelled "Total of shown".
- **`last_backup_at` was written in UTC and read as local**, making a fresh backup read ~6h old and tripping staleness early — now local, matching the rest of the schema.
- **Transaction ordering was unstable** for same-second rows — added `, t.id DESC`.
- **Rs. 0 sale warning never fired in the realistic case** (one unpriced product) — now warns on the *selected* product.
- **Cancelling a booking** now returns `outstandingDeposit` so the deposit cannot go unmentioned. The deposit is deliberately **not** auto-reversed — forfeiting is normal and reversing automatically would destroy real revenue.

---

# P1 — OPEN

**Deposit tracking is unreachable from the Bookings UI.** Fully implemented in main and correct over IPC, but the form renders only 8 fields — no deposit, no total-expected, and the cards show neither. Every booking created through the UI is forced to `depositPaid: 0`. `owner-bookings.jsx:116-125`. → Add the inputs and surface the values on the cards. *(Left open: this is new UI surface rather than a defect fix, and it pairs with the cancel-flow decision above.)*

---

# P2 — OPEN

**Money / correctness**
- **Every membership is valid one day too long.** `end_date = start + duration_days` with an *inclusive* `end_date >= today` comparison, so a 30-day product grants 31 days — roughly 12 free days per member per year on monthly renewals. `members.js:85-88` + `utils.js:80-86`. Fixing changes existing rows, so needs a migration decision.
- **A fully refunded membership stays Active.** The refund restores inventory but never touches the `memberships` row, though it's linked via `memberships.transaction_id`. Member keeps access they were fully refunded for. `transactions.js:235-330`.
- **A Rs. 0 product sells silently.** The warning banner only fires when *every* product is Rs. 0; the realistic case (one product missed) gives no warning and writes a Rs. 0 transaction. `staff-transaction.jsx:193-194`, banner gated at `:455`.
- **`last_backup_at` written in UTC, read as local.** `backup.js:138` uses `toISOString()` while everything else uses `datetime('now','localtime')`. A just-finished backup reads as 5h45m old (Asia/Kathmandu), so "stale" fires at ~30h rather than 36h.
- **Selling a menu item linked to a *deactivated* stock item still draws it down.** `restaurant-menu.js:120-124` checks existence, never `is_active`. Stock silently drains on a row invisible in every list.

**Data integrity**
- **Every membership sale creates a brand-new member.** No existing-member lookup, so renewals duplicate the person; check-ins, photos and history split at random. The two writes aren't atomic either, so a failure orphans the member row. `staff-transaction.jsx:259-282`, `members.js:91-103`.
- **Phone is never validated in the staff wizard.** `abc-123` is stored — and that's what renewal reminders later use to contact the member. `validatePhone` exists at `lib/validate.js:6-11` and is used by owner screens; the staff entry point just never imports it.
- **`auth:setup` is not idempotent.** A re-entrant submit creates two owners with the same name and two staff with the same PIN, bypassing `assertAdminNameUnique`/`assertPinUnique`, which `auth:setup` never calls. The `hasUsers()` check is split from the INSERT by two `await bcrypt.hash` calls. Honest scoping: a real double-click does *not* reproduce it; two clicks dispatched in one task do. `auth.js:68-93`, `App.jsx:35-45`.
- **Duplicate inventory items are silently created**, with no UNIQUE constraint (`schema.js:68-79`, `:93-104`). Combined with no delete, the duplicate is permanent.
- **Booking accepts past dates, garbage dates and negative/zero/text party sizes.** `bookings.js:169` checks only that name and date are non-empty. A garbage date never matches any ranged query, so the booking is invisible everywhere.
- **`bookings:update` / `update-status` report success for non-existent ids** — neither checks `result.changes`.
- **Stock adjustments accepted with no reason** — `reason` inserted unchecked; the most sensitive inventory operation leaves no trail.

**Visibility / UX**
- **Paused members are filtered as "Expired", and no "Paused" filter exists.** The row renderer accounts for paused (`owner-members.jsx:141-142`); the filter predicate doesn't (`:82-89`). Selecting "Expired" returns a member whose own badge says Paused.
- **Expired members show "—" for type and expiry** — `members:list-all` only fetches active or paused memberships, so exactly the win-back information is missing.
- **Voided transactions vanish entirely** — no strikethrough, no badge, no filter. `transactions.js:102` hardcodes `is_voided = 0`. The only trace is the audit log. `mapTransaction` maps an `isVoided` field no caller can ever see as true.
- **Dashboard hardcodes a 5-day expiry window**, ignoring `expiry_warning_days`. With the setting at 20, Members shows a member as "Expiring soon" while the Dashboard omits them and the copy still reads "Within next 5 days". Both handlers already default to the setting when `days` is omitted. `owner-dashboard.jsx:31-32`.
- **Adjust stock, per-item history, edit and delete are implemented but have no UI.** Four handlers exist and are bridged; none is called. There is no `*-inventory:history` read handler at all — history is write-only, so the owner can never see why stock changed, or correct a mis-restock.
- **"N items below reorder threshold" is wrong at the boundary** — the comparison is `<=`, so an item sitting exactly at its reorder level (the normal steady state) is permanently in the red alert. Pick `<` or reword; make query, row flag and banner agree.
- **Minimise and Maximise in the custom title bar do nothing** — no `onClick` and no IPC channel (`ui.jsx:161`, `:166`). The window is frameless, so there is no OS fallback: the app cannot be minimised at all.
- **No length limit on account names.** A 300-char name measured 3038px in a 1212px header, pushing **Log out** off-screen entirely — the only remaining exit is the Escape shortcut, which a new operator wouldn't know. Needs both a server-side cap and `min-width:0; overflow:hidden; text-overflow:ellipsis` on `.hdr-user`.
- **Empty restock quantity is a silent no-op** — early return with no state change, indistinguishable from a hung app.

---

# P3 — OPEN

Grouped, one line each.

**Feedback and copy**
- Empty-field logins report the internal "Invalid login credentials" rather than "Enter your PIN" (`auth.js:105`/`:131`/`:155`).
- An all-empty setup form reports "Staff PIN must be 4 digits" — the PIN check fires first because `'' !== ''` is false (`App.jsx:37-44`).
- PIN lockout says "a few seconds" for a 30-second lock; the password path correctly says "a minute" for 60s (`auth.js:20`/`:107`).
- The attempt that *triggers* the lockout still shows the generic failure; the user only learns on the next attempt (`auth.js:123-128`, `:141-146`).
- Void with an empty/whitespace reason does nothing at all — silent early return (`owner-transactions.jsx:44`).
- "Print membership card" swallows failures while "Print Ticket" on the same card handles them properly; the `printError` state already exists and is simply never set (`staff-transaction.jsx:352-362`).
- POS surfaced the internal "Menu item not found" to the till; owner Transactions renders the raw enum `booking_deposit`.

**Missing affordances**
- Enter doesn't submit the setup wizard, though both login modals support it.
- The setup PIN field accepts letters; the login PIN field strips them.
- Restaurant POS has no "Clear order" — a six-line order takes ~15 taps to clear, and the only `Clear` button is "Clear search".
- Cancelling a booking has no confirmation and no undo — once cancelled the buttons are hidden, so it can only be reinstated over IPC.
- Bookings has no empty state (the staff screen does it correctly); inventory tables render a bare header row when empty.
- Transactions has no empty-state message, unlike Members.
- Booking Notes is a single-line `<input>`, not a textarea.
- New inventory items can't be given an opening stock — the owner must fake a "Restock", mislabelling it as a purchase.
- No dashboard alert row is clickable; "13 items low stock" offers no way to reach Inventory.

**Scoping and correctness details**
- The same member can be checked in repeatedly — the guard is component-local state lost on remount, and there's no DB constraint. Footfall drifts upward.
- An expired member is indistinguishable from someone who never had a membership; both read "No active membership / Expires —".
- Transactions type filter covers 3 of 7 real types; the staff filter never contains the owner, so owner-recorded sales (every refund) are unfilterable.
- "This week" start date is computed in UTC while the end uses local — off by one day before 05:45 local. Also `-7` days inclusive makes it an 8-day window.
- No pagination and no custom date range: at most ~8 days of history is reachable.
- Row ordering is unstable for same-second rows — `ORDER BY t.created_at DESC` with no tiebreak. Add `, t.id DESC`.
- Members search concatenates name and phone, so `rai9841` matches a string present in neither field alone.
- Dashboard "Recent transactions" footer shows the top-5 total labelled "today" (Rs. 4,600 vs a real Rs. 29,100).
- Refund dialog pre-fills the original amount, not the remaining refundable amount, so accepting the default errors.
- Owner "Upcoming" bookings is a 60-day window; staff "Upcoming" is 14 — same word, two meanings.
- Restaurant restock ignores the item's unit: "Chicken Momo" (unit: plates) accepted `52.5`.

---

# What passed cleanly

Worth stating, because it's most of the app:

- **Money arithmetic under the sell paths is solid.** Line totals, cart totals, log totals, home metrics, reconciliation discrepancies and stock decrements matched the DB exactly in every check. Footer totals were arithmetically exact across all 14 filter states.
- **Oversell protection is genuinely robust.** Both sell paths refuse to oversell, drain to exactly zero correctly, roll a mixed cart back entirely when one line is short, catch a cart listing the same item twice beyond stock, refuse inactive menu items, and reject fractional/zero/negative/1e21 quantities.
- **Void and refund semantics are correct** apart from the two holes fixed above: re-voiding is rejected, voiding a refunded sale is rejected, refunding a refund is rejected, over/zero/negative refunds are rejected, partial and full refunds net exactly, and the reconciled-day confirmation flow works.
- **Deposit-transaction reconciliation** (create/update/void on zero/revive on re-add, and the refusal to resurrect a refunded or owner-voided transaction) behaved exactly as documented.
- **Auth and session handling is sound**: both throttles engage and release correctly, privileged IPC is refused when logged out, staff are refused owner-only IPC, Escape logs out but correctly does *not* while typing in a field, and sessions clear properly across reload and relaunch.
- **Pause/resume** works correctly, including a same-day pause adding 0 days and preserving the expiry.
- The 14-day upcoming-booking window is inclusive and correct at both ends.

---

# Could not test

- **Anything calling `shell.openExternal`** — the WhatsApp EOD send and renewal reminders were deliberately never clicked; they open real browser tabs. Buttons were verified to render, enable, and appear for exactly the right members. Message bodies, phone normalisation, `reminder_sent_at` writes and their audit entries are unexercised.
- **Native OS dialogs** — folder pickers, the Excel save dialog, and `dialog.showErrorBox`. Playwright cannot drive them; underlying functions were tested directly where reachable.
- **Printing** — no printer attached, so only the no-printer failure paths were exercised. Ticket layout, 58mm/80mm sizing and card artwork are unverified against hardware (the source flags this itself at `tickets.js:22-26`).
- **Camera capture** for member photos — needs real hardware and a permission grant. The upload path was tested fully.
- **The 30-minute idle timeout** — would require a 30-minute idle run.
- **Concurrency** — two windows mutating the same record. The single-instance lock plus one `--user-data-dir` per launch made this impractical.
- **Day-boundary behaviour** — all runs were inside one local day; midnight rollover was not observed.
- **Multi-staff tills** — only one staff account exists from setup, so per-staff EOD attribution is untested.
