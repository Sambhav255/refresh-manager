# Pre-Deployment Setup Guide

Do this on the reception PC after installing the .exe.

## First launch

1. Run Refresh Manager from the desktop shortcut
2. Setup wizard appears
3. Enter admin name and a strong password (write it down and keep it safe)
4. Enter first staff member name and a 4-digit PIN
5. Click Complete setup — admin dashboard opens

## Configure before first real transaction

### Settings → Pricing Manager

Set real prices for every product. All are seeded at Rs. 0. Go through each:

- Pool Day Pass
- Gym Day Pass
- All day packages (Sauna+Steam+Jacuzzi, Swimming+Sauna+Steam, Whole Package)
- All membership tiers

### Settings → WhatsApp number

Enter the admin's WhatsApp number in international format: 9779801010422
(977 = Nepal country code, no + or spaces)

### Settings → Backup settings

Set a backup folder — recommended: a USB drive or a folder that syncs to Google Drive.
Enable auto-backup (daily).

### Settings → Business info

Confirm name, address, phone are correct (pre-filled from seed data).

### Settings → Staff & Admins

Add a PIN for each reception staff member who will use the app. You can also add
more admin accounts here (each with their own name + password), change your own
admin password, and deactivate accounts. The app always keeps at least one
active admin, and any active admin's password authorizes backup restores.

### Pool Inventory

- Add current stock counts for all items (Restock each item to current real quantity)
- Set selling prices for items you sell (goggles, caps, etc.)
- Add any items not in the seeded list

### Restaurant Inventory

- Add real menu items (Momo, Tea, Coffee, etc.) with current stock and prices

## Day 1 operations walkthrough (train staff on this)

Staff logs in with 4-digit PIN.

Walk-in customer: New Transaction → pick type → pick product → customer name (can leave blank) → Cash or QR → Confirm & Save → Print Ticket.

Member signs up: New Transaction → Membership → fill name + phone → Confirm & Save → member now searchable.

Customer arrives: Search Member → confirm Active status → let in.

End of shift: End of Day tab → review totals → Cash reconciliation → Send to admin via WhatsApp.

Restaurant order: Restaurant POS tile → add items → checkout.

---

# New in the hardening release (configure these)

### Backup encryption passphrase (protects customer data)

Settings → Backup settings → **Backup encryption passphrase**. Set a passphrase you
will not forget. With it set, every backup becomes a single encrypted `.rmbak`
file that **bundles the database and all member photos** (AES-256). Without a
passphrase, backups are a plain `.db` file with no photos and no protection — fine
for testing, not for a USB stick or a Google-Drive-synced folder that leaves the
premises.

> **Write the passphrase down and store it separately from the backups.** It is
> required to restore, and it is not recoverable — a lost passphrase means the
> encrypted backups cannot be opened. It is never displayed or exported by the app.

### Receipt / ticket size

Settings → Business info → **Receipt / ticket size**: choose 80mm, 58mm, or A4 to
match your printer, then print a test ticket. Thermal widths are printer-dependent
— verify the layout isn't clipped and there's no runaway blank feed; if a roll
printer feeds blank paper after the receipt, that is tunable in `tickets.js`.

### Attendance / check-ins

Staff can tap **Check in** on a member search result. The admin dashboard shows
**Footfall today**; reports expose footfall over time and a "not seen in N days"
churn-risk list for renewal outreach.

---

# Operations & maintenance

## Building a release on the Mac and moving it to the Windows PC

The Windows installer is cross-built on the Mac — no Windows machine needed to build.

```bash
cd refresh-manager
npm test                 # every test must pass
npm run build:win        # produces dist-app/Refresh Manager-<version>-setup.exe
cd dist-app
zip -j "Refresh-Manager-<version>-windows.zip" "Refresh Manager-<version>-setup.exe"
shasum -a 256 "Refresh Manager-<version>-setup.exe" > SHA256SUMS.txt
```

