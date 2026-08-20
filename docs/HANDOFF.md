# Handoff

Written 2026-08-21, at the end of a long working session. Read this first, then
[ABOUT.md](../ABOUT.md) for the reasoning behind the code.

---

## The project in one paragraph

**Refresh Manager** — offline Electron + React + SQLite point-of-sale running the
whole of Refresh Recreation Center (pool, gym, restaurant) in Boudha, Kathmandu,
on one PC at the reception desk. Two roles: **staff** (4-digit PIN, the till) and
**admin** (name + password, the back office). Real cash goes through it daily;
the users are family members in their 50s who are not technical. It has not
shipped to the venue yet.

Repo: `/Users/sambhav/Refresh Manager/refresh-manager` · remote
`github.com/Sambhav255/refresh-manager` · branch `main`, pushed and in sync.

---

## State right now

| | |
|---|---|
| Unit tests | **305** across 32 files (`npm test`) |
| End-to-end | **182 checks** across 10 suites (`node test/e2e/verify-*.mjs`, `sweep-*.mjs`) |
| eslint | **0 errors** (13 warnings, all pre-existing `react-hooks` patterns) |
| Working tree | clean, everything committed and pushed |
| The real database | migrated to `user_version 8`, verified intact; backups on the Desktop |

The app may still be running from `npm run dev`. `pkill -f "electron-vite dev"` stops it.

---

## ⚠️ Read before running anything: the ABI trap

`better-sqlite3` is native and must be compiled for **Node's** ABI to run Vitest,
but **Electron's** ABI to run the app or any `test/e2e/*` script. These are
mutually exclusive states of `node_modules`, and switching is the single most
common way to lose ten minutes here.

- `npm test` rebuilds for **Node** automatically (its `pretest` hook).
- Before the app or E2E: `npx electron-rebuild -f -w better-sqlite3`.
- **Do not trust `electron-builder install-app-deps`** — observed reporting
  success without rebuilding. `electron-rebuild -f` is the reliable one.

A database error mentioning `NODE_MODULE_VERSION` on startup is always this.

---

## What to do next, in order

### 1. Wire the recovery-code redemption path — highest value
An admin can generate a single-use recovery code (Settings → Staff & Admins) and
the dashboard prompts them to. **There is nowhere on the login screen to type
it.** Until that exists the feature does not do the thing it was built for: a
sole admin who forgets their password still cannot get in.

Everything behind it is done and tested — `auth:recover-with-code`,
`api.recoverWithCode`, 16 unit tests, 29 E2E checks. What is missing is UI in
`src/renderer/src/App.jsx`:

- a "Forgot your password?" affordance on the admin login, shown only when
  `await api.hasRecoveryCode()` returns `{ exists: true }` (callable with no session)
- a form calling `api.recoverWithCode({ code, adminName, newPassword })`
- **the admin name must be a picker, not a text field.** The handler
  deliberately cannot say "no such admin" (that would make it an account-name
  oracle), so a typo is indistinguishable from a wrong code. Populate it from
  `api.listLoginRoster().admins`.
- on success the user is **not** signed in — send them to the normal login with
  a "Password reset — sign in with your new password" message.

### 2. Two loose ends from the code review
- Pricing screen: "Check the week" renders 21 blank cells for a **retired**
  product instead of saying why (`sales:quote` refuses an inactive product and
  the error is swallowed).
- Pricing screen: the live preview can warn a new rule will be "replaced" when
  saving will actually **overwrite** the rule it is comparing against — the
  draft is given `id: -1` and loses `winningRule`'s id tiebreak.

### 3. Things only a human can do
Never done, cannot be automated: **thermal printer** on real hardware (the
receipt-timestamp fix has never met one), **camera capture**, one real
**WhatsApp send**, behaviour across **local midnight**, a **two-staff** till
day, and a full **backup → restore drill** on a copy of real data.

### 4. From the owner's session, not yet built
`docs/ROADMAP.md` has the full plan. Not started: booking **deposit entry is
done** but a calendar-driven booking edit flow could be better; general
fit-and-finish for non-technical users (larger touch targets, fewer choices on
screen at once).

---

## Invariants — do not break these

They are not style preferences. Each exists because breaking it already cost
real money or real data once.

1. **Money and identity are derived in main, never accepted from the renderer.**
   A cart sends `{kind, refId, tier, quantity}`. It must never send a price, an
   amount or a `staffId`, and handlers must never read one if sent.
2. **Multi-write operations run in one `db.transaction()`.** A failure leaves
   nothing behind — no orphan member, no stock movement without its sale.
3. **`transactions.amount` stays the sale total.** Every report, the End-of-Day
   breakdown and the WhatsApp message read it.
4. **Reporting derives the breakdown from `transaction_lines` and cash/QR from
   `transaction_payments`**, not from the header columns. Reading the header
   booked add-ons as entry revenue and reported a split payment as all cash.
   Rows with no lines (refunds, pre-sale-model rows) fall back to the header,
   keyed on **lines** — keying on payments makes an on-account sale count as cash.
5. **All timestamps are local** (`datetime('now','localtime')`). The business
   closes at midnight in Kathmandu, not UTC. This has bitten the app *and* its
   own test scripts.
6. **No silent no-ops.** Every early return in a click path either shows a
   message or corresponds to a visibly disabled control.
7. **Anything both processes need lives in `src/shared/`.** Parallel copies
   drift — that is how End of Day and the WhatsApp report came to disagree about
   the same day, and how the pricing screen kept saying "Day Pass" after the
   rename.
8. **Never hard-delete** anything referenced by historical sales. Retire it.

---

## How this codebase has been worked on

Worth continuing, because it caught real bugs:

- **Two test layers, and the E2E one is not optional.** Both P0s ever found here
  lived in the renderer→main payload, where every handler test passed while the
  app was unusable. Unit-green does not mean working.
- **Watch a new test fail before trusting it.** A spec written after the fix may
  be asserting something already true. When a fix landed first, the fix was
  temporarily reverted to confirm the test went red.
- **Verify claims rather than relaying them.** Every round of parallel agent work
  produced at least one report that did not survive checking — a migration that
  crashed on upgrading databases, a "dead" function that was still called, a
  reporting layer left reading the wrong columns.
- **Parallel agents need strictly disjoint file ownership**, and `preload/index.js`
  plus `lib/api.js` pre-wired for them, or they collide there. They must not run
  `npm test`, `npm run build` or `electron-rebuild` concurrently — those race on
  `out/` and flip the native ABI under each other.

---

## Documentation map

| File | Contents |
|---|---|
| [ABOUT.md](../ABOUT.md) | Project history, every bug found and fixed, and **the decisions taken with their reasoning** — read section 4 and 6 before reversing anything |
| [README.md](../README.md) | Features, architecture, how to run and test |
| [docs/ROADMAP.md](ROADMAP.md) | The plan built from the owner's hands-on session |
| [docs/qa/QA_REPORT.md](qa/QA_REPORT.md) | The 55-bug sweep, with root cause and `file:line` |
| [docs/qa/MONEY_AUDIT.md](qa/MONEY_AUDIT.md) | Adversarial audit of every cash and stock path |
| [docs/qa/SHIP_READINESS.md](qa/SHIP_READINESS.md) | Test plan, fix status, and the manual matrix |

---

## Credentials on this machine

Dev database only: admin **`Demo` / `refresh2024`**, staff PIN **`4821`**. These
were set by hand during testing because the app had no password reset at the
time. **Change them before the venue uses this.**
