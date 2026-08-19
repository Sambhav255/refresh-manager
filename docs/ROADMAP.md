# Roadmap — after the first hands-on session (2026-08-19)

Planning document. Nothing here is built yet.

Source: Sambhav's walkthrough of the running app. This turns that session into a
buildable plan, separates what already exists from what does not, and flags the
decisions that need answering before code is written.

---

## 1. The headline

Most of the feedback resolves to **one architectural change plus a lot of small UI work.**

The architectural change: **a sale is currently one product.** The transaction
table stores a single `product_id` and a single `amount`. Almost every POS
complaint traces back to that one fact:

- can't sell 3 tickets without 3 transactions
- can't mix a day pass with a pair of goggles
- can't price a child differently from an adult in the same sale
- can't apply a discount with a reason
- can't take Rs 5,000 today and Rs 10,000 next week against one membership

None of those are patchable in isolation. They are all the same missing concept:
**a sale has lines, and a sale has payments.** Everything else in this document is
comparatively routine.

Two requests are **already built** and need no work beyond making them findable.

---

## 2. Already exists — do not rebuild

| Asked for | Reality |
|---|---|
| "At least 3 admins, each with their own username, for accountability" | **Built.** Settings → Staff & Admins: add admin, list, deactivate, change password. Guard rails already stop you deactivating yourself or the last admin. Every action is written to the audit log with the actor. |
| "See who made what change" | **Built.** `audit_log` records actor, action and detail for voids, refunds, price changes, staff/admin changes, booking status, reminders. Viewable in Settings → Audit. |

**Why it looked missing:** the session ran on a single shared `Demo` account, and
nothing on the dashboard points at account management. The fix is discoverability,
not features — see §6 "Onboarding".

**Also worth noting:** staff PIN login *already* attributes every sale to the
individual who rang it. Accountability is not currently broken (see the staff
dropdown discussion in §7).

---

## 3. The sale model — the one big piece

### 3.1 What is needed

A real POS sale needs three objects, not one:

```
transactions        the sale: customer, staff, timestamps, totals, status
  transaction_lines what was sold: item, tier, qty, unit price, line discount
  transaction_payments what was collected: amount, method, when
```

This single change delivers, in one go:

- **Quantity** — a line has a qty, so "4 adults" is one line
- **Mixed baskets** — day pass + goggles + a cap in one sale, one receipt
- **Kid/adult pricing** — tier is per line, so 2 adults + 1 child is one sale
- **Discounts** — per line or per sale, with a mandatory reason
- **Partial payment** — a sale can have payments totalling less than its lines;
  the shortfall is a visible balance owed
- **Split payment** — part cash, part QR, which will be wanted eventually

### 3.2 Design constraints that must not be broken

These were established during the QA and money-audit work and are non-negotiable:

1. **Prices are derived server-side.** The cart sends `{productId, tier, qty}`.
   Main computes the price from the catalogue and the pricing rules. It must never
   accept an amount from the renderer.
2. **One `db.transaction()`** for a whole sale — header, lines, payments, stock
   movements. A failure leaves nothing behind.
3. **`transactions.amount` stays** as the authoritative sale total, denormalised
   from the lines. Every existing report, the EOD breakdown, the WhatsApp message
   and the money tests read it. Do not remove it.
4. **Void and refund keep working** — including stock reversal, which is now
   shared between both paths. Refunds become per-line capable, but whole-sale
   refunds must behave exactly as they do now.

### 3.3 The reporting question — decide before building

A basket containing a day pass and a pair of goggles has no single
`transaction_type`. Two options:

**(A) Derive the breakdown from lines.** One transaction per sale. `byType`
aggregates over `transaction_lines`, not over `transactions.transaction_type`.
*Correct, matches how real POS systems work, one receipt per payment.* Cost: the
EOD breakdown, all seven reports and their tests are rewritten.

**(B) One transaction per type, grouped by a shared `sale_group_id`.** Reports and
EOD are untouched. Cost: "one sale" is several rows, receipts must group them, and
sale-level discounts and partial payments fit badly — they belong to one financial
object, not to a group.

**Recommendation: (A).** (B) looks cheaper but fights the two features that
motivated the change. If timeline forces it, (B) is a viable interim that does not
block (A) later.

