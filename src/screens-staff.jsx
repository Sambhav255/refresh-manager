/* ===== Staff interface screens ===== */
const { fmt } = window.RM;
const priceOf = (p) => (window.RM.prices[p] || 0);

/* ---------- Home ---------- */
function StaffHome({ go }) {
  const tx = window.RM.transactions;
  const total = tx.reduce((s, t) => s + t.amount, 0);
  const cash = tx.filter((t) => t.pay === "Cash").reduce((s, t) => s + t.amount, 0);
  const qr = tx.filter((t) => t.pay === "QR").reduce((s, t) => s + t.amount, 0);
  const lowCount = window.RM.inventory.filter((i) => i.low).length;

  const metrics = [
    { label: "Revenue today", value: fmt(total) },
    { label: "Cash", value: fmt(cash) },
    { label: "QR", value: fmt(qr) },
  ];
  const tiles = [
    { k: "new", icon: "plus-circle", c: "#185FA5", bg: "#E6F1FB", t: "New Transaction", s: "Day pass · Package · Membership", accent: "accent-blue" },
    { k: "members", icon: "user-search", c: "#0F6E56", bg: "#dcfce7", t: "Search Member", s: "Check status and expiry" },
    { k: "log", icon: "list", c: "#64748b", bg: "#f1f5f9", t: "Today's Log", s: tx.length + " transactions so far" },
    { k: "eod", icon: "send", c: "#0F6E56", bg: "#d6f0e7", t: "End of Day", s: "Send WhatsApp report", accent: "accent-teal" },
    { k: "inv", icon: "package", c: "#b45309", bg: "#fef3c7", t: "Inventory", s: lowCount ? lowCount + " items low stock" : "All stock OK", warn: lowCount > 0 },
    { k: "more", icon: "layout-grid", c: "#94a3b8", bg: "#f1f5f9", t: "More", s: "Coming soon", dim: true },
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
          <div key={t.k} className={"tile " + (t.accent || "") + (t.dim ? " dim" : "")}
            onClick={() => !t.dim && go(t.k)}>
            <div className="t-icon" style={{ background: t.bg }}><Icon name={t.icon} size={22} color={t.c} /></div>
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

/* ---------- New Transaction (5-step wizard) ---------- */
function NewTransaction({ onDone, staffName }) {
  const [step, setStep] = React.useState(0);
  const [product, setProduct] = React.useState("");
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [pay, setPay] = React.useState("Cash");
  const [saved, setSaved] = React.useState(false);
  const [type, setType] = React.useState("Membership");

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
          {phone && (
            <a href={"https://wa.me/977" + phone + "?text=" + encodeURIComponent("Thank you for visiting Refresh! Your " + product + " payment of " + fmt(amount) + " (" + pay + ") is confirmed. See you again!")}
              target="_blank" rel="noopener"
              className="btn btn-ghost btn-block" style={{ textDecoration: "none", color: "#16a34a", marginTop: 22 }}>
              <Icon name="message-circle" size={15} color="#16a34a" /> Send receipt via WhatsApp
            </a>
          )}
          <div style={{ display: "flex", gap: 10, marginTop: phone ? 10 : 22 }}>
            <button className="btn btn-ghost btn-block" onClick={() => { setSaved(false); setStep(0); setType("Membership"); setProduct(""); setName(""); setPhone(""); setPay("Cash"); }}>New transaction</button>
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
                {Object.keys(window.RM.products).map((t) => <option key={t}>{t}</option>)}
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
                {window.RM.products[type].map((p) => <option key={p}>{p}</option>)}
              </select>
            </div>
            {product && <div className="amount-box"><span className="a-label">Amount</span><span className="a-value">{fmt(amount)}</span></div>}
          </div>
        )}

        {step === 2 && (
          <div className="fade-in">
            <div className="field"><label>Transaction type</label><select className="select" value={type} disabled style={{ color: "#475569" }}><option>{type}</option></select></div>
            <div className="field"><label>Product</label><select className="select" value={product} disabled style={{ color: "#475569" }}><option>{product}</option></select></div>
            <div className="field"><label>Customer name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name (or leave blank for walk-in)" /></div>
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
                <span style={{ color: "#64748b" }}>{k}</span><span style={{ color: "#1a202c" }}>{v}</span>
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
            : <button className="btn btn-primary btn-block" style={{ width: "auto", flex: 1 }} onClick={() => {
                const newTx = {
                  id: "T-" + String(window.RM.transactions.length + 1).padStart(3, "0"),
                  time: new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
                  customer: name.trim() || "Walk-in",
                  product,
                  amount,
                  pay,
                  staff: staffName || "Staff",
                };
                window.RM.transactions = [newTx, ...window.RM.transactions];
                setSaved(true);
                showToast("Transaction saved · " + fmt(amount));
              }}><Icon name="check" size={16} /> Confirm & Save</button>}
        </div>
      </div>
    </div>
  );
}

