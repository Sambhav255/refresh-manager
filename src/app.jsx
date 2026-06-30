/* ===== Refresh Manager — app shell & routing ===== */
const { useState, useEffect } = React;

/* ---------- Staff PIN Login ---------- */
function StaffPinLogin({ onLogin, back }) {
  const [pin, setPin] = useState("");
  const [shake, setShake] = useState(false);

  const handleDigit = (d) => {
    const next = (pin + d).slice(0, 4);
    setPin(next);
    if (next.length === 4) {
      const found = window.RM.staff.find((s) => s.pin === next);
      if (found) {
        onLogin("staff", found.name);
      } else {
        setShake(true);
        setTimeout(() => { setPin(""); setShake(false); }, 420);
      }
    }
  };

  const keys = [1, 2, 3, 4, 5, 6, 7, 8, 9, null, 0, "del"];

  useEffect(() => {
    const onKey = (e) => {
      if (e.key >= "0" && e.key <= "9") handleDigit(e.key);
      if (e.key === "Backspace") setPin((p) => p.slice(0, -1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pin]);

  return (
    <div style={{ flex: 1, display: "grid", placeItems: "center", background: "var(--bg)" }} className="fade-in">
      <div style={{ textAlign: "center" }}>
        <div style={{ width: 52, height: 52, borderRadius: 14, background: "linear-gradient(150deg,#185FA5,#0C447C)", display: "grid", placeItems: "center", margin: "0 auto 14px", boxShadow: "0 8px 20px -6px rgba(12,68,124,.4)" }}>
          <Icon name="user" size={24} color="#fff" />
        </div>
        <div style={{ fontSize: 17, fontWeight: 500, color: "#1a202c" }}>Staff Login</div>
        <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 3 }}>Enter your 4-digit PIN</div>

        <div className={"pin-dots" + (shake ? " shake" : "")}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={"pin-dot" + (pin.length > i ? " filled" : "") + (shake ? " error" : "")} />
          ))}
        </div>

        <div className="numpad">
          {keys.map((k, i) => {
            if (k === null) return <div key={i} className="numpad-key blank" />;
            if (k === "del") return (
              <button key="del" className="numpad-key del" onClick={() => setPin((p) => p.slice(0, -1))}>
                <Icon name="delete" size={19} />
              </button>
            );
            return (
              <button key={k} className="numpad-key" onClick={() => handleDigit(String(k))}>{k}</button>
            );
          })}
        </div>

        <div style={{ marginTop: 16, fontSize: 11.5, color: "#94a3b8" }}>Demo PINs: 1234 · 5678</div>
        <button onClick={back} style={{ marginTop: 14, background: "none", border: "none", color: "#64748b", fontSize: 12.5, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5 }}>
          <Icon name="chevron-left" size={14} /> Back
        </button>
      </div>
    </div>
  );
}

/* ---------- Owner Password Login ---------- */
function OwnerPasswordLogin({ onLogin, back }) {
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [error, setError] = useState(false);

  const submit = () => {
    if (user === "admin" && pass === "refresh2026") {
      onLogin("owner");
    } else {
      setError(true);
      setTimeout(() => setError(false), 3000);
    }
  };

  return (
    <div style={{ flex: 1, display: "grid", placeItems: "center", background: "var(--bg)" }} className="fade-in">
      <div style={{ width: 320, textAlign: "center" }}>
        <div style={{ width: 52, height: 52, borderRadius: 14, background: "linear-gradient(150deg,#185FA5,#0C447C)", display: "grid", placeItems: "center", margin: "0 auto 14px", boxShadow: "0 8px 20px -6px rgba(12,68,124,.4)" }}>
          <Icon name="shield" size={24} color="#fff" />
        </div>
        <div style={{ fontSize: 17, fontWeight: 500, color: "#1a202c" }}>Owner Login</div>
        <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 3, marginBottom: 22 }}>Admin credentials required</div>

        <div className="field" style={{ textAlign: "left" }}>
          <label>Username</label>
          <input className="input" value={user} onChange={(e) => setUser(e.target.value)} placeholder="admin" />
        </div>
        <div className="field" style={{ textAlign: "left" }}>
          <label>Password</label>
          <input className="input" type="password" value={pass} onChange={(e) => setPass(e.target.value)}
            placeholder="••••••••••" onKeyDown={(e) => e.key === "Enter" && submit()} />
        </div>

        {error && (
          <div className="alert red" style={{ marginBottom: 12, fontSize: 12.5 }}>
            <Icon name="alert-circle" size={15} /> Invalid credentials · try admin / refresh2026
          </div>
        )}

        <button className="btn btn-primary btn-block" onClick={submit}>
          <Icon name="log-in" size={16} /> Log in
        </button>
        <button onClick={back} style={{ marginTop: 12, background: "none", border: "none", color: "#64748b", fontSize: 12.5, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5 }}>
          <Icon name="chevron-left" size={14} /> Back
        </button>
        <div style={{ marginTop: 14, fontSize: 11.5, color: "#94a3b8" }}>Demo: admin / refresh2026</div>
      </div>
    </div>
  );
}