### 3.4 Migration

Existing transactions have no lines. Back-fill one line per existing transaction
from its `product_id`/`amount` so history renders consistently, and one payment
row per transaction from its `amount`/`payment_method`. Follow the existing
migration pattern: versioned, snapshot first, roll back on failure.

---

## 4. Pricing rules

Current: one price per product. Needed:

- **Tiers** — child (≤6) vs adult, per product
- **Day overrides** — Saturday is Rs 500 for everyone
- **Scalable** — the rates will change; this must be editable, not hardcoded

Suggested shape: a `price_rules` table evaluated server-side at sale time —
`(product_id, tier, day_of_week, price, active_from)`. Resolution order: most
specific match wins (product+tier+day → product+tier → product default).

This keeps the server-side-pricing invariant: the cart names *what* and *who*, main
decides *how much*.

**Owner UI:** the pricing manager becomes a small matrix per product rather than a
single number. This is the screen the family will use most for changing rates, so
it should read like a price list, not a form.

**Needed from you:** the full current price matrix. The session gave day-pass
rates (child ≤6 Rs 500 / adult Rs 700 / Saturday Rs 500 all). Memberships,
packages, gym and the age cutoff rule need confirming — is "6 and under" by
birthday, or judgement at the desk?

---

## 5. Workstreams

Ordered by dependency, not priority.

### W1 — Sale model (foundation)
Schema for lines and payments, migration and back-fill, rewrite of
`transactions:create` and `restaurant:checkout` onto it, void/refund updated,
reporting decision from §3.3 applied. **Everything in W2 depends on this.**

### W2 — The checkout screen
Rebuild the staff sale flow as a proper till:
- a running basket with add/remove/quantity
- **add-ons mid-sale** — sell a ticket and a swim cap together
- tier selection per line (adult/child) with visible unit prices
- **discount with mandatory reason**
- payment step supporting partial payment and a stated balance owed
- receipt reflecting all of the above

Also in this stream, because they are the same screen:
- **Membership: two-step selection** — type first, then duration. The current
  single dropdown lists every combination at once.
- **Remove the member photo step.** Recommend hiding the step and keeping the
  data model, so it is one line to restore if the view changes.
- **Rename "Day Pass" / "Day Package".** Currently: `day_pass` = single-facility
  entry, `day_package` = combination (sauna/steam/jacuzzi). Suggest "Single entry"
  and "Combo". Names to be confirmed.

### W3 — Inventory usability
- **Delete items**, soft (`is_active = 0`), with an "show retired items" toggle to
  undo. The handler already supports this; there is no UI. Never hard-delete —
  items are referenced by historical sales.
- **Start empty.** 34 rows ship pre-seeded (17 products, 12 pool, 5 restaurant),
  all at price 0. That clutter also caused a shipped bug: the staff Sell Item
  screen was permanently empty because every seeded item was unpriced. Options:
  seed nothing and add a guided "set up your catalogue" step, or keep the seed
  behind a "load sample data" button. **Existing installs must not lose data** —
  the change applies to new databases only.
- **Reduce row actions.** Each row now has Price, Adjust, Restock, History — four
  buttons is too many to scan. Collapse into a row click that opens one item
  drawer containing all four.
- **Restaurant stock legibility** — the session flagged that current levels are
  hard to read. Needs a clearer "what do we have left" view, probably stock and
  unit shown together with low items sorted to the top.

### W4 — Bookings
- **Calendar view** — month and week. This is the main ask; schools book
  recurring slots and the list view does not answer "who is coming Tuesday?"
- **Multiple bookings per day at different times** — verify the current model
  handles back-to-back slots (11–12 and 1–2 same day) and that they display
  distinctly.
- **Recurring bookings** — "every Tuesday and Thursday, 11–12". Needs a recurrence
  concept and a way to edit/cancel one occurrence versus the series.
- **Deposit and total genuinely optional** — confirm a booking saves with both
  blank, and that the form does not imply they are required.

### W5 — Roles, stations and access
- **Station on login** — "Pool desk" or "Restaurant". Sets the home screen and
  hides irrelevant tiles. This addresses "separate swimming and restaurant POS"
  without building a second app, and is reversible if it proves wrong.