/* ---------- Member Search ---------- */
function MemberSearch() {
  const [q, setQ] = React.useState("");
  const [selected, setSelected] = React.useState(null);
  const [showAdd, setShowAdd] = React.useState(false);
  const emptyForm = { name: "", phone: "", type: "Swimming + Gym — Monthly" };
  const [form, setForm] = React.useState(emptyForm);

  const all = window.RM.members;
  const res = q.trim() ? all.filter((m) => (m.name + m.phone).toLowerCase().includes(q.trim().toLowerCase())) : all;

  const handleQ = (v) => { setQ(v); setSelected(null); };

  const addMember = () => {
    if (!form.name) return;
    showToast(form.name + " added as member");
    setShowAdd(false);
    setForm(emptyForm);
  };

  return (
    <div className="content fade-in" style={{ maxWidth: 720, margin: "0 auto" }}>
      {showAdd && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.32)", backdropFilter: "blur(3px)", display: "grid", placeItems: "center", zIndex: 50 }}>
          <div className="card scale-in" style={{ width: 380, padding: 24 }}>
            <div className="between" style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 500 }}>New Member</div>
              <button className="rowmenu" onClick={() => { setShowAdd(false); setForm(emptyForm); }}><Icon name="x" size={18} color="#64748b" /></button>
            </div>
            <div className="field"><label>Full name *</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Full name" autoFocus /></div>
            <div className="field"><label>Phone</label><input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="98XXXXXXXX" /></div>
            <div className="field">
              <label>Membership type</label>
              <select className="select" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {window.RM.products["Membership"].map((p) => <option key={p}>{p}</option>)}
              </select>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn btn-ghost btn-block" onClick={() => { setShowAdd(false); setForm(emptyForm); }}>Cancel</button>
              <button className="btn btn-primary btn-block"
                disabled={!form.name} style={!form.name ? { opacity: .5, cursor: "not-allowed" } : null}
                onClick={addMember}>
                <Icon name="user-plus" size={15} /> Add Member
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <div style={{ position: "relative", flex: 1 }}>
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", display: "flex" }}><Icon name="search" size={16} color="#94a3b8" /></span>
          <input className="input" style={{ paddingLeft: 36 }} value={q} onChange={(e) => handleQ(e.target.value)} placeholder="Search by name or phone…" />
        </div>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}><Icon name="user-plus" size={15} /> New Member</button>
      </div>

      <div className="sub" style={{ marginBottom: 12 }}>{res.length} result{res.length !== 1 ? "s" : ""} found</div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {res.map((m) => (
          <React.Fragment key={m.name}>
            <div className="card" style={{ padding: "13px 16px", display: "flex", alignItems: "center", gap: 14, cursor: "pointer", borderColor: selected?.name === m.name ? "var(--blue)" : "var(--border)", background: selected?.name === m.name ? "var(--blue-fill)" : "#fff", transition: "border-color .12s, background .12s" }}
              onClick={() => setSelected(selected?.name === m.name ? null : m)}>
              <Avatar initials={m.initials} status={m.status} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{m.name}</div>
                <div className="sub" style={{ color: "#64748b", marginTop: 2 }}>{m.type} · {m.phone}</div>
              </div>
              <div style={{ textAlign: "right", display: "flex", flexDirection: "column", gap: 5, alignItems: "flex-end" }}>
                <Badge kind={m.status} />
                <span style={{ fontSize: 11.5, color: m.status === "Expiring soon" ? "#b45309" : m.status === "Expired" ? "#991b1b" : "#94a3b8" }}>Expires {m.expiry}</span>
              </div>
              <Icon name={selected?.name === m.name ? "chevron-up" : "chevron-right"} size={15} color="#94a3b8" />
            </div>
            {selected?.name === m.name && (
              <div className="fade-in" style={{ marginTop: -4, padding: "14px 16px", background: "#f8faff", borderRadius: "0 0 8px 8px", border: "1px solid var(--blue)", borderTop: "none", display: "flex", gap: 14, alignItems: "center" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 500, color: m.status === "Expired" ? "#991b1b" : m.status === "Expiring soon" ? "#b45309" : "#16a34a" }}>
                    {m.status === "Expired" ? "Expired · " : m.status === "Expiring soon" ? "Expiring · " : "Active until · "}{m.expiry}
                  </div>
                  <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{m.type}</div>
                </div>
                <a href={"https://wa.me/977" + m.phone} target="_blank" rel="noopener"
                  className="btn btn-ghost" style={{ fontSize: 12, padding: "5px 11px", textDecoration: "none", color: "#16a34a", borderColor: "#bbf7d0" }}>
                  <Icon name="message-circle" size={14} color="#16a34a" /> WhatsApp
                </a>
                {(m.status === "Expired" || m.status === "Expiring soon") && (
                  <button className="btn btn-primary" style={{ fontSize: 12, padding: "5px 11px" }}
                    onClick={() => showToast("Use New Transaction → Membership to renew", "info")}>
                    <Icon name="refresh-cw" size={13} /> Renew
                  </button>
                )}
              </div>
            )}
          </React.Fragment>
        ))}
        {res.length === 0 && (
        <div className="card" style={{ padding: 28, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
          {q ? `No members match "${q}".` : "No members on record yet."}
        </div>
      )}
      </div>
    </div>
  );
}

