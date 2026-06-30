// Refresh Manager — shared mock data
// All dates, totals, and counts are kept internally consistent.
// Transactions: 6 today — Cash Rs. 2,100 · QR Rs. 4,100 · Total Rs. 6,200
window.RM = (function () {
  const transactions = [
    { id: "#108", time: "8:12 AM",  customer: "Walk-in",       product: "Pool Day Pass",                                       amount: 500,  pay: "Cash", staff: "Aarti" },
    { id: "#109", time: "9:34 AM",  customer: "Priya Sharma",  product: "Swimming + Gym — Monthly",                            amount: 3500, pay: "QR",   staff: "Aarti" },
    { id: "#110", time: "10:05 AM", customer: "Walk-in",       product: "Whole Package (Pool + Gym + Sauna + Steam + Jacuzzi)", amount: 800,  pay: "Cash", staff: "Aarti" },
    { id: "#111", time: "11:20 AM", customer: "Walk-in",       product: "Gym Day Pass",                                        amount: 300,  pay: "Cash", staff: "Bikash" },
    { id: "#112", time: "12:45 PM", customer: "Dipesh Rai",    product: "Sauna + Steam + Jacuzzi",                             amount: 600,  pay: "QR",   staff: "Bikash" },
    { id: "#113", time: "2:10 PM",  customer: "Walk-in",       product: "Pool Day Pass",                                       amount: 500,  pay: "Cash", staff: "Bikash" },
  ];

  const members = [
    { name: "Rajesh Kumar",  initials: "RK", type: "Swimming + Gym — Monthly", phone: "9841112233", status: "Active",        expiry: "22 Jul 2026" },
    { name: "Rima Pradhan",  initials: "RP", type: "Gym Only — Monthly",       phone: "9851223344", status: "Expiring soon", expiry: "5 Jul 2026"  },
    { name: "Anita Shrestha",initials: "AS", type: "Swimming + Gym — Monthly", phone: "9802113355", status: "Active",        expiry: "15 Aug 2026" },
    { name: "Bikash Tamang", initials: "BT", type: "Beginner Training — Monthly",phone:"9841556677", status: "Expired",      expiry: "1 Jun 2026"  },
    { name: "Sushila KC",    initials: "SK", type: "Gym Only — Monthly",       phone: "9818334455", status: "Expiring soon", expiry: "3 Jul 2026"  },
  ];

  const inventory = [
    { item: "Ladies Costume", variant: "Full Body", stock: 4, reorder: 3, price: 1200, low: false },
    { item: "Gents Costume", variant: "—", stock: 6, reorder: 3, price: 900, low: false },
    { item: "Goggles", variant: "Adult Large", stock: 8, reorder: 5, price: 450, low: false },
    { item: "Goggles", variant: "Baby", stock: 2, reorder: 5, price: 350, low: true },
    { item: "Swimming Cap", variant: "Small", stock: 5, reorder: 5, price: 250, low: false },
    { item: "Nose Pin", variant: "—", stock: 3, reorder: 10, price: 120, low: true },
    { item: "Floating Tube", variant: "—", stock: 4, reorder: 2, price: 600, low: false },
  ];

  const prices = {
    "Pool Day Pass": 500, "Gym Day Pass": 300,
    "Sauna + Steam + Jacuzzi": 600, "Swimming + Sauna + Steam": 700,
    "Whole Package (Pool + Gym + Sauna + Steam + Jacuzzi)": 800,
    "Beginner Training — 15 Days": 2000, "Beginner Training — Monthly": 3000,
    "Advanced Training — 15 Days": 2500, "Advanced Training — Monthly": 4000,
    "Gym Only — Monthly": 2000, "Gym Only — 3 Months": 5500, "Gym Only — 6 Months": 10000, "Gym Only — 1 Year": 18000,
    "Swimming + Gym — Monthly": 3500, "Swimming + Gym — 3 Months": 9500, "Swimming + Gym — 6 Months": 18000, "Swimming + Gym — 1 Year": 32000,
  };

  // Upcoming bookings use ISO date strings (YYYY-MM-DD) so the date input pre-fills correctly.
  // fmtBookingDate() in screens-owner.jsx converts them to "12 Jul 2026" for display.
  const bookings = [
    { id: "B-01", customer: "Rajesh Kumar",  type: "Pool — Corporate Event",  date: "2026-07-12", time: "9:00 AM – 12:00 PM", guests: 20, status: "Upcoming",  deposit: 5000, note: "Needs projector" },
    { id: "B-02", customer: "Priya Sharma",  type: "Sauna + Steam Private",   date: "2026-07-05", time: "6:00 PM – 7:30 PM",  guests: 2,  status: "Upcoming",  deposit: 2000, note: "" },
    { id: "B-03", customer: "Bikash Tamang", type: "Pool — Birthday Party",   date: "2026-06-08", time: "4:00 PM – 6:00 PM",  guests: 15, status: "Completed", deposit: 4000, note: "Kids party" },
    { id: "B-04", customer: "Anita Shrestha",type: "Gym — Group Session",     date: "2026-06-05", time: "7:00 AM – 8:00 AM",  guests: 8,  status: "Completed", deposit: 1500, note: "" },
  ];

  const weeklyRevenue = [
    { day: "Mon", amt: 5800 },
    { day: "Tue", amt: 4200 },
    { day: "Wed", amt: 7100 },
    { day: "Thu", amt: 3900 },
    { day: "Fri", amt: 8400 },
    { day: "Sat", amt: 9200 },
    { day: "Sun", amt: 6200 },
  ];

  const products = {
    "Membership": [
      "Beginner Training — 15 Days", "Beginner Training — Monthly",
      "Advanced Training — 15 Days", "Advanced Training — Monthly",
      "Gym Only — Monthly", "Gym Only — 3 Months", "Gym Only — 6 Months", "Gym Only — 1 Year",
      "Swimming + Gym — Monthly", "Swimming + Gym — 3 Months", "Swimming + Gym — 6 Months", "Swimming + Gym — 1 Year",
    ],
    "Day Package": ["Sauna + Steam + Jacuzzi", "Swimming + Sauna + Steam", "Whole Package (Pool + Gym + Sauna + Steam + Jacuzzi)"],
    "Day Pass": ["Pool Day Pass", "Gym Day Pass"],
  };

  // EOD totals derived from transactions above:
  //   Cash: #108(500) + #110(800) + #111(300) + #113(500) = 2,100
  //   QR:   #109(3500) + #112(600)                        = 4,100
  //   Total = 6,200  Count = 6
  const eod = {
    total: 6200, cash: 2100, qr: 4100, count: 6,
    rows: [
      { label: "Cash",              value: "Rs. 2,100" },
      { label: "QR (eSewa / Khalti)", value: "Rs. 4,100" },
      { label: "Memberships sold", value: "Rs. 3,500", note: "1" },
      { label: "Day packages",     value: "Rs. 1,400", note: "2" },
      { label: "Day passes",       value: "Rs. 1,300", note: "3" },
    ],
  };

  const kpis = [
    { label: "Today's revenue", value: "Rs. 6,200", sub: "+18% vs yesterday", tone: "pos" },
    { label: "Active members", value: "47", sub: "3 expiring soon", tone: "warn" },
    { label: "This month", value: "Rs. 68,400", sub: "Target: Rs. 80,000", tone: "muted" },
    { label: "Google reviews", value: "24  ·  ★ 4.7", sub: "Target: 50", tone: "muted" },
  ];

  const reports = [
    { icon: "calendar", title: "Daily revenue", desc: "All transactions for a selected day" },
    { icon: "calendar-range", title: "Monthly revenue", desc: "Aggregated by week and product" },
    { icon: "filter", title: "Custom date range", desc: "Any range with type & staff filters" },
    { icon: "users", title: "Member report", desc: "Full list with status and expiry" },
    { icon: "clock-alert", title: "Expiry report", desc: "Members expiring in next N days" },
    { icon: "package", title: "Inventory report", desc: "Stock levels and sales history" },
  ];

  const settings = [
    { icon: "tag", title: "Pricing manager", desc: "Edit prices for all products" },
    { icon: "layout-grid", title: "Product manager", desc: "Add or deactivate products" },
    { icon: "user-check", title: "Staff PINs", desc: "Manage staff access PINs" },
    { icon: "message-circle", title: "WhatsApp number", desc: "Owner number for daily reports" },
    { icon: "folder", title: "Backup settings", desc: "Folder path and schedule" },
    { icon: "building-2", title: "Business info", desc: "Name, address, phone" },
  ];

  const staff = [
    { name: "Aarti", role: "Reception", pin: "1234" },
    { name: "Bikash", role: "Reception", pin: "5678" },
  ];

  const fmt = (n) => "Rs. " + n.toLocaleString("en-IN");

  return { transactions, members, inventory, prices, products, bookings, weeklyRevenue, eod, kpis, reports, settings, staff, fmt };
})();
