/* ===== Owner interface screens ===== */
const RMo = window.RM;

function fmtBookingDate(str) {
  if (!str) return "";
  if (!str.includes("-")) return str; // already formatted (mock data)
  const [y, m, d] = str.split("-").map(Number);
  const mo = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return d + " " + mo[m - 1] + " " + y;
}

/* ---------- Weekly revenue bar chart ---------- */
function RevenueChart() {
  const data = RMo.weeklyRevenue;
  const max = Math.max(...data.map((d) => d.amt));
  const barH = 68, barW = 22, gap = 9;
  const totalW = data.length * barW + (data.length - 1) * gap;
  return (
    <svg width={totalW} height={barH + 18} aria-hidden="true">
      {data.map((d, i) => {
        const bh = Math.max(4, Math.round((d.amt / max) * barH));
        const x = i * (barW + gap);
        const isToday = i === data.length - 1;
        return (
          <g key={d.day}>
            <rect x={x} y={barH - bh} width={barW} height={bh} rx={4}
              fill={isToday ? "#185FA5" : "#dbeafe"} />
            <text x={x + barW / 2} y={barH + 14} textAnchor="middle"
              fontSize="9.5" fill={isToday ? "#185FA5" : "#94a3b8"}
              fontWeight={isToday ? "600" : "400"}>{d.day}</text>
          </g>
        );
      })}
    </svg>
  );
}

