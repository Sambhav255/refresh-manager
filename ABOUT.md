# About Refresh Manager

What this project is, what was found wrong with it, what was fixed, and why the non-obvious decisions were made the way they were.

If you are picking this codebase up cold, read this before changing anything — several of its rules exist because breaking them already cost real money once.

---

## 1. What it is

A single-machine, offline point-of-sale and management system for a recreation centre in Boudha, Kathmandu, with a swimming pool, a gym and a restaurant.

It runs on one PC at the reception desk. There is no server, no cloud, no network dependency. Everything lives in one SQLite file in the OS user-data directory, and everything the business earns in a day passes through this app.

Two roles:

- **Staff** (4-digit PIN) — the till. Sells entry, memberships and food; checks members in; counts the cash at close.
- **Admin** (name + password) — the back office. Reporting, pricing, stock, staff accounts, backups.

The constraints that shape every decision:

- **Offline and single-machine.** No sync, no conflict resolution — but also no second copy of the data if the disk dies, which is why backup and restore are treated as first-class features rather than a nice-to-have.
- **Real cash.** Reception takes rupees over a counter. A wrong total is not a cosmetic bug.
- **Non-technical users under time pressure.** A receptionist with a customer waiting will not read an error dialog carefully, and will press a button again if nothing appears to happen.

---

## 2. The QA sweep of August 2026

The app was believed to be close to shipping. To check that, it was driven end-to-end through its real UI with Playwright — 25 screens, roughly 470 individual checks.

**It found 55 bugs, including two that made core features completely unusable.**

The most important lesson came from *how* those two were missed. The app had a substantial unit suite that tested the IPC handlers directly, and it was entirely green. Both P0s lived in the **payload the renderer sent to main** — a layer no test touched. The handlers were correct; the calls into them were not.

That is why this repo now has two test layers, and why the end-to-end one is not optional.

### The two P0s

**The admin dashboard crashed on every single mount.** The owner's landing screen showed nothing but "Something went wrong". "Try again" could never fix it, because remounting restored the same initial state. The `alerts` array was built *above* the loading guard, so the first render always ran with `backupStatus` still `null` and dereferenced it. Two lines in the same block already used optional chaining; one did not.

**The restaurant POS could not complete a single sale.** Every order failed with "Menu item not found". The cart sent `{name, price, quantity}`; the handler resolved each line by `id`. The entire restaurant revenue path was dead, and none of it reached the log, the end-of-day report, or any owner report. It was a regression from a security fix that had made the handler re-derive prices from the catalogue — the handler was updated, the caller was not.

### What else the sweep found

Grouped by what they would have cost the business:

**Money reported wrongly**
- The End of Day breakdown listed only memberships, packages and passes — restaurant and pool-item takings were in the total but on no line. Rs. 600 invisible on the screen used to hand over cash. Worse, the WhatsApp report the owner received built its own breakdown and *did* include them, so staff and owner saw different accounts of the same day.
- Voiding a refund was accepted, dropping the negative correction and resurrecting the refunded sale as revenue — Rs. 10,000 of phantom income on a single void.
- Product names rendered as "undefined — Monthly" or blank everywhere a transaction was listed, including every report and Excel export.
- Every membership ran one day longer than its `duration_days` — roughly 12 free days per member per year on monthly renewals.
- A malformed month made every month-scoped report return zeros, reading as "no trade" rather than a bad request.

**Data quietly corrupted**
- Every membership sale created a brand-new member, so returning customers forked into duplicate records with their history split between them.
- A restock quantity typed for one item stayed in the box and could be applied to a completely different one.
- Handlers accepted blank names, negative prices, the string `'abc'` in numeric columns (rendering "Rs. NaN"), and restocks of `1e21`.
- Bookings accepted garbage dates, which then matched no ranged query — making the booking invisible everywhere.
- `restaurant-menu:update` wrote every column unconditionally, so a partial payload nulled the item's name, category and stock link.

**Features that could not be reached**
- Seeded pool stock shipped at price 0, and there was no way to set a price — leaving the staff Sell Item screen permanently empty with no in-app remedy.
- Four working, tested handlers had zero callers, so stock could not be corrected after a physical count by any route.
- Booking deposits were fully implemented in main with no UI at all; every booking created through the app had a deposit of zero.
- The frameless window's minimise and maximise buttons had no handlers, and there was no OS chrome to fall back on.

**Ways to lock yourself out**
- The setup wizard did not trim names. `"  Owner  "` displays as `Owner` (HTML collapses whitespace) but never matches at login — and with no password reset, the only recovery was deleting the database.

**Things that felt broken**
- Silent no-ops: clicking Void with a blank reason, Restock with an empty quantity, or Print Card with no printer did nothing at all — no message, no change, indistinguishable from a hung app.
- A successful ticket print looked identical to a dead button, so staff pressed it repeatedly.
- Voided transactions vanished entirely, leaving no trace outside the audit log.
- Reception could check the same member in repeatedly, inflating footfall.
- An expired member rendered identically to someone who had never joined — hiding exactly what reception needs to sell a renewal.

**Current state:** all of the above are fixed and covered by tests. The full list with root causes and `file:line` is in [docs/qa/QA_REPORT.md](docs/qa/QA_REPORT.md).

---

## 3. The money audit

After the fixes, every path that moves cash or stock was audited adversarially — assuming a hostile caller and bad luck. Findings were **reproduced against a running app**, not inferred. Full report: [docs/qa/MONEY_AUDIT.md](docs/qa/MONEY_AUDIT.md).

**Original verdict: the money is trustworthy, the stock is not.** Cash arithmetic survived everything; three real defects were found and **all are now fixed and covered by tests**. What they were:

