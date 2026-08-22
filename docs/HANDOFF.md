# Handoff

Written 2026-08-22, handing off from Claude to whoever/whatever continues this
(expected: Cursor). The user is out of usage for a while and won't be available to
answer questions — this doc is written to be self-contained. Read this first, then
[ABOUT.md](../ABOUT.md) for the reasoning behind the code, then
[REFRESH_MANAGER_UX_PUNCHLIST.md](../REFRESH_MANAGER_UX_PUNCHLIST.md) for the detailed
status of the current work stream.

---

## The project in one paragraph

**Refresh Manager** — offline Electron + React + SQLite point-of-sale running the
whole of Refresh Recreation Center (pool, gym, restaurant) in Boudha, Kathmandu, on one
PC at the reception desk. Two roles: **staff** (4-digit PIN, the till) and **admin**
(name + password, the back office). Real cash goes through it daily; the users are
family members in their 50s who are not technical. It has not shipped to the venue yet.

Repo: `/Users/sambhav/Refresh Manager/refresh-manager` · remote
`github.com/Sambhav255/refresh-manager`.

---

## ⚠️ Branch state — read this before doing anything else

**You are almost certainly on `ux-punchlist-phase1`, not `main`.** Run
`git branch --show-current` to confirm. This branch is:

- **18 commits ahead of `main`**, all pushed to `origin/ux-punchlist-phase1`.
- **Not merged.** A PR is ready to open at
  `https://github.com/Sambhav255/refresh-manager/pull/new/ux-punchlist-phase1` but
  nobody has opened or merged it yet — that decision was left for the human.
- Fully tested and reviewed: **345 tests passing** (`npm test`), clean build, 0 lint
  errors, and a full click-through of every touched screen via the E2E harness.

If you're picking this up in a **fresh clone or a different checkout**, make sure
you're actually on this branch (`git checkout ux-punchlist-phase1` after fetching)
before assuming any of the fixes below are present — none of them are on `main` yet.

**What's on this branch:** a UX/UI review (`REFRESH_MANAGER_UX_PUNCHLIST.md`) was
implemented task-by-task, each one built by a fresh implementer, checked by an
independent reviewer, and fix-looped when the reviewer found something real. Summary:

| Area | What changed |
|---|---|
| Design system | Colour semantics fixed (QR no longer reads as a link, green reserved for state chips), contrast fixed, touch targets sized correctly per surface, dev hint bar removed |
| Shared components | `Badge` extended, plus new `Money`, `RelativeDate`, `EmptyState`, `ConfirmDestructive` |
| Dashboard | A real bug fixed — the "upcoming bookings" count silently under-reported past 3 because it read a display-truncated array's length; footfall now counts day-pass attendees, not just member check-ins |
| End of Day | Two-column "By payment / By source" breakdown (the old flat list looked like double the real revenue), opening-float term added to reconciliation, WhatsApp report enriched |
| Transactions | Void/Refund collapsed into a row menu, both go through a shared confirm dialog with a mandatory reason picklist, refund gained a Cash/QR method choice |
| Members | Expired/expiring members now have a Renew action (previously: no way to take the renewal money from that screen at all) |
| Restaurant POS | Menu items grey out when their linked stock is out or retired, instead of failing at checkout after the order's already been taken |
| Staff | Staff can now void their own or a colleague's transaction within a configurable time window, previously owner-only |

**Two bugs were caught and fixed outside any single task's own review:**
1. A `better-sqlite3` native-module ABI mismatch that broke the app launch entirely
   (see the ABI section below) — fixed with a self-healing `posttest` npm script.
2. An integration bug a final end-to-end smoke test caught: two different tasks each
   added their own `Escape`-key handler (to close a new row-menu), and neither knew
   about App.jsx's pre-existing global `Escape`-to-logout handler — so closing a menu
   also logged the owner out. Fixed with a shared `rowMenuGuard` flag, same pattern as
   the pre-existing `cartGuard`. **This is exactly the kind of bug that only shows up
   when you actually click through the finished app** — if you build more screens with
   their own local `Escape` handling, check `rowMenuGuard`'s comment in
   `src/renderer/src/components/ui.jsx` for the pattern to follow.

Full detail, plus every case where the *original* UX review turned out to be wrong or
overstated (about a third of it — it was written from static screenshots with no
source access), is in `REFRESH_MANAGER_UX_PUNCHLIST.md`.

---

## What to do next, in order

### 1. The highest-leverage remaining item: the New Transaction rewrite

