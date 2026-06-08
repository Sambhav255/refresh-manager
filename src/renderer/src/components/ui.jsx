import {
  AlertTriangle,
  Banknote,
  BarChart3,
  Building2,
  Calendar,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  ClockAlert,
  Download,
  Filter,
  Folder,
  Home,
  LayoutDashboard,
  LayoutGrid,
  List,
  LogOut,
  MessageCircle,
  MoreVertical,
  Package,
  Plus,
  PlusCircle,
  Printer,
  QrCode,
  ReceiptText,
  Search,
  Send,
  Settings,
  Sheet,
  Shield,
  Tag,
  TrendingUp,
  User,
  UserCheck,
  UserSearch,
  Users,
  UtensilsCrossed,
  X
} from 'lucide-react'

const ICONS = {
  'alert-triangle': AlertTriangle,
  banknote: Banknote,
  'bar-chart-3': BarChart3,
  'building-2': Building2,
  calendar: Calendar,
  'calendar-clock': CalendarClock,
  'calendar-days': CalendarDays,
  'calendar-range': CalendarRange,
  check: Check,
  'check-check': CheckCheck,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'clock-alert': ClockAlert,
  download: Download,
  filter: Filter,
  folder: Folder,
  home: Home,
  'layout-dashboard': LayoutDashboard,
  'layout-grid': LayoutGrid,
  list: List,
  'log-out': LogOut,
  'message-circle': MessageCircle,
  'more-vertical': MoreVertical,
  package: Package,
  plus: Plus,
  'plus-circle': PlusCircle,
  printer: Printer,
  'qr-code': QrCode,
  'receipt-text': ReceiptText,
  search: Search,
  send: Send,
  settings: Settings,
  sheet: Sheet,
  shield: Shield,
  tag: Tag,
  'trending-up': TrendingUp,
  user: User,
  'user-check': UserCheck,
  'user-search': UserSearch,
  users: Users,
  utensils: UtensilsCrossed,
  x: X
}

export function Icon({ name, size = 18, color, strokeWidth = 1.9, style }) {
  const Comp = ICONS[name]
  if (!Comp) {
    console.warn(`Icon not found: "${name}"`)
    return <span style={{ display: 'inline-flex', width: size, height: size }} />
  }
  return (
    <Comp
      size={size}
      color={color || 'currentColor'}
      strokeWidth={strokeWidth}
      style={{ display: 'inline-flex', flexShrink: 0, ...style }}
    />
  )
}

export const WaveMark = ({ size = 22, color = '#fff' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path
      d="M2 8c2.2 0 2.2 2 4.4 2s2.2-2 4.4-2 2.2 2 4.4 2S17.4 8 19.6 8 21.8 10 22 10"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
    />
    <path
      d="M2 13c2.2 0 2.2 2 4.4 2s2.2-2 4.4-2 2.2 2 4.4 2 2.2-2 4.4-2 2 2 2.4 2"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      opacity=".6"
    />
  </svg>
)

export function Badge({ kind, children }) {
  const map = {
    Active: 'b-active',
    'Expiring soon': 'b-exp',
    Expired: 'b-dead',
    Cash: 'b-cash',
    QR: 'b-qr',
    Membership: 'b-mem'
  }
  return <span className={'badge ' + (map[kind] || 'b-cash')}>{children || kind}</span>
}

export function PayBadge({ pay }) {
  return <span className={'badge ' + (pay === 'QR' ? 'b-qr' : 'b-cash')}>{pay}</span>
}

export function Avatar({ initials, status }) {
  const cls = status === 'Active' ? 'av-active' : status === 'Expired' ? 'av-dead' : 'av-exp'
  return <div className={'avatar ' + cls}>{initials}</div>
}

export function Window({ children, onClose }) {
  return (
    <div className="win">
      <div className="titlebar">
        <div className="tb-left">
          <div className="tb-dot" />
          <span className="tb-title">Refresh Manager</span>
        </div>
        <div className="win-controls">
          <button title="Minimize">
            <svg className="gl" viewBox="0 0 10 10">
              <line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" strokeWidth="1" />
            </svg>
          </button>
          <button title="Maximize">
            <svg className="gl" viewBox="0 0 10 10">
              <rect
                x="1.2"
                y="1.2"
                width="7.6"
                height="7.6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
              />
            </svg>
          </button>
          <button className="close" title="Close" onClick={onClose}>
            <svg className="gl" viewBox="0 0 10 10">
              <line x1="1.5" y1="1.5" x2="8.5" y2="8.5" stroke="currentColor" strokeWidth="1" />
              <line x1="8.5" y1="1.5" x2="1.5" y2="8.5" stroke="currentColor" strokeWidth="1" />
            </svg>
          </button>
        </div>
      </div>
      {children}
    </div>
  )
}

export function AppHeader({ role, session, onLogout }) {
  const userLabel = session?.name
    ? `${session.name} · ${role === 'staff' ? 'Reception' : 'Admin'}`
    : role === 'staff'
      ? 'Staff'
      : 'Owner · Admin'
  return (
    <div className="hdr">
      <div className="hdr-brand">
        <div className="hdr-logo">
          <WaveMark size={24} />
        </div>
        <span className="hdr-name">Refresh Manager</span>
      </div>
      <div className="hdr-right">
        <div className="hdr-user">
          <Icon name={role === 'staff' ? 'user' : 'shield'} size={15} color="#bcd4ee" />
          <span>{userLabel}</span>
        </div>
        <button className="ghost-btn" onClick={onLogout}>
          <Icon name="log-out" size={14} /> Log out
        </button>
      </div>
    </div>
  )
}

export function SectionHead({ title, date, children }) {
  return (
    <div className="between" style={{ marginBottom: 18 }}>
      <div>
        <div className="h1">{title}</div>
        {date && (
          <div className="sub" style={{ marginTop: 3 }}>
            {date}
          </div>
        )}
      </div>
      <div className="row" style={{ gap: 10, alignItems: 'center' }}>
        {children}
      </div>
    </div>
  )
}