/* ---------- Dashboard ---------- */
function OwnerDashboard({ go }) {
  const tx = RMo.transactions.slice(0, 5);
  const total = RMo.transactions.reduce((s, t) => s + t.amount, 0);
  const upcoming = RMo.bookings.filter((b) => b.status === "Upcoming");
  const alerts = [
    { c: "amber", icon: "calendar-clock", t: "3 memberships expiring", d: "Within next 5 days" },
    { c: "red", icon: "alert-triangle", t: "2 items low stock", d: "Goggles Baby · Nose Pin" },
    { c: "green", icon: "calendar", t: upcoming.length + " upcoming bookings", d: upcoming.map((b) => b.customer).join(" · ") },
  ];
  return (
    <div className="content fade-in">
      <SectionHead title="Dashboard" date={window.fmtDate(new Date())}>
        <button className="btn btn-ghost" onClick={() => showToast("Daily export — available in the Electron app", "info")}><Icon name="download" size={15} /> Export today</button>
      </SectionHead>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 18 }}>
        {RMo.kpis.map((k) => (
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
            <a style={{ fontSize: 12, color: "#185FA5", cursor: "pointer" }} onClick={() => go && go("transactions")}>View all →</a>
          </div>
          <table className="tbl">
            <thead><tr><th style={{ width: 56 }}>ID</th><th style={{ width: 84 }}>Time</th><th>Customer</th><th>Product</th><th className="num" style={{ width: 92 }}>Amount</th><th style={{ width: 70 }}>Pay</th><th style={{ width: 70 }}>Staff</th></tr></thead>
            <tbody>
              {tx.map((t) => (
                <tr key={t.id}>
                  <td style={{ color: "#94a3b8" }}>{t.id}</td>
                  <td style={{ color: "#94a3b8" }}>{t.time}</td>
                  <td style={{ fontWeight: 500 }}>{t.customer}</td>
                  <td style={{ color: "#64748b", fontSize: 12.5 }}>{t.product}</td>
                  <td className="num">{RMo.fmt(t.amount)}</td>
                  <td><PayBadge pay={t.pay} /></td>
                  <td style={{ color: "#64748b" }}>{t.staff}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="tbl-foot"><span>{RMo.transactions.length} transactions · today</span><span className="total">Total: {RMo.fmt(total)}</span></div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: -1 }}>Alerts</div>
          {alerts.map((a) => (
            <div key={a.t} className={"alert " + a.c}>
              <Icon name={a.icon} size={17} />
              <div><div className="a-title">{a.t}</div><div className="a-desc">{a.d}</div></div>
            </div>
          ))}
          <div style={{ marginTop: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: "#64748b", marginBottom: 9 }}>This week's revenue</div>
            <RevenueChart />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Transactions (filtering + void) ---------- */
function OwnerTransactions() {
  const typeOf = (product) => {
    if (RMo.products["Membership"].includes(product)) return "Membership";
    if (RMo.products["Day Package"].includes(product)) return "Day Package";
    return "Day Pass";
  };

  const [typeFilter, setTypeFilter] = React.useState("All types");
  const [payFilter, setPayFilter] = React.useState("All payments");
  const [staffFilter, setStaffFilter] = React.useState("All staff");
  const [txs, setTxs] = React.useState(RMo.transactions.map((t) => ({ ...t, voided: false })));
  const [voidPending, setVoidPending] = React.useState(null);

  const staffNames = [...new Set(RMo.transactions.map((t) => t.staff))].sort();

  let filtered = txs;
  if (typeFilter !== "All types") filtered = filtered.filter((t) => typeOf(t.product) === typeFilter);
  if (payFilter !== "All payments") filtered = filtered.filter((t) => t.pay === payFilter);
  if (staffFilter !== "All staff") filtered = filtered.filter((t) => t.staff === staffFilter);

  const activeTotal = filtered.filter((t) => !t.voided).reduce((s, t) => s + t.amount, 0);

  const doVoid = (id) => {
    setTxs(txs.map((t) => (t.id === id ? { ...t, voided: true } : t)));
    setVoidPending(null);
    showToast("Transaction " + id + " voided");
  };

  return (
    <div className="content fade-in">
      <SectionHead title="Transactions" />

      {voidPending && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.32)", backdropFilter: "blur(3px)", display: "grid", placeItems: "center", zIndex: 50 }}>
          <div className="card scale-in" style={{ width: 320, padding: 24, textAlign: "center" }}>
            <div style={{ width: 52, height: 52, borderRadius: "50%", background: "#fee2e2", display: "grid", placeItems: "center", margin: "0 auto 14px" }}>
              <Icon name="alert-triangle" size={26} color="#ef4444" />
            </div>
            <div style={{ fontSize: 15, fontWeight: 500 }}>Void {voidPending}?</div>
            <div style={{ fontSize: 13, color: "#64748b", marginTop: 6, marginBottom: 20 }}>
              This will exclude it from all totals and cannot be undone.
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn btn-ghost btn-block" onClick={() => setVoidPending(null)}>Cancel</button>
              <button className="btn btn-block" style={{ background: "#ef4444", color: "#fff", border: "none" }} onClick={() => doVoid(voidPending)}>
                Void transaction
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginBottom: 14, alignItems: "center" }}>
        <select className="select" style={{ width: 140 }} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option>All types</option><option>Membership</option><option>Day Package</option><option>Day Pass</option>
        </select>
        <select className="select" style={{ width: 140 }} value={payFilter} onChange={(e) => setPayFilter(e.target.value)}>
          <option>All payments</option><option>Cash</option><option>QR</option>
        </select>
        <select className="select" style={{ width: 120 }} value={staffFilter} onChange={(e) => setStaffFilter(e.target.value)}>
          <option>All staff</option>
          {staffNames.map((s) => <option key={s}>{s}</option>)}
        </select>
        <div className="spacer" />
        <span style={{ fontSize: 12, color: "#94a3b8" }}>{filtered.length} row{filtered.length !== 1 ? "s" : ""}</span>
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
            <th style={{ width: 80 }}>Payment</th>
            <th style={{ width: 80 }}></th>
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 ? (
            <tr><td colSpan={7} style={{ textAlign: "center", color: "#94a3b8", padding: 28 }}>No transactions match the selected filters.</td></tr>
          ) : filtered.map((t) => (
            <tr key={t.id} style={{ opacity: t.voided ? .45 : 1 }}>
              <td style={{ color: "#94a3b8" }}>{t.id}</td>
              <td style={{ color: "#94a3b8" }}>{t.time}</td>
              <td style={{ fontWeight: 500 }}>{t.customer}</td>
              <td style={{ color: "#64748b", fontSize: 12.5 }}>{t.product}</td>
              <td className="num" style={{ textDecoration: t.voided ? "line-through" : "none" }}>{RMo.fmt(t.amount)}</td>
              <td>{t.voided ? <span className="badge b-dead">Voided</span> : <PayBadge pay={t.pay} />}</td>
              <td style={{ textAlign: "right" }}>
                {!t.voided && (
                  <button
                    className="btn btn-ghost"
                    style={{ padding: "3px 9px", fontSize: 11, color: "#dc2626", borderColor: "#fecaca" }}
                    onClick={() => setVoidPending(t.id)}>
                    Void
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="tbl-foot">
        <span>
          {filtered.filter((t) => !t.voided).length} active
          {filtered.some((t) => t.voided) && " · " + filtered.filter((t) => t.voided).length + " voided"}
        </span>
        <span className="total">Total: {RMo.fmt(activeTotal)}</span>
      </div>
    </div>
  );
}

/* ---------- Members (master-detail) ---------- */
function OwnerMembers() {
  const [q, setQ] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("All statuses");
  const [selected, setSelected] = React.useState(null);

  const filtered = RMo.members.filter((x) => {
    const matchQ = (x.name + x.phone).toLowerCase().includes(q.toLowerCase());
    const matchS = statusFilter === "All statuses" || x.status === statusFilter;
    return matchQ && matchS;
  });

  return (
    <div className="content fade-in">
      <SectionHead title="Members" />
      <div style={{ display: "flex", gap: 10, marginBottom: 14, alignItems: "center" }}>
        <div style={{ position: "relative", width: 240 }}>
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", display: "flex" }}><Icon name="search" size={15} color="#94a3b8" /></span>
          <input className="input" style={{ paddingLeft: 34 }} placeholder="Search members…" value={q}
            onChange={(e) => { setQ(e.target.value); setSelected(null); }} />
        </div>
        <select className="select" style={{ width: 150 }} value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setSelected(null); }}>
          <option>All statuses</option><option>Active</option><option>Expiring soon</option><option>Expired</option>
        </select>
        <div className="spacer" />
        <button className="btn btn-ghost"><Icon name="download" size={15} /> Export</button>
      </div>

      <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
        <table className="tbl" style={{ flex: 1 }}>
          <thead>
            <tr>
              <th>Member</th>
              <th style={{ width: 170 }}>Membership type</th>
              <th style={{ width: 120 }}>Status</th>
              <th style={{ width: 130 }}>Expiry date</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={4} style={{ textAlign: "center", color: "#94a3b8", padding: 28 }}>No members found.</td></tr>
            ) : filtered.map((x) => (
              <tr key={x.name}
                style={{ cursor: "pointer", background: selected?.name === x.name ? "var(--blue-fill)" : "" }}
                onClick={() => setSelected(selected?.name === x.name ? null : x)}>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                    <Avatar initials={x.initials} status={x.status} />
                    <div><div style={{ fontWeight: 500 }}>{x.name}</div><div style={{ fontSize: 11.5, color: "#94a3b8", marginTop: 1 }}>{x.phone}</div></div>
                  </div>
                </td>
                <td style={{ color: "#64748b" }}>{x.type}</td>
                <td><Badge kind={x.status} /></td>
                <td style={{ color: x.status === "Expired" ? "#991b1b" : x.status === "Expiring soon" ? "#b45309" : "#64748b" }}>{x.expiry}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {selected && <MemberDetail member={selected} onClose={() => setSelected(null)} />}
      </div>
    </div>
  );
}

/* ---------- Bookings ---------- */
function OwnerBookings() {
  const [filter, setFilter] = React.useState("All");
  const [bookings, setBookings] = React.useState(RMo.bookings.map((b) => ({ ...b })));
  const [showNew, setShowNew] = React.useState(false);
  const emptyForm = { customer: "", type: "Pool — Private Event", date: "", time: "", guests: "", deposit: "", note: "" };
  const [form, setForm] = React.useState(emptyForm);
  const nextId = React.useRef(bookings.reduce((max, b) => {
    const n = parseInt(b.id.replace(/\D/g, "")) || 0;
    return Math.max(max, n);
  }, 0) + 1);

  const tabs = ["All", "Upcoming", "Completed", "Cancelled"];
  const filtered = filter === "All" ? bookings : bookings.filter((b) => b.status === filter);
  const bStatusCls = { Upcoming: "b-qr", Completed: "b-active", Cancelled: "b-dead" };
  const bookingTypes = ["Pool — Private Event", "Pool — Corporate Event", "Pool — Birthday Party", "Sauna + Steam Private", "Gym — Group Session"];

  const saveBooking = () => {
    if (!form.customer || !form.date) return;
    const id = "B-" + String(nextId.current++).padStart(2, "0");
    setBookings([{ ...form, id, guests: Number(form.guests) || 0, deposit: Number(form.deposit) || 0, status: "Upcoming" }, ...bookings]);
    setShowNew(false);
    setForm(emptyForm);
    setFilter("Upcoming");
    showToast("Booking saved · " + form.customer);
  };

  const markComplete = (id) => { setBookings(bookings.map((b) => b.id === id ? { ...b, status: "Completed" } : b)); showToast("Booking marked complete"); };
  const markCancelled = (id) => { setBookings(bookings.map((b) => b.id === id ? { ...b, status: "Cancelled" } : b)); showToast("Booking cancelled", "info"); };

  return (
    <div className="content fade-in">
      <SectionHead title="Bookings" date="Private events, group sessions &amp; facility reservations">
        <button className="btn btn-primary" onClick={() => setShowNew(true)}><Icon name="plus" size={15} /> New Booking</button>
      </SectionHead>

      {showNew && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.32)", backdropFilter: "blur(3px)", display: "grid", placeItems: "center", zIndex: 50 }}>
          <div className="card scale-in" style={{ width: 460, padding: 26 }}>
            <div className="between" style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 16, fontWeight: 500 }}>New Booking</div>
              <button className="rowmenu" onClick={() => { setShowNew(false); setForm(emptyForm); }}><Icon name="x" size={18} color="#64748b" /></button>
            </div>
            <div className="field"><label>Customer name *</label><input className="input" value={form.customer} onChange={(e) => setForm({ ...form, customer: e.target.value })} placeholder="Full name" autoFocus /></div>
            <div className="field">
              <label>Booking type</label>
              <select className="select" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {bookingTypes.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="field"><label>Date *</label><input className="input" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
              <div className="field"><label>Time slot</label><input className="input" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} placeholder="e.g. 9:00 AM – 12:00 PM" /></div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="field"><label>No. of guests</label><input className="input" type="number" min="1" value={form.guests} onChange={(e) => setForm({ ...form, guests: e.target.value })} placeholder="0" /></div>
              <div className="field"><label>Deposit (Rs.)</label><input className="input" type="number" min="0" value={form.deposit} onChange={(e) => setForm({ ...form, deposit: e.target.value })} placeholder="0" /></div>
            </div>
            <div className="field"><label>Notes</label><input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Special requests, setup notes…" /></div>
            <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
              <button className="btn btn-ghost btn-block" onClick={() => { setShowNew(false); setForm(emptyForm); }}>Cancel</button>
              <button className="btn btn-primary btn-block"
                disabled={!form.customer || !form.date}
                style={!form.customer || !form.date ? { opacity: .5, cursor: "not-allowed" } : null}
                onClick={saveBooking}>
                <Icon name="check" size={15} /> Save Booking
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="seg" style={{ marginBottom: 16 }}>
        {tabs.map((t) => (
          <button key={t} className={filter === t ? "on" : ""} onClick={() => setFilter(t)}>
            {t}
            {t !== "All" && (
              <span style={{ marginLeft: 6, background: "#f1f5f9", borderRadius: 10, padding: "0 6px", fontSize: 11, color: "#64748b" }}>
                {bookings.filter((b) => b.status === t).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="card" style={{ padding: 36, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
          No {filter === "All" ? "" : filter.toLowerCase() + " "}bookings found.
        </div>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 60 }}>ID</th>
              <th>Customer &amp; Type</th>
              <th style={{ width: 130 }}>Date &amp; Time</th>
              <th className="num" style={{ width: 70 }}>Guests</th>
              <th className="num" style={{ width: 100 }}>Deposit</th>
              <th style={{ width: 100 }}>Status</th>
              <th style={{ width: 100 }}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((b) => (
              <tr key={b.id}>
                <td style={{ color: "#94a3b8" }}>{b.id}</td>
                <td>
                  <div style={{ fontWeight: 500 }}>{b.customer}</div>
                  <div style={{ fontSize: 11.5, color: "#64748b" }}>{b.type}{b.note ? " · " + b.note : ""}</div>
                </td>
                <td>
                  <div style={{ fontSize: 13 }}>{fmtBookingDate(b.date)}</div>
                  {b.time && <div style={{ fontSize: 11, color: "#94a3b8" }}>{b.time}</div>}
                </td>
                <td className="num" style={{ color: "#64748b" }}>{b.guests}</td>
                <td className="num">{RMo.fmt(b.deposit)}</td>
                <td><span className={"badge " + (bStatusCls[b.status] || "b-cash")}>{b.status}</span></td>
                <td>
                  {b.status === "Upcoming" && (
                    <div style={{ display: "flex", gap: 5 }}>
                      <button className="btn btn-ghost" style={{ padding: "4px 9px", fontSize: 11.5 }} onClick={() => markComplete(b.id)}>
                        <Icon name="check" size={13} /> Done
                      </button>
                      <button className="rowmenu" title="Cancel booking" onClick={() => markCancelled(b.id)}>
                        <Icon name="x" size={15} color="#94a3b8" />
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ---------- Inventory (interactive restock + add) ---------- */
function OwnerInventory() {
  const [inv, setInv] = React.useState(RMo.inventory.map((i) => ({ ...i })));
  const [restocking, setRestocking] = React.useState(null);
  const [qty, setQty] = React.useState("");
  const [showAdd, setShowAdd] = React.useState(false);
  const emptyItem = { item: "", variant: "", stock: "", reorder: "", price: "" };
  const [newItem, setNewItem] = React.useState(emptyItem);

  const lowItems = inv.filter((r) => r.stock < r.reorder);

  const confirmRestock = (idx) => {
    const n = parseInt(qty);
    if (isNaN(n) || n <= 0) { showToast("Enter a quantity greater than 0", "error"); return; }
    setInv(inv.map((item, i) => {
      if (i !== idx) return item;
      const s = item.stock + n;
      return { ...item, stock: s, low: s < item.reorder };
    }));
    showToast("Restocked · +" + n + " units");
    setRestocking(null);
    setQty("");
  };

  const addItem = () => {
    if (!newItem.item) return;
    const stock = parseInt(newItem.stock) || 0;
    const reorder = parseInt(newItem.reorder) || 5;
    setInv([...inv, { item: newItem.item, variant: newItem.variant || "—", stock, reorder, price: parseInt(newItem.price) || 0, low: stock < reorder }]);
    showToast(newItem.item + " added to inventory");
    setShowAdd(false);
    setNewItem(emptyItem);
  };

  return (
    <div className="content fade-in">
      <SectionHead title="Inventory">
        <button className="btn btn-ghost"><Icon name="download" size={15} /> Export</button>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}><Icon name="plus" size={15} /> Add item</button>
      </SectionHead>

      {showAdd && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.32)", backdropFilter: "blur(3px)", display: "grid", placeItems: "center", zIndex: 50 }}>
          <div className="card scale-in" style={{ width: 380, padding: 24 }}>
            <div className="between" style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 500 }}>Add inventory item</div>
              <button className="rowmenu" onClick={() => { setShowAdd(false); setNewItem(emptyItem); }}><Icon name="x" size={18} color="#64748b" /></button>
            </div>
            <div className="field"><label>Item name *</label><input className="input" value={newItem.item} onChange={(e) => setNewItem({ ...newItem, item: e.target.value })} placeholder="e.g. Swimming Fins" autoFocus /></div>
            <div className="field"><label>Variant</label><input className="input" value={newItem.variant} onChange={(e) => setNewItem({ ...newItem, variant: e.target.value })} placeholder="e.g. Large  (leave blank if none)" /></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              <div className="field"><label>Stock</label><input className="input" type="number" min="0" value={newItem.stock} onChange={(e) => setNewItem({ ...newItem, stock: e.target.value })} placeholder="0" /></div>
              <div className="field"><label>Reorder at</label><input className="input" type="number" min="0" value={newItem.reorder} onChange={(e) => setNewItem({ ...newItem, reorder: e.target.value })} placeholder="5" /></div>
              <div className="field"><label>Price (Rs.)</label><input className="input" type="number" min="0" value={newItem.price} onChange={(e) => setNewItem({ ...newItem, price: e.target.value })} placeholder="0" /></div>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
              <button className="btn btn-ghost btn-block" onClick={() => { setShowAdd(false); setNewItem(emptyItem); }}>Cancel</button>
              <button className="btn btn-primary btn-block"
                disabled={!newItem.item} style={!newItem.item ? { opacity: .5, cursor: "not-allowed" } : null}
                onClick={addItem}>
                <Icon name="plus" size={15} /> Add item
              </button>
            </div>
          </div>
        </div>
      )}

      {lowItems.length > 0 && (
        <div className="alert red" style={{ marginBottom: 14 }}>
          <Icon name="alert-triangle" size={17} />
          <div>
            <div className="a-title">{lowItems.length} item{lowItems.length > 1 ? "s" : ""} below reorder threshold</div>
            <div className="a-desc">{lowItems.map((r) => r.item + (r.variant !== "—" ? " (" + r.variant + ")" : "")).join(" · ")}</div>
          </div>
        </div>
      )}

      <table className="tbl">
        <thead>
          <tr>
            <th>Item</th><th style={{ width: 130 }}>Variant</th>
            <th className="num" style={{ width: 80 }}>Stock</th>
            <th className="num" style={{ width: 90 }}>Reorder at</th>
            <th className="num" style={{ width: 90 }}>Price</th>
            <th style={{ width: 190 }}></th>
          </tr>
        </thead>
        <tbody>
          {inv.map((r, i) => (
            <tr key={i}>
              <td style={{ fontWeight: 500 }}>{r.low && <Icon name="alert-triangle" size={14} color="#ef4444" style={{ verticalAlign: "-2px", marginRight: 6 }} />}{r.item}</td>
              <td style={{ color: "#64748b" }}>{r.variant}</td>
              <td className="num" style={{ color: r.low ? "#ef4444" : "#1a202c", fontWeight: r.low ? 500 : 400 }}>{r.stock}</td>
              <td className="num" style={{ color: "#94a3b8" }}>{r.reorder}</td>
              <td className="num">{RMo.fmt(r.price)}</td>
              <td>
                {restocking === i ? (
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input className="input" type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)}
                      placeholder="Qty" style={{ width: 72, padding: "5px 8px", fontSize: 12 }} autoFocus
                      onKeyDown={(e) => { if (e.key === "Enter") confirmRestock(i); if (e.key === "Escape") { setRestocking(null); setQty(""); } }} />
                    <button className="btn btn-primary" style={{ padding: "5px 11px", fontSize: 12 }} onClick={() => confirmRestock(i)}><Icon name="check" size={13} /> Add</button>
                    <button className="btn btn-ghost" style={{ padding: "5px 9px", fontSize: 12 }} onClick={() => { setRestocking(null); setQty(""); }}>✕</button>
                  </div>
                ) : (
                  <button className={"btn " + (r.low ? "btn-primary" : "btn-ghost")} style={{ padding: "5px 11px", fontSize: 12 }}
                    onClick={() => { setRestocking(i); setQty(""); }}>
                    <Icon name="plus" size={13} /> Restock
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- Reports ---------- */
function OwnerReports() {
  return (
    <div className="content fade-in">
      <SectionHead title="Reports & exports" date="Generate and download Excel reports" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
        {RMo.reports.map((r) => (
          <div key={r.title} className="card" style={{ padding: "16px 16px 14px", display: "flex", flexDirection: "column", gap: 8, cursor: "pointer", transition: "border-color .12s" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: 9, background: "#E6F1FB", display: "grid", placeItems: "center" }}><Icon name={r.icon} size={18} color="#185FA5" /></div>
              <div style={{ fontSize: 14, fontWeight: 500 }}>{r.title}</div>
            </div>
            <div className="sub" style={{ color: "#64748b", lineHeight: 1.45, minHeight: 32 }}>{r.desc}</div>
            <button className="btn btn-ghost" style={{ alignSelf: "flex-start", padding: "6px 11px", fontSize: 12 }}
              onClick={() => showToast("Excel export · available in the Electron app", "info")}>
              <Icon name="sheet" size={14} color="#16a34a" /> Export to Excel
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Pricing Manager ---------- */
function PricingManager({ back }) {
  const [prices, setPrices] = React.useState({ ...RMo.prices });
  const [editing, setEditing] = React.useState(null);
  const [tempVal, setTempVal] = React.useState("");

  const startEdit = (key) => { setEditing(key); setTempVal(String(prices[key])); };
  const saveEdit = () => {
    const v = parseInt(tempVal);
    if (!isNaN(v) && v >= 0) {
      window.RM.prices[editing] = v;
      setPrices({ ...prices, [editing]: v });
      showToast("Price updated");
    }
    setEditing(null);
  };

  const groups = [
    { label: "Day Passes", keys: ["Pool Day Pass", "Gym Day Pass"] },
    { label: "Day Packages", keys: ["Sauna + Steam + Jacuzzi", "Swimming + Sauna + Steam", "Whole Package (Pool + Gym + Sauna + Steam + Jacuzzi)"] },
    { label: "Membership — Beginner Training", keys: ["Beginner Training — 15 Days", "Beginner Training — Monthly"] },
    { label: "Membership — Advanced Training", keys: ["Advanced Training — 15 Days", "Advanced Training — Monthly"] },
    { label: "Membership — Gym Only", keys: ["Gym Only — Monthly", "Gym Only — 3 Months", "Gym Only — 6 Months", "Gym Only — 1 Year"] },
    { label: "Membership — Swimming + Gym", keys: ["Swimming + Gym — Monthly", "Swimming + Gym — 3 Months", "Swimming + Gym — 6 Months", "Swimming + Gym — 1 Year"] },
  ];

  return (
    <div className="content fade-in" style={{ maxWidth: 640, margin: "0 auto" }}>
      <SectionHead title="Pricing Manager">
        <button className="btn btn-ghost" onClick={back}><Icon name="chevron-left" size={15} /> Back to Settings</button>
      </SectionHead>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {groups.map((g) => (
          <div key={g.label} className="card" style={{ overflow: "hidden" }}>
            <div style={{ padding: "9px 16px", background: "#f8f9fa", borderBottom: "1px solid var(--border)", fontSize: 11.5, fontWeight: 500, color: "#64748b" }}>{g.label}</div>
            {g.keys.map((key, ki) => (
              <div key={key} style={{ display: "flex", alignItems: "center", padding: "11px 16px", borderBottom: ki < g.keys.length - 1 ? "1px solid #f1f5f9" : "none", gap: 12 }}>
                <span style={{ flex: 1, fontSize: 13 }}>{key}</span>
                {editing === key ? (
                  <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
                    <span style={{ fontSize: 13, color: "#64748b" }}>Rs.</span>
                    <input className="input" type="number" min="0" value={tempVal}
                      onChange={(e) => setTempVal(e.target.value)}
                      style={{ width: 100, padding: "5px 9px", fontSize: 13 }} autoFocus
                      onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditing(null); }} />
                    <button className="btn btn-primary" style={{ padding: "5px 12px", fontSize: 12 }} onClick={saveEdit}>Save</button>
                    <button className="btn btn-ghost" style={{ padding: "5px 9px", fontSize: 12 }} onClick={() => setEditing(null)}>✕</button>
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ fontSize: 14, fontWeight: 500 }}>{RMo.fmt(prices[key])}</span>
                    <button className="btn btn-ghost" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => startEdit(key)}>
                      <Icon name="pencil" size={13} /> Edit
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- WhatsApp Settings ---------- */
function WhatsAppPanel({ back }) {
  const [number, setNumber] = React.useState("9779801010422");
  const [saved, setSaved] = React.useState(false);

  return (
    <div className="content fade-in" style={{ maxWidth: 480, margin: "0 auto" }}>
      <SectionHead title="WhatsApp Number">
        <button className="btn btn-ghost" onClick={back}><Icon name="chevron-left" size={15} /> Back to Settings</button>
      </SectionHead>
      <div className="card" style={{ padding: 22 }}>
        <div style={{ fontSize: 13, color: "#64748b", marginBottom: 16, lineHeight: 1.55 }}>
          End-of-day reports and membership renewal reminders will be sent to this number.
          Enter in international format without + or spaces.
        </div>
        <div className="field">
          <label>WhatsApp number</label>
          <input className="input" value={number} onChange={(e) => { setNumber(e.target.value); setSaved(false); }} placeholder="9779801010422" />
        </div>
        <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 14 }}>977 = Nepal country code · e.g. 977980XXXXXXX</div>
        <button className={"btn " + (saved ? "btn-ghost" : "btn-primary")} style={saved ? { color: "#0F6E56" } : null}
          onClick={() => { setSaved(true); showToast("WhatsApp number saved"); }}>
          {saved ? <><Icon name="check" size={15} /> Saved</> : <><Icon name="save" size={15} /> Save number</>}
        </button>
      </div>
      <div style={{ marginTop: 14, background: "#f8f9fa", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px", fontSize: 12.5, color: "#64748b", lineHeight: 1.5 }}>
        <strong>To test:</strong> Go to Staff → End of Day → Count cash drawer → Send to owner via WhatsApp.
        A pre-filled WhatsApp link will open.
      </div>
    </div>
  );
}

/* ---------- Staff PINs ---------- */
function StaffPinsPanel({ back }) {
  const [staff, setStaff] = React.useState(window.RM.staff.map((s) => ({ ...s })));
  const [showAdd, setShowAdd] = React.useState(false);
  const emptyForm = { name: "", role: "Reception", pin: "" };
  const [form, setForm] = React.useState(emptyForm);
  const [reveal, setReveal] = React.useState(null);

  const addStaff = () => {
    if (!form.name || form.pin.length !== 4) return;
    setStaff([...staff, { ...form }]);
    showToast(form.name + " added");
    setShowAdd(false);
    setForm(emptyForm);
  };

  const removeStaff = (name) => {
    setStaff(staff.filter((s) => s.name !== name));
    showToast(name + " removed", "info");
  };

  const initials = (name) => name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="content fade-in" style={{ maxWidth: 560, margin: "0 auto" }}>
      <SectionHead title="Staff PINs">
        <button className="btn btn-ghost" onClick={back}><Icon name="chevron-left" size={15} /> Back to Settings</button>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}><Icon name="plus" size={15} /> Add staff</button>
      </SectionHead>

      {showAdd && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.32)", backdropFilter: "blur(3px)", display: "grid", placeItems: "center", zIndex: 50 }}>
          <div className="card scale-in" style={{ width: 340, padding: 22 }}>
            <div className="between" style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 15, fontWeight: 500 }}>Add staff member</div>
              <button className="rowmenu" onClick={() => { setShowAdd(false); setForm(emptyForm); }}><Icon name="x" size={17} color="#64748b" /></button>
            </div>
            <div className="field"><label>Full name *</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Sita Sharma" autoFocus /></div>
            <div className="field"><label>Role</label><input className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} /></div>
            <div className="field">
              <label>4-digit PIN *</label>
              <input className="input" type="text" inputMode="numeric" pattern="[0-9]*"
                maxLength={4} value={form.pin}
                onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, "").slice(0, 4) })}
                placeholder="••••" style={{ letterSpacing: 6 }} />
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
              <button className="btn btn-ghost btn-block" onClick={() => { setShowAdd(false); setForm(emptyForm); }}>Cancel</button>
              <button className="btn btn-primary btn-block"
                disabled={!form.name || form.pin.length !== 4}
                style={!form.name || form.pin.length !== 4 ? { opacity: .5, cursor: "not-allowed" } : null}
                onClick={addStaff}>
                <Icon name="user-plus" size={15} /> Add
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="card" style={{ overflow: "hidden" }}>
        <div style={{ padding: "10px 16px", background: "#f8f9fa", borderBottom: "1px solid var(--border)", fontSize: 12, color: "#64748b", fontWeight: 500 }}>
          {staff.length} staff member{staff.length !== 1 ? "s" : ""}
        </div>
        {staff.map((s, i) => (
          <div key={s.name} style={{ display: "flex", alignItems: "center", padding: "13px 16px", borderBottom: i < staff.length - 1 ? "1px solid #f1f5f9" : "none", gap: 13 }}>
            <div className="avatar av-active" style={{ width: 36, height: 36, fontSize: 12 }}>{initials(s.name)}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13.5, fontWeight: 500 }}>{s.name}</div>
              <div style={{ fontSize: 11.5, color: "#64748b" }}>{s.role}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontFamily: "monospace", fontSize: 16, letterSpacing: 4, color: reveal === s.name ? "#1a202c" : "#94a3b8", minWidth: 52 }}>
                {reveal === s.name ? s.pin : "••••"}
              </span>
              <button className="rowmenu" title={reveal === s.name ? "Hide PIN" : "Reveal PIN"} onClick={() => setReveal(reveal === s.name ? null : s.name)}>
                <Icon name={reveal === s.name ? "eye-off" : "eye"} size={15} color="#94a3b8" />
              </button>
            </div>
            <button className="btn btn-ghost" style={{ padding: "4px 10px", fontSize: 12, color: "#ef4444", borderColor: "#fecaca" }} onClick={() => removeStaff(s.name)}>
              Remove
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Business Info ---------- */
function BusinessInfoPanel({ back }) {
  const [info, setInfo] = React.useState({
    name: "Refresh Sports Club",
    address: "Boudha, Kathmandu, Nepal",
    phone: "9801010422",
    email: "refresh@example.com",
    hours: "6:00 AM – 9:00 PM",
  });
  const [saved, setSaved] = React.useState(false);
  const f = (k, v) => { setInfo({ ...info, [k]: v }); setSaved(false); };

  return (
    <div className="content fade-in" style={{ maxWidth: 480, margin: "0 auto" }}>
      <SectionHead title="Business Info">
        <button className="btn btn-ghost" onClick={back}><Icon name="chevron-left" size={15} /> Back to Settings</button>
      </SectionHead>
      <div className="card" style={{ padding: 22, display: "flex", flexDirection: "column", gap: 0 }}>
        <div className="field"><label>Business name</label><input className="input" value={info.name} onChange={(e) => f("name", e.target.value)} /></div>
        <div className="field"><label>Address</label><input className="input" value={info.address} onChange={(e) => f("address", e.target.value)} /></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div className="field"><label>Phone</label><input className="input" value={info.phone} onChange={(e) => f("phone", e.target.value)} /></div>
          <div className="field"><label>Email</label><input className="input" value={info.email} onChange={(e) => f("email", e.target.value)} /></div>
        </div>
        <div className="field"><label>Opening hours</label><input className="input" value={info.hours} onChange={(e) => f("hours", e.target.value)} placeholder="e.g. 6:00 AM – 9:00 PM" /></div>
        <button className={"btn " + (saved ? "btn-ghost" : "btn-primary")} style={saved ? { color: "#0F6E56" } : null}
          onClick={() => { setSaved(true); showToast("Business info saved"); }}>
          {saved ? <><Icon name="check" size={15} /> Saved</> : <><Icon name="save" size={15} /> Save info</>}
        </button>
      </div>
    </div>
  );
}

/* ---------- Settings ---------- */
function OwnerSettings() {
  const [panel, setPanel] = React.useState(null);

  if (panel === "pricing") return <PricingManager back={() => setPanel(null)} />;
  if (panel === "whatsapp") return <WhatsAppPanel back={() => setPanel(null)} />;
  if (panel === "staff") return <StaffPinsPanel back={() => setPanel(null)} />;
  if (panel === "biz") return <BusinessInfoPanel back={() => setPanel(null)} />;

  const panelMap = {
    "Pricing manager": "pricing",
    "WhatsApp number": "whatsapp",
    "Staff PINs": "staff",
    "Business info": "biz",
  };

  return (
    <div className="content fade-in">
      <SectionHead title="Settings" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
        {RMo.settings.map((s) => {
          const hasPanel = !!panelMap[s.title];
          return (
            <div key={s.title} className="settings-card card"
              style={{ padding: "15px 16px", display: "flex", alignItems: "center", gap: 13, cursor: hasPanel ? "pointer" : "default", transition: "background .12s, border-color .12s", opacity: hasPanel ? 1 : .75 }}
              onClick={() => { if (hasPanel) setPanel(panelMap[s.title]); }}>
              <div style={{ width: 38, height: 38, borderRadius: 9, background: hasPanel ? "#E6F1FB" : "#f1f5f9", display: "grid", placeItems: "center", flex: "0 0 38px" }}>
                <Icon name={s.icon} size={18} color={hasPanel ? "#185FA5" : "#94a3b8"} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 500 }}>{s.title}</div>
                <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 2 }}>{s.desc}</div>
              </div>
              {hasPanel
                ? <Icon name="chevron-right" size={17} color="#94a3b8" />
                : <span style={{ fontSize: 10.5, color: "#94a3b8", background: "#f1f5f9", borderRadius: 4, padding: "2px 7px" }}>Soon</span>
              }
            </div>
          );
        })}
      </div>
    </div>
  );
}

Object.assign(window, { OwnerDashboard, OwnerTransactions, OwnerMembers, OwnerBookings, OwnerInventory, OwnerReports, OwnerSettings });
