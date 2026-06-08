# Wave 1 QA — Code Audit Results

**Date:** 2026-06-08 (Phase 4 update)
**Method:** Static code review (no interactive GUI).
**App path:** refresh-manager/

## Summary

| Section | Result | Notes |
|---------|--------|-------|
| 2A Setup wizard | **PASS** | auth:needs-setup + SetupWizard flow complete |
| 2B Authentication | **LIKELY-FAIL** | Cmd+R reload keeps main-process session; session timeout now wired |
| 2C New transaction (staff) | **PASS** | Wizard, pricing banner, walk-in, payment toggle, success screen |
| 2D Membership transaction | **PASS** | Member + membership IPC; optional photo capture; membership card print |
| 2E Today's log & dashboard | **PASS** | Void filter in totals; payment filter; dashboard loading + send-all-reminders |
| 2F Pool inventory | **LIKELY-FAIL** | Owner restock/add works; no staff sell UI |
| 2G Restaurant inventory | **PASS** | StaffRestaurantPos wired from staff home; restaurant checkout IPC |
| 2H Bookings | **PASS** | Owner CRUD, staff read-only + mark completed, upcoming widgets |
| 2I Ticket printing | **LIKELY-FAIL** | Silent print IPC works; UI does not surface printer errors |
| 2J Pricing manager | **PASS** | Inline edit, price history, products feed transaction dropdown |
| 2K Excel export | **LIKELY-FAIL** | Daily/monthly/custom solid; advanced exports summary-only |
| 2L WhatsApp EOD | **PASS** | Missing-number error, wa.me URL; cash reconciliation step |
| 2M Edge cases | **MIXED** | See breakdown below |

## 2M Edge-case breakdown

| Scenario | Result | Notes |
|----------|--------|-------|
| Void excludes from totals | **PASS** | is_voided = 0 in transactions, reports, WhatsApp EOD |
| No products configured | **PASS** | Empty dropdown + zero-price banner |
| Long customer name | **PASS** | No hard truncation |
| Offline / no internet | **LIKELY-FAIL** | index.html loads Google Fonts CDN |
| Single app instance | **PASS** | app.requestSingleInstanceLock() |
| Delete DB while running | **LIKELY-FAIL** | No graceful handler |

## Phase 4 additions verified in code

1. ScreenErrorBoundary wraps staff and owner screens in App.jsx
2. Staff keyboard shortcuts N/M/L/E in StaffApp
3. Session timeout from session_timeout_minutes setting
4. Member photo + card in staff-transaction.jsx
5. Advanced reports in owner-reports.jsx
6. Reconciliation history list + export
7. PIN validation in staff settings
8. Restaurant POS route in StaffApp

## Remaining blockers

- Staff pool inventory sell UI
- Print error surfacing in UI
- Full Excel data sheets for member/inventory/advanced exports
- Google Fonts offline fallback
- Renderer reload session behavior
