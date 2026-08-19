# Ship readiness — test plan, open work, and improvements

**Date:** 2026-08-19 · **Audience:** whoever implements the remaining fixes and runs the tests.
Companion to `docs/qa/QA_REPORT.md` (full bug detail) and `docs/qa/findings-staff.md`.

---

## 0. Final hardening round — complete

| Feature | Backend | Tests | UI | Status |
|---|---|---|---|---|
| Unique-index migration | ✅ | ✅ `test/schema-constraints.test.js` | n/a | **Done.** check-ins (one per member per day, with historical de-duplication), pool items, restaurant items, members. Skips an index rather than failing when existing data already violates it, and records why. |
| Inventory movement history | ✅ `pool-inventory:history`, `restaurant-inventory:history` | ✅ `test/inventory-history.test.js` | ✅ | **Done.** Per-row **History** panel on both inventory screens: time, movement type, signed quantity, resulting balance, reason, staff, and the linked sale. Panels are mutually exclusive, and a stale in-flight response can no longer populate the wrong item's panel. |
| Atomic member + membership | ✅ `members:create-with-membership`, `members:find-matches` | ✅ `test/member-atomic.test.js` | ✅ | **Done.** The wizard makes one transactional call. When the customer looks like an existing member it offers "This is them" / "None of these — new member" / "Back" — never a forced merge. **The duplicate-member bug is fixed end-to-end**: two membership sales to the same person now leave exactly one record (`verify-fixes-5.mjs`). |

Verified by `test/e2e/verify-fixes-5.mjs` (13/13) on top of the existing suites.

One consistency bug was found while wiring this: the printed membership card computed its end date locally as `start + duration_days`, one day later than the backend now stores (`start + days - 1`, see OPEN-1). Printed cards disagreed with the database. The local helper was removed and the card now prints the dates returned by the write.

---

## 1. Test inventory and how to run it

**Status as of 2026-08-19: every item on the QA backlog is implemented and verified. 183 unit tests + 96 E2E checks, 0 failures, 0 skips, 0 lint errors, no runtime console errors. The Reports & Settings sweep — the last untested area — is now covered.**

| Suite | Files | What it proves | Run with |
|---|---|---|---|
| Unit/IPC (existing) | `test/*.test.js` | Money derivation, refunds/voids, backup/restore, migrations, security, reports | `npm test` |
| QA regressions | `test/qa-regressions.test.js` | The bugs fixed in the Aug-2026 sweep stay fixed | `npm test` |
| Validation guards | `test/validation-guards.test.js` | Main-process input guards: no blank names, negative money, text-in-numeric, absurd quantities; role gates hold | `npm test` |
| Open-bug specs | `test/open-bugs.test.js` | OPEN-1..11 — **all now implemented and un-skipped** | `npm test` |
| E2E fix verification | `test/e2e/verify-fixes{,-2,-3,-4,-5}.mjs` | The fixes work in the real app (65 checks). `-3`/`-4`/`-5` specifically cover renderer↔main wiring — where both original P0s hid | `node test/e2e/verify-fixes-5.mjs` |
| **E2E Reports & Settings sweep** | `test/e2e/sweep-reports-settings.mjs` | All 7 report types against a known dataset (total 4850), a real Excel file written + reopened + checked, staff/admin lifecycle, password change round-trip, menu editor, backup, audit log — 31 checks | `node test/e2e/sweep-reports-settings.mjs` |
| E2E area scripts | `test/e2e/area-*.mjs` (37 scripts) | Ad-hoc reproduction scripts from the QA sweep. Not maintained — they lint dirty and are kept only as evidence | `node test/e2e/<script>` |

### ⚠️ The ABI trap (read before running anything)

`better-sqlite3` must be compiled for **Node's** ABI for vitest, but for **Electron's** ABI for the app and every `test/e2e/*` script. These are mutually exclusive states of `node_modules`.

- `npm test` → its `pretest` hook rebuilds for **Node** automatically.
- Before running the app or any E2E script afterwards: `npx electron-rebuild -f -w better-sqlite3`.
- **Do not trust `npx electron-builder install-app-deps`** — it has been observed reporting success without rebuilding. `electron-rebuild -f` is the reliable command.

