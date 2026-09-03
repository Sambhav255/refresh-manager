# Unified Till Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 5-step New Transaction wizard with one till screen that can mix entry tickets, pool shop items, and kitchen items in a single `sales:create` basket, without putting memberships through that cart.

**Architecture:** Keep `sales:create` / `sales:quote` as the only writer for goods. Close the gap that `sales:create` does not yet honour restaurant 86'd-today the way `restaurant:checkout` does. Put the new UI behind owner setting `unified_till` (default off). Memberships stay on `members:create-with-membership`. Pool and restaurant checkout become thin adapters over the same sale engine.

**Tech Stack:** Electron 39, React 19, better-sqlite3, Vitest, Playwright E2E (`test/e2e/harness.mjs`).

**Spec:** REFRESH_MANAGER_UX_PUNCHLIST.md C-1/C-2; docs/HANDOFF.md next-work item 1; ABOUT.md sections 4-6.

Lane choice from the orientation plan: till rewrite (C-1/C-2), not a versioned ship and not dashboard/bookings/backups. The venue is not on a current build yet, so staff will never live on the old wizard.

## Global Constraints

- Prices, staff id, and sale totals are derived in main. Cart payload is `{ kind, refId, quantity, tier?, discount?, discountReason? }` only.
- One `db.transaction()` per sale. Failure leaves nothing.
- `transactions.amount` remains the sale total. Breakdowns come from lines and payments.
- Cart kinds: `product`, `pool_item`, `menu_item`. Do not send `membership` from this till.
- Local timestamps. No silent no-ops. `cartGuard` stays in sync so Escape does not log out mid-sale.
- Rebuild better-sqlite3 for Electron before app/E2E.
- H-42 and P-11-13 are unspecified. This plan is C-1/C-2 only.
- Do not bump version, merge to main, or package a venue build here.

## File map

- `src/main/ipc/sales.js` — engine; 86'd-menu check; export `executeSale`
- `src/main/ipc/restaurant-menu.js` — checkout adapter
- `src/main/ipc/inventory-pool.js` — sell-item adapter
- `src/renderer/src/components/qty-stepper.jsx` — create
- `src/renderer/src/screens/staff-till.jsx` — create
- `src/renderer/src/screens/staff-transaction.jsx` — keep until E2E green
- `src/renderer/src/App.jsx` — branch on `unified_till`
- `src/renderer/src/screens/owner-settings-extras.jsx` — toggle
- `test/sales-model.test.js` and `test/e2e/verify-checkout.mjs`

## Tasks

### Task 1: Reject 86'd menu items in sales:create

Why first: otherwise an 86'd dish becomes sellable through the till.

- [ ] Step 1: Failing test in test/sales-model.test.js — 86 a menu row, sales:create must fail with unavailable, zero transactions.
- [ ] Step 2: npm test -- test/sales-model.test.js — expect FAIL (priceLine only checks is_active).
- [ ] Step 3: After is_active, apply date(manually_unavailable_at) = date('now','localtime'). Error: "{name} is marked unavailable today".
- [ ] Step 4: Re-run file — PASS including existing menu stock-draw tests.
- [ ] Step 5: Commit fix: sales:create refuses menu items 86d today.

### Task 2: One sale engine; old channels become adapters

- [ ] Step 1: Failing parity tests — pool-inventory:sell-item and restaurant:checkout must write the same transaction_lines as sales:create.
- [ ] Step 2: Expect FAIL if those channels still write header-only.
- [ ] Step 3: Export executeSale from sales.js. Adapters map payload and return keys (transactionId, total, paymentMethod). deriveHeader must still mark a goggles-only sale as pool on EOD.
- [ ] Step 4: Full npm test.
- [ ] Step 5: Commit refactor: route pool and restaurant checkout through sales:create.

### Task 3: Feature flag unified_till

Default off. Owner settings card. App.jsx: missing/0 = wizard, 1 = StaffTill.

- [ ] Step 1: Test owner can set unified_till=1.
- [ ] Step 2: Add the card UI. Copy: Use the one-screen till.
- [ ] Step 3: Run settings tests.
- [ ] Step 4: Commit feat: owner toggle for the unified till (default off).

### Task 4: Shared QtyStepper

Create src/renderer/src/components/qty-stepper.jsx. Import from sell-item and restaurant POS. Same clamp and Enter as today.

- [ ] Step 1: Extract with no behaviour change.
- [ ] Step 2: Commit refactor: share QtyStepper.

### Task 5: StaffTill one screen for goods

Create staff-till.jsx. Flag on: new tab renders StaffTill. Left: Entry / Shop / Kitchen. Right: cart + Due from quoteSale. Bottom: Cash/QR Charge. Hide Kitchen when station hides restaurant. Copy cartPayload from the wizard. Keep cartGuard in sync.

- [ ] Step 1: Build behind the flag only.
- [ ] Step 2: Manual check: Entry Ticket plus goggles, one log row, stock down one.
- [ ] Step 3: Commit feat: single-screen staff till behind flag.

### Task 6: Compact membership, not in the cart

Fourth chip Member. Plan picker, name/phone, match offer. Submit create-with-membership. Do not put membership lines on the goods cart.

- [ ] Step 1: Port match-offer and atomic create from the wizard.
- [ ] Step 2: Manual check new and returning member.
- [ ] Step 3: Commit feat: membership on unified till.

### Task 7: Leftover tiles open the till

Flag on: sellitem tab opens shop; restaurant tab opens kitchen. Old screens only when flag is off. Same-day 86 control stays on kitchen rows via existing restaurant-menu channel. Do not rebuild C-3.

- [ ] Step 1: Route tiles.
- [ ] Step 2: Station hiding unchanged.
- [ ] Step 3: Commit feat: leftover tiles open unified till.

### Task 8: E2E against the real window

Update test/e2e/verify-checkout.mjs. Turn the flag on in the harness. Replace Continue-step asserts with single-screen actions. Keep: names, qty changes due, mixed basket is one sale, discount needs reason, part pay leaves balance, membership creates one member.

- [ ] Step 1: electron-rebuild better-sqlite3.
- [ ] Step 2: Run verify-checkout until green.
- [ ] Step 3: Run verify-fixes-5 and adjacent scripts.
- [ ] Step 4: Commit test: point checkout E2E at unified till.

### Task 9: Escape and money regression

- [ ] Step 1: cartGuard true with unpaid items, false after Charge. Escape must not log out.
- [ ] Step 2: Full npm test.
- [ ] Step 3: Commit only if a logout bug was fixed.

### Task 10: Punchlist status

- [ ] Mark C-1 and C-2 done in REFRESH_MANAGER_UX_PUNCHLIST.md. Flag default still off. Do not mark H-11, H-28, F-9, or human-only printer items.
- [ ] Commit docs: mark C-1 C-2 behind flag.

## Self-review

| Spec | Task |
|---|---|
| Collapse wizard (C-1) | 5, 8 |
| Mixed sale (C-2) | 2, 5, 7 |
| Engine absorbs pool/restaurant | 2 |
| 86'd dishes | 1 |
| Memberships off cart | 6 |
| Flag; old wizard remains | 3, 5, 7 |
| E2E seam | 8 |
| H-42 / P-11-13 | Out of scope |

Default unified_till stays off so a surprise build cannot replace the live flow unseen.