/* ---------- Login chooser ---------- */
function Login({ onLogin }) {
  const [mode, setMode] = useState("choose");

  if (mode === "staff") return <StaffPinLogin onLogin={onLogin} back={() => setMode("choose")} />;
  if (mode === "owner") return <OwnerPasswordLogin onLogin={onLogin} back={() => setMode("choose")} />;

  return (
    <div style={{ flex: 1, display: "grid", placeItems: "center", background: "var(--bg)" }} className="fade-in">
      <div style={{ width: 340, textAlign: "center" }}>
        <div style={{ width: 64, height: 64, borderRadius: 18, background: "linear-gradient(150deg,#185FA5,#0C447C)", display: "grid", placeItems: "center", margin: "0 auto 16px", boxShadow: "0 10px 24px -8px rgba(12,68,124,.5)" }}>
          <WaveMark size={34} />
        </div>
        <div style={{ fontSize: 23, fontWeight: 500, color: "#1a202c", letterSpacing: ".2px" }}>Refresh Manager</div>
        <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 4 }}>Boudha, Kathmandu</div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 30 }}>
          <button className="btn btn-ghost btn-block" style={{ padding: 14, fontSize: 14 }} onClick={() => setMode("staff")}>
            <Icon name="user" size={18} /> Staff Login
          </button>
          <button className="btn btn-primary btn-block" style={{ padding: 14, fontSize: 14 }} onClick={() => setMode("owner")}>
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
function StaffApp({ onLogout, userName }) {
  const [tab, setTab] = useState("home");

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA") return;
      const map = { n: "new", N: "new", m: "members", M: "members", l: "log", L: "log", e: "eod", E: "eod" };
      if (map[e.key]) setTab(map[e.key]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
      <AppHeader role="staff" userName={userName} onLogout={onLogout} />
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
  const nav = [
    { k: "dashboard", icon: "layout-dashboard", label: "Dashboard" },
    { k: "transactions", icon: "receipt-text", label: "Transactions" },
    { k: "members", icon: "users", label: "Members" },
    { k: "bookings", icon: "calendar", label: "Bookings" },
    { k: "inventory", icon: "package", label: "Inventory" },
    { k: "reports", icon: "bar-chart-3", label: "Reports" },
    { k: "settings", icon: "settings", label: "Settings" },
  ];
  const screens = {
    dashboard: <OwnerDashboard go={setTab} />,
    transactions: <OwnerTransactions />,
    members: <OwnerMembers />,
    bookings: <OwnerBookings />,
    inventory: <OwnerInventory />,
    reports: <OwnerReports />,
    settings: <OwnerSettings />,
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
  const [role, setRole] = useState("login");
  const [staffName, setStaffName] = useState("");

  const handleLogin = (r, name) => {
    setRole(r);
    if (name) setStaffName(name);
  };

  useEffect(() => { if (window.__fitStage) window.__fitStage(); }, [role]);

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
      : role === "staff"
        ? "Press <kbd>Esc</kbd> to log out · <kbd>N</kbd> New · <kbd>M</kbd> Members · <kbd>L</kbd> Log · <kbd>E</kbd> EOD"
        : "Press <kbd>Esc</kbd> to log out · everything is clickable";
  }, [role]);

  return (
    <Window onClose={() => setRole("login")}>
      {role === "login" && <Login onLogin={handleLogin} />}
      {role === "staff" && <StaffApp key="staff" userName={staffName} onLogout={() => setRole("login")} />}
      {role === "owner" && <OwnerApp key="owner" onLogout={() => setRole("login")} />}
      <ToastHost />
    </Window>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