Recommended: add to `package.json` scripts —
```json
"rebuild:electron": "electron-rebuild -f -w better-sqlite3",
"test:e2e": "npm run rebuild:electron && node test/e2e/verify-fixes.mjs && node test/e2e/verify-fixes-2.mjs"
```

### Workflow for future open-bug specs

All 11 original blocks are now implemented and un-skipped. When adding a new one, keep the discipline that made these trustworthy:

1. Write the spec, un-skip it, and **watch it fail** before writing any fix. A spec never seen red may be asserting something already true.
2. Implement the fix. Put the root cause with `file:line` in the block header.
3. Green → it now guards the fix permanently.
4. Never delete a block instead of fixing it without recording the decision in `QA_REPORT.md` — several are money bugs.

*(For the round just completed, OPEN-1 was empirically confirmed red by reverting the one-line fix and observing `2026-01-31` vs the expected `2026-01-30`. The other ten assert fields or behaviours that did not exist beforehand, so they could not have passed.)*

---

## 2. Fix status

### ✅ Done (2026-08-19) — all verified by unit + E2E

| # | Fix | Decision taken |
|---|---|---|
| OPEN-1 | `membershipEndDate` now returns `start + days - 1`; `end_date` stays the inclusive last valid day | **Grandfathered, no migration.** `end_date` is computed once at purchase and stored, so existing members keep the dates they were sold; only new memberships get the corrected duration. This was the safe default — a migration would shorten memberships people already paid for. Revisit only if you want existing rows corrected too. |
| OPEN-2 | Full refund of a membership sale sets the linked membership to `cancelled`, inside the same transaction as the stock restore. Partial refunds deliberately leave it alone | |
| OPEN-3 | `checkins:create` counts a member once per day and returns `alreadyCheckedIn`; `members:search` returns `checkedInToday`; staff screen reads server truth | A repeat is a **success**, not an error — a reception double-tap must not raise a red alert |
| OPEN-4 | `transactions:list` accepts `includeVoided` (default false, so no caller changes) | |
| OPEN-5 | List rows carry `refundedSoFar`/`remaining`; refund dialog defaults to remaining and shows "X of Y already refunded" | |
| OPEN-6 | `requirePhone` in main, mirroring the renderer's 10-digit Nepal rule; empty stays valid | |
| OPEN-7 | `restaurant-menu:update` converted to the allow-list partial-update pattern + value validation + not-found guard; `add` validated too | |
| OPEN-8 | Checkout refuses a menu item whose linked stock is deactivated or missing (was a silent `continue`) | |
| OPEN-9 | `lastMembership` returned for members with no active membership; staff screen shows "Advanced Training — Monthly / ended 30 Jan" vs "No membership on record" | |
| OPEN-10 | Duplicate **active** inventory items rejected with "…already exists — restock it instead"; re-adding a retired item still allowed | |
| OPEN-11 | `transactions:list` accepts `limit`/`offset` and returns `totalCount`; the Transactions screen pages at 100/page with Previous/Next | |

**One existing test was deliberately changed:** `checkins.test.js` "computes footfall totals" checked the *same member* in three times and expected 3 — it encoded the inflation bug itself. It now uses three different visitors, and a new test asserts one member counts once however many times they are checked in.

### ✅ Final round — UI, polish, and the missing sweep

