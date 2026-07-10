# Refresh Manager — Phase 2 Work Order: Verify, Audit, Harden, Extend

**Target repo:** `Sambhav255/refresh-manager` (Electron 39 · React 19 · better-sqlite3, offline-first, local SQLite/WAL)
**Prepared:** 2026-07-02
**Reads as a continuation of:** the original engineering work order (P0-1 … P3-2) and the implementing agent's follow-up (`Refresh_Manager_Work_Order_Followup.md`).
**Audience:** Claude Code (implementing agent).

---

## 0. READ THIS FIRST — the situation is not what the follow-up implies

A follow-up note claims the entire P0–P3 work order is complete on a branch `harden-money-path` (commit `e4cfcdf`), with 16 passing tests. **As of this writing, none of that is verifiable from the repository:**

- A fresh clone of `origin` shows only two branches: `main` (HEAD `8c54901`, "chore: clean up repo and fix UI bugs") and `prototype`. **`harden-money-path` is not pushed. Commit `e4cfcdf` does not exist on the remote.**
- `main` still contains every original vulnerability: `staff_id` is trusted from the renderer in `transactions:create`, `restaurant:checkout` performs **no** inventory movement, and there is **no** test script or Vitest config.

So the hardening either (a) lives only in a local, unpushed, unreviewed, single-squashed-commit working tree, or (b) does not exist. Either way, **for a system of record that holds a business's cash, unverified work must not be trusted.** Your first job is not to build new things — it is to establish ground truth.

**Operating principle for this entire work order: TRUST NOTHING, VERIFY EVERYTHING.** Treat the follow-up as a set of *claims to be independently confirmed against the actual code*, never as fact. Do not carry its conclusions into your analysis. Re-derive them.

---

## PHASE 0 — Establish ground truth & de-risk (do this before anything else)

### 0-A — Locate and preserve the work
1. Determine what actually exists. In the working environment, run:
   ```bash
   git fetch --all --prune
   git branch -a
   git log --oneline --all --graph -20
   git rev-parse --verify e4cfcdf 2>/dev/null && echo "commit exists" || echo "commit MISSING"
   ```
2. **If `harden-money-path` / `e4cfcdf` exists locally but is unpushed:** push it immediately (`git push -u origin harden-money-path`) so the work stops being a single point of failure, then open a Draft PR into `main`. Do this *before* touching any code.
3. **If it does not exist in your environment:** the work order was not actually delivered here. Stop and report that clearly. Do **not** silently re-implement from the follow-up's prose and claim parity — re-open the original work order and implement it properly with per-item commits (see 0-D).

### 0-B — Confirm the toolchain actually runs (the native-ABI trap is real)
`better-sqlite3` is a native addon. **Electron 39 → NODE_MODULE_VERSION 140; Node 22 → 127.** One compiled binary serves one runtime. Confirm both paths work and record the exact commands:
- App: `npm run postinstall` (rebuilds for Electron) → `npm run dev` launches without an ABI error.
- Tests: `npm rebuild better-sqlite3` (rebuilds for Node) → `npm test` runs.
- If switching between the two is required by hand, that is a footgun (see item 5-D, which makes it automatic). For now, just prove both states are reachable and note which one the tree is left in.

### 0-C — Independent verification matrix (produce `VERIFICATION.md`)
For **every** acceptance criterion in the original work order (P0-1 … P3-2), inspect the *actual diff* and record PASS / PARTIAL / FAIL / NOT-FOUND with the file+function and a one-line justification. Do not mark PASS from the follow-up's say-so — you must see the code and, where a test is claimed, see the test assert the behaviour. Pay special, skeptical attention to:

| Claim to scrutinise | What to actually confirm in code |
|---|---|
| P0-1 server-side `staff_id`/`amount` | `staffId` is **not** destructured from payload in `transactions.js`, `members.js`, `restaurant-menu.js`; amount is re-read from `products.price` / `restaurant_menu_items.price`. Grep for `payload.staffId` / `staffId` in those files — there should be none feeding the INSERT. |
| P0-2 checkout draw-down atomic | The sale INSERT and every inventory decrement are inside **one** `db.transaction(() => …)`. Force an overdraw in a multi-line cart and confirm the whole checkout rolls back (no transaction row, no partial stock change). |
| P0-3 safe restore | Sequence is: validate password → magic-byte check → `wal_checkpoint(TRUNCATE)` → `closeDatabase()` → delete live `-wal`/`-shm` → copy → `app.relaunch(); app.exit(0)`. Confirm `closeDatabase()` exists and is exported from `db/index.js`. |
| P0-4 negative stock | Guard throws *before* any write, inside the transaction. Confirm both pool sell and restaurant draw-down are covered, and `adjust` rejects negative targets. |
| P1-1 expiry | Startup run **and** cron; and the defence-in-depth `AND ms.end_date >= today` was added to the active-membership subqueries in `members:search` **and** `members:list-all`. |
| **P2-3 CHECK-constraint migration** | **This is the highest-risk change in the whole set — audit it hardest (see 1-B).** Confirm how `booking_deposit` was added to the `transactions.transaction_type` CHECK. If it was done with anything other than a transactional table-rebuild that preserves `id`s and runs `foreign_key_check`, treat it as FAIL. |
| P3-1 tests | Open the test files. Confirm each of the 16 tests asserts real behaviour (not `expect(true).toBe(true)`), and that the "migration preserves data/ids" test runs against a **populated** DB with child rows referencing `transactions`, not an empty one. |

### 0-D — Process hygiene (fix the governance smell)
- Ensure a real PR exists with a description enumerating what changed per item ID.
- The follow-up admits lint is `continue-on-error` and the tree carries pre-existing style findings. Establish a clean baseline: either fix `react/prop-types` + Prettier across the tree in one clearly-labelled commit, or add an explicit, reviewed eslint baseline — then set lint back to **blocking** in CI so new violations are caught.
- If the work landed as one squash commit, that's acceptable *now*, but going forward implement each item below as its own commit prefixed with the item ID.

**Phase 0 exit criteria:** the branch is pushed and PR-open; `VERIFICATION.md` exists with an honest per-criterion verdict; both ABI states are proven reachable; you know precisely what is real and what is not. Only then proceed.

---

## PHASE 1 — Independent safety audit (produce `SAFETY_AUDIT.md`)

Do a fresh, code-grounded safety review. This is a deliverable in its own right — a written report the owner's future engineers can rely on. Below are the areas that matter most for *this* app, with the specific things to check. Where you find a defect, fix it under Phase 2 and reference the item.

### 1-A — Data-loss surface (the thing that can end the business)
- **Restore integrity is under-checked.** The current restore (per follow-up) only verifies the 16-byte header `SQLite format 3\0`. A file can have a valid header and be corrupt. **Before clobbering the live DB, open the backup read-only in a throwaway connection and run `PRAGMA integrity_check` (or at minimum `quick_check`); abort the restore if it isn't `ok`.** Fix under **2-A**.
- **Backup integrity is never checked at creation.** A silently-corrupt live DB produces silently-corrupt backups; nobody finds out until a restore fails. Add an integrity probe on the live DB (periodic) and verify each freshly-written backup opens and passes `quick_check` before it counts as "success". Fix under **2-B**.
- **Backup coverage.** Confirm photos (`userData/photos/`) are part of the disaster-recovery story. A `.db`-only backup loses every member photo on a machine failure. Decide: include photos in the backup (zip the DB + photos folder) or explicitly document them as out of scope. Fix/spec under **2-B**.
- **Cron only fires while the app is running.** A reception PC is often off overnight, so a `5 0 * * *`-style expiry/backup cron may never fire. Confirm both the expiry job (P1-1) and the backup scheduler have a **catch-up-on-launch** path (the backup one already does via `shouldRunCatchupBackup`). Verify the expiry job mirrors it.

### 1-B — The `booking_deposit` migration (audit this like it can corrupt the ledger, because it can)
SQLite **cannot** `ALTER TABLE … DROP/ADD CONSTRAINT`. Adding `booking_deposit` to the `transactions.transaction_type` CHECK requires the official 12-step table rebuild. And `transactions` is referenced by foreign keys from `memberships.transaction_id`, `pool_inventory_transactions.transaction_id`, `restaurant_inventory_transactions.transaction_id`, and the new `bookings.deposit_transaction_id`. Get this wrong and you orphan references or lose the ledger.