**Voiding a sale reverses the money but not the stock.** Sell 3 goggles (20 → 17), void the sale: money correctly returns to zero, stock stays at 17. The refund path restores stock correctly; the void path does not. Same business event, two different outcomes depending on which button is pressed. Since voiding a mis-rung sale is routine, the shelf count drifts down permanently — causing false low-stock alerts and re-ordering of stock already on the shelf.

**Voiding a booking deposit leaves the booking claiming it was paid.** The transaction is voided; the booking still reports `depositPaid: 3000`. Staff then collect the "balance" believing a deposit is in hand. The business is short and nothing disagrees with itself loudly enough to notice.

**Every printed receipt shows the wrong time.** Tickets fall back to a UTC timestamp, and the fallback always runs because the caller never passes one. A receipt printed at 2:30 PM prints 8:45 AM — in a customer's hand, contradicting the log and the database.

Plus float drift on fractional restaurant stock, and one backup check comparing a local date against a UTC one.

**All five are fixed**, with regression tests in `test/money-audit.test.js`. The void/stock tests were confirmed red against the old code before the fix landed, so they are known to catch a recurrence.

The fix for the stock bug reuses the reversal logic the refund path already had, now shared by both. A void writes reversing `'in'` movements rather than silently adjusting the count, so the movement history still shows that stock went out and came back — an adjustment that erased the history would have been cheaper and much less auditable.

Worth stating equally plainly — what resisted attack: every money handler is role-gated (46/46 across seven files); prices and staff identity are genuinely derived server-side, so a tampered payload cannot mis-price or mis-attribute; all three double-reversal guards hold in main rather than only in the UI; neither inventory can be driven negative by any route tried, including the same item twice in one cart; and the day breakdown reconciles exactly to its own total.

---

## 4. Decisions taken, and why

These are the choices where a reasonable person could have gone the other way. Recorded so nobody has to re-litigate them from scratch — or worse, silently reverse them.

### Membership dates were fixed going forward, not retroactively

`end_date` is the inclusive last valid day, so a 30-day product must end on `start + 29`. It was `start + 30`.

`end_date` is computed once at purchase and stored, so changing the formula only affects new memberships. **Existing rows were deliberately left alone.** A migration would have retroactively shortened memberships people had already paid for — a worse failure than a few members getting one extra day. If you ever do want existing rows corrected, that is a product decision with a customer-communication cost, not a bug fix.

### Cancelling a booking does not reverse the deposit

Forfeiting a deposit is normal business practice; automatically refunding it would destroy real revenue. So cancelling keeps the money and instead **tells the owner** how much deposit is outstanding, leaving the forfeit-or-refund decision to a human. The handler returns `outstandingDeposit` so the UI can ask.

### A repeat check-in is a success, not an error

Reception re-searches a member constantly (to read their expiry) and will tap Check in again. The second tap now returns `{ success: true, alreadyCheckedIn: true }` rather than an error. A red alert for a harmless double-tap trains people to ignore red alerts.

### An impossible uniqueness index is skipped, not forced

The migration that adds unique indexes will **skip** an index whose existing data already violates it, recording why to the diagnostics log and audit trail. Two real people can genuinely share a name and phone. Refusing to start, or deleting a customer record to satisfy a constraint, would both be far worse than running with one fewer index — the handler-level check still gives the good error message.

### The existing-member merge is offered, never forced

When a membership sale looks like a returning customer, the wizard offers "This is them" or "None of these — new member". Two real people can share a name, and reception knows which case it is. Where there is no match, the flow is unchanged and costs zero extra steps — the common case must not pay for the rare one.

### Screenshots and one-off scripts were deleted

The sweep produced 94MB of screenshots and 37 ad-hoc reproduction scripts. Both were run artefacts: the screenshots were evidence of bugs now fixed and described in prose with `file:line`, and the scripts referenced a past state of the code and failed lint. Committing 94MB of binaries into a small app's history is permanent; the maintained suites replace them.

### One existing test was deliberately changed

`checkins.test.js` checked the same member in three times and asserted a footfall of three. That *encoded the double-counting bug* as expected behaviour. It now uses three different visitors, with a new test asserting that one member counts once however often they are checked in. Changing a test to make a fix pass deserves scrutiny — this one is called out so it gets it.

### Shared logic lives in `src/shared/`, not in two places

The End of Day screen and the WhatsApp report each maintained their own list of transaction types, and drifted — which is precisely how staff and owner came to see different breakdowns of the same day. Anything both processes need now lives in one module they both import. Keep it free of `electron` imports so both bundles can take it.

### The end-to-end layer is not optional

Both P0s passed every handler test that existed. The E2E suites exist specifically to cover the renderer-to-main seam, and new features are expected to be verified there, not only in Vitest.

---

## 5. Where things stand

**Green:** 183 unit tests, 96 end-to-end checks across 6 suites, 0 lint errors, no runtime console errors.

**All money-audit findings are fixed** and covered by regression tests.

**Never tested against real data.** The uniqueness migration de-duplicates historical check-ins and has only ever run against synthetic databases. **Before installing over an existing production database, copy it and run the new build against the copy.** This is the single largest untested risk in the project.

**Needs a human, cannot be automated:** the thermal printer on real hardware (note the receipt-timestamp bug lands exactly here), camera capture for member photos, one real WhatsApp send, behaviour across local midnight, a two-staff till day, and a full backup-then-restore drill on a copy of real data.

**Not done, deliberately:** an opening-stock field on Add Item (restock immediately after achieves the same result and records an auditable movement), and a per-item stock history UI beyond the movement panel already added.

The prioritised list lives in [docs/qa/SHIP_READINESS.md](docs/qa/SHIP_READINESS.md).
