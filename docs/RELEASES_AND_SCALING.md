# Release history, versioning, and scaling this software

Three related questions, answered together because they inform each other: what has
actually been shipped so far, how to keep shipping updates to it without breaking a
live install, and what would actually need to change if this software had to serve
more than one till, one venue, or one customer.

Written 2026-08-22. Nothing here required a code change to write — it's a reading of
the repo's actual history, the build artifacts sitting in `dist-app/`, and the
update-safety code that already exists, plus a few concrete recommendations.

---

## 1. What has actually been shipped

**Short version: there is no reliable way to answer "what's running on the venue PC
right now" just by asking the app — `package.json`'s version has read `1.0.0` for
every build that has ever been produced, including ones that differ in real,
user-facing behaviour.** That's the most important finding in this section, and it's
fixed by the versioning discipline in §2, not by anything below.

### The two candidate Windows builds

`dist-app/` (not tracked in git — it's build output) currently holds two Windows zip
builds, both self-labelled `1.0.0`, built nine days apart from two different commits:

| | `Refresh-Manager-1.0.0-windows.zip` | `Refresh-Manager-Windows-Demo.zip` |
|---|---|---|
| Built from commit | `91dea2d` — *"security: deny popups and external navigation in the main window"* | `df11ae0` — *"fix: stop PIN modal and transaction screen blinking on every keystroke"* (the very next commit after the one on the left) |
| Built | 2026-07-13, 00:06 | 2026-08-06, 14:30 |
| SHA-256 | `4ccd8462018a95a51c4a9bc748b247d19f5a9778b92edad980c468ca990f6b70` (see `dist-app/SHA256SUMS.txt`) | `77d8e0c3b95319f83b043326a67a8a0cf31bd8ee0ca16391e530380d931a655a` (see `dist-app/Refresh-Manager-Windows-Demo.SHA256.txt`) |
| Behavioural difference | The PIN entry modal and the New Transaction screen visibly re-render on every keystroke. | That's fixed. Otherwise identical — no other commits sit between the two. |
| Also present | A matching `.exe` installer (`Refresh Manager-1.0.0-setup.exe`) built at the same commit | An unpacked `Refresh-Manager-Windows-Demo/` folder alongside the zip — a portable, no-installer copy |

**Which one is "the one that shipped" cannot be determined from the repo alone** — both
report themselves as `1.0.0`, and the app records no build identifier anywhere a user
or a support session could read it back (see §2). Two ways to actually find out, in
order of reliability:

1. **Hash the files on the machine that's actually running it.** On the Windows
   machine in question: `certutil -hashfile "<path to the installed .exe or zip>"
   SHA256`, or on the portable-zip folder, hash `resources/app.asar` inside it the
   same way and compare against a fresh hash of the same file from each of the two
   zips above. Whichever matches is the answer, with certainty.
2. **Read the audit log on that machine's live database.** Every schema migration
   that has ever applied writes an `app:migrated` row to `audit_log`
   (`fromSchema`/`toSchema`/`appVersion`, plus a timestamp). Cross-referencing those
   timestamps against `git log --date=format:'%Y-%m-%d %H:%M' -- src/main/db/migrations.js`
   narrows down which commit was running at each point in that machine's history —
   imprecise, but doesn't require physical access to hash a file.

If a guess is unavoidable: the `Windows-Demo` build is newer, fixes a real visible bug
the other one has, and is named the way something built for a specific
demo/handover moment tends to be named — it's the more likely candidate for
whatever was actually used, but "more likely" is doing real work in that sentence.
**Don't treat this table as settled fact — verify against the actual machine before
relying on it for anything that matters** (e.g., before assuming a bug is or isn't
present in production).

### Everything since either of those builds

Both candidate builds predate essentially all of the work described in `ABOUT.md`
(the P0–P3 money-path hardening, most of the July/August QA sweep) and all of the UX
work on `ux-punchlist-phase1` (see `docs/HANDOFF.md`). If either build is genuinely
running anywhere with real data in it, that database is many schema versions and
several real bug fixes behind current `main`, let alone this branch — plan the next
update accordingly (test the *actual* upgrade path from that old a database, not just
from a freshly-seeded one; `test/migration.test.js` should be extended to cover it if
it doesn't already).

---

## 2. Versioning, going forward

`package.json`'s `version` field has been `1.0.0` since the very first commit that set
it and has never been bumped — every build anyone has ever produced, across four
months of continuous work, self-identifies as the same version. That's the direct
cause of §1's ambiguity, and it will keep causing exactly that problem, worse, as more
updates ship. This is a discipline gap, not a code gap — the machinery to do this
properly already exists (`app_version`/`schema_version` are already stamped into
`settings` on every launch, per `stampVersion` in `src/main/db/index.js`), it's just
never been fed a real version number.

**Recommended, before the next build that's meant to go anywhere real:**

- **Bump `package.json`'s `version` for every build that leaves this machine**, even
  a small one. Semver is fine (`1.1.0` for the UX punch-list work, `1.1.1` for a
  follow-up fix, etc.) — the exact scheme matters less than that it changes every time.
- **Tag the commit that was actually built**, in git (`git tag v1.1.0 <commit>`,
  pushed with `git push --tags`). That's the one fact that lets anyone reconstruct
  "what code produced this artifact" with certainty later, the way §1 couldn't.
- **Keep a one-line-per-release CHANGELOG** (a new `CHANGELOG.md`, or a "Release
  history" section appended to this file — either works, just pick one and keep
  using it). Doesn't need to be prose; a date, a version, and what changed is enough.
  It's the difference between this section existing once, written in hindsight with
  real effort, and it writing itself for free from here on.
- **Surface the build identity somewhere a support session can read it back** — the
  simplest version: bake the short git commit hash and build date into the app at
  build time (electron-vite's `define` config can inject them as constants) and show
  them in the existing Settings screen or in whatever `diagnostics:get-info` already
  returns (`src/main/ipc/diagnostics.js`) alongside the log paths it returns today.
  That one change would have made all of §1 a non-question.

None of this needs to happen before anything else in this document — it's cheap,
low-risk, and purely additive. It's listed first because it's the thing that makes
every future version of this exact question ("what's actually running out there")
answerable in five seconds instead of by forensic archaeology.

---

## 3. Pushing an update to an existing install, without messing it up

**This is already well-documented and, more importantly, already largely
automatic** — see `DEPLOYMENT.md`'s "Upgrading to a new version" section for the full
mechanics: a pre-update snapshot is taken automatically before any migration touches a
populated database, a failed migration rolls itself back and refuses to leave the app
running against a half-migrated database, and an old version refuses to open a
database a newer version already touched (the downgrade guard). That machinery is
real, it's tested (`test/migration.test.js`, `test/update-safety.test.js`), and it
does not need to be rebuilt — read `DEPLOYMENT.md` before assuming any of the below is
missing.

**One correction to that document:** it says `npm run dev` / `npm start`
(`predev`/`prestart`) rebuild `better-sqlite3` for Electron's ABI automatically via
`electron-builder install-app-deps`. In practice that command has been observed
reporting success without actually rebuilding anything — confirmed empirically while
working on `ux-punchlist-phase1` (see `docs/HANDOFF.md`'s ABI section). The reliable
command is `electron-rebuild -f -w better-sqlite3`; `ux-punchlist-phase1` also added a
`posttest` script so `npm test` self-heals this automatically, but that fix isn't on
`main` yet as of this writing.

**What the built-in safety net does *not* cover** — worth being honest about, because
assuming it covers everything is exactly how someone gets burned by the 5% it
doesn't:

- **A migration that runs to completion but is wrong.** The snapshot/rollback system
  only fires when a migration *throws*. A migration that completes successfully but
  computes something incorrectly (a bad `UPDATE`, a wrong default, a subtly wrong
  `WHERE` clause) commits normally, gets no rollback, and the mistake is now the new
  ground truth. The only real defence here is what already exists upstream of
  deployment: `test/migration.test.js` run against a realistically populated fixture,
  and — for anything touching money or membership dates — a manual spot-check against
  a **copy** of the real database before the real one ever sees the new build. This
  is already called out in `DEPLOYMENT.md` and in `ABOUT.md`'s "Where things stand" —
  it bears repeating because it's the one step most likely to get skipped under time
  pressure, and it's the one step that actually catches this failure mode.
- **A business-logic bug with no schema change at all.** Most of the fixes on
  `ux-punchlist-phase1`, for instance, touch no migration — they're pure code
  changes. The snapshot/rollback system is schema-migration-specific; it does nothing
  for "the new build has a UI bug" or "a report now computes a wrong number." The only
  net for that class of problem is: test before shipping, and know how to get back to
  the previous `.exe`/zip if it ships anyway (see below).
- **Going backwards once the schema has moved forward.** The downgrade guard is a
  safety feature, not an undo button — it stops an old version from silently
  corrupting a newer database, but it also means **reinstalling the previous version
  is not a real rollback once a migration has actually run**. If a new release turns
  out to have a serious problem after real data has been written under the new
  schema, the only ways back are: restore the automatic pre-update snapshot from
  `pre-update-backups/` (works only up to the moment right before the migration that
  brought the new schema in — anything written to the live app *after* that point is
  lost by restoring it), or restore a proper backup taken before the update. This is
  exactly why the manual pre-update backup `DEPLOYMENT.md` already recommends isn't
  redundant with the automatic snapshot — it's insurance for a different failure mode
  the automatic one can't cover.

**A release checklist worth actually writing down and following**, since none of the
individual pieces above are new but nobody has assembled them into one ordered list
yet:

1. Bump the version, per §2.
2. Run the full test suite and the E2E harness against a **copy** of the most
   representative real (or realistically-seeded) database available — not just a
   freshly-seeded empty one. A migration that's fine against an empty schema can
   still fail or misbehave against a database with real history in it.
3. Take a manual, verified backup of the real production database, before the update
   ever reaches the real machine — belt and braces alongside the automatic snapshot,
   for the "schema moved forward and now I need to actually go back" scenario above.
4. Build, hash the artifact, tag the commit (§2), and record the release.
5. Ship it, launch it once, and actually look — recent transactions, members, and
   photos present; no error dialog on startup. `DEPLOYMENT.md`'s upgrade steps cover
   this.
6. If anything looks wrong: stop, don't keep using the app, and restore from whichever
   of the two backup mechanisms above still has the state you need.

---

## 4. Scaling this software

This section is deliberately conservative. Everything else in this codebase's history
(see `ABOUT.md` §4/§6 — "decisions taken, and why") has favoured building exactly what
the business needs now over speculative generality, and that's been the right call
each time it's been checked. The same instinct applies here: **the current
architecture is correctly sized for exactly what it's serving today** — one venue,
one till, one SQLite file, one PC. Nothing below is a recommendation to start
building any of it now. It's a map of what would actually have to change, and roughly
in what order, if and when the business's shape genuinely outgrows what's here — so
that if that day comes, it's a planned change instead of a scramble.

### What "scale" could mean here, and they're different problems

**More data, same one venue, same one till.** Already handled. SQLite comfortably
handles a small business's transaction volume for years; nothing here needs to change
for this reason alone. If it ever did become a real bottleneck, targeted indexes and
query tuning would go a very long way before any bigger change was justified — check
`EXPLAIN QUERY PLAN` on the slow query before reaching for anything more drastic.

**A second till at the same venue** (e.g. the restaurant gets its own dedicated
terminal instead of switching stations on one PC). This is the most likely real need,
and the current single-file-on-one-PC design is a genuine, structural blocker for
it — SQLite's WAL mode allows multiple *readers* but effectively one writer, and more
importantly the database file simply isn't reachable from a second physical machine
without something in between. Two realistic paths, in order of how much they disturb
what already exists:

- **Put the existing SQLite file on a shared, always-on machine** (a small always-on
  PC, or even a Raspberry Pi) **and have both tills' Electron apps talk to a thin
  local network service in front of it**, rather than opening the `.db` file
  directly. This preserves almost everything — the schema, the business logic in
  `src/main/ipc/*`, the migration system — and mostly relocates *where* that logic
  runs (from "in the same process as the till UI" to "in a small always-on service
  both tills call over the LAN"). It's a real architectural change, but a contained
  one: the renderer-to-main IPC boundary that already exists between this app's UI
  and its business logic is almost exactly the seam a network boundary would go in.
- **Move to a real client-server database** (Postgres, most likely) and rebuild the
  main-process data layer against it. More work, more moving parts to operate (a
  database server that needs its own backups, its own uptime), and only worth it if
  multiple-terminal, multiple-location, or genuinely concurrent multi-writer access
  is a firm requirement — not a "might be nice."

Either path is a multi-week project, not a sprint, and neither should start before
there's a second till actually waiting to be plugged in.

**Multiple locations for the same business.** Everything in "a second till" above
applies, plus real questions that are business decisions before they're technical
ones: does each location need to work fully offline and sync later, or is
always-online acceptable? Does the owner want one combined view across locations, or
are they run as independent businesses that happen to share software? Nepal's
connectivity reality (the app's own `ABOUT.md`/strategy notes already name grid and
network instability as a real operating condition) makes "assume always-online" a
risky default — an offline-first, sync-when-connected design is probably the right
shape if this comes up, which is a meaningfully bigger lift than either single-venue
path above and deserves its own design pass when it's actually needed, not a
paragraph here.

**Turning this into a product for other venues**, not just Refresh Recreation
Center's own software. This is the biggest jump of the four, and mostly not a
technical one at the start: single-tenant, single-venue software sold to multiple
independent customers doesn't need multi-tenancy in the database sense (one gym's
data has no reason to ever share infrastructure with another's) — the actual new
work is packaging and operational, not architectural: a real installer/update
channel per customer (see §3's build discipline, times N), a way to configure
per-venue branding/pricing/products without editing source, a support and onboarding
process, and probably code-signing the installer (already flagged in
`DEPLOYMENT.md` as needed "if the app is ever distributed more widely"). The
per-venue software itself could stay almost exactly what it is today for quite a
while into that path — the field that would eventually matter is the nullable
`organisation_id` groundwork already discussed in
`REFRESH_MANAGER_UX_PUNCHLIST.md` §10 for a different reason (corporate accounts
within one venue), which is a coincidentally useful seam if multi-venue licensing
ever becomes real, but isn't worth building for that reason alone today.

### The one thing worth doing regardless of which path (if any) gets taken

Whatever direction this goes, §2's versioning discipline and §3's release checklist
get more valuable, not less, the moment there's more than one machine running this
software — either more tills at one venue or more venues entirely. Right now, with
one PC, "what's running and is it safe to update" is a question about one machine.
The moment there are two, it's a question that needs an actual answer on file, not
reconstructed from hashes and audit-log timestamps the way §1 had to. Get the habit
started now, while it's still cheap.
