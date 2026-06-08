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

// No-op kept so existing call sites stay valid; icons now self-render.
function useLucide() {}

const WaveMark = ({ size = 22, color = "#fff" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path d="M2 8c2.2 0 2.2 2 4.4 2s2.2-2 4.4-2 2.2 2 4.4 2S17.4 8 19.6 8 21.8 10 22 10"
      stroke={color} strokeWidth="2" strokeLinecap="round" />
    <path d="M2 13c2.2 0 2.2 2 4.4 2s2.2-2 4.4-2 2.2 2 4.4 2 2.2-2 4.4-2 2 2 2.4 2"
      stroke={color} strokeWidth="2" strokeLinecap="round" opacity=".6" />
  </svg>
);

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

// Windows window chrome wrapper
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

// App header — role: "staff" | "owner"
function AppHeader({ role, onLogout }) {
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

Object.assign(window, { Icon, useLucide, WaveMark, Badge, PayBadge, Avatar, Window, AppHeader, SectionHead });