Audit for **all** of the following; any miss = FAIL and must be fixed under **2-C**:
1. The rebuild runs inside a transaction and is **idempotent** (re-running the app must not rebuild again or fail).
2. `id`s are preserved exactly (explicit `INSERT INTO transactions_new (id, …) SELECT id, … FROM transactions`), so all FK references stay valid.
3. Foreign keys are toggled correctly: `PRAGMA foreign_keys=OFF` **outside** the transaction (it's a no-op inside one), rebuild inside a transaction, `PRAGMA foreign_key_check` after, then `PRAGMA foreign_keys=ON`.
4. The migration was **tested against a populated DB** containing memberships and inventory transactions that reference `transactions` rows — not an empty schema. Confirm `foreign_key_check` returns no rows post-migration.

**Strong recommendation (implement under 2-D):** the current `migrations.js` detects schema state with `PRAGMA table_info` column probes. That approach *cannot* express or detect CHECK-constraint changes and cannot safely order multi-step migrations. Replace it with **`PRAGMA user_version` sequential migrations** (skeleton in Appendix A). This is the correct foundation for a money app that will keep evolving.

### 1-C — Money-path integrity & audit trail
- Confirm the P0-1 fixes truly close the trust gap everywhere money is written, including any path the follow-up didn't enumerate (booking deposits, pool item sales, renewals).
- **Tamper-evidence / audit log.** Today there's `price_history` and `void_by/void_at` — good — but there is **no** audit record for: settings changes (including price-affecting ones and the WhatsApp number), staff deactivation, PIN changes, or **backup restores** (a restore silently rewrites the entire ledger behind one password). For a cash system, add a lightweight append-only `audit_log(id, actor_user_id, action, detail, created_at)` and write to it on: restore, settings change, staff add/deactivate/PIN-change, and void. Fix under **2-E**.
- **Void has no time limit and no reconciliation lock.** An owner can void a transaction from any past day, silently changing a day that was already reconciled and reported to them via EOD. Consider: block (or flag) voids against days that already have a `cash_reconciliations` row, and always write voids to the audit log. Spec under **2-E**.

### 1-D — Privacy / PII at rest (a real obligation, not a nice-to-have)
The DB stores member names, phone numbers, gender, notes, and photos in **plaintext**. Backups are plaintext `.db` copies configured to land on a USB stick or a Google-Drive-synced folder — i.e., **customer PII routinely leaves the premises unencrypted.** This is a genuine privacy exposure.
- Minimum: document the data-handling posture; restrict the backup folder; and consider writing backups as password-protected archives rather than bare `.db` files.
- Stronger: encryption at rest via `better-sqlite3-multiple-ciphers` (SQLCipher). Note the real cost — key management on an unattended kiosk is hard (a key stored next to the DB protects nothing), so this is an owner decision, not an automatic change. Present options in the audit; do not silently adopt SQLCipher. Spec under **2-F**.

### 1-E — Auth & session
- **PIN throttling is in-memory**, so an app restart clears the counter — brute-force protection is weak against someone with physical access. Acceptable for a kiosk threat model, but state it plainly in the audit. Consider persisting a lockout counter if the owner cares.
- **Idle-timeout activity detection.** Verify the idle timer in `App.jsx` resets on **mouse and touch** activity, not only `keydown`. Reception staff often work mouse-only; a keydown-only reset logs them out mid-task. If only `keydown` is wired, add `mousemove`/`click`/`touchstart` (throttled). Fix under **3-F**.
- Confirm the P1-4 duplicate-PIN guard exists and that two staff genuinely cannot collide (silent mis-attribution of sales).

### 1-F — Crash & corruption recovery
- Confirm the P2-2 handlers exist: `process.on('uncaughtException')` and `unhandledRejection` surface a dialog, and `isDatabaseHealthy()` (`quick_check`) is probed on focus. Verify a deleted/again-present DB file produces a clear dialog, not a frozen window.
- Confirm the IPC `wrap()` helpers convert DB-level failures into structured `{success:false,error}` rather than throwing raw errors to the renderer.

### 1-G — Electron hardening
- Confirm `contextIsolation` is on (default) and `nodeIntegration` is off in **every** `BrowserWindow` (main window, ticket window, membership-card window). The ticket window uses `sandbox:true` — good; confirm the main window's `sandbox:false` is actually required by the preload and note why.
- Confirm the P1-6 CSP is present in `index.html`, `ticket.html`, `membership-card.html` and that it's strict (no remote `script-src`; `img-src` allows `data:`/`file:` for photos).
- `shell.openExternal` is used for `wa.me` links built from a settings-stored owner number and DB phone numbers. Confirm numbers are sanitised to digits (they are, via `replace(/\D/g,'')`) so no arbitrary scheme/URL can be injected via a crafted phone field.

**Phase 1 exit criteria:** `SAFETY_AUDIT.md` exists, each area above has an explicit finding (OK / risk / defect), and every defect is ticketed into a Phase 2 item.

---

## PHASE 2 — Harden (fix what the audit finds; these are the known ones)

> Each item: **Problem → Solution → Acceptance.** Implement as its own commit `2-X: …`.

### 2-A — Restore must run `integrity_check` on the backup before clobbering live data
**Problem.** Restore only checks magic bytes; a header-valid but corrupt backup would overwrite good data with garbage.
**Solution.** Before `closeDatabase()`, open the chosen backup file in a **separate read-only** better-sqlite3 connection, run `PRAGMA integrity_check`, and abort with a clear error unless the single result row is `ok`. Only then proceed with the close/replace/relaunch sequence. Close the probe connection before touching files. (Snippet in Appendix B.)
**Acceptance.** Restoring a deliberately-corrupted-but-header-valid file is rejected and the live DB is untouched; a good backup restores and relaunches as before.

### 2-B — Backup creation verifies the output, and DR covers photos
**Problem.** No integrity verification at backup time; photos may be excluded from DR.
**Solution.** After writing a backup file, open it read-only and run `quick_check`; only mark `last_backup_status='success'` if it passes (otherwise `failed` + surfaced error). Decide and implement photo coverage: either (a) also copy `userData/photos/` alongside the `.db` (recommended — a timestamped folder or a zip), or (b) explicitly document photos as out-of-DR in `DEPLOYMENT.md`. Add a periodic `integrity_check` on the live DB (e.g., daily, right before the scheduled backup) that logs/surfaces failure.
**Acceptance.** A corrupt backup never reports success; restoring a backup taken today brings back both data and member photos (if coverage chosen); a corrupt live DB is flagged before it silently propagates into backups.

### 2-C — Make the `booking_deposit` CHECK migration provably safe (if not already)
**Problem.** Highest-risk migration; must be transactional, idempotent, id-preserving, FK-clean.
**Solution.** If 1-B found any gap, reimplement via the standard rebuild recipe (Appendix A shows it inside the `user_version` framework): `foreign_keys=OFF` → `BEGIN` → create `transactions_new` with the extended CHECK → `INSERT … SELECT` preserving ids → drop old → rename → `foreign_key_check` → `COMMIT` → `foreign_keys=ON`. Guard by version so it runs once.
**Acceptance.** Running migrations twice is a no-op; after migration on a populated DB, `PRAGMA foreign_key_check` returns nothing and all `memberships.transaction_id` / inventory `transaction_id` references still resolve; a `booking_deposit` transaction can be inserted.

### 2-D — Adopt `PRAGMA user_version` migration versioning
**Problem.** Column-probe migrations can't handle CHECK changes or ordering; fragile as the schema grows.
**Solution.** Introduce a migration runner keyed on `PRAGMA user_version` with an ordered list of numbered steps, each wrapped in a transaction, each bumping the version. Backfill the existing additive migrations as step 1 (guarded so existing production DBs converge correctly — a DB that already has `reminder_sent_at`, `cash_reconciliations`, etc. must land on the right version without re-running destructively). Skeleton in Appendix A.
**Acceptance.** A fresh DB and an existing v1.0.0 production DB both migrate to the same final `user_version` with identical schema; migrations are idempotent and ordered; adding a future migration is a one-line append.

### 2-E — Audit log + reconciliation-aware voids
**Problem.** No tamper-evident record of restores, settings/staff/PIN changes, or voids; voids can silently alter already-reconciled days.
**Solution.** Add an append-only `audit_log(id, actor_user_id, action, detail JSON/text, created_at)` (via a `user_version` migration). Write to it from: `backup:restore`, `settings:set`, `auth:add-staff`/`deactivate`/`change-pin`, and `transactions:void`. For voids, if the transaction's date already has a `cash_reconciliations` row, require an explicit owner confirmation flag and record that the void hit a reconciled day. Surface the audit log read-only in owner settings.
**Acceptance.** Every listed action produces an audit row with the acting user and timestamp; voiding a reconciled day is logged and flagged; the owner can view the log.

### 2-F — PII / backup privacy (spec + minimum viable change)
**Problem.** Plaintext PII leaves the building in plaintext backups.
**Solution (staged).** (1) Document the posture in `DEPLOYMENT.md` and add a one-time consent/notice line for members if the owner wants it. (2) Change backups from bare `.db` to password-protected archives (owner-set passphrase in Settings; used to zip on backup and unzip on restore). (3) Present—but do not auto-adopt—`better-sqlite3-multiple-ciphers` for at-rest encryption, with an honest note on kiosk key-management limits. Get an owner decision before (3).
**Acceptance.** Backups no longer land as plaintext `.db` on removable/synced storage without at least archive-level protection; the trade-offs are documented for the owner.

### 2-G — Membership pause/freeze × expiry-job interaction (latent bug)
**Problem.** The schema has `status='paused'` and `pause_start/pause_end/pause_reason`, but there's no pause/resume logic — and the new P1-1 expiry job may mishandle paused memberships (e.g., expire them, or not extend `end_date` by the paused duration). A paused membership must not be auto-expired and, on resume, its `end_date` should be pushed out by the pause length.
**Solution.** Ensure the expiry job excludes `status='paused'`. Then implement pause/resume properly under Phase 3 (item 3-B). At minimum in Phase 2, make the expiry job pause-aware so it can't corrupt frozen memberships.
**Acceptance.** A paused membership is never flipped to `expired` by the job; resuming extends `end_date` correctly (validated once 3-B lands).

### 2-H — EOD/report reconciliation must include the new transaction types
**Problem.** P1-3 made the EOD total reconcile with its line items. But P2-3 introduced `booking_deposit`, and pool-item sales use `pool_inventory`. If the EOD/report breakdowns hardcode membership/package/pass/restaurant lines, totals won't reconcile once deposits or item sales exist.
**Solution.** Build EOD and report breakdowns by iterating over the *actual* `transaction_type`/`source` groups present, so any type (including `booking_deposit`, `pool_inventory`) appears as its own line and the lines always sum to the printed total. Give each type a friendly label.
**Acceptance.** On a day containing a membership, a restaurant sale, a pool-item sale, and a booking deposit, the EOD WhatsApp message's line items sum exactly to the total, and every report's summary does likewise.

---

## PHASE 3 — Functionality: close product gaps that the business actually needs

> These map directly to the owner's stated goals (see the project brief and the Session-1 KPI framework: footfall, retention, utilisation). Prioritised by business value.

### 3-A — Attendance / check-in logging (unlocks the Footfall & Utilisation KPIs)
**Problem.** The owner's KPI framework explicitly tracks **Daily Average Footfall** and **Pool Capacity Utilisation**, but the app records *sales*, not *visits*. "Search member → confirm active → let them in" logs nothing, so footfall and "who hasn't visited in 30 days" (churn signal) are impossible.
**Solution.** Add a `check_ins(id, member_id, checked_in_at, staff_id, source)` table. Put a one-tap **Check in** button on the staff member-search result and on the day-pass sale success screen. Add a live "in the building today" count and a daily footfall figure to the owner dashboard, and a footfall series to reports. This is high-leverage and low-risk (append-only).
**Acceptance.** Checking in a member writes a row; the dashboard shows today's footfall; reports can show footfall over a range; a "not seen in N days" list is derivable for retention outreach.

### 3-B — Membership pause/freeze/resume (schema already anticipates it)
**Problem.** Gyms routinely need to freeze memberships (travel, injury). The columns exist; the behaviour doesn't.
**Solution.** Add `members:pause-membership` (sets `status='paused'`, records `pause_start`, reason) and `members:resume-membership` (sets `status='active'`, sets `pause_end`, and extends `end_date` by the paused duration). Wire into owner member management. Ensure the expiry job (2-G) ignores paused rows.
**Acceptance.** A membership can be paused and resumed; the frozen days are added back to `end_date`; paused members are excluded from "active" access checks and from expiry.

### 3-C — Refunds / returns (not just whole-transaction void)
**Problem.** The only correction is voiding an entire transaction. There's no partial refund and no way to reverse a restaurant order's inventory after checkout.
**Solution.** Add a refund flow that creates a linked negative/`refund` transaction (owner-gated, audit-logged) and, where inventory moved, restores stock atomically. Decide policy with the owner (full vs partial). Keep voids for same-shift mistakes; use refunds for after-the-fact corrections so the ledger stays append-only and auditable.
**Acceptance.** A refund reverses money and stock atomically, is attributed and audit-logged, and reports/EOD net it correctly.

### 3-D — Thermal-printer support for tickets (deployment-critical for Nepal reception)
**Problem.** Tickets print via a hidden `BrowserWindow` → `webContents.print()`. Reception desks in Nepal commonly use 58 mm / 80 mm thermal receipt printers. The current `ticket.html` layout and print options may not suit that, and a bad print flow stalls the queue.
**Solution.** Add a Settings option for receipt width (58 mm / 80 mm / A4) and silent-print-to-default-printer; make `ticket.html` responsive to the chosen width; test `webContents.print({ silent, margins, pageSize })` against a real thermal printer. Provide a graceful fallback (the amber "no printer" alert already exists — keep it).
**Acceptance.** A ticket prints cleanly on an 80 mm thermal printer without a dialog, and the layout isn't clipped; A4 still works; no printer still shows the friendly alert.

### 3-E — Reminder delivery log & re-send (make P1-5 trustworthy)
**Problem.** `reminder_sent_at` only means "we opened a wa.me link," not "delivered," and there's no history of outreach.
**Solution.** Record reminder attempts in the audit log (or a `reminder_log`), let the owner see who was contacted when, and allow an explicit re-send (clear/override `reminder_sent_at`). Keep the guided one-at-a-time flow from P1-5.
**Acceptance.** The owner can see reminder history per member and re-send deliberately; nothing is marked "sent" without the owner proceeding.

### 3-F — Idle-timer activity + small session polish
**Problem.** (From 1-E) idle reset may be keyboard-only.
**Solution.** Reset the idle timer on `mousemove`/`click`/`touchstart` (throttled) as well as `keydown`. Confirm `Esc` still logs out and that reload still clears the main-process session.
**Acceptance.** Mouse-only reception work does not trigger surprise logouts; idle timeout still fires after true inactivity.

---

## PHASE 4 — Reporting, analytics & indexing polish

### 4-A — Real weeks or honest labels, plus period-over-period
**Problem.** Monthly "by week" buckets by day-of-month (1–7, 8–14 …). The follow-up relabelled it honestly — verify that. Owners also want "this month vs last month."
**Solution.** Keep the honest label *or* compute real ISO weeks (`strftime('%W')`). Add a previous-period comparison to the monthly report (revenue, new members, footfall) so trends are visible. Feeds the owner's KPI dashboard habit.
**Acceptance.** Weekly grouping is either truly ISO or clearly labelled; monthly report shows delta vs the prior period.

### 4-B — Retention as a cohort, not just a ratio
**Problem.** Retention is a single monthly ratio; churn depends on the (previously broken) status field.
**Solution.** With P1-1 expiry correct and 3-A check-ins available, report retention as cohorts (joined in month M, still active after 1/2/3 months) and a churn-risk list (active but no check-in in N days). This is the analytics the growth role actually needs.
**Acceptance.** Owner can see cohort retention and a concrete churn-risk outreach list.

### 4-C — Add the missing indexes
**Problem.** No secondary indexes exist. Fine at current volume, but report queries scan.
**Solution.** Add indexes for the hot paths: `transactions(created_at)`, `transactions(member_id)`, `transactions(staff_id)`, `transactions(product_id)`, `memberships(member_id)`, `memberships(status,end_date)`, `check_ins(member_id, checked_in_at)`. Add via a `user_version` migration; recreate them in the transactions table rebuild (2-C) if applicable.
**Acceptance.** Indexes exist; report queries use them (`EXPLAIN QUERY PLAN` shows index use); no behaviour change.

---

## PHASE 5 — Test-suite expansion, CI, and the ABI footgun

### 5-A — Grow tests toward the pure, high-value logic
Add tests for: report builders (each of the 7 types produces the expected sheet set — kills the "summary-only export" regression class), EOD reconciliation math (lines sum to total across all types, item 2-H), membership expiry at the midnight/timezone boundary, pause/resume `end_date` extension (3-B), refund reversal (3-C), booking-deposit sync idempotency across create→change→zero→cancel (P2-3), and restore integrity rejection (2-A).
**Acceptance.** `npm test` covers each Phase-2/3 behaviour with at least one assertion that would fail if the behaviour regressed.

### 5-B — Migration tests against realistic fixtures
Ship a **populated** fixture DB (or a builder that seeds one with memberships and inventory transactions referencing `transactions`) and assert: forward migration from the v1.0.0 schema converges to the current `user_version`, `foreign_key_check` is clean, ids are preserved, and re-running is a no-op.
**Acceptance.** Upgrading a realistic production-shaped DB is proven safe in CI.

### 5-C — CI hardening
Run lint (blocking, per 0-D) + tests on push/PR. Ensure CI rebuilds `better-sqlite3` for Node before `npm test`. Add a build smoke step (`npm run build`) so packaging breakage is caught.
**Acceptance.** CI is green, lint is blocking, and a broken build fails CI.

### 5-D — Kill the ABI footgun for humans
**Problem.** Switching between "app runnable" and "tests runnable" by hand is a trap that will bite the owner's future dev.
**Solution.** Add npm lifecycle scripts so it's automatic: a `pretest` that rebuilds `better-sqlite3` for Node, and a `predev`/`prestart` that runs `electron-builder install-app-deps` (rebuild for Electron). Accept the rebuild latency, or detect the current ABI and skip if already correct. Document the one-liner in the README regardless.
**Acceptance.** A fresh clone can run `npm test` and then `npm run dev` (or vice versa) without a manual rebuild step or a confusing ABI error.

---

## PHASE 6 — Deployment & operations

### 6-A — Upgrade path that never loses data
Confirm that installing a new build preserves the existing `userData/refresh.db` and photos, and that migrations run cleanly on the real production DB on first launch of the new version. Document the exact upgrade steps in `DEPLOYMENT.md`.
**Acceptance.** A simulated in-place upgrade over a populated DB keeps all data and lands on the new schema version.

### 6-B — Windows signing / SmartScreen note
An unsigned `.exe` triggers SmartScreen warnings on the reception PC. For a single known machine this is acceptable; document how to proceed past it, and note code-signing as a future option if distribution widens.

### 6-C — Restore drill + backup monitoring
Document a **quarterly restore drill** (restore a backup onto a spare machine and confirm data). Add a dashboard indicator for "last successful backup age" and "unreconciled days," so the owner is nudged before problems compound.
**Acceptance.** `DEPLOYMENT.md` has a restore-drill checklist; the dashboard surfaces stale-backup and unreconciled-day warnings.

---

## Suggested execution order (dependency-aware)

1. **Phase 0** in full (ground truth, push, verify, ABI, process). Non-negotiable first.
2. **Phase 1** audit (write `SAFETY_AUDIT.md`) — cheap, informs everything.
3. **2-D** (`user_version` migrations) → then **2-C** (CHECK rebuild on that foundation) → **2-A/2-B** (restore/backup integrity) → **2-E** (audit log) → **2-G/2-H** (pause-aware expiry, reconciliation completeness) → **2-F** (PII, owner decision).
4. **3-A** (check-ins) and **3-B** (pause/resume) — highest business value; then **3-D** (thermal print, deployment-critical), **3-C**, **3-E**, **3-F**.
5. **Phase 4** analytics/indexes.
6. **Phase 5** tests/CI/ABI — land tests *with* each fix where practical, not only at the end.
7. **Phase 6** ops docs.

## What NOT to change (unchanged from the original mandate)
- The IPC + raw parameterised SQL + better-sqlite3 architecture. No ORM, no network dependency, no state-management library. Offline-first is a hard requirement.
- WAL mode, backup pruning (`MAX_BACKUPS = 30`), single-instance lock, `clearSession()`-on-reload, and the `requireOwner`/`requireStaffOrOwner` role gates — extend, never replace.
- Don't "improve" the money path by trusting the renderer again. Identity and price are always established in the main process.

---

## Appendix A — `PRAGMA user_version` migration skeleton (incl. safe CHECK rebuild)

```js
// db/migrations.js — versioned, ordered, each step transactional & idempotent.
const MIGRATIONS = [
  // v1: baseline additive columns/tables (backfill of the current ad-hoc migrations)
  (db) => {
    // add columns only if missing, create side tables, seed settings — as today
  },
  // v2: extend transactions.transaction_type CHECK to include 'booking_deposit'
  (db) => {
    // NOTE: foreign_keys must be OFF and this must run OUTSIDE an open txn wrapper
    // for the pragma to take effect; the runner handles that (see below).
    db.exec(`
      CREATE TABLE transactions_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transaction_type TEXT NOT NULL CHECK(transaction_type IN
          ('membership','day_package','day_pass','pool_inventory','restaurant','booking_deposit')),
        source TEXT NOT NULL DEFAULT 'pool' CHECK(source IN ('pool','restaurant')),
        customer_name TEXT NOT NULL, phone TEXT,
        product_id INTEGER REFERENCES products(id),
        member_id INTEGER REFERENCES members(id),
        amount REAL NOT NULL,
        payment_method TEXT NOT NULL CHECK(payment_method IN ('cash','qr')),
        staff_id INTEGER NOT NULL REFERENCES users(id),
        notes TEXT, is_voided INTEGER DEFAULT 0, void_reason TEXT,
        void_by INTEGER REFERENCES users(id), void_at TEXT,
        created_at TEXT DEFAULT (datetime('now','localtime'))
      );
      INSERT INTO transactions_new
        (id, transaction_type, source, customer_name, phone, product_id, member_id,
         amount, payment_method, staff_id, notes, is_voided, void_reason, void_by, void_at, created_at)
      SELECT
         id, transaction_type, source, customer_name, phone, product_id, member_id,
         amount, payment_method, staff_id, notes, is_voided, void_reason, void_by, void_at, created_at
      FROM transactions;
      DROP TABLE transactions;
      ALTER TABLE transactions_new RENAME TO transactions;
    `)
  },
  // v3: add indexes; v4: audit_log; v5: check_ins; ... append-only.
]

export function runMigrations(db) {
  let version = db.pragma('user_version', { simple: true })
  for (let i = version; i < MIGRATIONS.length; i++) {
    const needsFkOff = true // set per-migration if it rebuilds a referenced table
    if (needsFkOff) db.pragma('foreign_keys = OFF')
    const step = db.transaction(() => {
      MIGRATIONS[i](db)
      db.pragma(`user_version = ${i + 1}`)
    })
    step()
    if (needsFkOff) {
      const problems = db.pragma('foreign_key_check')
      if (problems.length) throw new Error('Migration FK check failed: ' + JSON.stringify(problems))
      db.pragma('foreign_keys = ON')
    }
  }
}
```
(Adapt the FK-toggle handling to your runner; the key invariants are: outside-txn pragma, id-preserving copy, post-rebuild `foreign_key_check`, monotonic `user_version`.)