`REFRESH_MANAGER_UX_PUNCHLIST.md` §5 items `C-1`/`C-2`. The staff-facing "New
Transaction" screen is a 5-step wizard for what's usually a single Rs. 300 day-pass
sale — collapsing it into one screen with an inline cart is the single highest-value
remaining change, confirmed for real (not overstated) by reading the actual code.

**This was deliberately not started.** It replaces the screen staff use for every sale,
all day, at a business already running on real money — the highest blast-radius change
in the whole document. The original review's own advice was to ship it behind a
feature flag and run both flows in parallel for a week in the real world; that's not
achievable in an unattended session, and the user wasn't available to sign off on
starting it. If you're an AI agent picking this up autonomously: apply the same
judgment — this is the one piece worth a human's explicit go-ahead before you touch it,
not just default forward momentum. If a human is driving Cursor interactively, that
constraint doesn't apply the same way; use your judgment, but still test unusually
thoroughly before considering it done, and see the closing note in the punchlist doc
for what was already scoped out (a 4th, previously-uncounted sale-writing backend path
was found; `sales:create`'s cart model can likely absorb the other two without new
backend logic — read that note before starting, it'll save time).

### 2. Everything else, ranked

See `REFRESH_MANAGER_UX_PUNCHLIST.md` §13 for the full ranked list. In short, after the
till rewrite: owner dashboard trend deltas (the data already exists, nothing asks it
"is this good?"), booking deposit/payment visibility, then backups (`F-9` — flagged by
the app's own dashboard alert as unresolved, and by the original review's own words as
"the most dangerous line in the entire app").

### 3. Two small loose ends from before this session — now fixed
Both were fixed and verified against the real running app after the rest of this
handoff was first drafted (commit `06aad79`): the retired-product week-check now shows
a clear message instead of 21 blank cells, and the live preview no longer tells the
owner a new rule will be "replaced" by one it actually supersedes.

### 4. Things only a human can do
Never done, cannot be automated: **thermal printer** on real hardware, **camera
capture**, one real **WhatsApp send**, behaviour across **local midnight**, a
**two-staff** till day, and a full **backup → restore drill** on a copy of real data.

---

## ⚠️ Read before running anything: the ABI trap

`better-sqlite3` is native and must be compiled for **Node's** ABI to run Vitest, but
**Electron's** ABI to run the app or any `test/e2e/*` script. These are mutually
exclusive states of `node_modules`.

**This now self-heals on `ux-punchlist-phase1`** (commit `d78cd8b`): `npm test` rebuilds
for Node automatically (`pretest`) and rebuilds back to Electron automatically
afterward (`posttest`). You should not need to think about this on this branch. If
you're on `main` or an older commit without that `posttest` script, you still need to
rebuild manually before running the app or an E2E script:

```
npx electron-rebuild -f -w better-sqlite3
```

**Do not trust `electron-builder install-app-deps`** — observed reporting success
without actually rebuilding. `electron-rebuild -f` is the reliable one. A database
error mentioning `NODE_MODULE_VERSION` on startup is always this.

---

## Running things

```
npm test                    # vitest — main process / IPC / DB logic, self-healing ABI
npm run build                # electron-vite build, all three targets
npm run lint                  # eslint; 0 errors is the bar, warnings are pre-existing
npm run dev                    # launches the real app for interactive use
node test/e2e/screenshot-tour.mjs      # walks every screen, screenshots to docs/qa/screenshots/
node test/e2e/seed-demo-month.mjs      # seeds ~30 days of realistic demo data into a fresh profile
```

Renderer components have **no unit-test harness** — verify UI changes by actually
launching the app through `test/e2e/harness.mjs`'s `launchApp`/`shot` pattern (see any
`test/e2e/*.mjs` file for the shape), not by reading the JSX and trusting it. Write
throwaway verification scripts under `test/e2e/`, screenshot to
`docs/qa/screenshots/<name>/` (gitignored), and **delete the script before committing**
— that's the convention every task on this branch followed.

---

## Invariants — do not break these

Not style preferences. Each exists because breaking it already cost real money or real
data once (see `ABOUT.md` for the incidents).

1. **Money and identity are derived in main, never accepted from the renderer.** A cart
   sends `{kind, refId, tier, quantity}`. It must never send a price, an amount or a
   `staffId`, and handlers must never read one if sent.
2. **Multi-write operations run in one `db.transaction()`.** A failure leaves nothing
   behind — no orphan member, no stock movement without its sale.
3. **`transactions.amount` stays the sale total.** Every report, End-of-Day and the
   WhatsApp message read it.
4. **Reporting derives the breakdown from `transaction_lines` and cash/QR from
   `transaction_payments`**, not the header columns, except as a fallback for rows with
   no lines (refunds, pre-sale-model rows).
