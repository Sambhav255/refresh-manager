/* ===== Refresh Manager — app shell & routing ===== */
const { useState, useEffect } = React;

/* ---------- Login ---------- */
function Login({ onLogin }) {
  return (
    <div style={{ flex: 1, display: "grid", placeItems: "center", background: "var(--bg)" }} className="fade-in">
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

/* ---------- Staff inventory (reachable from Home tile) ---------- */
function StaffInventory({ back }) {
  const inv = window.RM.inventory;
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

/* ---------- Staff shell ---------- */
function StaffApp({ onLogout }) {
  const [tab, setTab] = useState("home");
  useLucide(tab);
  const tabs = [
    { k: "home", icon: "home", label: "Home" },
    { k: "new", icon: "plus-circle", label: "New Transaction" },
    { k: "members", icon: "users", label: "Members" },
    { k: "log", icon: "list", label: "Today's Log" },
    { k: "eod", icon: "send", label: "End of Day" },
  ];
  let screen;
  if (tab === "home") screen = <StaffHome go={setTab} />;
  else if (tab === "new") screen = <NewTransaction onDone={setTab} />;
  else if (tab === "members") screen = <MemberSearch />;
  else if (tab === "log") screen = <TodaysLog />;
  else if (tab === "eod") screen = <EndOfDay />;
  else if (tab === "inv") screen = <StaffInventory back={() => setTab("home")} />;

  const navActive = (k) => (k === tab) || (tab === "inv" && k === "home");

  return (
    <div className="app">
      <AppHeader role="staff" onLogout={onLogout} />
      <div className="body-wrap"><div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>{screen}</div></div>
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

/* ---------- Owner shell ---------- */
function OwnerApp({ onLogout }) {
  const [tab, setTab] = useState("dashboard");
  useLucide(tab);
  const nav = [
    { k: "dashboard", icon: "layout-dashboard", label: "Dashboard" },
    { k: "transactions", icon: "receipt-text", label: "Transactions" },
    { k: "members", icon: "users", label: "Members" },
    { k: "inventory", icon: "package", label: "Inventory" },
    { k: "reports", icon: "bar-chart-3", label: "Reports" },
    { k: "settings", icon: "settings", label: "Settings" },
  ];
  const screens = {
    dashboard: <OwnerDashboard />, transactions: <OwnerTransactions />, members: <OwnerMembers />,
    inventory: <OwnerInventory />, reports: <OwnerReports />, settings: <OwnerSettings />,
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

/* ---------- Root ---------- */
function App() {
  const [role, setRole] = useState("login"); // login | staff | owner

  useEffect(() => { if (window.__fitStage) window.__fitStage(); }, [role]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && role !== "login") setRole("login"); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [role]);

  // footer hint
  useEffect(() => {
    const h = document.getElementById("hint");
    if (!h) return;
    h.innerHTML = role === "login"
      ? "Refresh Manager · interactive prototype — choose a login to begin"
      : "Press <kbd>Esc</kbd> to log out · everything is clickable";
  }, [role]);

  return (
    <Window onClose={() => setRole("login")}>
      {role === "login" && <Login onLogin={setRole} />}
      {role === "staff" && <StaffApp key="staff" onLogout={() => setRole("login")} />}
      {role === "owner" && <OwnerApp key="owner" onLogout={() => setRole("login")} />}
    </Window>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
