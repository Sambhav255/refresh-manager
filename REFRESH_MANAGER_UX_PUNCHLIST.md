# Refresh Manager — UX/UI Review & Implementation Status

**Product:** Refresh Manager (Electron + React desktop app)
**Business:** Refresh Recreation Center — heated indoor pool, gym, sauna/steam/jacuzzi, retail counter, snack restaurant. Nayabasti, Boudha, Kathmandu.
**Original review:** 15 screenshots — owner/admin (Dashboard, Transactions, Members, Bookings, Inventory, Restaurant) and staff/reception POS (Home, New Transaction, Member search, Today's Log, End of Day, Pool Inventory, Bookings, Sell Item, Restaurant POS). 21 Aug 2026.
**This revision:** updated after implementing and shipping Phase 1 + Phase 2 (corrected scope) on branch `ux-punchlist-phase1`. Same date.

---

## 0. How to use this document

This is a **status report plus remaining punch list**, not a static spec anymore. Most of what was flagged as Critical or High severity has been implemented, reviewed, and merged onto `ux-punchlist-phase1`. Along the way, roughly a third of the original findings turned out to be wrong or overstated — the original review was written from 15 static screenshots without access to the running app or its source, and several "broken" things were either already built (just not exercised by the demo data used for the screenshots) or real but for a different reason than stated. Every correction is called out explicitly below so nobody re-discovers the same dead end twice.

**Reading this document:**
- **✅ Done** — implemented, code-reviewed (including at least one full review-and-fix cycle by an independent reviewer), tests passing, merged to `ux-punchlist-phase1`. Each has its commit hash(es).
- **🔧 Corrected** — the original finding was wrong or overstated. The correction is explained; if a smaller real issue was found underneath, it's marked done or open accordingly.
- **⏳ Open** — not yet built. Still organized by the original priority tiers.

**Priority definitions (unchanged from the original review):**

| Tier | Meaning |
|---|---|
| **Critical (C)** | Breaks a real workflow, loses money, or creates an unrecoverable error state. |
| **High (H)** | Meaningfully slows staff down under queue pressure, or hides information the owner needs to run the business. |
| **Polish (P)** | Consistency, contrast, affordance, craft. |
| **Feature (F)** | Net-new capability the design implies but doesn't deliver. |

---

## 1. What this app gets right — protect these

Unchanged from the original review — none of this was touched, and none of it should be:

- **Cash vs QR as a first-class dimension**, not a generic "payment method" field.
- **The station concept** (Pool desk / Restaurant) — one machine, two tills, different item sets.
- **End of Day → WhatsApp report** — a daily summary that lands in the family WhatsApp group.
- **Product naming that matches how the venue sells** — "Swim + Gym Quarterly — 3 Months," not "Product SKU 4."
- **Kids/Adult variants** on retail items.
- **Membership status as a lifecycle** (Active / Expiring soon / Expired), not a boolean.

---

## 2. The core diagnosis — updated

Three structural problems were named as generating most of the individual issues. Status on each:

**(a) The staff surface is built like a form, not like a till.** — **Still true, still open.** The New Transaction wizard (C-1) and the three-separate-tills problem (C-2) are the only Critical items not yet addressed. See §5.

**(b) The owner surface reports "today" and cannot report "trend."** — **Partially addressed.** The booking-count/footfall trust bugs underneath this are fixed (C-6). Trend deltas, sparklines, and the KPI restructure itself (H-11, H-12) are still open — see §6.

**(c) Numbers disagree across screens, and nothing is attributable to a person.** — **Mostly a non-issue.** The attribution half was already built before this review started (per-staff PINs, `staff_id` on every transaction, a real name in the header) — the original review saw "Reception · Reception" and inferred a missing feature, but that was a demo-data artifact (a placeholder test account literally named "Reception"), not a gap. The number-disagreement half (bookings count) was real and is fixed (C-6). See the C-5 and C-6 entries in §5.

---

## 3. Design principles

Unchanged — still the tie-breaker for any judgment call not explicitly covered:

**P1** — Speed beats completeness on the staff side. **P2** — Information density beats whitespace on the owner side. **P3** — Colour carries exactly one meaning each. **P4** — Never rely on colour alone. **P5** — Destructive actions are never adjacent twins. **P6** — Every empty state is an instruction, not a failure. **P7** — Every number on screen has a definition, and the same definition everywhere. **P8** — The register is plain and active ("Renew membership," not "Process").

---

## 4. Design system fixes — ✅ ALL DONE

Everything in this section shipped as Task 1–3 on `ux-punchlist-phase1` (commits `95d0fb6`, `2e4de38`, `1bf5c34`).

- **`P-1` Colour semantics** ✅ — token set defined (`--color-danger`, `--text-secondary`, `--text-tertiary`); QR badge no longer shares primary blue with buttons/links; the two genuinely-primary `btn-teal` actions (Restaurant POS "Confirm order", Sell Item "Confirm sale") converted to `btn-primary`; End of Day tile's green accent removed.
- **`P-2` Contrast** ✅ — Today's Log hierarchy inverted correctly (product description now primary/dark, customer name secondary); every genuine-content occurrence of the low-contrast `--muted` token found by grep and promoted to `--text-secondary`.
- **`P-3` Touch targets** ✅ — 44px floor on the staff surface (scoped via a new `.app-staff` wrapper class rather than per-button edits), 32px on owner / 40px on destructive actions; calendar day cells gained a hover state.
- **`P-4` Numeric alignment** ✅ — turned out to already be done everywhere it mattered; verified by direct audit of all six tables named in the original spec, no changes needed. `tabular-nums` added to `.tbl .num` regardless, for future-proofing.
- **`P-5` Shared components** ✅ — `Badge` (already existed, extended with Paused/Confirmed/Pending/Cancelled/Completed/'In stock'/Low/'Out of stock' variants), `PayBadge` (already existed, untouched), plus net-new `Money`, `RelativeDate`, `EmptyState`, `ConfirmDestructive`. **Correction to the original spec:** `Badge` and `PayBadge` already existed and were already reused across three screens before this review — they did not need to be built from scratch as §4's original text assumed.
- **`P-6` Dev hint bar / Escape hazard** ✅ — hint bar removed; Escape-to-logout now refuses to fire while the New Transaction cart has unsaved items (a `cartGuard` module flag checked by the global handler), rather than the broader "Escape closes a modal instead" redesign, which was judged out of scope for a contrast/colour task.
- `P-7` (Escape guard scoping — see P-6) is the one piece of the original P-6 redesign intentionally left for later: full "Escape closes current modal/drawer" semantics, not just the cart-loss fix.

---

## 5. CRITICAL

### `C-1` / `C-2` — New Transaction wizard / three separate sale surfaces — ⏳ OPEN, NOT YET STARTED

**Still fully real, and if anything understated by the original review.** Confirmed against source: `staff-transaction.jsx` is a genuine 5-step wizard (1544 lines). Investigating further while queuing this work turned up a **fourth** independent sale-writing backend path beyond the three the original review counted (`sales:create` for New Transaction, `pool-inventory:sell-item` for Sell Item, `restaurant:checkout` for Restaurant POS, plus membership signup/renewal inserting its own transaction row directly) — meaning the backend is at least as fragmented as the UI.

One piece of good news found while investigating: `sales:create`'s cart model already natively supports `pool_item` and `menu_item` line kinds, so it can likely absorb both `pool-inventory:sell-item` and `restaurant:checkout` outright rather than needing new backend logic — the unification may mostly be "migrate two screens' frontends onto the endpoint that already does what they need," not "invent a new one."

**This is the single highest-blast-radius change in the whole punch list** — it replaces the screen staff use for every sale, all day, at a live money-handling business. Deliberately not started without your explicit go-ahead; see the note at the end of this document.

### `C-3` — Restaurant POS sells items the kitchen can't make — ✅ DONE (commits `d55f6c7`, `6415923`)

🔧 **Corrected severity.** The original framing ("staff take the money and then apologise") implied a completed sale of stock that doesn't exist. That's false — `restaurant:checkout` already threw and aborted atomically if a cart's quantity exceeded linked stock, so no money was ever actually taken for a zero-stock item. The real, still-worth-fixing problem: staff only discovered this at final Confirm, after already taking the customer's order.

**Fix shipped:** `restaurant-menu:list` now returns each item's linked stock level and a server-computed `isAvailable`; zero-stock or manually-marked-unavailable tiles grey out and can't be added to cart; low-but-nonzero stock shows a warning dot but stays sellable. A same-day manual "mark unavailable" override was added (auto-clears the next day, no cron needed) with both an owner-side toggle (on the Settings → Restaurant menu screen — the original brief guessed this lived on the main Restaurant screen; it doesn't, so it went where the actual menu-item list is) and a staff-side one on the POS tile itself. One real gap was caught and fixed in review: `isAvailable` didn't originally account for the linked stock item's own `is_active` flag, which would have let a tile show sellable for an item whose stock had been retired — closed with a regression test.

**Correction to the original spec:** it suggested building a many-to-many "blocking ingredients" join table. Not needed — `restaurant_menu_items.inventory_item_id` already provides exactly the 1:1 link the fix needed.

### `C-4` — Staff have no way to correct a mistake — ✅ DONE (commit `afe2c83`)

**Confirmed fully real, no correction needed.** `transactions:void` genuinely required owner-role before this — staff had no correction path at all.

**Fix shipped:** staff can now void their own or a colleague's transaction from the same day, within a configurable window (setting: `staff_void_window_minutes`, default 15, on Owner → Settings → Staff & Admins), with a mandatory reason from the same picklist the owner side uses. Every pre-existing owner-side guard (already-voided, refund-type, booking_deposit-type, has-live-refunds, the reconciled-day two-step confirm) still applies identically regardless of who's calling. A staff void is visibly flagged to the owner (bold red "voided by {name}" on Transactions, a "Voids today: N (Rs. X)" line in End of Day) and the audit log now records the actor's role. Server-side mandatory-reason enforcement was added as part of this work — previously it only existed client-side, which is trivially bypassable by anything calling the IPC channel directly.

Known, accepted, low-severity gaps (none blocking): a staff member can void a *colleague's* sale within the window, not just their own (the brief never restricted this, and it's mitigated by the visibility/audit work above); the window-boundary settings parser inherits a pre-existing non-numeric-input fallback gap shared with an older, similar setting (`expiry_warning_days`) — worth a follow-up hardening pass across both, not blocking.

### `C-5` — Everyone is "Reception"; transactions can't be attributed to a person — 🔧 CORRECTED, mostly already done; small gap open

**This was substantially already built before this review started.** The header already renders the real logged-in user's name (`${session.name} · ${role}`), staff already get individual 4-digit PINs (bcrypt-hashed), a name picker already appears at login when more than one staff member exists, and every transaction already stores a non-nullable `staff_id`. The "Reception · Reception" header the original review saw, and the "Sambhav" attribution on every demo transaction, were both artifacts of how the demo data for the screenshots was generated (a placeholder test account named "Reception," and every demo sale run under the owner's session rather than distributed across staff logins) — not a product gap.