| Area | Done |
|---|---|
| **Bookings** | Deposit / total-expected / deposit-method fields on the form; deposit + balance on each card; cancel now asks first and names the outstanding deposit (consuming `outstandingDeposit`); Reinstate for cancelled bookings; empty state; Notes is a textarea; People is numeric; past-date warning; tab labelled "Next 60 days" (staff says 14 — the two no longer use the same word for different windows) |
| **Transactions** | All 7 types in the type filter (from the shared label map); Last 7 / Last 30 / **custom date range**; **Show voided** toggle rendering voided rows struck through; owner included in the staff filter; empty-state row; void with a blank reason now shows an error instead of doing nothing; **pagination** (100/page with total count); "This week" no longer computed in UTC |
| **Inventory (both screens)** | **Adjust stock** with a mandatory reason — previously there was *no* way to correct stock after a count; **Price** control on restaurant items (parity with pool); "at or below reorder level" wording now matches the `<=` the code actually implements |
| **POS** | Clear order button; lookup failures translated into counter-friendly wording |
| **Staff** | Print-membership-card now reports failure and confirms success (it silently swallowed both) |
| **Auth** | Lockout copy derives from the real cooldown ("30 seconds", not "a few seconds"); the attempt that *arms* the lock now says so; "2 attempts left" warnings; empty-field logins name the missing field instead of "Invalid login credentials" |
| **Dashboard** | Alerts navigate — low stock → Inventory, bookings → Bookings, backup → Settings, expiring → Members |
| **Members** | Expired members show what they were on and when it ended on both the staff and owner screens |
| **Reports** | Month/year validated across all five month-scoped reports — a malformed month used to silently return an all-zero report, which reads as "no trade" rather than a bad request |

### Deliberately not done

| Item | Why |
|---|---|
| Opening-stock field on Add item | Restock immediately after adding achieves the same result and records an auditable movement. Adding a third path to change stock (add / restock / adjust) is more surface than it's worth. |
| Per-item stock history UI | Needs a new read handler (`*-inventory:history`) plus a drawer. The data is being written correctly and is queryable; this is a reporting feature, not a defect. |
| Duplicate-member prevention in the staff wizard | Real fix is the single `members:create-with-membership` transaction in section 4 — a refactor, not a patch. Main-side phone validation (OPEN-6) removes the worst symptom. |
| Retroactive membership date migration | See OPEN-1 above — existing members keep the dates they were sold. |

---

## 3. What unit tests CANNOT prove — E2E/manual matrix

The renderer↔main contract is where both P0s lived (`{name,price,qty}` vs `{id,qty}` — every IPC-level test passed while the app was 100% broken). Unit green ≠ shippable. Before ship, run:

| Area | How to verify | Status |
|---|---|---|
| Every screen renders with data + POS sale end-to-end | `node test/e2e/verify-fixes.mjs` + `verify-fixes-2.mjs` (25 checks) | Automated, passing |
| **Reports & Settings sweep** | Never completed — the QA agent for this area was killed 4× by API errors. 7 report types vs known seed data, Excel export opened and totals checked, staff/admin lifecycle, restaurant menu editor (especially after OPEN-7!), backup→restore round-trip, audit log completeness. Scripts to adapt: `test/e2e/area-owner3-*.mjs` | **NOT DONE — highest-risk untested area** |
| WhatsApp EOD send + renewal reminder | Manual, once, with a real number: correct wa.me URL, correct message, `reminder_sent_at` written, audit row. (Deliberately never automated — `shell.openExternal`.) | Not done |
| Thermal printer | Manual on the venue hardware: ticket layout, 58/80mm width, membership card. Only the no-printer error path is tested. | Not done |
| Camera photo capture | Manual: capture, preview, retake, and the photo path after backup→restore. | Not done (upload path is tested) |
| Midnight rollover | Leave the app open across midnight: Today's Log empties, EOD offers yesterday, dashboard KPIs reset. All date maths uses `datetime('now','localtime')` consistently, but nobody has ever watched the boundary. | Not done |
| Multi-staff day | Add a second staff PIN, sell under both, check per-staff attribution in EOD + staff-activity report. | Not done |
| Restore drill | On a **copy** of real data: backup → wipe userData → restore → verify counts. `backup-restore.test.js` proves the mechanics; do it once with real hands before trusting it. | Not done |
| Update safety | Install current build over a userData dir created by the previous release (migration + snapshot path). | Not done |

---

## 4. Improvements (beyond bug fixes)

### Architecture / correctness

