# REFRESH MANAGER — Deploy & Go-Live
## Phase 4 is done. What happens now.
### Read this before touching Cursor again.

---

## WHERE THINGS STAND

All 10 commits are on `main`. The GitHub Actions Windows build is running (or finished).
The app has never been tested interactively — everything so far was a code audit.

Three things need to happen before the app goes on the reception desk:

1. **Fix 3 known issues** (30–60 min in Cursor)
2. **Test the Windows `.exe` on real hardware** (60–90 min, not in Cursor)
3. **Deploy and go live** (follow the setup steps below)

Do them in that order.

---

## PART 1 — FIX THREE THINGS BEFORE DEPLOYING

These were flagged as likely-fails in `QA_WAVE1.md`. Fix them before the `.exe` goes
on the reception PC. Each one is a 10–20 minute Cursor task.

---

### FIX 1 — Google Fonts CDN (critical for offline use)

**Problem:** `app.css` or `index.html` almost certainly has a line like:
```css
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:...');
```
If the reception PC has no internet, the font never loads. On Windows with no fallback,
the app will render in Times New Roman or a system serif. The UI will look broken.

**Fix:** Remove the Google Fonts import entirely. Replace with the Windows system font
stack, which looks excellent on Windows 10/11 and requires zero internet:

In `src/renderer/src/app.css`, find any `@import` for Google Fonts and delete it.
Then find the root `font-family` declaration and replace it with:

```css
body, * {
  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
}
```

`Segoe UI` is Windows 11's native font. It is guaranteed to be present on every
Windows 10+ machine. The app will look the same or better than with DM Sans.

**Cursor prompt:**
```
In src/renderer/src/app.css and src/renderer/index.html, find and remove any
Google Fonts @import or <link> tag. Replace the root font-family with:
'Segoe UI', system-ui, -apple-system, sans-serif
Run npm run dev and confirm the app looks correct. Commit: "fix: self-host fonts,
remove Google Fonts CDN dependency"
```

---

### FIX 2 — Session security on window reload

**Problem:** Pressing F5 (Windows refresh) or Cmd+R (Mac dev) reloads the renderer
but keeps the main-process in-memory session. A staff member who walks away from the
reception desk could have the app reloaded by anyone and be dropped straight into
the staff dashboard, bypassing the PIN screen entirely.

**Fix:** In `src/main/index.js`, listen for `did-finish-load` on the main window's
webContents and clear the session on every renderer load:

```js
win.webContents.on('did-finish-load', () => {
  // Security: renderer reload must re-authenticate
  clearSession()  // or session.clear() — whatever your session module exports
})
```

This means F5 always returns to the login screen. In production this is the correct
behaviour for a shared reception desk.

**Cursor prompt:**
```
In src/main/index.js, after win is created, add:
  win.webContents.on('did-finish-load', () => { clearSession() })
where clearSession is imported from src/main/session.js (or equivalent).
This clears the in-memory session whenever the renderer reloads, so F5 always
returns to the login screen. Confirm the import works and npm run dev still launches.
Commit: "fix(auth): clear session on renderer reload — F5 returns to login"
```

---

### FIX 3 — Print error shown to staff

**Problem:** When "Print Ticket" fails (no printer connected), the error is returned
from the IPC handler but the success screen currently has no UI to display it.
Staff would click the button, nothing would happen, and they'd have no idea why.

**Fix:** On the transaction success screen (wherever the "Print Ticket" button lives),
handle the error state from `tickets:print`:

```jsx
const [printError, setPrintError] = useState(null)

const handlePrint = async () => {
  const result = await window.api.printTicket(txnData)
  if (!result.success) {
    setPrintError('No printer found. Check the printer connection, then try again.')
  }
}

// In JSX:
{printError && (
  <div className="alert amber" style={{ marginTop: 12 }}>
    {printError}
  </div>
)}
```

**Cursor prompt:**
```
On the transaction success screen (find the component that shows "Print Ticket"
and "Done" buttons), add error handling for the printTicket IPC call.
If result.success is false, show an amber alert below the buttons with the text:
"No printer found. Check the printer is on and connected, then try again."
The "Done" button should always work regardless of print status.
Commit: "fix(tickets): show error message when no printer is connected"
```

---

### After all 3 fixes

```bash
npm run build        # confirm clean build
git push origin main # triggers new GitHub Actions .exe build
```

Wait for the new build to finish before downloading the `.exe`.

---

