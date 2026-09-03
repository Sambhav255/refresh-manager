# Changelog

All notable releases of Refresh Manager.

## 1.1.1 — 2026-09-03

- Pricing manager: add entry tickets, combo tickets, and memberships from this screen (the missing Products section)
- Stop selling / sell again on each product

## 1.1.0 — 2026-09-03

### Deployment & safety
- In-app updates: check GitHub Releases or install from a file you receive (USB, Drive, WhatsApp)
- Pre-update database snapshot before every install — your books stay in `%APPDATA%`
- Daily Excel workbook saved beside encrypted backups for human-readable disaster reference
- Backup folder required at first setup; guided restore wizard
- Version, build date, and commit shown in Settings → About & updates
- "What's new" dialog after each update

### Till (default for new installs)
- Unified one-screen till enabled by default (Settings toggle to revert to legacy wizard)
- Staff land on the till after PIN; quiet today-sales strip
- Fast PIN switch in header for shift handover
- Kitchen copy print after restaurant sales

### Owner dashboard
- Paid / unpaid / dues KPIs with week and month trends vs prior period
- Booking deposits and part-paid balances visible
- Today's discounts and stock value totals

### Other
- Crash recovery dialog with option to restart
- Database integrity check on startup
- Owner runbook (`docs/OWNER_RUNBOOK.md`)
