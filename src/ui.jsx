/* ===== Shared UI primitives ===== */

// Build an SVG string from lucide's icon-node data (no DOM replacement of React nodes).
function iconSvg(name, size, color, sw) {
  const L = window.lucide;
  if (!L || !L.icons) return "";
  const key = String(name).split(/[-_]/).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
  const node = L.icons[key];
  if (!node || !Array.isArray(node)) return "";
  const kids = node[2] || [];
  const inner = kids.map((c) => {
    const tag = c[0], attrs = c[1] || {};
    const a = Object.keys(attrs).map((k) => k + '="' + attrs[k] + '"').join(" ");
    return "<" + tag + " " + a + "></" + tag + ">";
  }).join("");
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size +
    '" viewBox="0 0 24 24" fill="none" stroke="' + color + '" stroke-width="' + sw +
    '" stroke-linecap="round" stroke-linejoin="round">' + inner + "</svg>";
}

// Icon: React only ever owns the wrapper <span>; the <svg> is set via innerHTML,
// so lucide/React never fight over the same node (no removeChild crashes).
function Icon({ name, size = 18, color, strokeWidth = 1.9, style }) {
  const ref = React.useRef(null);
  React.useLayoutEffect(() => {
    if (ref.current) ref.current.innerHTML = iconSvg(name, size, color || "currentColor", strokeWidth);
  }, [name, size, color, strokeWidth]);
  return <span ref={ref} aria-hidden="true" style={{ display: "inline-flex", width: size, height: size, color: color || undefined, ...style }} />;
}

function useLucide() {}

const WaveMark = ({ size = 22, color = "#fff" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path d="M2 8c2.2 0 2.2 2 4.4 2s2.2-2 4.4-2 2.2 2 4.4 2S17.4 8 19.6 8 21.8 10 22 10"
      stroke={color} strokeWidth="2" strokeLinecap="round" />
    <path d="M2 13c2.2 0 2.2 2 4.4 2s2.2-2 4.4-2 2.2 2 4.4 2 2.2-2 4.4-2 2 2 2.4 2"
      stroke={color} strokeWidth="2" strokeLinecap="round" opacity=".6" />
  </svg>
);

function fmtDate(d) {
  const da = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const mo = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return da[d.getDay()] + ", " + d.getDate() + " " + mo[d.getMonth()] + " " + d.getFullYear();
}

function Badge({ kind, children }) {
  const map = {
    "Active": "b-active", "Expiring soon": "b-exp", "Expired": "b-dead",
    "Cash": "b-cash", "QR": "b-qr", "Membership": "b-mem",
  };
  return <span className={"badge " + (map[kind] || "b-cash")}>{children || kind}</span>;
}

function PayBadge({ pay }) {
  return <span className={"badge " + (pay === "QR" ? "b-qr" : "b-cash")}>{pay}</span>;
}

function Avatar({ initials, status }) {
  const cls = status === "Active" ? "av-active" : status === "Expired" ? "av-dead" : "av-exp";
  return <div className={"avatar " + cls}>{initials}</div>;
}

function Window({ children, onClose }) {
  return (
    <div className="win">
      <div className="titlebar">
        <div className="tb-left">
          <div className="tb-dot" />
          <span className="tb-title">Refresh Manager</span>
        </div>
        <div className="win-controls">
          <button title="Minimize"><svg className="gl" viewBox="0 0 10 10"><line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" strokeWidth="1" /></svg></button>
          <button title="Maximize"><svg className="gl" viewBox="0 0 10 10"><rect x="1.2" y="1.2" width="7.6" height="7.6" fill="none" stroke="currentColor" strokeWidth="1" /></svg></button>
          <button className="close" title="Close" onClick={onClose}><svg className="gl" viewBox="0 0 10 10"><line x1="1.5" y1="1.5" x2="8.5" y2="8.5" stroke="currentColor" strokeWidth="1" /><line x1="8.5" y1="1.5" x2="1.5" y2="8.5" stroke="currentColor" strokeWidth="1" /></svg></button>
        </div>
      </div>
      {children}
    </div>
  );
}

function AppHeader({ role, userName, onLogout }) {
  const [time, setTime] = React.useState(() =>
    new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
  );
  React.useEffect(() => {
    const id = setInterval(() =>
      setTime(new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })),
      10000
    );
    return () => clearInterval(id);
  }, []);
  return (
    <div className="hdr">
      <div className="hdr-brand">
        <div className="hdr-logo"><WaveMark size={24} /></div>
        <span className="hdr-name">Refresh Manager</span>
      </div>
      <div className="hdr-right">
        <span style={{ fontSize: 12, color: "#bcd4ee", opacity: .75, letterSpacing: ".3px" }}>{time}</span>
        <div className="hdr-user">
          <Icon name={role === "staff" ? "user" : "shield"} size={15} color="#bcd4ee" />
          <span>{role === "staff" ? (userName || "Aarti") + " · Reception" : "Owner · Admin"}</span>
        </div>
        <button className="ghost-btn" onClick={onLogout}>
          <Icon name="log-out" size={14} /> Log out
        </button>
      </div>
    </div>
  );
}

