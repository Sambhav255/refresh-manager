# Money & stock audit

**Date:** 2026-08-19 · **Scope:** every path that moves cash or stock.
**Method:** code reading plus empirical probes against the running app (isolated temp database). Every finding below was **reproduced**, not inferred — the observed numbers are quoted.

**Verdict: sound. All five findings below are now FIXED and covered by tests** (`test/money-audit.test.js`, 10 tests; the void/stock tests were confirmed to fail against the old code before the fix landed).

The original verdict was *the money is trustworthy, the stock is not*: cash arithmetic survived everything, but voiding a sale reversed the money and left the stock decremented — and voiding a mis-rung sale is one of the most common operations at any till. That, and the four findings under it, are resolved. The findings are kept in full below because the reasoning still applies to anyone changing these paths.

| Severity | Count | Status |
|---|---|---|
| P0 — money can be wrong | **0** | — |
| P1 — stock/records can be wrong | **2** | ✅ fixed |
| P2 — customer-facing wrong data | **1** | ✅ fixed |
| P3 — cosmetic / drift | **2** | ✅ fixed |

---

## ✅ P1-A — Voiding a sale did not return the stock

**What happens.** `transactions:void` reverses the money and nothing else. Stock sold on that transaction stays deducted forever. Both inventories are affected.

**Reproduced** (pool):

| Step | Stock | Day total |
|---|---|---|
| Start | 20 | — |
| Sell 3 goggles | **17** | 750 |
| **Void the sale** | **17** ← never returns | 0 ✓ |

And restaurant: 40 → 36 on a 4-unit order → **36** after voiding.

For contrast, the refund path gets it right: sell 2 (17→15), full refund → **17**. So the same business event produces two different stock outcomes depending on which button the owner presses.

**Why the code allows it.** `src/main/ipc/transactions.js`, the void handler sets a flag and stops:

```js
db.prepare(
  `UPDATE transactions SET is_voided = 1, void_reason = ?, void_by = ?, void_at = datetime('now','localtime') WHERE id = ?`
).run(reason, session.userId, transactionId)
```

`transactions:refund` does the restoration properly — it walks `pool_inventory_transactions` / `restaurant_inventory_transactions` for `txn_type = 'out'` rows linked to the original and writes matching `'in'` rows. The void path has no equivalent.

**Books vs reality.** A voided sale of 3 goggles: revenue correct at Rs. 0, shelf says 17, reality is 20. Three goggles the owner physically has but the system says are gone. Repeated over months this triggers false low-stock alerts and re-ordering of stock already on the shelf, and it silently corrupts the inventory-turnover report.

**Fixed.** Stock is restored in the void handler, inside the same transaction, reusing the reversal logic the refund path already has (a shared `restoreStockFor(db, transactionId, staffId, reason)` used by both). A void means "this sale never happened", so unlike a partial refund there is no ambiguity about quantity — the whole movement reverses. Note the reversal rows should be written, not the original rows deleted, so the movement history stays auditable.

---

## ✅ P1-B — Voiding a booking deposit left the booking claiming it was paid

**What happens.** The deposit's money transaction is voided (correctly removed from revenue), but the booking row still says `deposit_paid = 3000`.

**Reproduced:** created a booking with a Rs. 3,000 deposit → voided the linked `booking_deposit` transaction → `voided: true`, day total back to 0, **booking still reports `depositPaid: 3000`**.

**Consequence.** The booking screen shows "Deposit Rs. 3,000 · balance Rs. 17,000". The ledger contains no such deposit. When the customer arrives, staff collect Rs. 17,000 believing Rs. 3,000 is already in — the business is Rs. 3,000 short and nothing in the system disagrees with itself loudly enough to notice.

**Why.** `bookings.js` has `syncDepositTransaction`, which reconciles the deposit transaction *when the booking changes*. Nothing runs in the other direction: voiding the transaction directly never touches the booking.

**Fixed** by refusing. The options were to refuse the void of a `booking_deposit` transaction directly (point the owner at the booking, which is the record of intent — this mirrors the existing "cannot void a refund" guard and is the smaller change), or clear `deposit_paid`/`deposit_transaction_id` on the booking as part of the void. I lean toward refusing: the deposit belongs to the booking, and editing it there already works correctly.

---

## ✅ P2 — Every printed receipt showed the wrong time

**What happens.** Printed tickets carry a UTC timestamp. In Kathmandu (UTC+5:45) a receipt printed at **2:30 PM prints 8:45 AM**.

**Why.** `src/main/ipc/tickets.js:53`:

```js
const dt = datetime || new Date().toISOString()
```