**⏳ Still open:** the one genuinely missing piece is "fast user switch" — a PIN pad reachable from the header without a full logout, for shift handovers. Small, not yet started.

### `C-6` — The same metric returns different numbers on different screens — ✅ DONE (commits `3e3de7b`, `4cf9549`)

🔧 **Corrected root cause.** The original review guessed two divergent query definitions (one including cancelled bookings, one excluding). Both screens actually called the identical shared `bookings:upcoming` endpoint the whole time — there was no query divergence. The real bug: the owner Dashboard sliced the bookings array to 3 items for its display widget, then a separate headline count accidentally reused that *sliced* array's `.length` instead of the true total.

**Fix shipped:** the display slice and the true count are now tracked separately. Footfall's definition was also broadened per the original review's own suggestion — it previously counted only member check-ins; it now also counts day-pass/entry-ticket sale attendees (summed by quantity, not by sale count), with a documented, deliberate limitation (no de-duplication of a member who both checks in and separately buys a day pass — rare enough not to be worth the complexity). `METRICS.md` now documents the canonical definition, computing handler, and consuming screens for every dashboard metric.

### `C-7` — Members screen has no way to take money — ✅ DONE (commits `7fb40f1`, `12608f4`)

🔧 **Corrected framing.** The original review's specific claim — "Pause is the most prominent action on an expired member, and it's a mis-tap away from corrupting the record" — was false. The Pause button was already correctly hidden on expired rows before this review; the actual gap was simpler: expired and expiring-soon members had **no** renewal action at all, not a wrong one.

