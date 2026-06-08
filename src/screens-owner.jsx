/* ===== Owner interface screens ===== */
const RMo = window.RM;

/* ---------- Dashboard ---------- */
function OwnerDashboard() {
  const tx = RMo.transactions.slice(0, 5);
  const total = RMo.transactions.reduce((s, t) => s + t.amount, 0);
  const alerts = [
    { c: "amber", icon: "calendar-clock", t: "3 memberships expiring", d: "Within next 5 days" },
    { c: "red", icon: "alert-triangle", t: "2 items low stock", d: "Goggles Baby · Nose Pin" },
    { c: "green", icon: "trending-up", t: "7 new members this week", d: "On track for target" },
  ];
  return (
    <div className="content fade-in">
      <SectionHead title="Dashboard" date="Sunday, 7 Jun 2026">
        <button className="btn btn-ghost"><Icon name="download" size={15} /> Export today</button>
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
          <div className="between" style={{ marginBottom: 10 }}><div style={{ fontSize: 14, fontWeight: 500 }}>Recent transactions</div><a style={{ fontSize: 12, color: "#185FA5", cursor: "pointer" }}>View all</a></div>
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
        </div>
      </div>
    </div>
  );
}

/* ---------- Transactions (full log) ---------- */
function OwnerTransactions() {
  const tx = RMo.transactions;
  const total = tx.reduce((s, t) => s + t.amount, 0);
  return (
    <div className="content fade-in">
      <SectionHead title="Transactions" />
      <div style={{ display: "flex", gap: 10, marginBottom: 14, alignItems: "center" }}>
        <select className="select" style={{ width: 130 }} defaultValue="Today"><option>Today</option><option>Yesterday</option><option>This week</option><option>This month</option></select>
        <select className="select" style={{ width: 140 }} defaultValue="All types"><option>All types</option><option>Membership</option><option>Day Package</option><option>Day Pass</option></select>
        <select className="select" style={{ width: 130 }} defaultValue="All staff"><option>All staff</option><option>Aarti</option></select>
        <div className="spacer" />
        <button className="btn btn-ghost"><Icon name="sheet" size={15} color="#16a34a" /> Export Excel</button>
      </div>
      <table className="tbl">
        <thead><tr><th style={{ width: 56 }}>ID</th><th style={{ width: 84 }}>Time</th><th>Customer</th><th>Product</th><th className="num" style={{ width: 96 }}>Amount</th><th style={{ width: 76 }}>Payment</th><th style={{ width: 44 }}></th></tr></thead>
        <tbody>
          {tx.map((t) => (
            <tr key={t.id}>
              <td style={{ color: "#94a3b8" }}>{t.id}</td>
              <td style={{ color: "#94a3b8" }}>{t.time}</td>
              <td style={{ fontWeight: 500 }}>{t.customer}</td>
              <td style={{ color: "#64748b", fontSize: 12.5 }}>{t.product}</td>
              <td className="num">{RMo.fmt(t.amount)}</td>
              <td><PayBadge pay={t.pay} /></td>
              <td><button className="rowmenu"><Icon name="more-vertical" size={16} color="#94a3b8" /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="tbl-foot"><span>{tx.length} transactions</span><span className="total">Total: {RMo.fmt(total)}</span></div>
    </div>
  );
}

/* ---------- Members ---------- */
function OwnerMembers() {
  const m = RMo.members;
  return (
    <div className="content fade-in">
      <SectionHead title="Members" />
      <div style={{ display: "flex", gap: 10, marginBottom: 14, alignItems: "center" }}>
        <div style={{ position: "relative", width: 260 }}>
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", display: "flex" }}><Icon name="search" size={15} color="#94a3b8" /></span>
          <input className="input" style={{ paddingLeft: 34 }} placeholder="Search members…" />
        </div>
        <select className="select" style={{ width: 150 }} defaultValue="All statuses"><option>All statuses</option><option>Active</option><option>Expiring soon</option><option>Expired</option></select>
        <div className="spacer" />
        <button className="btn btn-ghost"><Icon name="download" size={15} /> Export</button>
      </div>
      <table className="tbl">
        <thead><tr><th>Member</th><th style={{ width: 180 }}>Membership type</th><th style={{ width: 130 }}>Status</th><th style={{ width: 140 }}>Expiry date</th></tr></thead>
        <tbody>
          {m.map((x) => (
            <tr key={x.name}>
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
    </div>
  );
}

/* ---------- Inventory ---------- */
function OwnerInventory() {
  const inv = RMo.inventory;
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
        <thead><tr><th>Item</th><th style={{ width: 130 }}>Variant</th><th className="num" style={{ width: 80 }}>Stock</th><th className="num" style={{ width: 90 }}>Reorder at</th><th className="num" style={{ width: 90 }}>Price</th><th style={{ width: 110 }}></th></tr></thead>
        <tbody>
          {inv.map((r, i) => (
            <tr key={i}>
              <td style={{ fontWeight: 500 }}>
                {r.low && <Icon name="alert-triangle" size={14} color="#ef4444" style={{ verticalAlign: "-2px", marginRight: 6 }} />}{r.item}
              </td>
              <td style={{ color: "#64748b" }}>{r.variant}</td>
              <td className="num" style={{ color: r.low ? "#ef4444" : "#1a202c", fontWeight: r.low ? 500 : 400 }}>{r.stock}</td>
              <td className="num" style={{ color: "#94a3b8" }}>{r.reorder}</td>
              <td className="num">{RMo.fmt(r.price)}</td>
              <td><button className={"btn " + (r.low ? "btn-primary" : "btn-ghost")} style={{ padding: "5px 11px", fontSize: 12 }}>Restock</button></td>
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
            <button className="btn btn-ghost" style={{ alignSelf: "flex-start", padding: "6px 11px", fontSize: 12 }}><Icon name="sheet" size={14} color="#16a34a" /> Export to Excel</button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Settings ---------- */
function OwnerSettings() {
  return (
    <div className="content fade-in">
      <SectionHead title="Settings" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
        {RMo.settings.map((s) => (
          <div key={s.title} className="settings-card card" style={{ padding: "15px 16px", display: "flex", alignItems: "center", gap: 13, cursor: "pointer", transition: "background .12s, border-color .12s" }}>
            <div style={{ width: 38, height: 38, borderRadius: 9, background: "#E6F1FB", display: "grid", placeItems: "center", flex: "0 0 38px" }}><Icon name={s.icon} size={18} color="#185FA5" /></div>
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

Object.assign(window, { OwnerDashboard, OwnerTransactions, OwnerMembers, OwnerInventory, OwnerReports, OwnerSettings });