The fallback is UTC — and the fallback is always what runs, because the only caller (`staff-transaction.jsx:385`) passes `transactionId, customerName, product, amount, paymentMethod` and **no `datetime`**. Everything else in the app uses `datetime('now','localtime')`.

**Consequence.** Customer-facing and audit-relevant: the receipt in a customer's hand disagrees with Today's Log, the EOD report and the database by 5h45m. Any dispute ("I paid at 2:30") is unresolvable from the paper.

**Fixed.** The fallback is now local time. A future reprint flow should also pass the transaction's stored `created_at` from the renderer (it is already on `savedTxn`), and change the fallback to local time so a missing value can never reintroduce the skew.

---

## ✅ P3-A — Fractional restaurant stock accumulated float error

**Reproduced:** set stock to 10, restocked 0.1 three times → stored value **10.299999999999999**.

Restaurant units are `REAL` (kg, litres) by design, so fractions are correct — but the raw value is what gets stored and, on the restaurant inventory table, what gets *displayed* (`{r.stock}` is rendered unformatted; only the new History panel runs values through a 3dp formatter). The owner will eventually see `10.299999999999999` in the Stock column.

It also makes the low-stock comparison `current_stock <= reorder_level` fire or not fire on an epsilon at exact boundaries.

**Fixed.** Rounded to 3dp on write in the restock/adjust/sell handlers (the display formatter already exists — `qtyText` in `owner-restaurant.jsx` — but rounding belongs at the write, not only the render). Money is unaffected: all cash amounts are whole rupees.

## ✅ P3-B — Catch-up backup compared a local date against a UTC date

`src/main/index.js:94`:

```js
const lastDate = last.value.slice(0, 10)          // local (since the timestamp fix)
const today = new Date().toISOString().slice(0, 10) // UTC
return lastDate < today
```

Between 00:00 and 05:44 local the UTC date is still yesterday, so a catch-up backup that is due on a new local day won't fire until after 05:45. It is delayed, not lost (the 23:59 schedule still runs), so this is minor — but it is the same class of bug as the `last_backup_at` skew already fixed, and now uses a local date on both sides.

---

## What I tried to break and could not

This matters as much as the findings — these are the paths the owner can rely on.

**Authorization.** Every money-moving handler is gated. Verified by count across all seven files: `transactions` 5/5, `members` 11/11, `inventory-pool` 9/9, `inventory-restaurant` 8/8, `restaurant-menu` 5/5, `bookings` 5/5, `reconciliation` 3/3. No ungated handler exists.

**Server-side pricing and attribution.** `transactions:create`, `members:add-membership`, `members:create-with-membership`, `pool-inventory:sell-item` and `restaurant:checkout` all re-derive the amount from the product/menu catalogue and take `staff_id` from the session. A tampered payload cannot mis-price a sale or attribute it to another staff member. I checked specifically that `staffId` and `amount` are not destructured from the payload in `transactions:create` — they aren't.

**Double-reversal.** All three guards hold and are enforced in main, not just the UI: voiding a refund is refused; refunding a refund is refused; voiding a sale that has live refunds is refused. Re-voiding an already-voided row is refused. Over-refunding beyond the remaining balance is refused, as are zero and negative refunds.

**Refund arithmetic.** Partial refunds net exactly and can be repeated up to the original amount, never beyond. A full refund restores stock exactly once and cancels a linked membership. Partial refunds correctly do neither.

**Oversell.** Neither inventory can be driven negative — not by a single oversized line, not by the same item appearing twice in one cart, and the whole cart rolls back if any line is short.

**Breakdown reconciliation.** `today-summary`'s `byType` sums exactly to its own total on a mixed day, and cash + QR equals total. The End of Day screen and the WhatsApp message now build from the same shared label map, so they cannot disagree about the same day.

**Reconciled days.** Voiding a transaction on a day already cash-reconciled requires explicit confirmation and records that fact in the audit trail.

**Money precision.** All cash amounts are whole rupees; I found no float path that reaches a customer-visible total. The float issue above is confined to fractional *stock*.

---

## Fix order — all completed

1. **P1-A — void restores stock.** Highest value: common operation, silent corruption, and the correct logic already exists in the refund path to reuse.
2. **P1-B — booking deposit void.** Small change (a guard), removes a way for the business to lose Rs. 3,000 without noticing.
3. **P2 — receipt timestamp.** One-line renderer change plus a local-time fallback; it is on paper in a customer's hand.
4. **P3-A / P3-B** — round fractional stock on write; use `todayLocal()` for the catch-up check.

None of these is a ship-blocker for *cash correctness*. P1-A is a ship-blocker for *inventory correctness* if the owner intends to trust stock levels for ordering.