**Fix shipped:** the primary row action is now status-driven — Expired/Expiring-soon rows get a primary "Renew" button that opens a small dialog prefilled with the member's current plan, a start date defaulting to the day after their old expiry (clamped to never pre-date today, so an already-lapsed member doesn't get backdated into a still-expired new membership), and a Cash/QR toggle. One regression surfaced and was fixed during review: the first version of this change silently dropped the pre-existing "Pause" action from Expiring-soon rows (a member going on a trip through their renewal date needs to still be pausable) — restored via a small row-overflow menu, reusing the pattern C-8 established. The Dashboard's old one-at-a-time "Send next reminder" button now navigates to Members pre-filtered to everyone needing renewal, where the real per-row actions live.

### `C-8` — Void and Refund are always-visible adjacent twins — ✅ DONE (commit `fccddaf`)

🔧 **Corrected framing — real problem, but smaller than described.** Both Void and Refund already opened a genuine two-step confirm card before this review (not a single destructive click as the original text claimed); Void already required a reason (as free text); Refund already showed full context and already correctly handled **partial** refunds with clear stock-restoration messaging (this alone answers the original §12 open question about partial refunds — no product decision needed, the capability already existed and works). The real gaps: still two always-visible adjacent buttons rather than a menu; neither reason was a mandatory picklist (Refund's was optional free text); no refund-method (cash vs QR) choice existed anywhere; voided rows didn't show who voided them or why.

**Fix shipped:** Void/Refund collapsed into a per-row overflow menu; both now go through the new shared `ConfirmDestructive` dialog with full context (customer/product/amount/payment method) and the same mandatory reason picklist; Refund gained an explicit Cash/QR method choice, defaulting to the original sale's method; voided rows show reason and voiding staff via a hover tooltip, sourced from a real join, not a client-side guess. One real bug in the shared `ConfirmDestructive` component itself was caught and fixed along the way: it was clearing the picked reason on every confirm click, which broke the reconciled-day two-step flow (the dialog stays open across that flow rather than unmounting).

---

## 6. HIGH — status by screen

Items not listed below are unchanged from the original review and still open.

**Folded into work above, now done:**
- `H-24` (stacked action buttons breaking row alignment on Members) — fixed as part of `C-7`.
- `H-32` (Pool Inventory "Status" column all em-dashes) — 🔧 **corrected**: the column already worked correctly for Retired/Out-of-stock/Low; it only ever showed em-dashes because the demo data never had an item cross into low/out territory, and there was no positive "In stock" chip for the healthy case. That chip now exists (commit `1bf5c34`).
- `H-33` (Pool Inventory has no low-stock banner, inconsistent with Restaurant) — 🔧 **corrected, was already false**: both screens already had byte-identical low-stock banner logic before this review. No fix needed beyond `H-32`'s chip.
- `H-39` / `H-40` / `H-41` (End of Day breakdown/reconciliation/WhatsApp report) — ✅ done (commit `685dc2c`). 🔧 **Corrected**: H-40 and H-41 were both substantially already built — a real reconciliation flow (physical count vs. system cash, discrepancy shown, mandatory reason if unbalanced) and a real WhatsApp send step already existed and were already chained together. Only H-39 (the flat, ambiguous-looking breakdown) was fully real as originally described. Shipped: a two-column "By payment / By source" layout with each column showing its own total (H-39); an opening-float term added to the reconciliation formula, via a proper schema migration (H-40) — a real, unrelated bug in that migration's guard was caught and fixed during implementation (it broke a synthetic test fixture representing a database that had never run the migration creating the reconciliation table at all); five new sections (footfall, voids, low stock, tomorrow's bookings, expiring memberships) added to the WhatsApp message, each omitted when zero rather than shown as noise (H-41).