/* ---------- Today's Log ---------- */
function TodaysLog() {
  const all = window.RM.transactions;
  const [q, setQ] = React.useState("");
  const [payF, setPayF] = React.useState("All");

  const tx = all.filter((t) => {
    const matchQ = (t.customer + t.product).toLowerCase().includes(q.toLowerCase());
    const matchP = payF === "All" || t.pay === payF;
    return matchQ && matchP;
  });
  const total = tx.reduce((s, t) => s + t.amount, 0);

  return (
    <div className="content fade-in" style={{ maxWidth: 860, margin: "0 auto" }}>
      <SectionHead title="Today's Log" date={window.fmtDate(new Date())} />
      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        <div style={{ position: "relative", flex: 1 }}>
          <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", display: "flex" }}><Icon name="search" size={15} color="#94a3b8" /></span>
          <input className="input" style={{ paddingLeft: 33 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customer or product…" />
        </div>
        <div className="seg">
          {["All", "Cash", "QR"].map((p) => (
            <button key={p} className={payF === p ? "on" : ""} onClick={() => setPayF(p)}>{p}</button>
          ))}
        </div>
      </div>
      <table className="tbl">
        <thead><tr><th style={{ width: 90 }}>Time</th><th>Customer &amp; Product</th><th className="num" style={{ width: 110 }}>Amount</th><th style={{ width: 90 }}>Payment</th></tr></thead>
        <tbody>
          {tx.length === 0
            ? <tr><td colSpan={4} style={{ textAlign: "center", color: "#94a3b8", padding: 24 }}>No transactions match.</td></tr>
            : tx.map((t) => (
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
        <span>{tx.length} transaction{tx.length !== 1 ? "s" : ""}{q || payF !== "All" ? " (filtered)" : " · today"}</span>
        <span className="total">Total: {fmt(total)}</span>
      </div>
    </div>
  );
}

/* ---------- End of Day (with cash reconciliation) ---------- */
function EndOfDay() {
  const e = window.RM.eod;
  const [step, setStep] = React.useState(0); // 0: summary, 1: count, 2: result
  const [physical, setPhysical] = React.useState("");
  const [sent, setSent] = React.useState(false);

  const physNum = parseFloat(physical) || 0;
  const diff = physNum - e.cash;
  const matched = physical !== "" && Math.abs(diff) < 1;

  return (
    <div className="content fade-in" style={{ display: "grid", placeItems: "start center", paddingTop: 24 }}>
      <div className="card scale-in" style={{ width: 430, padding: 24 }}>
        <div style={{ textAlign: "center", paddingBottom: 18 }}>
          <div className="m-label" style={{ fontSize: 12 }}>Total revenue today</div>
          <div style={{ fontSize: 34, fontWeight: 500, margin: "4px 0 4px", letterSpacing: ".2px" }}>{fmt(e.total)}</div>
          <div className="sub">{e.count} transactions · {window.fmtDate(new Date())}</div>
        </div>

        {step === 0 && (
          <>
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 6 }}>
              {e.rows.map((r) => (
                <div key={r.label} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", fontSize: 13, borderBottom: "1px solid #f1f5f9" }}>
                  <span style={{ color: "#64748b" }}>{r.label}</span>
                  <span>{r.value}{r.note && <span style={{ color: "#94a3b8" }}> ({r.note})</span>}</span>
                </div>
              ))}
            </div>
            <button className="btn btn-primary btn-block" style={{ marginTop: 18 }} onClick={() => setStep(1)}>
              <Icon name="coins" size={16} /> Count cash drawer
            </button>
          </>
        )}

        {step === 1 && (
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16 }}>
            <div style={{ fontSize: 13.5, fontWeight: 500, marginBottom: 14 }}>Cash reconciliation</div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "10px 0", borderBottom: "1px solid #f1f5f9", marginBottom: 14 }}>
              <span style={{ color: "#64748b" }}>System cash total</span>
              <span style={{ fontWeight: 500 }}>{fmt(e.cash)}</span>
            </div>
            <div className="field">
              <label>Physical cash in drawer</label>
              <input className="input" type="number" value={physical} onChange={(ev) => setPhysical(ev.target.value)}
                placeholder="Enter amount…" autoFocus onKeyDown={(ev) => ev.key === "Enter" && physical && setStep(2)} />
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
              <button className="btn btn-ghost btn-block" onClick={() => setStep(0)}>
                <Icon name="chevron-left" size={15} /> Back
              </button>
              <button className="btn btn-primary btn-block"
                disabled={!physical}
                style={!physical ? { opacity: .5, cursor: "not-allowed" } : null}
                onClick={() => setStep(2)}>
                Verify count
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16 }}>
            <div className={"alert " + (matched ? "green" : "amber")} style={{ marginBottom: 16 }}>
              <Icon name={matched ? "check-circle" : "alert-triangle"} size={17} />
              <div>
                <div className="a-title">
                  {matched ? "Cash balanced ✓" : (diff > 0 ? "Over by " : "Short by ") + fmt(Math.abs(diff))}
                </div>
                <div className="a-desc">
                  {matched
                    ? "Physical count matches system total."
                    : "System: " + fmt(e.cash) + " · Physical: " + fmt(physNum)}
                </div>
              </div>
            </div>
            <button className={"btn btn-block " + (sent ? "btn-ghost" : "btn-teal")}
              style={{ ...(sent ? { color: "#0F6E56", borderColor: "#bbe3d6", background: "#eafaf4" } : {}) }}
              onClick={() => {
                setSent(true);
                showToast("EOD report sent via WhatsApp");
                const msg = `EOD Report · ${window.fmtDate(new Date())}\n` +
                  "Total: " + window.RM.fmt(e.total) + " (" + e.count + " txns)\n" +
                  "Cash: " + window.RM.fmt(e.cash) + "\n" +
                  "QR: " + window.RM.fmt(e.qr);
                window.open("https://wa.me/9779801010422?text=" + encodeURIComponent(msg));
              }}>
              <Icon name={sent ? "check-check" : "message-circle"} size={17} />
              {sent ? "Report sent to owner" : "Send to owner via WhatsApp"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { StaffHome, NewTransaction, MemberSearch, TodaysLog, EndOfDay });