## PART 2 — DOWNLOAD THE WINDOWS `.EXE`

1. Go to `https://github.com/Sambhav255/refresh-manager/actions`
2. Open the latest **Build Windows** workflow run
3. Scroll to **Artifacts** at the bottom
4. Download `refresh-manager-win`
5. Unzip — you'll find a file named something like `Refresh Manager Setup 1.0.0.exe`

If the build failed (red ✗), the most common reasons are:
- `better-sqlite3` native module rebuild failed → check the logs for `electron-rebuild` errors
- `icon.ico` missing → the build needs `resources/icon.ico` to exist
- Memory issue on the GitHub runner → re-run the workflow (it's free)

---

## PART 3 — TEST ON WINDOWS HARDWARE

**Do not install on the reception PC yet.** Test on any Windows 10/11 machine first.
If you don't have one handy, use the reception PC but be ready to uninstall.

### Installation

1. Run `Refresh Manager Setup 1.0.0.exe`
2. Install to default location: `C:\Program Files\Refresh Manager\`
3. Allow the installer to create a desktop shortcut
4. Launch from the desktop shortcut (not from the installer)

### Where the database lives (Windows)

The database is not in `Program Files`. It's in:
```
C:\Users\[username]\AppData\Roaming\Refresh Manager\refresh.db
```
This is `app.getPath('userData')` on Windows. Backups go here too by default.
To trigger the setup wizard again during testing, delete `refresh.db` from this folder.

### Testing checklist (run through every item)

Work through these in order. Tick each one.

**First launch**
- [ ] Setup wizard appears (not the login screen)
- [ ] Owner name + password accepted
- [ ] Confirm password mismatch shows error
- [ ] First staff name + PIN accepted
- [ ] Completing wizard → owner dashboard
- [ ] Closing and relaunching → login screen (not wizard)

**Authentication**
- [ ] Staff PIN (correct) → staff dashboard
- [ ] Staff PIN (wrong) → inline error, no crash
- [ ] Owner credentials (correct) → owner dashboard
- [ ] Owner credentials (wrong) → inline error
- [ ] F5 from staff dashboard → returns to login screen (Fix 2 above)
- [ ] F5 from owner dashboard → returns to login screen

**Transaction flow (set at least one price first)**
- [ ] Settings → Pricing Manager → set Pool Day Pass to Rs. 500
- [ ] New Transaction → Pool Day Pass → Rs. 500 auto-fills
- [ ] Walk-in, Cash → Confirm & Save → success screen
- [ ] "Print Ticket" with printer connected → ticket prints
- [ ] "Print Ticket" with no printer → amber error message (Fix 3 above)
- [ ] "Done" → returns to home
- [ ] Membership transaction → member appears in Member Search with correct expiry date

**Fonts and rendering (Fix 1 above)**
- [ ] Disconnect from internet → restart app → fonts still look correct (Segoe UI)
- [ ] No broken layout, no serif font appearing

**Backup**
- [ ] Settings → Backup → pick a folder (e.g. Desktop)
- [ ] "Backup now" → file appears in the chosen folder named `refresh_backup_YYYY-MM-DD.db`
- [ ] Owner dashboard → backup status shows "Last backup: today"

**Inventory**
- [ ] Set a price for at least one pool inventory item
- [ ] Staff: sell the item → stock decrements → transaction created
- [ ] Owner: low-stock alert appears on dashboard

**Bookings**
- [ ] Owner: create a booking with a future date
- [ ] Staff: Bookings tile shows the booking
- [ ] Staff: mark booking as Completed

**Restaurant POS**
- [ ] Owner: Settings → Restaurant Menu → add a menu item (e.g. Tea, Rs. 80)
- [ ] Staff: Restaurant tile → select Tea → Confirm → transaction shows source = restaurant
- [ ] Owner dashboard: restaurant revenue is separate from pool revenue

**Cash reconciliation**
- [ ] End of Day → enter a matching physical count → "Cash balanced"
- [ ] End of Day → enter a non-matching count → discrepancy shown with reason field

**WhatsApp EOD**
- [ ] Settings → WhatsApp number: enter `9779801010422`
- [ ] End of Day → "Send to owner via WhatsApp" → browser opens with pre-filled message

**Excel export**
- [ ] Owner Reports → Daily revenue → file downloads as `Refresh_DailyRevenue_YYYY-MM-DD.xlsx`
- [ ] Open in Excel → data is correct, not empty

**Offline resilience**
- [ ] Disconnect from internet completely
- [ ] Relaunch the app → launches normally
- [ ] Complete a transaction → saves correctly
- [ ] Fonts still render correctly (Segoe UI, Fix 1)

---

## PART 4 — DEPLOY TO THE RECEPTION PC

Once the Windows test passes, install on the actual reception desk machine.

### Before installing

Confirm the reception PC has:
- [ ] Windows 10 or 11
- [ ] A printer (if ticket printing is wanted from day one)
- [ ] At least 500MB free disk space
- [ ] The machine is set to Nepal timezone (UTC+5:45)
  - If not: Settings → Time & Language → Time zone → (UTC+05:30) Chennai/Kolkata is close,
    but Nepal is actually UTC+5:45. Windows has a dedicated Nepal Standard Time entry.
    Set it to **Nepal Standard Time (UTC+5:45)**.

### Install

Run the `.exe` installer on the reception PC. Same steps as Part 3.

### First-launch configuration (owner does this, not staff)

Work through these in order:

**1. Setup wizard**
- Owner name: use the actual owner's name
- Password: something memorable but not obvious — write it in a safe place
- First staff member: add whoever is on shift today

**2. Settings → Pricing Manager**
Set real prices for every product before telling staff to start using the app.
Products seeded at Rs. 0 will show the yellow warning banner to staff.

Suggested order (fill in actual prices):
```
Pool Day Pass           → Rs. ____
Gym Day Pass            → Rs. ____
Sauna + Steam + Jacuzzi → Rs. ____
Swimming + Sauna + Steam→ Rs. ____
Whole Package           → Rs. ____
Beginner Training 15d   → Rs. ____
Beginner Training Monthly → Rs. ____
Advanced Training 15d   → Rs. ____
Advanced Training Monthly → Rs. ____
Gym Only Monthly        → Rs. ____
Gym Only 3 Months       → Rs. ____
Gym Only 6 Months       → Rs. ____
Gym Only 1 Year         → Rs. ____
Swimming + Gym Monthly  → Rs. ____
Swimming + Gym 3 Months → Rs. ____
Swimming + Gym 6 Months → Rs. ____
Swimming + Gym 1 Year   → Rs. ____
```

**3. Settings → WhatsApp number**
Enter: `9779801010422` (or whatever number receives the EOD report)

**4. Settings → Backup**
- Pick a backup folder. Best options:
  - A USB drive that's always plugged in to the PC
  - A folder synced to Google Drive (if the PC has it installed)
  - Any folder on the PC (minimum viable — but vulnerable to PC failure)
- Enable "Auto-backup daily"

**5. Settings → Manage Staff**
Add a PIN for every reception staff member who will use the app.
Name them clearly (e.g. "Aarti", "Bikash") so the owner can see who logged what.

**6. Pool Inventory → set real stock counts**
For each item already in the list, tap "Restock" and enter the current real quantity.
This makes the inventory accurate from day one instead of starting at 0.

Add any items that aren't in the seeded list (Add item button).
Set selling prices for any items the facility sells to customers.

**7. Restaurant Inventory / Restaurant Menu**
If the restaurant is to be tracked from day one:
- Add current stock for each seeded item
- Settings → Restaurant Menu: add all current menu items with prices

If the restaurant tracking is to be added later, skip this for now.

**8. Enter existing members (optional but recommended)**
If the facility has existing members, enter them now so they show up in Member Search
from day one. For each: name, phone, membership type, start date.
The end date will be calculated automatically from the duration.

---

## PART 5 — STAFF TRAINING (30 minutes, do this before the first shift)

Walk each staff member through the following. Don't give them a manual — show them once
and let them do it themselves once while you watch.

### What staff need to know

**Logging in:**
Type your 4-digit PIN and press Enter. That's it.

**Walk-in transaction (most common):**
```
Home → New Transaction
Step 1: pick type (Day Pass, Day Package, or Membership)
Step 2: pick product from the list
Step 3: customer name (or leave blank for anonymous walk-in) + phone (optional)
Step 4: Cash or QR
Step 5: confirm → Confirm & Save
→ Print ticket if they need one → Done
```

**Checking a member:**
```
Home → Search Member → type their name or phone number → look for green "Active" badge
If Expiring Soon (amber) or Expired (red) → tell them to renew
```

**End of shift:**
```
Home → End of Day
Check the totals look right
Count the physical cash
Enter it in the reconciliation box
If it matches: good
If it doesn't: type a reason (common: "one QR not scanned", "change given", etc.)
Click "Send to owner via WhatsApp"
```

**Bookings:**
```
Home → Bookings → see upcoming group bookings
When the group arrives: find their booking → Mark as Completed
Never create or change bookings — that's owner only
```

**Important: never share your PIN.**
If you think someone else knows your PIN, tell the owner to change it.

---

## PART 6 — FIRST WEEK MONITORING

In the first week of real use, watch for these things:

**Daily checks (owner):**
- Open the dashboard every evening before end of day
- Do the transaction counts look right? (ask staff to verbally confirm)
- Is the backup running? (dashboard widget)
- Any low-stock alerts that need restocking?

**After first 3 days:**
- Check the `cash_reconciliations` table (or the owner report) — are there any
  recurring discrepancies? If yes, investigate with staff.
- Check the Google review count — is it being updated manually? The app tracks it
  as a KPI but doesn't auto-fetch from Google. Update it weekly in Settings.

**First week bugs to watch for:**
- Wrong expiry dates on memberships (should be fixed in Wave 1 — but verify with a
  real membership created on the actual machine)
- Prices showing as Rs. 0 for any product (means it wasn't set in Pricing Manager)
- Any screen that crashes instead of showing an error (report the screen name so it
  can be fixed in a patch)
- Print issues on the specific printer model at reception

---

## PART 7 — AFTER GO-LIVE: WHAT TO BUILD NEXT

Once the app is running successfully for one week, the highest-value next additions are:

**Patch 1 (within 2 weeks of going live):**
Fix any bugs reported by staff during real use. Don't build new features until the
existing ones are stable.

**Phase 5A — Member portal / WhatsApp integration:**
Instead of staff manually calling expiring members, the renewal reminder WhatsApp
button currently opens wa.me for each member one by one. Upgrade this to a
WhatsApp Business API integration that sends automatically at a scheduled time.
High value, requires a WhatsApp Business Account (free tier exists for small businesses).

**Phase 5B — Occupancy tracking:**
A simple manual count: staff enter "pool count" at 10 AM, 12 PM, 6 PM each day.
The owner sees occupancy trends over time. Informs decisions about peak pricing,
lesson scheduling, and capacity management.

**Phase 5C — Multi-staff shift logs:**
Currently all transactions are attributed to whoever is logged in. If two staff
members share a shift, it's unclear who logged what. Add a shift start/end log
so the owner can see: "Aarti's shift: 6 AM – 2 PM, 12 transactions, Rs. 4,200."

**Phase 5D — Google Business Profile sync:**
A manual reminder in the app: "You have 24 Google reviews. Target: 50."
Currently static. A future version could use the Google Business API to auto-fetch
the review count. Low priority but high visibility for the owner.

---

## CURSOR PROMPT FOR THE FIX TASKS (Part 1)

Paste this to do all 3 fixes in one session:

```
Read QA_WAVE1.md and DEPLOYMENT.md before starting.

Three targeted fixes needed before the Windows .exe is deployed to the reception PC:

FIX 1 — Offline fonts
In src/renderer/index.html and src/renderer/src/app.css, find and remove any
Google Fonts @import or <link rel="stylesheet"> pointing to fonts.googleapis.com.
Replace the root font-family with: 'Segoe UI', system-ui, -apple-system, sans-serif
Run npm run dev and confirm the UI looks correct.

FIX 2 — Session cleared on window reload
In src/main/index.js, after the main BrowserWindow is created, add:
  win.webContents.on('did-finish-load', () => clearSession())
where clearSession comes from src/main/session.js (or wherever the session is stored).
This ensures F5 or window reload always returns to the login screen.
Confirm npm run dev still launches correctly.

FIX 3 — Print error visible to staff
On the transaction success screen (the component showing "Print Ticket" and "Done"),
wrap the printTicket IPC call in a try/catch and add a printError state.
If result.success is false, show an amber .alert below the buttons:
"No printer found. Check the printer is on and connected, then try again."
The "Done" button must always work regardless of print state.

After all 3 fixes:
- npm run build (confirm clean build)
- Commit each fix separately with clear messages
- Push to main (triggers new GitHub Actions Windows build)
- Do not modify any other files
```

---

*Prepared June 2026 · Refresh Recreation Center Pvt. Ltd.*
*Phase 4 complete · 3 fixes → test on Windows → deploy to reception desk*
