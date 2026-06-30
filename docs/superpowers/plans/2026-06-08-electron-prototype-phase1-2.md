# Refresh Manager Electron Prototype (Phase 1–2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold an Electron-Vite project and migrate the existing HTML prototype's JSX files to ES modules, producing a working Electron app where all screens render correctly using mock data.

**Architecture:** electron-vite scaffold (React + JavaScript) provides the build pipeline. The 5 source files from `Refresh Software/src/` are copied into the new project and converted from CDN globals (`window.RM.*`, `window.lucide`, `Object.assign(window,...)`) to proper ES module imports/exports. CSS is extracted verbatim from the HTML prototype's `<style>` block.

**Tech Stack:** Electron 28+, Vite 5, React 18, lucide-react, Node 18+ LTS

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/renderer/index.html` | Modify | Add stage/scaler/root/hint structure + DM Sans font + fitStage script |
| `src/renderer/src/main.jsx` | Modify | createRoot entry; import app.css; remove StrictMode |
| `src/renderer/src/app.css` | Create | Full CSS extracted from `Refresh Manager.html` lines 11–242 |
| `src/renderer/src/App.jsx` | Create | App shell, Login, StaffApp, OwnerApp, StaffInventory; all bugs fixed |
| `src/renderer/src/components/ui.jsx` | Create | Icon (lucide-react lookup), WaveMark, Badge, PayBadge, Avatar, Window, AppHeader, SectionHead |
| `src/renderer/src/screens/staff.jsx` | Create | StaffHome, NewTransaction, MemberSearch, TodaysLog, EndOfDay |
| `src/renderer/src/screens/owner.jsx` | Create | OwnerDashboard, OwnerTransactions, OwnerMembers, OwnerInventory, OwnerReports, OwnerSettings |
| `src/renderer/src/data/mock.js` | Create | Named exports: transactions, members, inventory, products, eod, kpis, reports, settings, fmt |
| `src/main/index.js` | Modify | Window size 1280×880, frame: false |

---

## Task 1: Scaffold the project and verify a blank Electron window

**Files:**
- Create: `../refresh-manager/` (new project root, one level up from `Refresh Software/`)

- [ ] **Step 1.1: Scaffold the electron-vite project**

Run from `/Users/sambhav/Desktop/Refresh Manager/`:
```bash
cd "/Users/sambhav/Desktop/Refresh Manager"
npm create @quick-start/electron@latest refresh-manager
```
When prompted:
- Template: **react**
- Variant: **JavaScript** (not TypeScript)

- [ ] **Step 1.2: Install dependencies**

```bash
cd refresh-manager
npm install
npm install lucide-react
```

- [ ] **Step 1.3: Verify blank window opens**

```bash
npm run dev
```

Expected: A blank Electron window opens. No errors in terminal. Close it with Ctrl+C.

- [ ] **Step 1.4: Commit scaffold**

```bash
git init
git add .
git commit -m "chore: scaffold electron-vite react project"
```

---

## Task 2: Configure the Electron main window

**Files:**
- Modify: `src/main/index.js`

- [ ] **Step 2.1: Replace the generated createWindow function**

Open `src/main/index.js`. Find the `createWindow` function (it sets `width: 900, height: 670`). Replace the entire function with:

```javascript
function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 880,
    show: false,
    frame: false,
    resizable: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}
```

Keep everything else in `index.js` unchanged (app.whenReady, window-all-closed, etc.).

- [ ] **Step 2.2: Run and verify window size**

```bash
npm run dev
```

Expected: Electron window opens at 1280×880 with no native title bar (just a blank content area). Close it.

- [ ] **Step 2.3: Commit**

```bash
git add src/main/index.js
git commit -m "chore: configure window size 1280x880, frame: false"
```

---

## Task 3: Update the renderer index.html

**Files:**
- Modify: `src/renderer/index.html`

- [ ] **Step 3.1: Replace the generated index.html**

Replace the entire contents of `src/renderer/index.html` with:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Refresh Manager</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600&display=swap" rel="stylesheet" />
</head>
<body>
  <div id="stage">
    <div id="scaler">
      <div id="root"></div>
    </div>
  </div>
  <div class="kbd-hint" id="hint"></div>
  <script type="module" src="/src/main.jsx"></script>
  <script>
    function fitStage() {
      var winW = 1200, winH = 800, pad = 68;
      var s = Math.min((window.innerWidth - pad) / winW, (window.innerHeight - pad) / winH);
      s = Math.min(s, 1.05);
      var el = document.getElementById('scaler');
      if (el) el.style.transform = 'scale(' + s + ')';
    }
    window.addEventListener('resize', fitStage);
    window.__fitStage = fitStage;
    fitStage();
  </script>
</body>
</html>
```

- [ ] **Step 3.2: Commit**

```bash
git add src/renderer/index.html
git commit -m "chore: add stage/scaler structure and DM Sans font"
```

---

## Task 4: Create app.css

**Files:**
- Create: `src/renderer/src/app.css`

- [ ] **Step 4.1: Extract the CSS from the HTML prototype**

Open `../Refresh Software/Refresh Manager.html`. Copy everything between (and not including) the `<style>` and `</style>` tags (lines 11–242). Create `src/renderer/src/app.css` and paste those lines verbatim.

The file starts with `:root {` and ends with `.kbd-hint kbd { ... }`. If you want to verify you got the right block, the last line of the CSS should be:
```css
  .kbd-hint kbd { background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.14); border-radius: 4px; padding: 1px 6px; font-family: inherit; font-size: 11px; }
```

Then add one line at the top to note the source:
```css
/* Extracted from Refresh Manager.html — full design token set for Refresh Manager */
```

- [ ] **Step 4.2: Add the drag region rule for the frameless titlebar**

Append at the bottom of `app.css`:

```css
/* Frameless window drag region */
.titlebar { -webkit-app-region: drag; }
.win-controls button { -webkit-app-region: no-drag; }
```

- [ ] **Step 4.3: Commit**

```bash
git add src/renderer/src/app.css
git commit -m "feat: add app.css extracted from HTML prototype"
```

---

## Task 5: Create data/mock.js

**Files:**
- Create: `src/renderer/src/data/mock.js`

- [ ] **Step 5.1: Create the file with named exports**

Create `src/renderer/src/data/mock.js`:

```javascript
export const transactions = [
  { id: "#108", time: "8:12 AM", customer: "Walk-in", product: "Pool Day Pass", amount: 500, pay: "Cash", staff: "Aarti" },
  { id: "#109", time: "9:34 AM", customer: "Priya Sharma", product: "Swimming + Gym — Monthly", amount: 3500, pay: "QR", staff: "Aarti" },
  { id: "#110", time: "10:05 AM", customer: "Walk-in", product: "Whole Package", amount: 800, pay: "Cash", staff: "Aarti" },
  { id: "#111", time: "11:20 AM", customer: "Walk-in", product: "Gym Day Pass", amount: 300, pay: "Cash", staff: "Aarti" },
  { id: "#112", time: "12:45 PM", customer: "Dipesh Rai", product: "Sauna + Steam + Jacuzzi", amount: 600, pay: "QR", staff: "Aarti" },
  { id: "#113", time: "2:10 PM", customer: "Walk-in", product: "Pool Day Pass", amount: 500, pay: "Cash", staff: "Aarti" },
];

export const members = [
  { name: "Rajesh Kumar",  initials: "RK", type: "Swimming + Gym",    phone: "9841112233", status: "Active",        expiry: "22 Jun 2026" },
  { name: "Rima Pradhan",  initials: "RP", type: "Gym Only",          phone: "9851223344", status: "Expiring soon", expiry: "10 Jun 2026" },
  { name: "Anita Shrestha",initials: "AS", type: "Swimming + Gym",    phone: "9802113355", status: "Active",        expiry: "15 Jul 2026" },
  { name: "Bikash Tamang", initials: "BT", type: "Beginner Training", phone: "9841556677", status: "Expired",       expiry: "1 Jun 2026"  },
  { name: "Sushila KC",    initials: "SK", type: "Gym Only",          phone: "9818334455", status: "Active",        expiry: "30 Jun 2026" },
];

export const inventory = [
  { item: "Ladies Costume", variant: "Full Body", stock: 4,  reorder: 3,  price: 1200, low: false },
  { item: "Gents Costume",  variant: "—",         stock: 6,  reorder: 3,  price: 900,  low: false },
  { item: "Goggles",        variant: "Adult Large",stock: 8, reorder: 5,  price: 450,  low: false },
  { item: "Goggles",        variant: "Baby",       stock: 2, reorder: 5,  price: 350,  low: true  },
  { item: "Swimming Cap",   variant: "Small",      stock: 5, reorder: 5,  price: 250,  low: false },
  { item: "Nose Pin",       variant: "—",          stock: 3, reorder: 10, price: 120,  low: true  },
  { item: "Floating Tube",  variant: "—",          stock: 4, reorder: 2,  price: 600,  low: false },
];

export const products = {
  "Membership": [
    "Beginner Training — 15 Days", "Beginner Training — Monthly",
    "Advanced Training — 15 Days", "Advanced Training — Monthly",
    "Gym Only — Monthly", "Gym Only — 3 Months", "Gym Only — 6 Months", "Gym Only — 1 Year",
    "Swimming + Gym — Monthly", "Swimming + Gym — 3 Months", "Swimming + Gym — 6 Months", "Swimming + Gym — 1 Year",
  ],
  "Day Package": ["Sauna + Steam + Jacuzzi", "Swimming + Sauna + Steam", "Whole Package (Pool + Gym + Sauna + Steam + Jacuzzi)"],
  "Day Pass": ["Pool Day Pass", "Gym Day Pass"],
};

export const eod = {
  total: 6200, cash: 4100, qr: 2100, count: 8,
  rows: [
    { label: "Cash",                   value: "Rs. 4,100" },
    { label: "QR (eSewa / Khalti)",    value: "Rs. 2,100" },
    { label: "Memberships sold",       value: "Rs. 3,500", note: "2" },
    { label: "Day packages",           value: "Rs. 1,400", note: "3" },
    { label: "Day passes",             value: "Rs. 1,300", note: "3" },
  ],
};

export const kpis = [
  { label: "Today's revenue",  value: "Rs. 6,200", sub: "+18% vs yesterday",    tone: "pos"   },
  { label: "Active members",   value: "47",         sub: "3 expiring soon",      tone: "warn"  },
  { label: "This month",       value: "Rs. 68,400", sub: "Target: Rs. 80,000",  tone: "muted" },
  { label: "Google reviews",   value: "24  ·  ★ 4.7", sub: "Target: 50",        tone: "muted" },
];

export const reports = [
  { icon: "calendar",       title: "Daily revenue",       desc: "All transactions for a selected day" },
  { icon: "calendar-range", title: "Monthly revenue",     desc: "Aggregated by week and product" },
  { icon: "filter",         title: "Custom date range",   desc: "Any range with type & staff filters" },
  { icon: "users",          title: "Member report",       desc: "Full list with status and expiry" },
  { icon: "clock-alert",    title: "Expiry report",       desc: "Members expiring in next N days" },
  { icon: "package",        title: "Inventory report",    desc: "Stock levels and sales history" },
];

export const settings = [
  { icon: "tag",          title: "Pricing manager",  desc: "Edit prices for all products" },
  { icon: "layout-grid",  title: "Product manager",  desc: "Add or deactivate products" },
  { icon: "user-check",   title: "Staff PINs",       desc: "Manage staff access PINs" },
  { icon: "message-circle",title: "WhatsApp number", desc: "Owner number for daily reports" },
  { icon: "folder",       title: "Backup settings",  desc: "Folder path and schedule" },
  { icon: "building-2",   title: "Business info",    desc: "Name, address, phone" },
];

export function fmt(n) {
  return "Rs. " + n.toLocaleString("en-IN");
}
```

- [ ] **Step 5.2: Commit**

```bash
git add src/renderer/src/data/mock.js
git commit -m "feat: add mock data as ES module"
```

---

## Task 6: Create components/ui.jsx

**Files:**
- Create: `src/renderer/src/components/ui.jsx`

- [ ] **Step 6.1: Create the file**

Create `src/renderer/src/components/ui.jsx`:

```jsx
import {
  AlertTriangle, Banknote, BarChart3, Building2, Calendar, CalendarClock,
  CalendarRange, Check, CheckCheck, ChevronLeft, ChevronRight, ClockAlert,
  Download, Filter, Folder, Home, LayoutDashboard, LayoutGrid, List, LogOut,
  MessageCircle, MoreVertical, Package, Plus, PlusCircle, QrCode, ReceiptText,
  Search, Send, Settings, Sheet, Shield, Tag, TrendingUp, User, UserCheck,
  UserSearch, Users,
} from 'lucide-react';

const ICONS = {
  'alert-triangle':  AlertTriangle,
  'banknote':        Banknote,
  'bar-chart-3':     BarChart3,
  'building-2':      Building2,
  'calendar':        Calendar,
  'calendar-clock':  CalendarClock,
  'calendar-range':  CalendarRange,
  'check':           Check,
  'check-check':     CheckCheck,
  'chevron-left':    ChevronLeft,
  'chevron-right':   ChevronRight,
  'clock-alert':     ClockAlert,
  'download':        Download,
  'filter':          Filter,
  'folder':          Folder,
  'home':            Home,
  'layout-dashboard':LayoutDashboard,
  'layout-grid':     LayoutGrid,
  'list':            List,
  'log-out':         LogOut,
  'message-circle':  MessageCircle,
  'more-vertical':   MoreVertical,
  'package':         Package,
  'plus':            Plus,
  'plus-circle':     PlusCircle,
  'qr-code':         QrCode,
  'receipt-text':    ReceiptText,
  'search':          Search,
  'send':            Send,
  'settings':        Settings,
  'sheet':           Sheet,
  'shield':          Shield,
  'tag':             Tag,
  'trending-up':     TrendingUp,
  'user':            User,
  'user-check':      UserCheck,
  'user-search':     UserSearch,
  'users':           Users,
};

export function Icon({ name, size = 18, color, strokeWidth = 1.9, style }) {
  const Comp = ICONS[name];
  if (!Comp) {
    console.warn(`Icon not found: "${name}"`);
    return <span style={{ display: 'inline-flex', width: size, height: size }} />;
  }
  return (
    <Comp
      size={size}
      color={color || 'currentColor'}
      strokeWidth={strokeWidth}
      style={{ display: 'inline-flex', flexShrink: 0, ...style }}
    />
  );
}

export const WaveMark = ({ size = 22, color = "#fff" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path
      d="M2 8c2.2 0 2.2 2 4.4 2s2.2-2 4.4-2 2.2 2 4.4 2S17.4 8 19.6 8 21.8 10 22 10"
      stroke={color} strokeWidth="2" strokeLinecap="round"
    />
    <path
      d="M2 13c2.2 0 2.2 2 4.4 2s2.2-2 4.4-2 2.2 2 4.4 2 2.2-2 4.4-2 2 2 2.4 2"
      stroke={color} strokeWidth="2" strokeLinecap="round" opacity=".6"
    />
  </svg>
);

export function Badge({ kind, children }) {
  const map = {
    "Active":        "b-active",
    "Expiring soon": "b-exp",
    "Expired":       "b-dead",
    "Cash":          "b-cash",
    "QR":            "b-qr",
    "Membership":    "b-mem",
  };
  return <span className={"badge " + (map[kind] || "b-cash")}>{children || kind}</span>;
}

export function PayBadge({ pay }) {
  return <span className={"badge " + (pay === "QR" ? "b-qr" : "b-cash")}>{pay}</span>;
}

export function Avatar({ initials, status }) {
  const cls = status === "Active" ? "av-active" : status === "Expired" ? "av-dead" : "av-exp";
  return <div className={"avatar " + cls}>{initials}</div>;
}

export function Window({ children, onClose }) {
  return (
    <div className="win">
      <div className="titlebar">
        <div className="tb-left">
          <div className="tb-dot" />
          <span className="tb-title">Refresh Manager</span>
        </div>
        <div className="win-controls">
          <button title="Minimize">
            <svg className="gl" viewBox="0 0 10 10">
              <line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" strokeWidth="1" />
            </svg>
          </button>
          <button title="Maximize">
            <svg className="gl" viewBox="0 0 10 10">
              <rect x="1.2" y="1.2" width="7.6" height="7.6" fill="none" stroke="currentColor" strokeWidth="1" />
            </svg>
          </button>
          <button className="close" title="Close" onClick={onClose}>
            <svg className="gl" viewBox="0 0 10 10">
              <line x1="1.5" y1="1.5" x2="8.5" y2="8.5" stroke="currentColor" strokeWidth="1" />
              <line x1="8.5" y1="1.5" x2="1.5" y2="8.5" stroke="currentColor" strokeWidth="1" />
            </svg>
          </button>
        </div>
      </div>
      {children}
    </div>
  );
}

export function AppHeader({ role, onLogout }) {
  return (
    <div className="hdr">
      <div className="hdr-brand">
        <div className="hdr-logo"><WaveMark size={24} /></div>
        <span className="hdr-name">Refresh Manager</span>
      </div>
      <div className="hdr-right">
        <div className="hdr-user">
          <Icon name={role === "staff" ? "user" : "shield"} size={15} color="#bcd4ee" />
          <span>{role === "staff" ? "Aarti · Reception" : "Owner · Admin"}</span>
        </div>
        <button className="ghost-btn" onClick={onLogout}>
          <Icon name="log-out" size={14} /> Log out
        </button>
      </div>
    </div>
  );
}

export function SectionHead({ title, date, children }) {
  return (
    <div className="between" style={{ marginBottom: 18 }}>
      <div>
        <div className="h1">{title}</div>
        {date && <div className="sub" style={{ marginTop: 3 }}>{date}</div>}
      </div>
      <div className="row" style={{ gap: 10, alignItems: "center" }}>{children}</div>
    </div>
  );
}
```

- [ ] **Step 6.2: Commit**

```bash
git add src/renderer/src/components/ui.jsx
git commit -m "feat: add ui components as ES module with lucide-react"
```

---

## Task 7: Create screens/staff.jsx

**Files:**
- Create: `src/renderer/src/screens/staff.jsx`

- [ ] **Step 7.1: Create the file**

Create `src/renderer/src/screens/staff.jsx`:

```jsx
import { useState } from 'react';
import { transactions, members, products, eod, inventory, fmt } from '../data/mock';
import { Icon, Badge, PayBadge, Avatar, SectionHead } from '../components/ui';

const PRICE = {
  "Pool Day Pass": 500, "Gym Day Pass": 300,
  "Sauna + Steam + Jacuzzi": 600, "Swimming + Sauna + Steam": 700,
  "Whole Package (Pool + Gym + Sauna + Steam + Jacuzzi)": 800,
  "Beginner Training — 15 Days": 2000, "Beginner Training — Monthly": 3000,
  "Advanced Training — 15 Days": 2500, "Advanced Training — Monthly": 4000,
  "Gym Only — Monthly": 2000, "Gym Only — 3 Months": 5500, "Gym Only — 6 Months": 10000, "Gym Only — 1 Year": 18000,
  "Swimming + Gym — Monthly": 3500, "Swimming + Gym — 3 Months": 9500, "Swimming + Gym — 6 Months": 18000, "Swimming + Gym — 1 Year": 32000,
};
const priceOf = (p) => PRICE[p] || 0;

export function StaffHome({ go }) {
  const metrics = [
    { label: "Revenue today", value: "Rs. 5,700" },
    { label: "Cash",          value: "Rs. 3,800" },
    { label: "QR",            value: "Rs. 1,900" },
  ];
  const tiles = [
    { k: "new",     icon: "plus-circle",  c: "#185FA5", bg: "#E6F1FB", t: "New Transaction",  s: "Day pass · Package · Membership", accent: "accent-blue" },
    { k: "members", icon: "user-search",  c: "#0F6E56", bg: "#dcfce7", t: "Search Member",     s: "Check status and expiry" },
    { k: "log",     icon: "list",         c: "#64748b", bg: "#f1f5f9", t: "Today's Log",       s: "8 transactions so far" },
    { k: "eod",     icon: "send",         c: "#0F6E56", bg: "#d6f0e7", t: "End of Day",        s: "Send WhatsApp report", accent: "accent-teal" },
    { k: "inv",     icon: "package",      c: "#b45309", bg: "#fef3c7", t: "Inventory",         s: "2 items low stock", warn: true },
    { k: "more",    icon: "layout-grid",  c: "#94a3b8", bg: "#f1f5f9", t: "More",              s: "Coming soon", dim: true },
  ];
  return (
    <div className="content fade-in">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 18 }}>
        {metrics.map((m) => (
          <div key={m.label} className="metric">
            <div className="m-label">{m.label}</div>
            <div className="m-value">{m.value}</div>
          </div>
        ))}
      </div>
      <div className="tiles">
        {tiles.map((t) => (
          <div
            key={t.k}
            className={"tile " + (t.accent || "") + (t.dim ? " dim" : "")}
            onClick={() => !t.dim && go(t.k)}
          >
            <div className="t-icon" style={{ background: t.bg }}>
              <Icon name={t.icon} size={22} color={t.c} />
            </div>
            <div>
              <div className="t-title">{t.t}</div>
              <div className={"t-sub" + (t.warn ? " warn" : "")} style={{ marginTop: 3 }}>{t.s}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function NewTransaction({ onDone }) {
  const [step, setStep] = useState(0);
  const [type, setType] = useState("Day Pass");
  const [product, setProduct] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [pay, setPay] = useState("Cash");
  const [saved, setSaved] = useState(false);

  const labels = ["Type", "Product", "Customer", "Payment", "Confirm"];
  const amount = priceOf(product);

  if (saved) {
    return (
      <div className="content fade-in" style={{ display: "grid", placeItems: "center" }}>
        <div className="card scale-in" style={{ width: 420, padding: "34px 28px", textAlign: "center" }}>
          <div style={{ width: 60, height: 60, borderRadius: "50%", background: "#dcfce7", display: "grid", placeItems: "center", margin: "0 auto 16px" }}>
            <Icon name="check" size={30} color="#16a34a" />
          </div>
          <div style={{ fontSize: 17, fontWeight: 500 }}>Transaction saved</div>
          <div className="sub" style={{ marginTop: 6 }}>{product} · {fmt(amount)} · {pay}</div>
          <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
            <button className="btn btn-ghost btn-block" onClick={() => { setSaved(false); setStep(0); setType("Day Pass"); setProduct(""); setName(""); setPhone(""); }}>
              New transaction
            </button>
            <button className="btn btn-primary btn-block" onClick={() => onDone("home")}>Done</button>
          </div>
        </div>
      </div>
    );
  }

  const StepBar = () => (
    <div className="steps">
      {labels.map((l, i) => (
        <div key={l} className={"step " + (i < step ? "done" : i === step ? "active" : "")}>
          {i < step && <Icon name="check" size={10} style={{ marginRight: 3, verticalAlign: "-1px" }} />}{l}
        </div>
      ))}
    </div>
  );

  const next = () => setStep((s) => Math.min(4, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));

  return (
    <div className="content fade-in" style={{ display: "grid", placeItems: "start center", paddingTop: 26 }}>
      <div className="card" style={{ width: 500, padding: 22 }}>
        <StepBar />

        {step === 0 && (
          <div className="fade-in">
            <div className="field">
              <label>Transaction type</label>
              <select className="select" value={type} onChange={(e) => { setType(e.target.value); setProduct(""); }}>
                {Object.keys(products).map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            <p className="sub" style={{ marginBottom: 4 }}>Pick what the customer is paying for to continue.</p>
          </div>
        )}

        {step === 1 && (
          <div className="fade-in">
            <div className="field">
              <label>Product</label>
              <select className="select" value={product} onChange={(e) => setProduct(e.target.value)}>
                <option value="">Select a product…</option>
                {products[type].map((p) => <option key={p}>{p}</option>)}
              </select>
            </div>
            {product && <div className="amount-box"><span className="a-label">Amount</span><span className="a-value">{fmt(amount)}</span></div>}
          </div>
        )}

        {step === 2 && (
          <div className="fade-in">
            <div className="field"><label>Transaction type</label><select className="select" value={type} disabled style={{ color: "#475569" }}><option>{type}</option></select></div>
            <div className="field"><label>Product</label><select className="select" value={product} disabled style={{ color: "#475569" }}><option>{product}</option></select></div>
            <div className="field"><label>Customer name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" /></div>
            <div className="field"><label>Phone (optional)</label><input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98XXXXXXXX" /></div>
            <div className="amount-box"><span className="a-label">Amount</span><span className="a-value">{fmt(amount)}</span></div>
          </div>
        )}

        {step === 3 && (
          <div className="fade-in">
            <div className="amount-box" style={{ marginBottom: 16 }}><span className="a-label">Amount due</span><span className="a-value">{fmt(amount)}</span></div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 500, color: "#64748b", marginBottom: 8 }}>Payment method</label>
            <div className="toggle-row">
              <button className={"toggle-btn" + (pay === "Cash" ? " sel" : "")} onClick={() => setPay("Cash")}><Icon name="banknote" size={17} /> Cash</button>
              <button className={"toggle-btn" + (pay === "QR" ? " sel" : "")} onClick={() => setPay("QR")}><Icon name="qr-code" size={17} /> QR (eSewa / Khalti)</button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="fade-in">
            {[["Type", type], ["Product", product], ["Customer", name || "Walk-in"], ["Phone", phone || "—"], ["Payment", pay]].map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
                <span style={{ color: "#64748b" }}>{k}</span>
                <span style={{ color: "#1a202c" }}>{v}</span>
              </div>
            ))}
            <div className="amount-box" style={{ marginTop: 14 }}><span className="a-label">Total</span><span className="a-value">{fmt(amount)}</span></div>
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          {step > 0 && <button className="btn btn-ghost" onClick={back}><Icon name="chevron-left" size={16} /> Back</button>}
          <div className="spacer" />
          {step < 4
            ? <button className="btn btn-primary" disabled={step === 1 && !product} style={step === 1 && !product ? { opacity: .5, cursor: "not-allowed" } : null} onClick={next}>Continue <Icon name="chevron-right" size={16} /></button>
            : <button className="btn btn-primary btn-block" style={{ width: "auto", flex: 1 }} onClick={() => setSaved(true)}><Icon name="check" size={16} /> Confirm & Save</button>
          }
        </div>
      </div>
    </div>
  );
}

export function MemberSearch() {
  const [q, setQ] = useState("");
  const all = members;
  const res = all.filter((m) => (m.name + m.phone).toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="content fade-in" style={{ maxWidth: 720, margin: "0 auto" }}>
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <div style={{ position: "relative", flex: 1 }}>
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", display: "flex" }}>
            <Icon name="search" size={16} color="#94a3b8" />
          </span>
          <input className="input" style={{ paddingLeft: 36 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or phone…" />
        </div>
        <button className="btn btn-primary">Search</button>
      </div>
      <div className="sub" style={{ marginBottom: 12 }}>{res.length} result{res.length !== 1 ? "s" : ""} found</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {res.map((m) => (
          <div key={m.name} className="card" style={{ padding: "13px 16px", display: "flex", alignItems: "center", gap: 14 }}>
            <Avatar initials={m.initials} status={m.status} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 500 }}>{m.name}</div>
              <div className="sub" style={{ color: "#64748b", marginTop: 2 }}>{m.type} · {m.phone}</div>
            </div>
            <div style={{ textAlign: "right", display: "flex", flexDirection: "column", gap: 5, alignItems: "flex-end" }}>
              <Badge kind={m.status} />
              <span style={{ fontSize: 11.5, color: m.status === "Expiring soon" ? "#b45309" : m.status === "Expired" ? "#991b1b" : "#94a3b8" }}>
                Expires {m.expiry}
              </span>
            </div>
          </div>
        ))}
        {res.length === 0 && <div className="card" style={{ padding: 28, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>No members match "{q}".</div>}
      </div>
    </div>
  );
}

export function TodaysLog() {
  const tx = transactions;
  const total = tx.reduce((s, t) => s + t.amount, 0);
  return (
    <div className="content fade-in" style={{ maxWidth: 860, margin: "0 auto" }}>
      <SectionHead title="Today's Log" date="Sunday, 7 Jun 2026" />
      <table className="tbl">
        <thead>
          <tr>
            <th style={{ width: 90 }}>Time</th>
            <th>Customer &amp; Product</th>
            <th className="num" style={{ width: 110 }}>Amount</th>
            <th style={{ width: 90 }}>Payment</th>
          </tr>
        </thead>
        <tbody>
          {tx.map((t) => (
            <tr key={t.id}>
              <td style={{ color: "#94a3b8" }}>{t.time}</td>
              <td><span style={{ fontWeight: 500 }}>{t.customer}</span> <span style={{ color: "#94a3b8" }}>· {t.product}</span></td>
              <td className="num">{fmt(t.amount)}</td>
              <td><PayBadge pay={t.pay} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="tbl-foot">
        <span>{tx.length} transactions · today</span>
        <span className="total">Total: {fmt(total)}</span>
      </div>
    </div>
  );
}

export function EndOfDay() {
  const e = eod;
  const [sent, setSent] = useState(false);
  return (
    <div className="content fade-in" style={{ display: "grid", placeItems: "start center", paddingTop: 24 }}>
      <div className="card scale-in" style={{ width: 420, padding: 24 }}>
        <div style={{ textAlign: "center", paddingBottom: 18 }}>
          <div className="m-label" style={{ fontSize: 12 }}>Total revenue today</div>
          <div style={{ fontSize: 34, fontWeight: 500, margin: "4px 0 4px", letterSpacing: ".2px" }}>{fmt(e.total)}</div>
          <div className="sub">{e.count} transactions · Sunday, 7 Jun 2026</div>
        </div>
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 6 }}>
          {e.rows.map((r) => (
            <div key={r.label} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", fontSize: 13, borderBottom: "1px solid #f1f5f9" }}>
              <span style={{ color: "#64748b" }}>{r.label}</span>
              <span>{r.value}{r.note && <span style={{ color: "#94a3b8" }}> ({r.note})</span>}</span>
            </div>
          ))}
        </div>
        <button
          className={"btn btn-block " + (sent ? "btn-ghost" : "btn-teal")}
          style={{ marginTop: 18, ...(sent ? { color: "#0F6E56", borderColor: "#bbe3d6", background: "#eafaf4" } : {}) }}
          onClick={() => setSent(true)}
        >
          <Icon name={sent ? "check-check" : "message-circle"} size={17} />
          {sent ? "Report sent to owner" : "Send to owner via WhatsApp"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 7.2: Commit**

```bash
git add src/renderer/src/screens/staff.jsx
git commit -m "feat: add staff screens as ES module"
```

---

## Task 8: Create screens/owner.jsx

**Files:**
- Create: `src/renderer/src/screens/owner.jsx`

- [ ] **Step 8.1: Create the file**

Create `src/renderer/src/screens/owner.jsx`:

```jsx
import { transactions, members, inventory, kpis, reports, settings, fmt } from '../data/mock';
import { Icon, Badge, PayBadge, Avatar, SectionHead } from '../components/ui';