function SectionHead({ title, date, children }) {
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

/* ===== Toast system ===== */
let _toastId = 0;

function showToast(msg, type) {
  window.dispatchEvent(new CustomEvent("rm:toast", { detail: { msg, type: type || "success", id: ++_toastId } }));
}

function ToastHost() {
  const [toasts, setToasts] = React.useState([]);
  React.useEffect(() => {
    const handler = (e) => {
      const t = e.detail;
      setToasts((ts) => [...ts, t]);
      setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== t.id)), 2800);
    };
    window.addEventListener("rm:toast", handler);
    return () => window.removeEventListener("rm:toast", handler);
  }, []);
  if (!toasts.length) return null;
  return (
    <div style={{ position: "fixed", bottom: 18, right: 18, zIndex: 300, display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
      {toasts.map((t) => (
        <div key={t.id} className={"toast " + t.type}>
          <Icon name={t.type === "error" ? "alert-circle" : t.type === "info" ? "info" : "check-circle"} size={15} color="#fff" />
          {t.msg}
        </div>
      ))}
    </div>
  );
}

/* ===== Member detail panel ===== */
function MemberDetail({ member, onClose }) {
  const parseDate = (str) => {
    const mo = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
    const p = str.split(" ");
    return new Date(parseInt(p[2]), mo[p[1]], parseInt(p[0]));
  };
  const APP_DATE = new Date();
  const expDate = parseDate(member.expiry);
  const daysLeft = Math.round((expDate - APP_DATE) / 86400000);
  const txs = window.RM.transactions.filter((t) => t.customer === member.name);
  const avCls = member.status === "Active" ? "av-active" : member.status === "Expired" ? "av-dead" : "av-exp";

  return (
    <div className="member-detail fade-in" style={{ position: "relative" }}>
      {onClose && (
        <button className="rowmenu" style={{ position: "absolute", right: 6, top: 6 }} onClick={onClose}>
          <Icon name="x" size={16} color="#94a3b8" />
        </button>
      )}
      <div style={{ textAlign: "center", paddingTop: 4 }}>
        <div className={"detail-avatar " + avCls}>{member.initials}</div>
        <div style={{ fontSize: 15, fontWeight: 500, marginTop: 10 }}>{member.name}</div>
        <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{member.type}</div>
        <div style={{ marginTop: 8 }}><Badge kind={member.status} /></div>
      </div>

      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 11, display: "flex", flexDirection: "column", gap: 7 }}>
        {[
          ["Expires", member.expiry, member.status === "Expired" ? "#991b1b" : member.status === "Expiring soon" ? "#b45309" : "#1a202c"],
          ["Days left", daysLeft > 0 ? daysLeft + " days" : "Expired", daysLeft > 0 && daysLeft <= 7 ? "#b45309" : daysLeft <= 0 ? "#991b1b" : "#1a202c"],
          ["Phone", member.phone, "#1a202c"],
        ].map(([label, value, color]) => (
          <div key={label} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
            <span style={{ color: "#94a3b8" }}>{label}</span>
            <span style={{ fontWeight: 500, color }}>{value}</span>
          </div>
        ))}
      </div>

      {(member.status === "Expired" || member.status === "Expiring soon") && (
        <button className="btn btn-primary btn-block" style={{ fontSize: 12.5, padding: "8px" }}
          onClick={() => showToast("Renewal flow — see New Transaction → Membership", "info")}>
          <Icon name="refresh-cw" size={13} /> Renew Membership
        </button>
      )}

      <a href={"https://wa.me/977" + member.phone + "?text=" + encodeURIComponent("Hello " + member.name + "!")}
        target="_blank" rel="noopener"
        className="btn btn-ghost btn-block"
        style={{ fontSize: 12.5, padding: "8px", textDecoration: "none" }}>
        <Icon name="message-circle" size={13} color="#16a34a" /> WhatsApp
      </a>

      <div>
        <div style={{ fontSize: 10.5, fontWeight: 600, color: "#94a3b8", letterSpacing: ".5px", marginBottom: 7 }}>RECENT TRANSACTIONS</div>
        {txs.length === 0
          ? <div style={{ fontSize: 12, color: "#94a3b8", textAlign: "center" }}>No transactions on record</div>
          : txs.slice(0, 3).map((t) => (
            <div key={t.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "6px 0", borderBottom: "1px solid #f1f5f9" }}>
              <span style={{ color: "#64748b", flex: 1, marginRight: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.product}</span>
              <span style={{ fontWeight: 500, flexShrink: 0 }}>{window.RM.fmt(t.amount)}</span>
            </div>
          ))
        }
      </div>
    </div>
  );
}

Object.assign(window, { Icon, useLucide, WaveMark, fmtDate, Badge, PayBadge, Avatar, Window, AppHeader, SectionHead, showToast, ToastHost, MemberDetail });