## Appendix B — Restore integrity probe (before clobbering live data)

```js
import Database from 'better-sqlite3'
function assertBackupHealthy(backupPath) {
  const probe = new Database(backupPath, { readonly: true, fileMustExist: true })
  try {
    const rows = probe.pragma('integrity_check') // [{ integrity_check: 'ok' }]
    const ok = rows.length === 1 && rows[0].integrity_check === 'ok'
    if (!ok) throw new Error('Backup failed integrity check — restore aborted')
  } finally {
    probe.close()
  }
}
// call assertBackupHealthy(path) AFTER the magic-byte check and BEFORE closeDatabase()+copy.
```

## Appendix C — Verification matrix template (`VERIFICATION.md`)

```
| ID   | Acceptance criterion (verbatim)                 | Verdict | Evidence (file:func / test name)        |
|------|-------------------------------------------------|---------|------------------------------------------|
| P0-1 | staff sale records session staff, tampered price ignored | PASS/PARTIAL/FAIL/NOT-FOUND | ... |
| P0-2 | overdraw rolls back whole checkout              | ...     | test: 'restaurant checkout rolls back'   |
| ...  | ...                                             | ...     | ...                                      |
```

---

### One-line summary for the PR/hand-off
Phase 2 first *proves* the money-path hardening is real (it's currently unpushed and unverifiable), then closes the safety gaps the first pass under-addressed — restore/backup integrity, the high-risk CHECK-constraint migration, an audit trail, and PII-in-backups — and adds the business-critical functionality the owner's own KPIs demand (attendance/footfall, membership freeze), with a real test suite and a fixed native-ABI workflow behind it.