export function OwnerDashboard() {
  const tx = transactions.slice(0, 5);
  const total = transactions.reduce((s, t) => s + t.amount, 0);
  const alerts = [
    { c: "amber", icon: "calendar-clock", t: "3 memberships expiring",  d: "Within next 5 days" },
    { c: "red",   icon: "alert-triangle", t: "2 items low stock",       d: "Goggles Baby · Nose Pin" },
    { c: "green", icon: "trending-up",    t: "7 new members this week", d: "On track for target" },
  ];
  return (
    <div className="content fade-in">
      <SectionHead title="Dashboard" date="Sunday, 7 Jun 2026">
        <button className="btn btn-ghost"><Icon name="download" size={15} /> Export today</button>
      </SectionHead>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 18 }}>
        {kpis.map((k) => (
          <div key={k.label} className="metric">
            <div className="m-label">{k.label}</div>
            <div className="m-value">{k.value}</div>
            <div className={"m-sub " + k.tone}>{k.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 290px", gap: 16 }}>
        <div>
          <div className="between" style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 500 }}>Recent transactions</div>
            <a style={{ fontSize: 12, color: "#185FA5", cursor: "pointer" }}>View all</a>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 56 }}>ID</th>
                <th style={{ width: 84 }}>Time</th>
                <th>Customer</th>
                <th>Product</th>
                <th className="num" style={{ width: 92 }}>Amount</th>
                <th style={{ width: 70 }}>Pay</th>
                <th style={{ width: 70 }}>Staff</th>
              </tr>
            </thead>
            <tbody>
              {tx.map((t) => (
                <tr key={t.id}>
                  <td style={{ color: "#94a3b8" }}>{t.id}</td>
                  <td style={{ color: "#94a3b8" }}>{t.time}</td>
                  <td style={{ fontWeight: 500 }}>{t.customer}</td>
                  <td style={{ color: "#64748b", fontSize: 12.5 }}>{t.product}</td>
                  <td className="num">{fmt(t.amount)}</td>
                  <td><PayBadge pay={t.pay} /></td>
                  <td style={{ color: "#64748b" }}>{t.staff}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="tbl-foot">
            <span>{transactions.length} transactions · today</span>
            <span className="total">Total: {fmt(total)}</span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: -1 }}>Alerts</div>
          {alerts.map((a) => (
            <div key={a.t} className={"alert " + a.c}>
              <Icon name={a.icon} size={17} />
              <div><div className="a-title">{a.t}</div><div className="a-desc">{a.d}</div></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function OwnerTransactions() {
  const tx = transactions;
  const total = tx.reduce((s, t) => s + t.amount, 0);
  return (
    <div className="content fade-in">
      <SectionHead title="Transactions" />
      <div style={{ display: "flex", gap: 10, marginBottom: 14, alignItems: "center" }}>
        <select className="select" style={{ width: 130 }} defaultValue="Today">
          <option>Today</option><option>Yesterday</option><option>This week</option><option>This month</option>
        </select>
        <select className="select" style={{ width: 140 }} defaultValue="All types">
          <option>All types</option><option>Membership</option><option>Day Package</option><option>Day Pass</option>
        </select>
        <select className="select" style={{ width: 130 }} defaultValue="All staff">
          <option>All staff</option><option>Aarti</option>
        </select>
        <div className="spacer" />
        <button className="btn btn-ghost"><Icon name="sheet" size={15} color="#16a34a" /> Export Excel</button>
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th style={{ width: 56 }}>ID</th>
            <th style={{ width: 84 }}>Time</th>
            <th>Customer</th>
            <th>Product</th>
            <th className="num" style={{ width: 96 }}>Amount</th>
            <th style={{ width: 76 }}>Payment</th>
            <th style={{ width: 44 }}></th>
          </tr>
        </thead>
        <tbody>
          {tx.map((t) => (
            <tr key={t.id}>
              <td style={{ color: "#94a3b8" }}>{t.id}</td>
              <td style={{ color: "#94a3b8" }}>{t.time}</td>
              <td style={{ fontWeight: 500 }}>{t.customer}</td>
              <td style={{ color: "#64748b", fontSize: 12.5 }}>{t.product}</td>
              <td className="num">{fmt(t.amount)}</td>
              <td><PayBadge pay={t.pay} /></td>
              <td><button className="rowmenu"><Icon name="more-vertical" size={16} color="#94a3b8" /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="tbl-foot">
        <span>{tx.length} transactions</span>
        <span className="total">Total: {fmt(total)}</span>
      </div>
    </div>
  );
}

export function OwnerMembers() {
  const m = members;
  return (
    <div className="content fade-in">
      <SectionHead title="Members" />
      <div style={{ display: "flex", gap: 10, marginBottom: 14, alignItems: "center" }}>
        <div style={{ position: "relative", width: 260 }}>
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", display: "flex" }}>
            <Icon name="search" size={15} color="#94a3b8" />
          </span>
          <input className="input" style={{ paddingLeft: 34 }} placeholder="Search members…" />
        </div>
        <select className="select" style={{ width: 150 }} defaultValue="All statuses">
          <option>All statuses</option><option>Active</option><option>Expiring soon</option><option>Expired</option>
        </select>
        <div className="spacer" />
        <button className="btn btn-ghost"><Icon name="download" size={15} /> Export</button>
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th>Member</th>
            <th style={{ width: 180 }}>Membership type</th>
            <th style={{ width: 130 }}>Status</th>
            <th style={{ width: 140 }}>Expiry date</th>
          </tr>
        </thead>
        <tbody>
          {m.map((x) => (
            <tr key={x.name}>
              <td>
                <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                  <Avatar initials={x.initials} status={x.status} />
                  <div>
                    <div style={{ fontWeight: 500 }}>{x.name}</div>
                    <div style={{ fontSize: 11.5, color: "#94a3b8", marginTop: 1 }}>{x.phone}</div>
                  </div>
                </div>
              </td>
              <td style={{ color: "#64748b" }}>{x.type}</td>
              <td><Badge kind={x.status} /></td>
              <td style={{ color: x.status === "Expired" ? "#991b1b" : x.status === "Expiring soon" ? "#b45309" : "#64748b" }}>
                {x.expiry}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function OwnerInventory() {
  const inv = inventory;
  return (
    <div className="content fade-in">
      <SectionHead title="Inventory">
        <button className="btn btn-ghost"><Icon name="download" size={15} /> Export</button>
        <button className="btn btn-primary"><Icon name="plus" size={15} /> Add item</button>
      </SectionHead>
      <div className="alert red" style={{ marginBottom: 14 }}>
        <Icon name="alert-triangle" size={17} />
        <div><div className="a-title">2 items below reorder threshold</div><div className="a-desc">Goggles (Baby) · Nose Pin</div></div>
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th>Item</th>
            <th style={{ width: 130 }}>Variant</th>
            <th className="num" style={{ width: 80 }}>Stock</th>
            <th className="num" style={{ width: 90 }}>Reorder at</th>
            <th className="num" style={{ width: 90 }}>Price</th>
            <th style={{ width: 110 }}></th>
          </tr>
        </thead>
        <tbody>
          {inv.map((r, i) => (
            <tr key={i}>
              <td style={{ fontWeight: 500 }}>
                {r.low && <Icon name="alert-triangle" size={14} color="#ef4444" style={{ verticalAlign: "-2px", marginRight: 6 }} />}
                {r.item}
              </td>
              <td style={{ color: "#64748b" }}>{r.variant}</td>
              <td className="num" style={{ color: r.low ? "#ef4444" : "#1a202c", fontWeight: r.low ? 500 : 400 }}>{r.stock}</td>
              <td className="num" style={{ color: "#94a3b8" }}>{r.reorder}</td>
              <td className="num">{fmt(r.price)}</td>
              <td>
                <button className={"btn " + (r.low ? "btn-primary" : "btn-ghost")} style={{ padding: "5px 11px", fontSize: 12 }}>Restock</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function OwnerReports() {
  return (
    <div className="content fade-in">
      <SectionHead title="Reports & exports" date="Generate and download Excel reports" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
        {reports.map((r) => (
          <div key={r.title} className="card" style={{ padding: "16px 16px 14px", display: "flex", flexDirection: "column", gap: 8, cursor: "pointer", transition: "border-color .12s" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: 9, background: "#E6F1FB", display: "grid", placeItems: "center" }}>
                <Icon name={r.icon} size={18} color="#185FA5" />
              </div>
              <div style={{ fontSize: 14, fontWeight: 500 }}>{r.title}</div>
            </div>
            <div className="sub" style={{ color: "#64748b", lineHeight: 1.45, minHeight: 32 }}>{r.desc}</div>
            <button className="btn btn-ghost" style={{ alignSelf: "flex-start", padding: "6px 11px", fontSize: 12 }}>
              <Icon name="sheet" size={14} color="#16a34a" /> Export to Excel
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function OwnerSettings() {
  return (
    <div className="content fade-in">
      <SectionHead title="Settings" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
        {settings.map((s) => (
          <div key={s.title} className="settings-card card" style={{ padding: "15px 16px", display: "flex", alignItems: "center", gap: 13, cursor: "pointer", transition: "background .12s, border-color .12s" }}>
            <div style={{ width: 38, height: 38, borderRadius: 9, background: "#E6F1FB", display: "grid", placeItems: "center", flex: "0 0 38px" }}>
              <Icon name={s.icon} size={18} color="#185FA5" />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13.5, fontWeight: 500 }}>{s.title}</div>
              <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 2 }}>{s.desc}</div>
            </div>
            <Icon name="chevron-right" size={17} color="#94a3b8" />
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 8.2: Commit**

```bash
git add src/renderer/src/screens/owner.jsx
git commit -m "feat: add owner screens as ES module"
```

---

## Task 9: Create App.jsx and update main.jsx

**Files:**
- Create: `src/renderer/src/App.jsx` (replace generated)
- Modify: `src/renderer/src/main.jsx`

- [ ] **Step 9.1: Replace App.jsx**

Replace the entire contents of `src/renderer/src/App.jsx` with:

```jsx
import { useState, useEffect } from 'react';
import { Window, WaveMark, Icon, AppHeader, SectionHead } from './components/ui';
import { StaffHome, NewTransaction, MemberSearch, TodaysLog, EndOfDay } from './screens/staff';
import { OwnerDashboard, OwnerTransactions, OwnerMembers, OwnerInventory, OwnerReports, OwnerSettings } from './screens/owner';
import { inventory } from './data/mock';

function Login({ onLogin }) {
  return (
    <div style={{ flex: 1, display: "grid", placeItems: "center", background: "var(--bg)", minHeight: "100%" }} className="fade-in">
      <div style={{ width: 340, textAlign: "center" }}>
        <div style={{ width: 64, height: 64, borderRadius: 18, background: "linear-gradient(150deg,#185FA5,#0C447C)", display: "grid", placeItems: "center", margin: "0 auto 16px", boxShadow: "0 10px 24px -8px rgba(12,68,124,.5)" }}>
          <WaveMark size={34} />
        </div>
        <div style={{ fontSize: 23, fontWeight: 500, color: "#1a202c", letterSpacing: ".2px" }}>Refresh Manager</div>
        <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 4 }}>Boudha, Kathmandu</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 30 }}>
          <button className="btn btn-ghost btn-block" style={{ padding: 14, fontSize: 14 }} onClick={() => onLogin("staff")}>
            <Icon name="user" size={18} /> Staff Login
          </button>
          <button className="btn btn-primary btn-block" style={{ padding: 14, fontSize: 14 }} onClick={() => onLogin("owner")}>
            <Icon name="shield" size={18} /> Owner / Admin Login
          </button>
        </div>
      </div>
      <div style={{ position: "absolute", bottom: 16, fontSize: 11.5, color: "#94a3b8" }}>v1.0</div>
    </div>
  );
}

function StaffInventory({ back }) {
  const inv = inventory;
  return (
    <div className="content fade-in" style={{ maxWidth: 860, margin: "0 auto" }}>
      <SectionHead title="Inventory">
        <button className="btn btn-ghost" onClick={back}><Icon name="chevron-left" size={15} /> Back to home</button>
      </SectionHead>
      <div className="alert red" style={{ marginBottom: 14 }}>
        <Icon name="alert-triangle" size={17} />
        <div><div className="a-title">2 items below reorder threshold</div><div className="a-desc">Goggles (Baby) · Nose Pin</div></div>
      </div>
      <table className="tbl">
        <thead><tr><th>Item</th><th style={{ width: 140 }}>Variant</th><th className="num" style={{ width: 80 }}>Stock</th><th className="num" style={{ width: 100 }}>Reorder at</th></tr></thead>
        <tbody>
          {inv.map((r, i) => (
            <tr key={i}>
              <td style={{ fontWeight: 500 }}>{r.low && <Icon name="alert-triangle" size={14} color="#ef4444" style={{ verticalAlign: "-2px", marginRight: 6 }} />}{r.item}</td>
              <td style={{ color: "#64748b" }}>{r.variant}</td>
              <td className="num" style={{ color: r.low ? "#ef4444" : "#1a202c" }}>{r.stock}</td>
              <td className="num" style={{ color: "#94a3b8" }}>{r.reorder}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StaffApp({ onLogout }) {
  const [tab, setTab] = useState("home");
  const tabs = [
    { k: "home",    icon: "home",        label: "Home" },
    { k: "new",     icon: "plus-circle", label: "New Transaction" },
    { k: "members", icon: "users",       label: "Members" },
    { k: "log",     icon: "list",        label: "Today's Log" },
    { k: "eod",     icon: "send",        label: "End of Day" },
  ];
  let screen;
  if (tab === "home")    screen = <StaffHome key="home" go={setTab} />;
  else if (tab === "new")     screen = <NewTransaction key="new" onDone={setTab} />;
  else if (tab === "members") screen = <MemberSearch key="members" />;
  else if (tab === "log")     screen = <TodaysLog key="log" />;
  else if (tab === "eod")     screen = <EndOfDay key="eod" />;
  else if (tab === "inv")     screen = <StaffInventory key="inv" back={() => setTab("home")} />;

  const navActive = (k) => k === tab || (tab === "inv" && k === "home");

  return (
    <div className="app">
      <AppHeader role="staff" onLogout={onLogout} />
      <div className="body-wrap">
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>{screen}</div>
      </div>
      <div className="botnav">
        {tabs.map((t) => (
          <div key={t.k} className={"tab" + (navActive(t.k) ? " active" : "")} onClick={() => setTab(t.k)}>
            <Icon name={t.icon} size={20} />
            <span className="t-label">{t.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function OwnerApp({ onLogout }) {
  const [tab, setTab] = useState("dashboard");
  const nav = [
    { k: "dashboard",    icon: "layout-dashboard", label: "Dashboard" },
    { k: "transactions", icon: "receipt-text",      label: "Transactions" },
    { k: "members",      icon: "users",             label: "Members" },
    { k: "inventory",    icon: "package",            label: "Inventory" },
    { k: "reports",      icon: "bar-chart-3",        label: "Reports" },
    { k: "settings",     icon: "settings",           label: "Settings" },
  ];
  const screens = {
    dashboard:    <OwnerDashboard />,
    transactions: <OwnerTransactions />,
    members:      <OwnerMembers />,
    inventory:    <OwnerInventory />,
    reports:      <OwnerReports />,
    settings:     <OwnerSettings />,
  };
  return (
    <div className="app">
      <AppHeader role="owner" onLogout={onLogout} />
      <div className="body-wrap">
        <div className="sidebar">
          {nav.map((n) => (
            <div key={n.k} className={"nav-item" + (n.k === tab ? " active" : "")} onClick={() => setTab(n.k)}>
              <span className="ni-icon"><Icon name={n.icon} size={17} /></span>{n.label}
            </div>
          ))}
        </div>
        {screens[tab]}
      </div>
    </div>
  );
}

export default function App() {
  const [role, setRole] = useState("login");

  useEffect(() => {
    if (window.__fitStage) window.__fitStage();
  }, [role]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && role !== "login") setRole("login"); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [role]);

  useEffect(() => {
    const h = document.getElementById("hint");
    if (!h) return;
    h.innerHTML = role === "login"
      ? "Refresh Manager · choose a login to begin"
      : "Press <kbd>Esc</kbd> to log out · everything is clickable";
  }, [role]);

  return (
    <Window onClose={() => window.close()}>
      {role === "login" && <Login onLogin={setRole} />}
      {role === "staff" && <StaffApp key="staff" onLogout={() => setRole("login")} />}
      {role === "owner" && <OwnerApp key="owner" onLogout={() => setRole("login")} />}
    </Window>
  );
}
```

- [ ] **Step 9.2: Update main.jsx**

Replace the entire contents of `src/renderer/src/main.jsx` with:

```jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './app.css'

ReactDOM.createRoot(document.getElementById('root')).render(<App />)
```

- [ ] **Step 9.3: Delete generated files that are no longer needed**

```bash
rm -f src/renderer/src/assets/electron.svg
rm -f src/renderer/src/assets/react.svg
```

- [ ] **Step 9.4: Commit**

```bash
git add src/renderer/src/App.jsx src/renderer/src/main.jsx
git commit -m "feat: add App.jsx and update main.jsx entry — all screens wired"
```

---

## Task 10: Run and verify all screens

- [ ] **Step 10.1: Start the dev server**

```bash
npm run dev
```

Expected: Electron window opens at 1280×880 with the Refresh Manager login screen (navy logo, two login buttons, dark desktop background).

- [ ] **Step 10.2: Login screen**

Confirm:
- Wave logo icon visible (white SVG)
- "Refresh Manager" title and "Boudha, Kathmandu" subtitle
- "Staff Login" ghost button and "Owner / Admin Login" primary button

- [ ] **Step 10.3: Staff interface**

Click "Staff Login". Confirm:
- Navy header with "Aarti · Reception" and Log out button
- 3 metric cards (Revenue today, Cash, QR)
- 6 tile grid — icons visible on all tiles
- Bottom tab bar with 5 tabs

Click each tile and tab:
- New Transaction: 5-step wizard, step through Type → Product → Customer → Payment → Confirm → saved confirmation
- Members: search bar, 5 member cards with badges and avatars
- Today's Log: transaction table with 6 rows and totals footer
- End of Day: revenue card, breakdown rows, WhatsApp send button
- Inventory tile (from Home): stock table with 7 rows, red low-stock alerts

- [ ] **Step 10.4: Owner interface**

Press Esc to return to login. Click "Owner / Admin Login". Confirm:
- Navy header with "Owner · Admin"
- Left sidebar with 6 nav items
- Dashboard: 4 KPI metric cards, recent transactions table, 3 alert cards

Click each sidebar item:
- Transactions: filter row (3 selects + Export Excel button), table, footer
- Members: search + status filter, member table with avatars and badges
- Inventory: low-stock alert banner, stock table with Restock buttons
- Reports: 6 report cards with Export to Excel buttons
- Settings: 6 setting cards with chevrons

- [ ] **Step 10.5: ESC key**

From any screen, press Esc. Confirm: returns to login screen.

- [ ] **Step 10.6: Final commit**

```bash
git add -A
git commit -m "feat: Phase 1-2 complete — all screens rendering in Electron"
```

---

## Troubleshooting

**Icon shows blank / console warns "Icon not found: X"**
The icon name `X` is missing from the `ICONS` map in `ui.jsx`. Look up the correct export name in `node_modules/lucide-react/dist/lucide-react.js` and add it to both the import list and the map.

**Blank white screen on startup**
Check browser console (View → Toggle Developer Tools in Electron). Most likely a JS import error — a typo in a file path or a named export that doesn't match.

**CSS not loading (unstyled content)**
Confirm `import './app.css'` is present in `main.jsx`. Confirm `app.css` exists at `src/renderer/src/app.css`.

**Window has native title bar showing above custom titlebar**
`frame: false` is not set in `src/main/index.js`. Re-check Task 2.

**DM Sans font not loading**
Expected — Google Fonts requires internet. The app falls back to `system-ui` cleanly.
