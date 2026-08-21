# Metrics reference

What each headline number on the owner Dashboard and staff Home actually
means, which IPC handler computes it, and which screens show it. Written as
part of C-6 (see `.superpowers/sdd/REFRESH_MANAGER_UX_PUNCHLIST.md`), which
fixed two of these numbers disagreeing with themselves across screens.

## `upcomingBookings(days)`

**Definition:** bookings whose `booking_date` falls within the next `days`
days (inclusive of today), excluding any booking with status `cancelled` or
`completed`.

**Handler:** `bookings:upcoming`, `src/main/ipc/bookings.js:219`.

**Screens:** staff Home (`src/renderer/src/screens/staff.jsx`, calls
`api.upcomingBookings({ days: 14 })` and uses the full, unsliced result
length for its "N upcoming" tile subtitle) and owner Dashboard
(`src/renderer/src/screens/owner-dashboard.jsx`, same call). Both screens
call the exact same handler — there was never a query divergence between
them.

Before this fix, the Dashboard displayed a booking count that was
accidentally capped at 3 (see "Known duplication / bugs fixed" below); it now
reads a separate `bookingsTotal` state, taken from the full array's length
before the display list is truncated to 3 for the "Upcoming bookings" widget.

## `revenueToday()` (`api.todaySummary`)

**Definition:** revenue is derived from `transaction_lines` (not the header
`amount`) so that a mixed cart's revenue splits correctly by kind, and
cash/QR splits are derived from `transaction_payments` (not the header
`payment_method`) so a part-cash/part-QR sale counts on both sides — because
one sale can now hold several kinds of item and be settled more than one way.
Only rows dated today (`date(t.created_at) = today`, local time) with
`is_voided = 0` are included. A `source` filter (`'pool'` or `'restaurant'`)
restricts to that side of the business when passed.

**Handler:** `transactions:today-summary`, `src/main/ipc/transactions.js:214`
(preload maps `api.todaySummary` → `transactions:today-summary`,
`src/preload/index.js:24`).

**Screens:** owner Dashboard (called three times — once per `source: 'pool'`,
once per `source: 'restaurant'`, once combined, for the Pool/Restaurant/
Combined/QR KPI tiles), staff Home, staff End-of-Day
(`src/renderer/src/screens/staff-eod.jsx`).

## `footfallToday()` — the fixed definition (Part B of C-6)

**Definition (as of this fix):** footfall = distinct member check-ins today
**plus** today's day-pass attendee count, where the attendee count is the
summed `quantity` of every non-voided day-pass sale's day-pass line(s) rung
up today (a single day-pass sale can be for more than one person — a
quantity-3 line is 3 people through the door, not 1 sale). A walk-in who
buys a day pass and never "checks in" as a member action is now counted;
previously they were invisible, even though they are the most literal
definition of footfall in the building.

**Known limitation (deliberate, not a bug):** a member who both checks in
*and* separately buys a day pass on the same visit is counted twice. This is
not de-duplicated — it is rare enough that the added complexity (correlating
a check-in row to a same-day sale for the same person, when a sale need not
even carry a `member_id`) was judged not worth it. Out of scope for this
task per the punch-list's ruling.

**SQL, in `checkins:today`:**

```sql
-- member check-ins today (unchanged)
SELECT COUNT(*) as c FROM check_ins WHERE date(checked_in_at) = ?

-- + day-pass attendees today (new)
SELECT COALESCE(SUM(tl.quantity), 0) as c
FROM transactions t
JOIN transaction_lines tl ON tl.transaction_id = t.id
JOIN products p ON p.id = tl.ref_id
WHERE t.transaction_type = 'day_pass'
  AND t.is_voided = 0
  AND date(t.created_at) = ?
  AND tl.kind = 'product'
  AND p.category = 'day_pass'
```

`count` returned by the handler is the sum of both queries. The `recent`
list in the same response is unchanged — it stays check-in rows only, so
other consumers of `checkins:today` that read `recent` (e.g. any
member-check-in activity feed) are unaffected by this fix.

**Handler:** `checkins:today`, `src/main/ipc/checkins.js:57`.

**Screens:** owner Dashboard, "Footfall today" KPI tile (sub-label reads
"member check-ins", which is now stale given the definition above — the
label was not changed as part of this task since relabelling UI copy was not
in scope for Part B, but a follow-up should update it to something like
"member check-ins + day passes").

## `activeMembers()` / `expiringMembers(days)`