5. **All timestamps are local** (`datetime('now','localtime')`). The business closes at
   midnight in Kathmandu, not UTC.
6. **No silent no-ops.** Every early return in a click path either shows a message or
   corresponds to a visibly disabled control.
7. **Anything both processes need lives in `src/shared/`.** Parallel copies drift —
   that's how End of Day and the WhatsApp report once disagreed about the same day.
8. **Never hard-delete** anything referenced by historical sales. Retire it.

---

## How this codebase has been worked on — worth continuing

- **Two test layers, and the E2E one is not optional.** Renderer bugs live in the
  renderer→main payload, where every handler test passes while the app is unusable.
- **Verify claims rather than relaying them.** Repeatedly, a report describing a bug or
  a fix didn't survive checking against the actual code or a live run — a migration
  that broke a synthetic test fixture, a "removed" feature that was still reachable, a
  root-cause explanation that was flatly wrong even though the symptom was real. Read
  the source. Click through the app. Don't just trust a prior write-up (including this
  one, and including `REFRESH_MANAGER_UX_PUNCHLIST.md` — it says explicitly which of
  its own claims were independently verified vs. reported by an implementer).
- **A dedicated reviewer, not just the implementer's own testing, kept catching real
  things.** Several fixes on this branch went through one extra round after an
  independent pass found something the implementer's own verification missed — a
  regression, a mis-scoped guard, a claim that didn't match the diff. If you're working
  solo (no separate reviewer available), budget time to re-read your own diff cold
  before calling something done, and actually run the app, not just the test suite.
- **Parallel work needs strictly disjoint file ownership.** Two changes touching the
  same file concurrently is how things collide; `preload/index.js` and `lib/api.js`
  are shared choke points every screen touches, so change them carefully.

---

## Credentials on this machine (dev database only)

Admin **`Sambhav` / `refresh2024`**, staff PIN **`4821`**. Set by hand during testing.
**Change them before the venue uses this.**

---

## Documentation map

| File | Contents |
|---|---|
| **`docs/HANDOFF.md`** (this file) | Start here |
| [`ABOUT.md`](../ABOUT.md) | Project history, every bug found and fixed, decisions with reasoning — read before reversing anything |
| [`REFRESH_MANAGER_UX_PUNCHLIST.md`](../REFRESH_MANAGER_UX_PUNCHLIST.md) | The active UX work stream: done / corrected-from-the-original-review / still-open, ranked |
| [`README.md`](../README.md) | Features, architecture, how to run and test |
| [`docs/RELEASES_AND_SCALING.md`](RELEASES_AND_SCALING.md) | What's actually been shipped so far (with the ambiguity in that spelled out honestly), why `package.json`'s version has never moved and what to do about it, a release checklist, exactly what the built-in update-safety net does and doesn't cover, and a deliberately conservative look at what scaling to a second till / a second venue / a second customer would actually require |
| [`METRICS.md`](../METRICS.md) | Canonical definition of every dashboard metric, which handler computes it, which screens show it — read before adding a new number to a screen |
| [`docs/ROADMAP.md`](ROADMAP.md) | Business-feature planning from an Aug 2026 walkthrough. **Partially stale**: its central architectural ask (a sale needs lines + payments, not one product) was already built by the time this doc was last touched — see `ABOUT.md` §5. The rest (family memberships, corporate accounts, swim classes, etc.) is still unbuilt and may still be relevant; verify against current code before trusting any specific claim in it. |
| [`docs/qa/QA_REPORT.md`](qa/QA_REPORT.md) | The August 2026 bug sweep, with root cause and `file:line` |
| [`docs/qa/MONEY_AUDIT.md`](qa/MONEY_AUDIT.md) | Adversarial audit of every cash and stock path |
| [`docs/qa/SHIP_READINESS.md`](qa/SHIP_READINESS.md) | Test plan, fix status, manual test matrix |
| [`docs/archive/`](archive/) | Superseded planning/audit docs from the July 2026 hardening phase — historical record only, see `docs/archive/README.md` |
| `.cursor/rules/project.mdc` | The same essential context as this file, condensed for automatic injection into Cursor's context |
| `.superpowers/sdd/REFRESH_MANAGER_UX_PUNCHLIST/` | Full task-by-task history for the punch-list work (briefs, implementer reports, reviewer findings, every ruling made) — **gitignored, local to this machine only**, won't exist on a fresh clone. `REFRESH_MANAGER_UX_PUNCHLIST.md` is the durable record of the same conclusions. |