**Confirmed real, still open:** `H-1`–`H-3` (staff Home layout), `H-5`–`H-10` (Member search / Today's Log), `H-11`–`H-23`, `H-25`, `H-26` (owner Dashboard / Transactions / Members), `H-27`–`H-31` (Bookings), `H-34`–`H-38` (Pool/Restaurant Inventory beyond the chip fix), `H-42`, `H-43` (staff global).

---

## 7. POLISH — all still open

Unchanged from the original review (`P-7` through `P-20`, table form) — none attempted yet. See the original table structure; nothing here has been invalidated by anything found during implementation.

---

## 8. New features worth building — all still open

`F-1` through `F-11`, unchanged. None attempted. Worth re-reading `F-9` (backups) in particular before the next phase of work — it's flagged as the most dangerous line in the whole app (no tested backup/restore path on a database that *is* the business's financial record) and doesn't depend on anything else in this document.

---

## 9. Sequencing — where things actually stand

Original Phases 1 and 2 are done (with the scope corrections above folded in), plus two Phase-4-labeled items (`C-7`, and the `H-32`/`H-33` inventory chip) that turned out cheap enough to fold in early. Everything below is unchanged from the original plan and still applies as written in the prior version of this document:

- **Phase 3 — the till rewrite** (`C-1`, `C-2`, `H-42`, `P-11`–`P-13`): not started. See the note below.
- **Phase 4 — owner intelligence** (`H-11`–`H-23`, `H-25`, `H-26`, `H-34`–`H-38`, `F-7`): mostly open (`C-7` and the inventory chip already done, as noted above).
- **Phase 5 — bookings, then growth features** (`H-27`–`H-31`, `F-1`–`F-6`, `F-10`, `F-11`): fully open.