There is no handler literally named `activeMembers()`. What the owner Members
screen calls "active" is a client-side filter over the full member list:

- **Handler:** `members:list-all`, `src/main/ipc/members.js:429` — returns
  every member with their current `activeMembership` (and `pausedMembership`,
  if any) attached per row, computed server-side per member from the
  `memberships` table (`status = 'active' AND end_date >= today`, most
  recent by `end_date`).
- **Screen:** owner Members (`src/renderer/src/screens/owner-members.jsx`),
  which calls `api.listAllMembers()` once and then filters/searches/badges
  client-side (the "Active" status option in its filter dropdown, around
  line 200, filters on the `activeMembership` field the handler already
  computed — it does not re-derive "active" with its own SQL).

`expiringMembers(days)` **is** a real, named, shared handler:

- **Definition:** active memberships (`status = 'active'`) whose `end_date`
  falls between today and `today + days` inclusive. When `days` is omitted,
  the handler falls back to the `expiry_warning_days` setting (the same
  setting the Members screen's own "expiring soon" badge threshold honours).
- **Handler:** `members:expiring-soon`, `src/main/ipc/members.js:398`
  (preload maps `api.expiringSoon` → `members:expiring-soon`).
- **Screens:** owner Dashboard, called as `api.expiringSoon({})` — the
  existing code comment right above that call
  (`src/renderer/src/screens/owner-dashboard.jsx:34-36`) explains that
  omitting `days` (rather than hardcoding e.g. 5) was a deliberate earlier
  fix: hardcoding a number on the Dashboard made it disagree with the
  Members screen's own warning-window setting. This file (`METRICS.md`)
  exists in part because that fix had no lasting record beyond an inline
  comment — C-6 makes it a documented precedent: **one shared handler, one
  shared setting, read the same way everywhere**, which is exactly the
  pattern that also fixed Part A and Part B of this task.

## `lowStockItems()`

Pool and restaurant low stock are two **separate** handlers over two
separate inventory tables — this is not duplication, it's two genuinely
different domains (pool gear vs. restaurant/kitchen stock) that happen to
share a "at or below reorder level" rule:

- **Pool:** `pool-inventory:low-stock`, `src/main/ipc/inventory-pool.js:377`
  — `is_active = 1 AND current_stock <= reorder_level` over
  `pool_inventory_items`. Called as `api.poolLowStock()`.
- **Restaurant:** `restaurant-inventory:low-stock`,
  `src/main/ipc/inventory-restaurant.js:350` — same rule, over
  `restaurant_inventory_items`. Called as `api.restaurantLowStock()`.

**Screens:**

- Pool low stock: owner Dashboard (feeds the "N items low stock" alert and
  its inventory link), owner Inventory screen, staff Home (count only, for
  a tile subtitle).
- Restaurant low stock: owner Restaurant screen only.

**Observation (not fixed — out of scope for this task):** restaurant low
stock is **not** fetched anywhere on the owner Dashboard. The Dashboard's
"N items low stock" alert and its `lowStock` state only ever reflect pool
inventory; a restaurant item that has run low produces no Dashboard alert
at all, only the owner Restaurant screen's own list. This may be worth a
follow-up (either a second alert or a combined count), but adding it was
not part of this task's brief.

## Known duplication found and fixed as part of this task

**The dashboard/staff booking-count mismatch (Part A).** This was not a case
of two IPC handlers computing the same thing differently (the plan's own
guess in §5 C-6 was wrong on this point — verified against source, both
screens always called the same `bookings:upcoming` handler). The actual bug
was renderer-local: `owner-dashboard.jsx`'s `loadData` truncated the
upcoming-bookings array to 3 items for display (`.slice(0, 3)`, correctly —
that widget shouldn't show a huge list) but then re-read `.length` off that
*already-truncated* array for the "N upcoming bookings" alert text, capping
the displayed count at 3 regardless of the true total. Fixed by adding a
`bookingsTotal` state set from the full array's length in the same
`.then()`, before slicing, and pointing the alert at `bookingsTotal` instead
of `bookings.length`. No new shared `metrics/` module was needed — there was
only ever one query; the bug was in how the renderer reused its result.

No other metric investigated for this task (`revenueToday`, `footfallToday`,
`activeMembers`, `expiringMembers`, `lowStockItems`) was found to be computed
independently in more than one place, so no `metrics/` selector module was
built — per the task brief, that abstraction only pays for itself once a
metric is actually duplicated, and none of the others are.
