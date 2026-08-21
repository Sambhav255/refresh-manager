import { useState } from 'react'
import { fmt, formatShortDate, relativeDays } from '../lib/format'
import {
  AlertTriangle,
  Banknote,
  BarChart3,
  Building2,
  Calendar,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  Camera,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  ClockAlert,
  CreditCard,
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
  Upload,
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
  camera: Camera,
  check: Check,
  'check-check': CheckCheck,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'clock-alert': ClockAlert,
  'credit-card': CreditCard,
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
  upload: Upload,
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
    Membership: 'b-mem',
    // Booking status + membership pause + inventory-level variants. Colours
    // reuse the existing green/amber/red/neutral classes per the project's
    // colour rule (green = resolved/positive only, amber = needs attention,
    // red = negative/terminal, neutral slate = informational/inactive) — see
    // task-2-report.md for the full mapping rationale.
    Confirmed: 'b-active',
    Completed: 'b-active',
    'In stock': 'b-active',
    Low: 'b-exp',
    'Out of stock': 'b-dead',
    Cancelled: 'b-neutral',
    Pending: 'b-neutral',
    Paused: 'b-neutral'
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
          <button title="Minimize" onClick={() => window.api?.minimizeWindow?.()}>
            <svg className="gl" viewBox="0 0 10 10">
              <line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" strokeWidth="1" />
            </svg>
          </button>
          <button title="Maximize" onClick={() => window.api?.toggleMaximizeWindow?.()}>
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

// Rs. amount with tabular-aligned digits, everywhere currency appears
// (spec P-4). `fmt` (lib/format.js) stays the plain-string formatter for
// inline sentence text ("8 in stock · reorder at 5") — this wraps it for
// contexts (table cells, summary lines) that want alignment + negative-value
// styling for free.
export function Money({ value, negative }) {
  const n = Number(value || 0)
  const isNeg = negative ?? n < 0
  return (
    <span
      style={{
        fontVariantNumeric: 'tabular-nums',
        color: isNeg ? 'var(--color-danger)' : undefined
      }}
    >
      {isNeg ? '-' : ''}
      {fmt(Math.abs(n))}
    </span>
  )
}

// Absolute date plus a glanceable relative distance, e.g.
// "22 Aug 2026 · in 1 day" (spec H-23/P-18).
export function RelativeDate({ date }) {
  if (!date) return null
  return (
    <span>
      {formatShortDate(date)}{' '}
      <span style={{ color: 'var(--text-secondary)' }}>· {relativeDays(date)}</span>
    </span>
  )
}

// Consistent empty state for search-before-typing, filtered tables with no
// matches, and empty calendars (spec P-6). `action` takes caller-supplied
// button/link markup (not a {label, onClick} pair) so this component never
// needs to know about routing.
export function EmptyState({ title, body, action }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text-secondary)' }}>
      <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)', marginBottom: 6 }}>
        {title}
      </div>
      {body && <div style={{ fontSize: 13 }}>{body}</div>}
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  )
}

// Shared confirmation dialog for Void/Refund/Delete booking/Pause (spec
// P-5/C-8): always shows the caller-supplied summary (customer/amount/
// context), always requires a reason before it can be confirmed. Built on a
// minimal .modal-backdrop/.modal pair (app.css) rather than an existing
// overlay convention — none exists elsewhere in this codebase; forms here
// are inline cards appended to the page (e.g. owner-inventory.jsx's "Add
// item" panel), not fixed-position dialogs. .modal matches .card's
// border-radius/border-colour/shadow language.
//
// This task does not wire ConfirmDestructive into any screen — that's later
// Phase 2/4 work that also owns the row-menu refactor (C-8) on those screens.
export function ConfirmDestructive({
  open,
  title,
  summary,
  reasons = [],
  confirmLabel = 'Confirm',
  danger = true,
  // Forward-compatibility slot for the not-yet-built partial-refund
  // line-item picker (§12 open question #5): when a later task passes a
  // non-empty `lineItems` array, item checkboxes render here. Intentionally
  // unimplemented in this task — no UI reads this prop yet.
  lineItems,
  onConfirm,
  onCancel
}) {
  const [reason, setReason] = useState('')
  const [reasonText, setReasonText] = useState('')

  if (!open) return null

  const isOther = reason === 'Other'
  const canConfirm = reason && (!isOther || reasonText.trim().length > 0)

  const reset = () => {
    setReason('')
    setReasonText('')
  }

  const handleCancel = () => {
    reset()
    onCancel?.()
  }

  const handleConfirm = () => {
    if (!canConfirm) return
    onConfirm?.(reason, isOther ? reasonText.trim() : undefined)
    reset()
  }

  return (
    <div className="modal-backdrop" onClick={handleCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 12 }}>{title}</div>
        {summary && (
          <div
            style={{
              fontSize: 13,
              color: 'var(--text-secondary)',
              background: 'var(--bg)',
              borderRadius: 8,
              padding: '10px 12px',
              marginBottom: 14
            }}
          >
            {summary}
          </div>
        )}
        {/* lineItems checkbox UI renders here once a caller passes a
            non-empty lineItems array — not implemented in this task. */}
        {Array.isArray(lineItems) && lineItems.length > 0 && null}
        <div className="field">
          <label>Reason</label>
          <select className="select" value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">Select a reason…</option>
            {reasons.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        {isOther && (
          <div className="field">
            <label>Details</label>
            <input
              className="input"
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value)}
              placeholder="Say more…"
              autoFocus
            />
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button className="btn btn-ghost" onClick={handleCancel}>
            Cancel
          </button>
          <button
            className="btn"
            style={{
              background: danger ? 'var(--color-danger)' : 'var(--blue)',
              color: '#fff',
              opacity: canConfirm ? 1 : 0.5,
              cursor: canConfirm ? 'pointer' : 'not-allowed'
            }}
            disabled={!canConfirm}
            onClick={handleConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
