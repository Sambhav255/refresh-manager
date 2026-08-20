import { useState, useEffect } from 'react'
import { api } from '../lib/api'
import { fmt, todayLocal } from '../lib/format'
import { Icon } from '../components/ui'

// Tile ids, which double as the screen keys App.jsx routes on. Exported so a
// caller can name a tile structurally instead of by its caption: captions get
// reworded, and a station that trimmed the grid by caption stopped trimming
// anything the moment one changed, with nothing to notice it had.
export const STAFF_TILES = Object.freeze({
  NEW: 'new',
  MEMBERS: 'members',
  LOG: 'log',
  EOD: 'eod',
  INVENTORY: 'inv',
  BOOKINGS: 'bookings',
  RESTAURANT: 'restaurant',
  SELL_ITEM: 'sellitem'
})

// `hiddenTiles` is a list of STAFF_TILES ids the caller's station does not need.
export function StaffHome({ go, hiddenTiles = [] }) {
  const [summary, setSummary] = useState(null)
  const [lowCount, setLowCount] = useState(0)
  const [bookingCount, setBookingCount] = useState(0)
  const [txCount, setTxCount] = useState(0)

  useEffect(() => {
    api.todaySummary().then((s) => setSummary(s))
    api.poolLowStock().then((r) => setLowCount(r.items?.length || 0))
    api.upcomingBookings({ days: 14 }).then((r) => setBookingCount(r.bookings?.length || 0))
    api
      .listTransactions({ dateFrom: todayLocal(), dateTo: todayLocal() })
      .then((r) => setTxCount(r.transactions?.length || 0))
  }, [])

  const metrics = [
    { label: 'Revenue today', value: fmt(summary?.total) },
    { label: 'Cash', value: fmt(summary?.cash) },
    { label: 'QR', value: fmt(summary?.qr) }
  ]

  const allTiles = [
    {
      k: STAFF_TILES.NEW,
      icon: 'plus-circle',
      c: '#185FA5',
      bg: '#E6F1FB',
      t: 'New Transaction',
      s: 'Day pass · Package · Membership',
      accent: 'accent-blue'
    },
    {
      k: STAFF_TILES.MEMBERS,
      icon: 'user-search',
      c: '#0F6E56',
      bg: '#dcfce7',
      t: 'Search Member',
      s: 'Check status and expiry'
    },
    {
      k: STAFF_TILES.LOG,
      icon: 'list',
      c: '#64748b',
      bg: '#f1f5f9',
      t: "Today's Log",
      s: `${txCount} transaction${txCount !== 1 ? 's' : ''} so far`
    },
    {
      k: STAFF_TILES.EOD,
      icon: 'send',
      c: '#0F6E56',
      bg: '#d6f0e7',
      t: 'End of Day',
      s: 'Send WhatsApp report',
      accent: 'accent-teal'
    },
    {
      k: STAFF_TILES.INVENTORY,
      icon: 'package',
      c: '#b45309',
      bg: '#fef3c7',
      t: 'Inventory',
      s: lowCount ? `${lowCount} item${lowCount !== 1 ? 's' : ''} low stock` : 'Stock levels',
      warn: lowCount > 0
    },
    {
      k: STAFF_TILES.BOOKINGS,
      icon: 'calendar-days',
      c: '#185FA5',
      bg: '#E6F1FB',
      t: 'Bookings',
      s: `${bookingCount} upcoming in 14 days`
    },
    {
      k: STAFF_TILES.RESTAURANT,
      icon: 'utensils',
      c: '#b45309',
      bg: '#fef3c7',
      t: 'Restaurant POS',
      s: 'Menu orders & checkout'
    },
    {
      k: STAFF_TILES.SELL_ITEM,
      icon: 'shopping-bag',
      c: '#0F6E56',
      bg: '#d6f0e7',
      t: 'Sell Item',
      s: 'Goggles, caps & pool items'
    }
  ]

  // Say something when a station names a tile that no longer exists: silently
  // hiding nothing is precisely the failure this replaced.
  if (import.meta.env?.DEV) {
    const unknown = hiddenTiles.filter((k) => !allTiles.some((t) => t.k === k))
    if (unknown.length) console.error('StaffHome: unknown hidden tile ids', unknown)
  }
  const tiles = allTiles.filter((t) => !hiddenTiles.includes(t.k))

  return (
    <div className="content fade-in">
      <div
        style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, marginBottom: 18 }}
      >
        {metrics.map((m) => (
          <div key={m.label} className="metric">
            <div className="m-label">{m.label}</div>
            <div className="m-value">{m.value}</div>
          </div>
        ))}
      </div>
      <div className="tiles">
        {tiles.map((t) => (
          <div
            key={t.k}
            className={'tile ' + (t.accent || '') + (t.dim ? ' dim' : '')}
            onClick={() => !t.dim && go(t.k)}
          >
            <div className="t-icon" style={{ background: t.bg }}>
              <Icon name={t.icon} size={22} color={t.c} />
            </div>
            <div>
              <div className="t-title">{t.t}</div>
              <div className={'t-sub' + (t.warn ? ' warn' : '')} style={{ marginTop: 3 }}>
                {t.s}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export { NewTransaction } from './staff-transaction'
export { MemberSearch } from './staff-members'
export { TodaysLog } from './staff-log'
export { EndOfDay } from './staff-eod'
export { StaffBookings } from './staff-bookings'
export { StaffRestaurantPos } from './staff-restaurant-pos'
export { SellItem } from './staff-sell-item'