- **Password reset.** There is none. I hit this myself during setup: the only way
  into an existing install was editing the database by hand, and the setup wizard
  refuses to run twice. This is a genuine operational risk for a family business.
  Suggest: any active admin can reset another admin's password, plus a documented
  recovery procedure for the last-admin case.
- **Staff selection at login** — see §7, needs a decision.

### W6 — Fit and finish for the actual users
The stated users are in their 50s and not technical. Worth a dedicated pass rather
than treating it as incidental:
- larger touch targets and type on the till screens
- fewer choices visible at once (the membership dropdown is the worst case)
- plain-language errors everywhere
- a first-run state that explains what to do rather than presenting empty tables

### W7 — Deferred / to revisit
- WhatsApp integration is unconfigured; revisit once a number is decided.
- Print membership card — keep, currently untested against hardware.

---

## 6. Onboarding — small, high value

The session opened with "I'm assuming this is a fresh app that I need to reset",
followed by a failed login. Two cheap fixes:

- **A visible first-run path.** If the database has no products priced and no
  transactions, show a setup checklist: add your products and prices, add staff,
  set the backup folder, set the WhatsApp number.
- **Point at account management.** A one-time dashboard note that admins are added
  in Settings → Staff & Admins would have prevented the "we need multi-admin"
  conclusion entirely.

---

## 7. Decisions needed from you

These block or reshape work, so they are worth answering before anything starts.

1. **Reporting model (§3.3)** — derive the breakdown from lines (A) or group
   transactions (B)? Recommend A.
2. **Staff login dropdown.** You asked for a user picker before the PIN. Worth
   knowing: the PIN *already* identifies the staff member uniquely and every sale
   is attributed correctly, so accountability works today. A dropdown adds a step
   at a busy counter and displays your staff list to anyone standing at the
   terminal. Options: (a) keep PIN-only and make the signed-in name much more
   prominent, (b) add the dropdown as you asked, (c) make it a setting. What is
   the underlying worry — that the wrong person gets credited, or that staff
   cannot tell who is logged in?
3. **The full price matrix** — every product, both tiers, and the day rules.
4. **Age cutoff** — is "6 and under" checked, or desk judgement? Affects whether
   the child tier needs a date of birth.
5. **Partial payments** — is the balance a debt tracked against a member, or just
   a note on the sale? Does an unpaid balance block anything (entry, renewal)?
6. **Discounts** — should they be admin-only, or can staff apply them? Any cap?
7. **Seed data** — start new installs completely empty, or keep the sample
   catalogue behind a button?
8. **Restaurant separation** — is a station picker at login enough, or do you
   genuinely want a separate application?

---

## 8. Risks

**The sale model touches everything that was just hardened.** The money paths were
audited adversarially and are currently trustworthy — conservation, double-reversal
guards, atomicity, server-side pricing. Rewriting the transaction core puts all of
that back in play. Mitigation: the existing 193 unit tests and 97 end-to-end checks
must keep passing throughout, with new tests written for lines and payments
*before* the old path is removed.

**Discounts and partial payments are new ways for the books to be wrong.** A
discount is a deliberate revenue reduction and a partial payment is a receivable.
Both need to appear correctly in the EOD reconciliation and the daily report, or
the cash count will stop matching. These deserve their own money-audit pass.

**Clearing seed data on existing installs would destroy history.** New databases
only; existing ones keep their items and can retire them by hand.

**Scope.** W1 and W2 together are larger than everything done in the QA round. If
there is a deadline, the honest sequencing is: W1+W2 first and properly, then W3,
then the rest. Quantity and add-ons alone would justify the work — those are daily
friction at the counter.

---

## 9. Suggested order

1. **Decisions in §7** — particularly the reporting model and the price matrix.
2. **W1 sale model** with tests written alongside, old path kept until the new one
   is proven.
3. **W2 checkout screen** — the visible payoff; quantity, add-ons, tiers,
   discounts, partial payment.
4. **W3 inventory** — small, self-contained, immediately improves daily use.
5. **W5 password reset** — pull this earlier if anyone else is going to install
   the app before the rest lands.
6. **W4 bookings calendar**, then **W6 fit and finish**.