---

## 10. Schema and API changes — status

Everything listed under the original "Phase 2" schema section is done: `transactions.staff_id`/void columns already existed pre-review; `cash_reconciliations.opening_float` added (commit `685dc2c`); `restaurant_menu_items.manually_unavailable_at` added (commit `d55f6c7`); no new `staff`/`cash_sessions`/`backups` tables were needed beyond what already existed. Phase 3/4/5 schema changes (menu blocking-ingredients — turned out unnecessary, see `C-3`; `inventory_adjustments`; `members.last_visit_at`/`organisation_id`/`household_id`; bookings deposit fields; `check_ins` checkout tracking; `batches`/`enrolments`/`attendance`) are all still open as originally listed.

---

## 11. Templated vs. genuinely designed — updated

The original read holds, with one addition: the metric-computation layer (§C-6) turned out to already be well-designed in the places that mattered (shared IPC handlers, not per-screen duplication) — the bug was a display-layer slip, not an architectural one. And the void/refund/reconciliation backend logic (§C-4, C-8, H-40) was more careful and further along than the screenshots suggested; the interaction design around it (adjacent buttons, free-text reasons, no context in the dialog) was the templated part, not the underlying logic.

---

## 12. Open questions for the owner — resolved or still open

Most of these turned out to already be answered by existing code, or were resolved with a documented default per the original instruction to "build the flexible version" rather than guess:

1. **Footfall definition** — resolved: check-ins + day-pass/entry-ticket attendees, documented limitation on the rare double-count case. (`C-6`)
2. **Staff see the day's revenue total on Home?** — still open, not yet touched (`H-1`).
3. **Dashboard comparison baseline** — still open, not yet built (`H-11`).
4. **Void window length** — resolved: 15 minutes default, configurable in Settings. (`C-4`)
5. **Partial refunds** — resolved: turned out to already exist and work correctly before this review started, nothing to decide. (`C-8`)
6. **Staff-created bookings, owner approval?** — still open (`H-30`).
7. **Pool double-booking — warning or hard block?** — still open (`H-31`).
8. **Discounts — who, and is there a cap?** — still open (`F-6`).
9. **Receipts — printer or WhatsApp-only?** — still open (`F-5`).
10. **Backup destination** — still open (`F-9`).
11. **Does Pause extend expiry?** — assumed yes (industry-standard "freeze") when this was scoped, but not actually touched by any shipped work yet — verify before building anything that depends on it.
12. **Restaurant stock unit (kg real or aspirational)?** — resolved: real, the shipped `C-3` work depends on and correctly handles fractional kg quantities.

---

## 13. What's actually left, ranked

If picking up where this leaves off:

1. **The till rewrite (`C-1`/`C-2`).** Still the single highest-leverage remaining item, and now better-scoped than the original review knew (a 4th sale-writing path found, and evidence the existing `sales:create` endpoint can likely absorb the other two without new backend logic). The highest-blast-radius change in the document — deliberately not started without an explicit go-ahead. See the note below.
2. **Owner dashboard trends (`H-11`).** ~30 days of data already exist in the database; nothing currently asks it "is this good?" Independent of the till rewrite, safe to parallelize.
3. **Bookings deposit/payment visibility (`H-28`).** This business takes advance deposits on private events; whether money has landed doesn't appear anywhere in either interface yet.
4. **Backups (`F-9`).** Flagged by the app's own Dashboard alert as unresolved and is, by the original review's own words, "the most dangerous line in the entire app."
5. **Everything else in §6–§8**, roughly in the order the original document's phases laid out.

---

## A note on the till rewrite

Before starting `C-1`/`C-2`: this replaces the screen staff use for every single sale, all day, at a business that's already operating on real money. The original review's own advice was to ship it behind a feature flag and run both flows in parallel for a week in the real world — not something achievable inside an agent session. The plan, when this resumes, is to build it with the same rigor as everything above (fresh implementer, full independent review, thorough test and screenshot verification) — but to flag it explicitly before it lands rather than let a core POS rewrite replace the live flow unseen. This is the one piece of the whole document worth a hands-on look before it ships, not just a report to read after the fact.

---

*Status current as of `ux-punchlist-phase1` @ `afe2c83`. Reference item IDs in commits, as before.*
