# REFRESH RECREATION CENTER
## Product Requirements Document — Internal Management Software
### Version 1.0 · June 2026 · Windows Desktop Application

---

## 1. DOCUMENT OVERVIEW

### Purpose
This document defines the full requirements for **Refresh Manager** — a Windows desktop application for Refresh Recreation Center Pvt. Ltd., Nayabasti, Boudha, Kathmandu. The software replaces the current paper logbook system with a structured, dual-access management tool for front desk staff and owners.

### Scope (v1.0)
This version covers:
- Daily Transaction Log
- Membership Management
- Walk-in / Day Pass Management
- Inventory Management (recreational items)
- Staff and Owner interfaces
- Excel export
- End-of-day WhatsApp summary to owner

**Out of scope for v1.0 (future versions):**
- Restaurant / kitchen module (designed in, built later)
- Member check-in / attendance tracking
- Online booking
- Mobile app

### Target Users
| User Type | Who | Access Level |
|---|---|---|
| Staff | Front desk / reception staff | Transaction entry, member lookup, day pass sale, inventory view |
| Owner / Admin | Business owner and designated family members | Full access — all reports, pricing management, exports, settings |

---

## 2. SYSTEM ARCHITECTURE OVERVIEW

### Platform
- **Type:** Windows Desktop Application
- **Minimum OS:** Windows 10
- **Deployment:** Single machine at reception desk (no internet required for core functions; internet needed only for WhatsApp summary feature)
- **Database:** Local (SQLite or equivalent lightweight DB)
- **Backup:** Daily automatic export to a designated folder (owner configures path); manual export to Excel available at any time

### Two Interfaces
The application has **two distinct interfaces** accessible via a login screen:

**Staff Interface** — simplified, task-focused, designed for speed at front desk
**Owner Interface** — full dashboard with reports, settings, pricing, and exports

Both interfaces share the same underlying data. Switching between them requires re-login.

---

## 3. LOGIN & ACCESS CONTROL

### Login Screen
- App opens to a clean login screen with the Refresh logo
- Two role options: **Staff Login** / **Owner Login** (can be a role selector + PIN, or separate username/password)
- Owner can set and change all PINs/passwords from the Owner Interface

### Staff PIN
- 4-digit PIN (simple, fast for front desk use)
- Staff cannot access Owner Interface

### Owner Login
- Username + password (more secure)
- Owner can create multiple staff PINs (e.g. one per staff member for accountability)
- Owner can view which staff member logged each transaction (if multiple PINs are used)

---

## 4. PRODUCT CATALOGUE & PRICING

*All prices are set by the Owner and can be edited from the Owner Interface. Staff cannot edit prices.*

### 4.1 Membership Types

#### Swimming Memberships (Training)
| Membership | Duration | Notes |
|---|---|---|
| Beginner Training | 15 days | For learners / beginners |
| Beginner Training | Monthly (30 days) | |
| Advanced Training | 15 days | For experienced swimmers |
| Advanced Training | Monthly (30 days) | |

#### Gym Memberships
| Membership | Duration |
|---|---|
| Gym Only | Monthly |
| Gym Only | 3 Months |
| Gym Only | 6 Months |
| Gym Only | 1 Year |

#### Combined Memberships
| Membership | Duration |
|---|---|
| Swimming + Gym | Monthly |
| Swimming + Gym | 3 Months |
| Swimming + Gym | 6 Months |
| Swimming + Gym | 1 Year |

### 4.2 Day Packages (Walk-in, Hourly Access)
*Each package is a fixed-duration day visit — approximately 1 hour per facility included.*

| Package Name | Facilities Included |
|---|---|
| Sauna + Steam + Jacuzzi | Sauna, Steam Room, Jacuzzi |
| Swimming + Sauna + Steam | Pool, Sauna, Steam Room |
| Whole Package | Pool + Gym + Sauna + Steam Room + Jacuzzi |

### 4.3 Day Pass (Simple Walk-in)
| Type | Notes |
|---|---|
| Pool Day Pass | Single session, walk-in |
| Gym Day Pass | Single session, walk-in |

*Note: The above is a starting list. Owner can add, edit, or deactivate any product from the Owner Interface.*

---

## 5. DAILY TRANSACTION LOG

### 5.1 Purpose
Records every revenue-generating transaction that occurs at the front desk — memberships sold, day passes, day packages, and any one-off payments.

### 5.2 Transaction Entry (Staff Interface)

When a staff member processes a sale, they complete the following fields:

| Field | Type | Required | Notes |
|---|---|---|---|
| Customer Name | Text | Yes | Free text; for day passes, can enter "Walk-in" |
| Phone Number | Number | Optional | Useful for membership holders; optional for walk-ins |
| Transaction Type | Dropdown | Yes | Membership / Day Package / Day Pass |
| Product Selected | Dropdown | Yes | Auto-populates based on Transaction Type selection |
| Duration (if membership) | Dropdown | Yes | Auto-populates based on product; e.g. Monthly, 3 Months |
| Amount (NPR) | Number | Yes | Auto-fills from price list; staff cannot edit unless override is permitted by owner |
| Payment Method | Toggle | Yes | Cash / QR |
| Notes | Text | Optional | For any special cases or remarks |
| Date & Time | Auto | — | System timestamp; not editable by staff |
| Staff ID | Auto | — | Logged from current session login |

**Flow for staff:**
1. Select Transaction Type → Product populates
2. Select Product → Price auto-fills
3. Enter customer name → Enter phone (optional)
4. Confirm payment method
5. Click **"Confirm & Save"**
6. Receipt appears on screen (printable if printer connected; otherwise shown for reference)

### 5.3 Transaction Log View

Staff can view today's transactions in a simple list. They cannot edit or delete any entry — only the Owner can void/edit transactions.

Owner can view:
- All transactions (today / this week / this month / custom date range)
- Filter by: staff member / transaction type / product / payment method
- Sort by: time, amount, product
- Total revenue for selected period, broken down by: Cash vs QR / Membership vs Day Pass vs Day Package
- Export to Excel (any date range)

### 5.4 End-of-Day Summary (WhatsApp to Owner)

At the end of each day (triggered manually by staff clicking **"Send End-of-Day Report"**, or auto-triggered at a time set by the owner), the system compiles and sends a WhatsApp message to the owner's number.

**Message format:**
```
🏊 Refresh Recreation Center
📅 Daily Summary — [Date]

💰 REVENUE
Total: Rs. [X]
  • Cash: Rs. [X]
  • QR: Rs. [X]

📋 TRANSACTIONS ([N] total)
  • Memberships: [N] — Rs. [X]
  • Day Packages: [N] — Rs. [X]
  • Day Passes: [N] — Rs. [X]

🏷️ TOP PRODUCTS TODAY
  • [Product Name]: [N] sales
  • [Product Name]: [N] sales

👤 Staff on duty: [Staff Name/ID]

— Sent from Refresh Manager
```

**Implementation note:** WhatsApp sending can use WhatsApp Web automation (via the wa.me API link opened in browser) or a WhatsApp Business API integration. Simplest v1 approach: generate the formatted text and open a pre-filled WhatsApp Web link that the staff member sends with one click.

---

## 6. MEMBERSHIP LOG

### 6.1 Purpose
Tracks all active, expired, and upcoming-expiry memberships. Replaces the paper member register.

### 6.2 New Member Registration

When a membership is sold via the Transaction Log, the system automatically creates a Membership Record. Staff can also register a member without an immediate payment (e.g. pre-registration).

**Member Record Fields:**

| Field | Type | Required | Notes |
|---|---|---|---|
| Member ID | Auto | — | Sequential number assigned by system |
| Full Name | Text | Yes | |
| Phone Number | Number | Yes | Primary contact |
| Gender | Dropdown | Optional | Male / Female / Other |
| Membership Type | Dropdown | Yes | Pulled from product catalogue |
| Duration | Dropdown | Yes | |
| Start Date | Date | Yes | Defaults to today; owner can backdate |
| End Date | Date | Auto | Calculated from start date + duration |
| Amount Paid (NPR) | Number | Yes | |
| Payment Method | Toggle | Yes | Cash / QR |
| Photo | Image | Optional | Webcam capture or file upload (for identity) |
| Notes | Text | Optional | |

### 6.3 Membership Status

Each member record carries a status, automatically updated by the system:

| Status | Definition |
|---|---|
| **Active** | End date is in the future |
| **Expiring Soon** | End date is within 5 days (highlighted in amber) |
| **Expired** | End date has passed and no renewal logged |
| **Paused** | Owner manually pauses a membership (e.g. member travel) |

### 6.4 Membership Views

**Staff view:**
- Search member by name or phone number
- See member's current status, membership type, and expiry date
- Cannot edit membership records

**Owner view:**
- Full member list with filters: Active / Expiring Soon / Expired / All
- Edit any member record
- Renew a membership (creates a new transaction + extends end date)
- Void/cancel a membership with a reason log
- Export full member list to Excel
- View membership count by type (e.g. "14 active Gym Monthly members")

