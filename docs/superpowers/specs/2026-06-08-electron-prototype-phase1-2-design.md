# Refresh Manager — Electron Prototype (Phase 1–2)
## Design Spec · 2026-06-08

---

## Goal

Get the existing React/JSX UI running correctly inside an Electron window — all screens rendering, no CDN dependencies, no backend yet. This is Phase 1–2 of the full build plan described in `Refresh_Cursor_Handoff.md`.

**Out of scope for this phase:** SQLite, IPC handlers, auth, real data, Excel export, WhatsApp EOD, packaging.

---

## Project Location

New project scaffolded at:
```
/Users/sambhav/Desktop/Refresh Manager/refresh-manager/
```

The existing `Refresh Software/` folder (docs + source files) stays untouched as reference.

---

## Approach

**electron-vite + React + JavaScript**

- Scaffold with `npm create @quick-start/electron@latest refresh-manager` (React, JavaScript template)
- Extract CSS from `Refresh Manager.html` `<style>` block → `app.css`
- Copy and migrate the 5 source files — globals → ES module imports/exports
- Install `lucide-react`, replace SVG-injection `Icon` component with lookup map
- Fix 4 known bugs documented in the handoff

---

## Project Structure

```
refresh-manager/
├── package.json
├── electron.vite.config.js
├── src/
│   ├── main/
│   │   └── index.js               # Electron entry (window creation only)
│   ├── preload/
│   │   └── index.js               # Empty context bridge stub
│   └── renderer/
│       └── src/
│           ├── main.jsx            # createRoot entry
│           ├── App.jsx             # migrated from app.jsx
│           ├── app.css             # extracted from Refresh Manager.html
│           ├── components/
│           │   └── ui.jsx          # migrated from ui.jsx
│           ├── screens/
│           │   ├── staff.jsx       # migrated from screens-staff.jsx
│           │   └── owner.jsx       # migrated from screens-owner.jsx
│           └── data/
│               └── mock.js         # migrated from data.js
└── resources/
    └── icon.ico
```

---

## File Migration Plan

### `data/mock.js`
- Unwrap `window.RM = (function(){...})()` into named exports
- `export const transactions`, `members`, `inventory`, `products`, `eod`, `kpis`, `reports`, `settings`
- `export function fmt(n)`

### `components/ui.jsx`
- Replace `window.lucide` SVG-injection with `import { ... } from 'lucide-react'`
- `Icon` component becomes a lookup map: string name → lucide-react JSX component
- Replace `Object.assign(window, {...})` with named `export function` on each component
- Keep `WaveMark` SVG as-is (custom, not from lucide)

### `screens/staff.jsx`
- Add imports from `../data/mock` and `../components/ui`
- Remove all `window.RM.*` references
- Remove `useLucide()` calls (were no-ops)
- Export each screen as named export: `StaffHome`, `NewTransaction`, `MemberSearch`, `TodaysLog`, `EndOfDay`

### `screens/owner.jsx`
- Same pattern as staff
- Named exports: `OwnerDashboard`, `OwnerTransactions`, `OwnerMembers`, `OwnerInventory`, `OwnerReports`, `OwnerSettings`

### `App.jsx`
- Import all screens and components
- `import './app.css'`
- Remove all `window.*` references
- Fix Login blank screen: ensure outer div has `min-height: 100%` + flex
- Fix StaffHome tile mounting: add `key` prop

### `main/index.js` — Window configuration
- **Single window** for Phase 1–2 (React state handles routing; separate per-role windows are a Phase 3 concern)
- Window size: `1280 × 880` — gives comfortable room for the `1200 × 800` `.win` frame
- `frame: false` — the custom `.titlebar` in the JSX provides the window chrome
- `resizable: true` — allows testing at different sizes

### `app.css`
- Copy verbatim from `<style>` block in `Refresh Manager.html` (lines 11–242)
- No changes needed — complete and production-ready

---

## Bug Fixes

| Bug | Screen | Fix |
|---|---|---|
| Login renders blank | Login | Add `min-height: 100%` + flexbox to Login container |
| Staff home tiles don't render on mount | StaffHome | Add `key` prop to force correct mounting |
| "Log out" wraps to two lines | AppHeader | `white-space: nowrap` on `.ghost-btn` (already in extracted CSS) |
| Window header missing | StaffApp | Covered by CSS extraction |

---

## Setup Sequence

1. `cd "/Users/sambhav/Desktop/Refresh Manager"`
2. `npm create @quick-start/electron@latest refresh-manager` → React, JavaScript
3. `cd refresh-manager && npm install`
4. `npm install lucide-react`
5. `npm run dev` → confirm blank Electron window
6. Migrate files in order: `mock.js` → `ui.jsx` → `staff.jsx` → `owner.jsx` → `App.jsx` + `app.css`
7. Verify all screens

---

## Verification Checklist

- [ ] Login screen shows logo + two login buttons
- [ ] Staff Login → home tiles render with icons and metric cards
- [ ] New Transaction wizard goes through all 5 steps → confirmation → Done returns to home
- [ ] Member Search shows results, filters correctly
- [ ] Today's Log shows transaction table
- [ ] End of Day shows totals + WhatsApp send button
- [ ] Owner Login → dashboard loads with KPIs + recent transactions + alerts
- [ ] Owner sidebar navigation works for all 6 screens
- [ ] Esc key returns to login

---

*Spec prepared 2026-06-08 · Refresh Recreation Center Pvt. Ltd.*
*Next: implementation plan → then Phase 3 (SQLite backend)*
