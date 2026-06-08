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
  { icon: "tag",           title: "Pricing manager",  desc: "Edit prices for all products" },
  { icon: "layout-grid",   title: "Product manager",  desc: "Add or deactivate products" },
  { icon: "user-check",    title: "Staff PINs",       desc: "Manage staff access PINs" },
  { icon: "message-circle",title: "WhatsApp number",  desc: "Owner number for daily reports" },
  { icon: "folder",        title: "Backup settings",  desc: "Folder path and schedule" },
  { icon: "building-2",    title: "Business info",    desc: "Name, address, phone" },
];

export { fmt } from '../lib/format'