- **Do not use Finder's "Compress"** — it adds `__MACOSX` junk. Use the `zip -j` command above.
- Transfer the zip by USB drive or Google Drive (Gmail blocks zips containing an .exe).
- On the Windows PC, verify the copy wasn't corrupted:
  `certutil -hashfile "Refresh Manager-<version>-setup.exe" SHA256` and compare with SHA256SUMS.txt.
- Windows SmartScreen will warn because the app is unsigned: **More info → Run anyway**.
- Install over the previous version; data is preserved (see "Upgrading" below).

## Upgrading to a new version (never lose data)

The database and photos live in the Windows user-data folder
(`%APPDATA%/refresh-manager/`), **not** inside the app install folder, so
installing a new `.exe` over the old one keeps all data.

On first launch of a new version, schema migrations run automatically and are
**versioned (`PRAGMA user_version`), ordered, transactional, and idempotent** — a
failed migration rolls back and the old data is untouched. The migration test
suite proves a populated v1.0.0-shaped database upgrades to the current schema
with foreign-key integrity intact.

### Built-in update safety (automatic)

Every launch that has migrations to apply is protected without any manual step:

1. **Pre-update snapshot.** Before *any* migration runs on a database that already
   has data, the app copies the whole DB to
   `%APPDATA%/refresh-manager/pre-update-backups/` (the last 5 are kept). This is a
   same-instant rollback point that does not depend on the configured off-site backup.
2. **Roll back on failure.** If a migration throws, the app closes the DB, restores
   that snapshot, and shows a dialog: *"A database update did not complete and was
   rolled back. Your data is intact… reinstall the previous version or contact
   support."* — instead of crashing to a blank window. The app does **not** run
   against a half-migrated database.
3. **Downgrade guard.** If you ever install an **older** app version over a database a
   **newer** version created, the app refuses to open it (*"This data was created by a
   newer version…"*) rather than silently corrupting it. Reinstall the newer version to
   proceed.
4. **Version stamp.** The app + schema version that last opened the DB is recorded in
   settings, and each upgrade is written to the audit log (`app:migrated`).

**Upgrade steps:** (1) take a manual backup and confirm it reports success (belt and
braces — the app also snapshots automatically); (2) install the new `.exe` over the old
one; (3) launch — migrations apply on open, with the safety net above; (4) spot-check
that recent transactions, members, and photos are present. If anything looks wrong, the
pre-update snapshot in `pre-update-backups/` (or Settings → Backup → Restore) rolls you
back.

> **Deploying a change involving a schema migration:** add one entry to the
> `MIGRATIONS` array in `src/main/db/migrations.js` (see `docs/archive/PROGRESS.md` →
> "Migrations" for the original writeup, or just read a couple of existing entries in
> `migrations.js` for the house style), keep it guarded/idempotent, extend
> `test/migration.test.js` against a populated fixture, and bump the app `version` in
> `package.json`. The runner and the safety net handle the rest.

## Windows signing / SmartScreen

The `.exe` is unsigned, so Windows SmartScreen may warn on first run. For a single
known reception PC this is acceptable: click **More info → Run anyway**. If the app
is ever distributed more widely, buy an OV/EV code-signing certificate and sign in
`electron-builder.yml` to remove the warning.

## Backup monitoring & quarterly restore drill

- The admin dashboard flags a **stale backup** (no successful backup in over a day)
  so problems are noticed before they compound.
- **Quarterly restore drill (do not skip):** on a spare machine, install the app,
  copy a recent backup over, and restore it (Settings → Backup → Restore, any
  active admin password + backup passphrase). Confirm members, transactions, and photos come
  back. A backup you have never restored is not a backup you can trust. Restores
  are integrity-checked before they touch live data and are recorded in the audit
  log.

## Developer note — native module ABI

`better-sqlite3` is a native addon and Electron (ABI 140) and Node (ABI 127) differ.
The npm scripts handle this automatically: `npm test` rebuilds it for Node
(`pretest`), and `npm run dev` / `npm start` rebuild it for Electron
(`predev`/`prestart`). If you ever hit a `NODE_MODULE_VERSION` error, run
`npm run postinstall` (for the app) or `npm rebuild better-sqlite3` (for tests).