### 6.5 Expiry Alerts

- Dashboard widget on Owner Interface shows count of memberships expiring in the next 7 days
- On Staff Interface, if a staff member searches a member whose membership is expired or expiring, a clear coloured banner appears: **"⚠️ Membership expires in 3 days"** or **"❌ Membership expired on [date]"**

---

## 7. INVENTORY MANAGEMENT

### 7.1 Purpose
Tracks stock levels of all retail and rental items sold or lent to customers at the facility.

### 7.2 Inventory Item List (v1.0)

| Category | Item | Variants |
|---|---|---|
| Swimwear — Ladies | Full Body Costume | Sizes (S, M, L, XL — owner configures) |
| Swimwear — Ladies | Half Costume | Sizes |
| Swimwear — Gents | Gents Costume | Sizes |
| Swimwear — Children | Baby Costume — Girls | Sizes |
| Swimwear — Children | Baby Costume — Boys | Sizes |
| Accessories | Goggles — Adult (Large) | — |
| Accessories | Goggles — Adult (Small) | — |
| Accessories | Goggles — Baby | — |
| Accessories | Swimming Cap — Large | — |
| Accessories | Swimming Cap — Small | — |
| Accessories | Nose Pin | — |
| Equipment | Floating Tube | — |

*Owner can add new items and categories from the Owner Interface.*

### 7.3 Inventory Record per Item

| Field | Description |
|---|---|
| Item Name | e.g. "Ladies Full Body Costume — Size M" |
| Category | Swimwear / Accessories / Equipment |
| Current Stock | Live count |
| Reorder Alert Level | Owner sets a minimum; system flags when stock falls below |
| Unit Cost (NPR) | Purchase cost (for owner tracking) |
| Selling Price (NPR) | Price charged to customer |
| Total Sold (all time) | Running count |
| Last Restocked | Date of last stock addition |

### 7.4 Stock Transactions

**Stock In (Restock):**
- Owner adds stock: select item, enter quantity added, enter date
- System updates current stock level and logs the restock

**Stock Out (Sale / Issue):**
- When an inventory item is sold via the Transaction Log, staff selects the item and quantity → stock automatically decrements
- Staff can also manually log a stock-out (e.g. item issued for trial/rental)

**Stock Adjustment (Owner only):**
- Owner can manually correct stock count (e.g. after physical audit) with a mandatory reason field

### 7.5 Inventory Views

**Staff:** Can view current stock levels. Cannot edit prices or adjust stock counts.

**Owner:**
- Full inventory table with current stock, low-stock alerts highlighted in red
- Restock history per item
- Sales history per item
- Export full inventory report to Excel

---

## 8. OWNER INTERFACE — DASHBOARD & FEATURES

### 8.1 Dashboard (Home Screen)

Upon owner login, the dashboard displays:

| Widget | Content |
|---|---|
| Today's Revenue | Total NPR (Cash + QR split shown) |
| Today's Transactions | Count and quick list of last 10 |
| Active Members | Total count with expiring-soon alert |
| Low Stock Alerts | Items below reorder threshold |
| This Month Revenue | Running total vs last month |
| Quick Actions | New Member / New Transaction / Export Today |

### 8.2 Reports Section

| Report | Description | Export |
|---|---|---|
| Daily Revenue Report | All transactions for a selected day | Excel |
| Monthly Revenue Report | Aggregated by week and product type | Excel |
| Custom Date Range Report | Any range; filterable by product/payment | Excel |
| Member Report | Full member list with status | Excel |
| Expiry Report | Members expiring in next X days | Excel |
| Inventory Report | Stock levels + sales history | Excel |
| Transaction Audit Log | Every transaction with staff ID and timestamp | Excel |

### 8.3 Settings (Owner Only)

| Setting | Description |
|---|---|
| Pricing Manager | Edit price of any product; changes log with date and old/new price |
| Product Manager | Add / deactivate products and membership types |
| Staff PIN Manager | Create, edit, delete staff PINs |
| WhatsApp Number | Set owner's WhatsApp number for end-of-day report |
| End-of-Day Report Time | Set auto-send time or keep as manual trigger |
| Reorder Alert Levels | Set per-item stock minimums |
| Backup Folder | Set path for daily auto-backup of database |
| Business Info | Name, address, phone — used in reports and receipts |

---

## 9. STAFF INTERFACE — DESIGN REQUIREMENTS

