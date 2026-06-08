import { useState } from 'react';
import { transactions, members, products, eod, fmt } from '../data/mock';
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
          <div key={t.k} className={"tile " + (t.accent || "") + (t.dim ? " dim" : "")} onClick={() => !t.dim && go(t.k)}>
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
            <button className="btn btn-ghost btn-block" onClick={() => { setSaved(false); setStep(0); setType("Day Pass"); setProduct(""); setName(""); setPhone(""); }}>New transaction</button>
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
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", display: "flex" }}><Icon name="search" size={16} color="#94a3b8" /></span>
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
              <span style={{ fontSize: 11.5, color: m.status === "Expiring soon" ? "#b45309" : m.status === "Expired" ? "#991b1b" : "#94a3b8" }}>Expires {m.expiry}</span>
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
        <thead><tr><th style={{ width: 90 }}>Time</th><th>Customer &amp; Product</th><th className="num" style={{ width: 110 }}>Amount</th><th style={{ width: 90 }}>Payment</th></tr></thead>
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
      <div className="tbl-foot"><span>{tx.length} transactions · today</span><span className="total">Total: {fmt(total)}</span></div>
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
        <button className={"btn btn-block " + (sent ? "btn-ghost" : "btn-teal")} style={{ marginTop: 18, ...(sent ? { color: "#0F6E56", borderColor: "#bbe3d6", background: "#eafaf4" } : {}) }} onClick={() => setSent(true)}>
          <Icon name={sent ? "check-check" : "message-circle"} size={17} />
          {sent ? "Report sent to owner" : "Send to owner via WhatsApp"}
        </button>
      </div>
    </div>
  );
}
