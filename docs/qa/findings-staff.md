# QA findings — all staff-role screens

*Produced by a Playwright-driven sweep of the real Electron build, 2026-08-18. Scripts: `test/e2e/area-staff-*.mjs`. Screenshots: `docs/qa/screenshots/staff/`.*

**Summary:** 9 staff screens exercised end-to-end (StaffHome, New Transaction, Member Search, Today's Log, End of Day, Restaurant POS, Sell Item, Staff Inventory, Staff Bookings, plus the staff shell and keyboard shortcuts). **10 bugs: 1× P0, 4× P1, 3× P2, 3× P3.** 131 of 144 checks passed. No staff screen tripped `ScreenErrorBoundary`.

Each run starts from a fresh isolated `--user-data-dir`, completes the setup wizard, then makes the shop realistic **through the owner UI** (Pricing: Pool Day Pass Rs. 500, Gym Day Pass Rs. 300, Whole Package Rs. 1,200, Gym Only Monthly Rs. 2,500; Restaurant menu: Tea Rs. 50 linked to Tea stock, Momo Rs. 180; Inventory: "Pro Goggles" Rs. 250 restocked to 10; Tea stock to 20). `Sauna + Steam + Jacuzzi` is deliberately left at Rs. 0 to exercise the zero-price path.

---

## BUG-1 — Restaurant POS checkout is completely broken; no order can ever be saved

**Severity: P0** — revenue path dead; restaurant sales cannot be recorded at all.

**What happens.** Building a cart works perfectly — tapping, quantities, totals, payment selection all correct. **Confirm order** always fails with a red `Menu item not found: Tea`. No transaction written, no stock moved, "Order saved" never reached. Not data-dependent: fails for every menu item, linked to stock or not. Confirmed present in the shipped bundle, not just source.

Every restaurant rupee taken across the counter is therefore missing from Today's Log, Home metrics, End of Day, the WhatsApp report, and all owner reports.

**Repro.** Owner → Settings → Restaurant menu → add Tea Rs. 50. Log out, staff login (PIN 4821). Home → Restaurant POS → tap Tea (`Total: Rs. 50`) → **Confirm order** → `Menu item not found: Tea`. `listTransactions({source:'restaurant'})` returns 0 rows; linked stock unchanged.

**Root cause.** `src/renderer/src/screens/staff-restaurant-pos.jsx:114-118` drops `c.id` from the payload:

```js
const r = await api.restaurantCheckout({
  items: cart.map((c) => ({ name: c.name, price: c.price, quantity: c.quantity })),
  paymentMethod: pay.toLowerCase(),
  staffId: session?.userId
})
```

`src/main/ipc/restaurant-menu.js:99-100` resolves each line by exactly that missing field:

```js
const menuItem = menuStmt.get(i.id)
if (!menuItem) throw new Error(`Menu item not found: ${i.name || i.id}`)
```

The backend is correct and deliberately hardened (it ignores client-supplied prices and re-derives totals from the catalogue) — the renderer simply omits the key it keys on. Cart entries *do* carry `id` (`addToCart` spreads the full menu item, line 93). Calling `restaurantCheckout` with `{id, quantity}` over the same IPC channel succeeds immediately and draws linked stock down 1:1, isolating the fault to the renderer payload.

**Suggested fix.** Include `id: c.id` in each cart line. Since `price`/`name` are ignored server-side, the payload reduces to `{ id: c.id, quantity: c.quantity }`. Add a guard in the handler naming the offending field when `i.id` is missing so this fails loudly. A regression test driving the POS *through the UI* (not the IPC layer) would have caught it.

**Screenshots.** `staff/74-pos-checkout-result.png`, `staff/71-pos-cart.png`

---

## BUG-2 — End of Day breakdown silently omits restaurant and pool-item revenue

**Severity: P1** — money reporting wrong; the cash-handover screen disagrees with itself.

**What happens.** Correct headline total and correct Cash/QR split, but the itemised breakdown only ever lists Memberships / Day packages / Day passes. Restaurant and pool-item sales are counted in the total and in Cash/QR but appear on no line, so the breakdown does not reconcile and the missing money is invisible.

Measured: total **Rs. 2,300** (Cash 1,100 + QR 1,200), itemised lines sum to **Rs. 1,700** — **Rs. 600 unaccounted** (Rs. 500 pool items + Rs. 100 restaurant).

The on-screen figures also disagree with the WhatsApp report the owner receives: `generateEODMessage` (`src/main/ipc/whatsapp.js:57-75`) builds its breakdown from the type groups actually present, so the message *does* include Pool Items and Restaurant lines. Staff and owner see two different breakdowns of the same day.

**Repro.** Sell Day Pass Rs. 500 cash + Day Package Rs. 1,200 QR + 2× Pro Goggles Rs. 500 cash + a restaurant order Rs. 100 cash. Bottom nav → End of Day.

**Root cause.** `src/renderer/src/screens/staff-eod.jsx:66-74` hardcodes three of the possible types:

```js
{ label: 'Memberships sold', value: fmt(summary.byType?.membership || 0) },
{ label: 'Day packages',     value: fmt(summary.byType?.day_package || 0) },
{ label: 'Day passes',       value: fmt(summary.byType?.day_pass || 0) }
```

`summary.byType` from `transactions:today-summary` (`src/main/ipc/transactions.js:160-171`) already contains `restaurant`, `pool_inventory`, `booking_deposit`, `refund`. Any future type is silently dropped the same way.

**Suggested fix.** Build the breakdown from `Object.entries(summary.byType)` with a label map and stable order, exactly as `whatsapp.js` already does (`TYPE_LABELS`/`TYPE_ORDER`). Share that map between main and renderer so screen and WhatsApp report cannot diverge. Add an assertion that the lines sum to the headline total.

**Screenshot.** `staff/54-eod-summary-populated.png`

---

## BUG-3 — Today's Log shows no product name (or literal "undefined — Monthly")

**Severity: P1** — the log's only descriptive column is empty.

**What happens.** The "Customer & Product" column shows the customer name, a bare `·`, and nothing else. For memberships it renders the literal `undefined — Monthly`. Restaurant and pool sales fall back to the raw DB type instead of item names that *are* stored in `notes`:

```
9:53 PM  Hari Shrestha · undefined — Monthly   Rs. 2,500  QR
9:56 PM  Log QR Customer ·                     Rs. 1,200  QR
9:56 PM  Walk-in · pool_inventory              Rs. 500    Cash
9:56 PM  Walk-in · restaurant                  Rs. 100    Cash
```

Amounts, times, payment badges and the footer total are all correct — only the description is broken. This is the screen reception uses to answer "what did this customer buy?".

**Root cause.** `src/main/ipc/transactions.js:23` passes the raw joined row into a helper expecting a *product* object:

```js
product: row.product_name ? productDisplayName(row) : row.transaction_type,
```

The query aliases the name to `product_name` (`transactions.js:96`), so `row.name` is `undefined`. `productDisplayName` (`src/main/ipc/utils.js:19-28`) reads `product.name`. `src/main/ipc/members.js:33-40` shows the correct pattern. Shared mapping code, so the same wrong value reaches owner Transactions too.

**Suggested fix.** Build the product object first, mirroring `members.js`: `productDisplayName({ name: row.product_name, category: row.category, duration_days: row.duration_days, sub_category: row.sub_category })`. For transactions with no `product_id`, prefer `row.notes` (already `"Tea x2"`) over the raw type. Make `productDisplayName` return `''` rather than `undefined` when `name` is missing.

**Screenshots.** `staff/33-todays-log-populated.png`, `staff/52-log-populated.png`

---

## BUG-3b — Sell Item cannot sell any seeded pool item, and the owner cannot fix it

**Severity: P1** — screen is empty out of the box with no in-app remedy.

**What happens.** Sell Item shows "No sellable items. Ask the owner to add pool items with a selling price." even though 12 pool items exist and are visible on staff Inventory. Sell Item filters to items with a selling price; all seeded items ship at `selling_price = 0`.

The dead end: the owner's Pool Inventory offers **no way to set the selling price of an existing item** — the price field exists only on the "Add item" form. The only route to selling seeded goggles is creating a duplicate item, leaving the original as permanent dead inventory. The handler that would fix this (`pool-inventory:update`, allow-list includes `selling_price`) exists and is on the preload bridge, but no renderer screen calls it.

**Root cause.**
- Seed ships zero: `src/main/db/seed.js:99-196`
- Sell Item filters them out: `staff-sell-item.jsx:83` — `.filter((i) => i.selling_price > 0)`
- Owner UI never exposes an edit: `owner-inventory.jsx:99-135` renders only a `Restock` button; `sellingPrice` appears only in the add form (`:158-166`)
- Capable handler unused: `src/main/ipc/inventory-pool.js:203-224`, bridged at `src/preload/index.js:53` as `updatePoolItem`, zero call sites in `src/renderer`

**Suggested fix.** Add an inline price edit to each owner Pool Inventory row wired to the existing `updatePoolItem` handler — smallest change, and it also unblocks routine price changes. Seeding non-zero prices alone would still leave the owner unable to change a price. Soften the staff empty state to name the actual blocker.

**Screenshot.** `staff/76-sellitem-list.png`

---

## BUG-5 — A Rs. 0 product sells through the wizard with no warning

**Severity: P2** — a free sale is recorded as a real transaction.

**What happens.** With a price unset, the wizard walks through to "Transaction saved" showing `Rs. 0` and writes a Rs. 0 transaction. It appears in Today's Log as a real line and in the transaction count without contributing revenue, so count and revenue silently disagree.

There *is* a warning banner — but only when **every** product is Rs. 0. The realistic case (one product missed) produces no warning at all.

**Root cause.** `src/renderer/src/screens/staff-transaction.jsx:193-194`:

```js
const amount = selected?.price ?? 0
const allPricesZero = products.length > 0 && products.every((p) => !p.price)
```

Banner gated on `allPricesZero` (line 455), never the selected product. Confirm button (`:682-689`) has no amount guard, only `disabled={saving}`.

**Suggested fix.** Warn on the *selected* product: when `selected && !(selected.price > 0)`, show an amber alert on Product and Confirm steps and require explicit confirmation (or block). Grey out zero-priced products in the dropdown.

**Screenshot.** `staff/27-txn-zero-price-saved.png`

---

## BUG-6 — Selling a membership always creates a brand-new member record

**Severity: P2** — duplicate members, split history, unreliable search.

**What happens.** The membership branch calls `createMember` unconditionally with no existing-member lookup. A renewal, upgrade, or repeat customer creates a second row with the same name and phone. Member Search returns two identical cards; check-ins, photos and history split across them at random. Verified: two "Gym Only — Monthly" sales to "Hari Shrestha" → `searchMembers` returns **2** rows.

Related: `createMember` and `addMembership` are separate IPC calls with no transaction. If `addMembership` fails, the member row is orphaned; staff retry, creating another duplicate.

**Root cause.** `staff-transaction.jsx:259-282` — no lookup, two non-atomic writes. `members:create` (`src/main/ipc/members.js:91-103`) has no uniqueness check; no unique index on `members(name, phone)`.

**Suggested fix.** Search for an existing member on name/phone blur and offer "Existing member found — add this membership to them?" with the option to create new (two people can share a name). Reuse the found `memberId`. Longer term, move create-member-plus-add-membership behind one IPC call in a single DB transaction.

**Screenshot.** `staff/32-txn-duplicate-member.png`

---

## BUG-7 — Customer phone is never validated in the wizard

**Severity: P2** — corrupts the data renewal reminders depend on.

**What happens.** The phone field accepts anything. `abc-123` passes the Confirm step and is stored. For a membership that phone is what renewal reminders later use to WhatsApp the member, and what Member Search matches on — so a typo silently becomes an uncontactable member.

**Root cause.** `staff-transaction.jsx:550-558` — plain input, no validation. The file imports only `api`, `format`, `ui` — never `../lib/validate`. `validatePhone` exists at `src/renderer/src/lib/validate.js:6-11` and is used by owner settings screens; the staff-facing entry point is the one place it is missing. `members:create` does not validate either.

**Suggested fix.** Import `validatePhone`, block Continue on the Customer step when it errors, show the message inline (empty stays valid — phone is optional). Restrict input to digits as typed. Mirror the check in `members:create`.

**Screenshot.** `staff/24-txn-step4-confirm.png`

---

## BUG-8 — The same member can be checked in repeatedly, inflating footfall

**Severity: P3** — attendance metric drifts upward; no money impact.

**What happens.** After check-in the button reads "Checked in" and disables — but that state lives only in the component. Switching tabs and back re-mounts the screen, the flag is lost, and pressing again writes a second check-in for the same member on the same day. Verified: check-in count **2** for one visitor.

Footfall feeds owner reports, so a reception desk re-searching a member (normal — to check their expiry) steadily over-reports attendance.

**Root cause.** `src/renderer/src/screens/staff-members.jsx:9-14` — guard is component-local state discarded on unmount. Backend has no same-day guard either: `checkins:create` (`src/main/ipc/checkins.js:18-32`) inserts unconditionally; no unique constraint on `(member_id, date(checked_in_at))`.

**Suggested fix.** Return today's check-in state with each search result (or have `checkins:create` return `{alreadyCheckedIn: true}` without inserting) so the button reflects truth on every render, and show the check-in time. Enforce uniqueness per member per day at the DB level.

**Screenshot.** `staff/47-members-duplicate-checkin.png`

---

## BUG-9 — An expired member is indistinguishable from someone who never had a membership

**Severity: P3** — missing information exactly when reception needs it.

**What happens.** Member Search only reads the *active* membership. A member who lapsed last week renders identically to a walk-in who never bought anything — "No active membership", "Expires —". The red "Expired" badge shows for both:

```
BR  Bikash Rai    No active membership ∘ 9847654321   Expired  Expires —
CL  Chandra Lama  No active membership ∘ 9800000000   Expired  Expires —
```

Reception cannot answer "when did yours run out?" or "what were you on?" — the two questions asked constantly when selling a renewal.

**Root cause.** `staff-members.jsx:61-64` reads only `m.activeMembership` and falls back to constants. `members:search` (`src/main/ipc/members.js:105-128`) selects only memberships with `status = 'active' AND end_date >= today`, so lapsed rows never reach the renderer.

**Suggested fix.** Have `members:search` also return the most recent *past* membership; render "Expired — Gym Only — Monthly, ended 31 Jan 2024" versus a distinct "No membership on record".

**Screenshot.** `staff/45-members-active-vs-expired.png`

---

## BUG-4 — Restaurant POS has no way to clear an order

**Severity: P3** — missing affordance; slow and error-prone at a busy counter.

**What happens.** The only way to empty the cart is pressing `−` on every line until each hits zero. A six-line order takes ~15 taps to clear. The only `Clear` control is "Clear search", which clears the menu filter — an easy mis-tap.

**Root cause.** `staff-restaurant-pos.jsx:249-324` — `setCart([])` is only ever called inside `checkout()` (line 127), never from a user control.

**Suggested fix.** Add a "Clear order" ghost button in the cart header calling `setCart([])`, with a confirm step once the cart is non-trivial. Label it distinctly from "Clear search".

**Screenshot.** `staff/72-pos-line-removed.png`

---

## BUG-10 — "Print membership card" gives no feedback when printing fails

**Severity: P3** — inconsistent error handling.

**What happens.** On the membership receipt, **Print Ticket** handles failure properly ("No printer found. Check the printer is on and connected…"). **Print membership card**, on the same card, swallows the result: with no printer it does nothing at all — no success, no error, no visible change. Staff press it repeatedly, then hand over an unprinted card.

**Root cause.** `staff-transaction.jsx:352-362` awaits and discards the result:

```js
const handlePrintCard = async () => {
  if (!savedTxn?.isMembership) return
  await api.printMembershipCard({ ... })
}
```

Compare `handlePrint` at `:337-350`, which checks `result?.success` and sets `printError`. The `printError` state and its alert (`:419-423`) already exist — the card path never sets them.

**Suggested fix.** Mirror `handlePrint`: check `success`, reuse the existing `printError` alert, clear it at call start. Add a "Card sent to printer" confirmation, since silent success and silent failure currently look identical.

**Screenshot.** `staff/92-print-card-result.png`

---

## PASS/FAIL summary

79 flows across 9 screens. Everything not listed above passed, including: all 8 StaffHome tiles and their back buttons; bottom nav; keyboard shortcuts n/m/l/e (correctly suppressed while typing); Escape logout and header Log out; the full 5-step wizard for day pass, day package and membership with correct amounts and receipts; Back at every step; member photo upload/preview/remove; cash/QR toggle; graceful no-printer ticket failure; member search by full/partial name and phone; empty and no-result states; active/expired badges; check-in persistence and non-leakage; Today's Log empty and populated states with a footer total matching the DB exactly (Rs. 2,300); EOD empty state, headline total, Cash/QR rows, empty and non-numeric cash rejection, over/short/balanced reconciliation with correct discrepancy, persistence, Back, and the already-reconciled skip; POS add/increment/steppers/typed quantities/999 clamp/decrement-to-remove/search/no-match/cash-QR; the backend refusing an over-stock order; Sell Item quantity clamping (0→1, negative impossible, above-stock clamped), line totals, stock decrement 10→7, correct transaction, and out-of-stock blocking; staff Inventory low-stock alert accuracy and read-only-ness; staff Bookings 14-day window, mark-completed, empty state.

Money arithmetic was correct throughout: line totals, cart totals, log totals, home metrics, reconciliation discrepancies and stock decrements all matched the DB exactly.

---

## Could not test

- **WhatsApp send from End of Day** — deliberately skipped; `whatsapp:send-eod` calls `shell.openExternal` (`whatsapp.js:147`) and would open a real browser tab. Verified instead that the button appears only after reconciliation and is enabled. Note: with no `whatsapp_owner_number` configured the handler throws before reaching `openExternal` (`:135-141`), so the error path is safely reachable; only the configured-number path opens a browser.
- **Camera capture on the photo step** — `getUserMedia` needs real hardware and a permission grant. The Upload path was tested fully; "Take photo"/"Capture"/"Cancel" were not.
- **Physical receipt and membership-card output** — no printer attached, so only no-printer failure paths were exercised. Ticket layout, 58mm/80mm sizing and card artwork are unverified against hardware (the source flags this at `src/main/ipc/tickets.js:22-26`).
- **Restaurant POS post-checkout flows** — "Order saved", "New order", "Done", the Enter shortcut, and UI-driven linked-stock draw-down are unreachable while BUG-1 stands. The backend stock guard was verified over IPC instead. Re-test once BUG-1 is fixed.
- **POS empty-menu state** — seeded DB has no menu items, but shop setup adds them before staff login, so this branch was seen only in passing.
- **Idle-session timeout** (`App.jsx:534-543`, 30 min default) — would require a 30-minute idle run.
- **Multi-staff / concurrent tills** — only one staff account exists from setup, so nothing about two tills or per-staff EOD attribution was tested.
- **Day-boundary behaviour** — all runs were inside one local day (Asia/Kathmandu). Timestamps use `datetime('now','localtime')` queried with a local `todayLocal()`, which is self-consistent, but midnight rollover was not observed.