The staff interface must be:
- **Fast:** A walk-in day pass transaction should take under 60 seconds from opening the app
- **Simple:** No unnecessary menus or options; only what's needed for the current task
- **Clear:** Large text, high contrast, minimal data entry required
- **Error-resistant:** Dropdowns and auto-fills wherever possible; confirm dialogs before saving

### Staff Interface Screens

| Screen | Purpose |
|---|---|
| Home | Quick access to: New Transaction / Search Member / Inventory View / End-of-Day Report |
| New Transaction | Step-by-step transaction entry form |
| Member Search | Search by name or phone; view status and expiry |
| Today's Log | Read-only list of today's transactions |
| Inventory | Read-only stock level view |
| End-of-Day | Trigger WhatsApp summary send; view daily totals |

---

## 10. EXCEL EXPORT SPECIFICATION

All exports follow a consistent format:

- **Header row:** Bold, background colour matching Refresh brand
- **File naming convention:** `Refresh_[ReportType]_[DateRange].xlsx`
  - e.g. `Refresh_DailyRevenue_2026-06-07.xlsx`
  - e.g. `Refresh_Members_Active_2026-06.xlsx`
- **Sheets:** Each export can contain multiple tabs if relevant (e.g. Revenue report has: Summary tab + Transaction Detail tab)
- **Totals:** Always included at bottom of numeric columns
- **Export location:** Owner-configured default folder; or browse-to-save option

---

## 11. FUTURE MODULES (PLANNED — NOT IN V1.0)

### 11.1 Restaurant Module
To be designed and built as v1.1 or v2.0. Will include:
- Fixed menu item catalogue
- Restaurant sales log (separate from main facility transactions)
- Restaurant inventory tracking (ingredients or finished items — TBD)
- Restaurant revenue visible separately in Owner Dashboard
- Consolidated daily summary showing: Facility Revenue + Restaurant Revenue + Combined Total
- WhatsApp summary to include restaurant revenue line

### 11.2 Planned Enhancements
- Member check-in log (attendance tracking per visit)
- Digital membership card (QR code per member)
- Automated WhatsApp renewal reminders to members
- Multi-location support (if Refresh expands)
- Mobile companion app for owner (view-only dashboard on phone)

---

## 12. NON-FUNCTIONAL REQUIREMENTS

| Requirement | Specification |
|---|---|
| **Performance** | Transaction save must complete in under 2 seconds |
| **Offline capability** | All core functions work without internet; only WhatsApp send requires connectivity |
| **Data safety** | No transaction can be deleted by staff; owner deletions are logged |
| **Backup** | Automatic daily backup to configured local folder; manual backup option always available |
| **Language** | English interface throughout (Nepali labels optional in future) |
| **Screen resolution** | Minimum 1366×768; optimised for 1920×1080 |
| **Installer** | Standard Windows installer (.exe); single-click setup |
| **No subscription** | Software is a one-time installation; no cloud dependency for core features |

---

## 13. OPEN QUESTIONS (TO RESOLVE BEFORE DEVELOPMENT)

| # | Question | Why It Matters |
|---|---|---|
| 1 | What is the exact pricing for each membership and package? | Needed to pre-populate the price list before launch |
| 2 | What are the size variants for swimwear items? | Needed to set up inventory catalogue correctly |
| 3 | Should staff be able to apply a discount? If yes, with owner approval or freely? | Affects transaction form design |
| 4 | Do day packages have a set price, or does it vary? | Needed for product catalogue |
| 5 | Is there a printer at reception for receipts? | Determines whether receipt printing needs to be built |
| 6 | How many staff PINs are needed at launch? | Setup configuration |
| 7 | Should the system support membership pausing (e.g. member travels for 2 weeks and wants time added back)? | Affects membership logic complexity |
| 8 | What WhatsApp method is preferred — manual click-to-send or fully automated? | Determines technical approach for summary feature |

---

## 14. GLOSSARY

| Term | Definition |
|---|---|
| Transaction | Any single revenue event recorded at the front desk |
| Membership | A recurring access subscription tied to a named member |
| Day Pass | A single-session, walk-in access purchase (pool or gym) |
| Day Package | A bundled hourly experience purchase (sauna+steam+jacuzzi etc.) |
| Walk-in | A customer with no membership — pays per visit |
| Owner Interface | The admin-level application view with full reporting and settings |
| Staff Interface | The simplified front-desk view for daily operations |
| QR Payment | Any digital payment via QR code (eSewa, Khalti, bank QR) |

---

*Document prepared June 2026 · Refresh Recreation Center Pvt. Ltd. · Nayabasti, Boudha, Kathmandu*
*Next step: Review open questions (Section 13), confirm pricing, and brief development team*
