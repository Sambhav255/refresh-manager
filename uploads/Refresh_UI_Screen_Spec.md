# REFRESH MANAGER — UI Screen Spec
## Reference file for Claude Design session
### Upload alongside CLAUDE_DESIGN_PROMPT.md

---

## APP STRUCTURE AT A GLANCE

```
Login Screen
├── Staff Interface (bottom tab nav)
│   ├── Home (tile grid + daily metrics)
│   ├── New Transaction (5-step form)
│   ├── Member Search
│   ├── Today's Log (read-only table)
│   └── End of Day (summary + WhatsApp send)
└── Owner Interface (left sidebar nav)
    ├── Dashboard (KPIs + recent transactions + alerts)
    ├── Transactions (full log with filters + export)
    ├── Members (list with status + expiry)
    ├── Inventory (stock levels + low-stock alerts)
    ├── Reports (6 export report types)
    └── Settings (6 setting categories)
```

---

## SHARED LAYOUT COMPONENTS

### App Header (all screens)
- Height: ~50px
- Background: `#0C447C` (deep navy)
- Left: wave/droplet icon (white) + "Refresh Manager" text (white, 15px, weight 500)
- Right: user badge (muted blue text, person icon + "Aarti · Reception" for staff / "Owner · Admin" for owner) + "Log out" button (ghost style, blue border, light blue text)

### Staff Bottom Tab Navigation
- Height: ~52px
- Background: light gray `#f4f5f7`, top border `#e2e8f0`
- 5 tabs: Home | New Transaction | Members | Today's Log | End of Day
- Each tab: icon (20px, outline) + label (11px) centered
- Active tab: icon + label in `#185FA5`, 2px top border in `#185FA5`
- Inactive: icon + label in `#94a3b8`

### Owner Left Sidebar
- Width: 190px
- Background: white `#ffffff`
- Right border: 1px `#e2e8f0`
- Items: icon (17px) + label (13px), padding 10px 14px
- Active: text and icon `#185FA5`, 2px right border `#185FA5`, background `#f8faff`
- Hover: background `#f8f9fa`
- Nav items: Dashboard · Transactions · Members · Inventory · Reports · Settings

---

## COLOUR USAGE GUIDE

| Element | Color |
|---|---|
| App header background | `#0C447C` |
| Primary buttons, active nav, links | `#185FA5` |
| Selected/info background fills | `#E6F1FB` |
| WhatsApp send button | `#0F6E56` |
| Page background / canvas | `#f4f5f7` |
| Card backgrounds | `#ffffff` |
| Card borders | `#e2e8f0` (1px) |
| Active tile top accent | `#185FA5` (3px top border) |
| EOD tile top accent | `#0F6E56` (3px top border) |
| Text primary | `#1a202c` |
| Text secondary | `#64748b` |
| Text muted / timestamps | `#94a3b8` |
| Active member badge | bg `#dcfce7` / text `#166534` |
| Expiring soon badge | bg `#fef3c7` / text `#92400e` |
| Expired badge | bg `#fee2e2` / text `#991b1b` |
| Cash payment badge | bg `#f1f5f9` / text `#475569` |
| QR payment badge | bg `#dbeafe` / text `#1e40af` |
| Success/positive | `#22c55e` |
| Warning/amber | `#f59e0b` |
| Error/danger | `#ef4444` |

---

## BADGE STYLES

All badges are pill-shaped (fully rounded, ~20px border-radius), padding 2px 8px, font-size 11px, weight 500.

| Badge | Background | Text |
|---|---|---|
| Active | `#dcfce7` | `#166534` |
| Expiring soon | `#fef3c7` | `#92400e` |
| Expired | `#fee2e2` | `#991b1b` |
| Paused | `#f1f5f9` | `#475569` |
| Cash | `#f1f5f9` | `#475569` |
| QR | `#dbeafe` | `#1e40af` |
| Membership | `#ede9fe` | `#5b21b6` |

---

## MEMBER AVATAR STYLE

Circles, 34–36px diameter, centered initials (11px, weight 500).
- Active member: bg `#dbeafe`, text `#1e40af`
- Expiring member: bg `#fef3c7`, text `#92400e`
- Expired member: bg `#fee2e2`, text `#991b1b`

---

## TABLE STYLE

All data tables:
- White background, 1px `#e2e8f0` border, 8px border-radius, overflow hidden
- Header row: background `#f8f9fa`, text `#64748b`, 11px, weight 500, padding 10px 14px
- Data rows: 12–13px, padding 10px 14px, border-top 1px `#e2e8f0`
- Hover state: very light gray `#f8f9fa` background on row

---

## METRIC CARD (KPI CARD) STYLE

Used in: Staff Home (top 3 cards), Owner Dashboard (top 4 KPIs)
- Background: `#f4f5f7` (secondary surface, slightly darker than white)
- No border
- Border-radius: 8px
- Padding: 12px 14px
- Label: 11px, `#64748b`, margin-bottom 5px
- Value: 20–22px, weight 500, `#1a202c`
- Sub: 11px, `#94a3b8` (or color-coded: green for positive, amber for warning)

---

## ACTION TILE STYLE (Staff Home)

- Background: white `#ffffff`
- Border: 1px `#e2e8f0`
- Border-radius: 12px
- Padding: 18px 14px
- Icon: 30px, outline style, colored per category
- Label: 13px, weight 500, `#1a202c`
- Subtitle: 11px, `#64748b`
- Primary tile (New Transaction): 3px top border in `#185FA5`
- EOD tile: 3px top border in `#0F6E56`
- Hover: border becomes `#185FA5`