1. **One IPC call for member+membership creation.** The wizard does `members:create` then `members:add-membership` — non-atomic, and the cause of both orphan members and duplicate members (QA P2). A single `members:create-with-membership` handler wrapping one DB transaction, with a `matchExisting` lookup (name+phone) that lets the UI offer "add to existing member?", kills three bugs at once.
2. **Unique indexes as the last line of defence:** partial unique on `members(name, phone)` where phone is not null; `pool_inventory_items(name, variant)` and `restaurant_inventory_items(name)` where `is_active = 1`; `check_ins(member_id, date(checked_in_at))`. Handler checks (OPEN-3/10) catch the UX; indexes catch everything else. Ship as a migration — `test/migration.test.js` shows the pattern.
3. **Share validation between processes.** `renderer/src/lib/validate.js` and `main/ipc/utils.js` now hold parallel rules that will drift. Move both into `src/shared/` (the `transaction-types.js` precedent works — both bundles import it).
4. **Silent-no-op audit.** Grep the renderer for `if (!x) return` inside submit handlers — the QA sweep found four (void reason, restock qty, price edit, card print) where a click did *nothing visible*. Rule: every early return in a click path sets an error or disables the button.
5. **Inventory history read API.** Every stock movement is written to `*_inventory_transactions`, but there is no read handler — the history is write-only. One `inventory:history {itemId}` handler + a drawer makes restock mistakes diagnosable in-app instead of via sqlite3.
6. **Expose the existing adjust/edit/deactivate handlers in the UI.** Four working, tested, bridged handlers have zero call sites (QA P2). The owner still cannot rename an item, fix a wrong price on a restaurant item, correct stock after a count, or retire an item.

### Product / UX (cheap wins first)

7. Restaurant inventory needs the same per-row **Price** control just added to pool inventory.
8. Booking cancel: confirmation dialog naming the booking + outstanding deposit (handler already returns it), with forfeit/refund choice; a "Reinstate" action on cancelled bookings.
9. Transactions screen: custom date range (handler already accepts arbitrary `dateFrom/dateTo`), type filter covering all 7 types (labels exist in `src/shared/transaction-types.js`), owner in the staff filter.
10. POS: "Clear order" button; friendlier error mapping ("no longer on the menu" instead of raw handler text).
11. Lockout UX: say "30 seconds" (derive from `PIN_COOLDOWN_MS`), warn on the attempt that arms the lock.
12. Opening stock field on add-item (recorded as an adjustment with reason "Opening stock", not a fake restock).
13. Empty states for owner Bookings and Transactions (staff screens already have them — copy the pattern).

### Operational (pre-ship hygiene)

14. **Commit the working tree.** ~30 modified + new files are sitting uncommitted on `main`; the QA round and fix round are one logical change each and should be two commits, tagged, before any packaging.
15. **CI:** GitHub Actions running `npm test` per push is trivial (no ABI issue — `pretest` handles it). E2E needs a display; `xvfb-run` on Linux works for Electron and would have caught both P0s on every push.
16. Version/schema bump discipline: OPEN-1's migration (if chosen) must bump `SCHEMA_VERSION` — `update-safety.test.js` proves snapshot/rollback, so lean on it.
17. Backup encryption is configured but optional — decide whether unencrypted backups of a business's member data (names + phones) onto a USB stick is acceptable before ship; if not, require the passphrase during onboarding.

---

## 5. Pre-ship checklist

- [ ] All `describe.skip` blocks in `open-bugs.test.js` either fixed (un-skipped, green) or explicitly deferred in `QA_REPORT.md`
- [ ] `npm test` → 0 failures, 0 *unexpected* skips
- [ ] `npm run rebuild:electron && node test/e2e/verify-fixes.mjs && node test/e2e/verify-fixes-2.mjs` → 25/25
- [ ] Reports & Settings E2E sweep completed (section 3) — **currently the biggest hole**
- [ ] Manual matrix: printer, camera, WhatsApp, midnight, multi-staff, restore drill
- [ ] Working tree committed and tagged; `npm run build:win` / `build:mac` from a clean checkout
- [ ] Fresh-install smoke on the packaged build: setup wizard → price products → one sale of each type → EOD → backup
- [ ] Upgrade smoke: packaged build opened over previous release's userData