---

## FORM FIELD STYLE

- Label: 12px, weight 500, `#64748b`, margin-bottom 5px
- Input / Select: full width, border 1px `#e2e8f0`, border-radius 6px, padding 8px 10px, 13px text, `#1a202c`
- Focus: border `#185FA5`
- Amount display box: background `#f4f5f7`, border-radius 8px, padding 11px 14px, label left `#64748b`, amount right `#1a202c` 19–20px weight 500

---

## PAYMENT TOGGLE STYLE

Two equal-width buttons side by side:
- Default state: white bg, `#e2e8f0` border, `#64748b` text
- Selected state: `#dbeafe` bg, `#185FA5` border, `#185FA5` text
- Each has an outline icon (cash icon / QR code icon) to the left of label

---

## STEP PROGRESS BAR

5 equal steps across top of transaction card:
- Done steps: 2px bottom border `#22c55e`, text `#22c55e` 10px
- Current step: 2px bottom border `#185FA5`, text `#185FA5` 10px weight 500
- Future steps: 2px bottom border `#e2e8f0`, text `#94a3b8` 10px

---

## ALERT CARD STYLE (Owner Dashboard)

Small cards stacked in right column:
- Amber alert: bg `#fef3c7`, text `#92400e`, icon + bold title (12px weight 500) + subtitle (11px)
- Red alert: bg `#fee2e2`, text `#991b1b`
- Green alert: bg `#dcfce7`, text `#166534`
- Border-radius: 8px, padding 9px 12px

---

## SETTINGS NAVIGATION CARD STYLE

Used in Settings screen:
- White bg, 1px `#e2e8f0` border, 8px radius
- Icon (20px, `#185FA5`) + title (13px weight 500) + description (11px `#64748b`) + chevron-right icon right (`#94a3b8`)
- Hover: slight background tint `#f8faff`
- Full-row clickable

---

## REPORT CARD STYLE

Used in Reports screen:
- White bg, 1px `#e2e8f0` border, 12px radius
- Padding: 14px 16px
- Icon row: colored icon (20px, `#185FA5`) + title (13px weight 500)
- Description: 11px `#64748b`, margin 6px top
- "Export to Excel" ghost button with spreadsheet icon (11px)

---

## REALISTIC SAMPLE DATA TO USE

**Staff name on shift:** Aarti

**Today's transactions (use across transaction screens):**
| ID | Time | Customer | Product | Amount | Payment |
|---|---|---|---|---|---|
| #108 | 8:12 AM | Walk-in | Pool Day Pass | Rs. 500 | Cash |
| #109 | 9:34 AM | Priya Sharma | Swimming + Gym — Monthly | Rs. 3,500 | QR |
| #110 | 10:05 AM | Walk-in | Whole Package | Rs. 800 | Cash |
| #111 | 11:20 AM | Walk-in | Gym Day Pass | Rs. 300 | Cash |
| #112 | 12:45 PM | Dipesh Rai | Sauna + Steam + Jacuzzi | Rs. 600 | QR |
| #113 | 2:10 PM | Walk-in | Pool Day Pass | Rs. 500 | Cash |

**Daily totals:** Rs. 6,200 total · Rs. 4,100 cash · Rs. 2,100 QR · 6 transactions

**Active members:**
| Name | Initials | Type | Status | Expiry |
|---|---|---|---|---|
| Rajesh Kumar | RK | Swimming + Gym | Active | 22 Jun 2026 |
| Rima Pradhan | RP | Gym Only | Expiring soon | 10 Jun 2026 |
| Anita Shrestha | AS | Swimming + Gym | Active | 15 Jul 2026 |
| Bikash Tamang | BT | Beginner Training | Expired | 1 Jun 2026 |
| Sushila KC | SK | Gym Only | Active | 30 Jun 2026 |

**Inventory items:**
| Item | Variant | Stock | Reorder | Status |
|---|---|---|---|---|
| Ladies Costume | Full Body | 4 | 3 | OK |
| Gents Costume | — | 6 | 3 | OK |
| Goggles | Adult Large | 8 | 5 | OK |
| Goggles | Baby | 2 | 5 | LOW |
| Swimming Cap | Small | 5 | 5 | OK |
| Nose Pin | — | 3 | 10 | LOW |
| Floating Tube | — | 4 | 2 | OK |

**Owner KPIs for dashboard:**
- Today's revenue: Rs. 6,200 (+18% vs yesterday)
- Active members: 47 (3 expiring soon)
- This month: Rs. 68,400 (Target: Rs. 80,000)
- Google reviews: 24, rating 4.7★ (Target: 50)

---

## PRODUCT CATALOGUE (for dropdown reference)

**Memberships:**
- Beginner Training — 15 Days
- Beginner Training — Monthly
- Advanced Training — 15 Days
- Advanced Training — Monthly
- Gym Only — Monthly
- Gym Only — 3 Months
- Gym Only — 6 Months
- Gym Only — 1 Year
- Swimming + Gym — Monthly
- Swimming + Gym — 3 Months
- Swimming + Gym — 6 Months
- Swimming + Gym — 1 Year

**Day Packages:**
- Sauna + Steam + Jacuzzi
- Swimming + Sauna + Steam
- Whole Package (Pool + Gym + Sauna + Steam + Jacuzzi)

**Day Passes:**
- Pool Day Pass
- Gym Day Pass

---

*This file is a design reference. For full product requirements, see Refresh_Software_PRD.md. For technical architecture, see Refresh_Developer_Brief.md.*
