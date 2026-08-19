import { useState, useEffect, useCallback } from 'react'
import { api } from '../lib/api'
import { fmt, todayLocal, formatDateDisplay } from '../lib/format'
import { Icon, PayBadge, SectionHead } from '../components/ui'

export function OwnerDashboard({ go }) {
  const [pool, setPool] = useState(null)
  const [restaurant, setRestaurant] = useState(null)
  const [combined, setCombined] = useState(null)
  const [tx, setTx] = useState([])
  const [bookings, setBookings] = useState([])
  const [lowStock, setLowStock] = useState([])
  const [expiring, setExpiring] = useState([])
  const [reminders, setReminders] = useState([])
  const [backupStatus, setBackupStatus] = useState(null)
  const [backupStale, setBackupStale] = useState(false)
  const [footfall, setFootfall] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [sendingReminders, setSendingReminders] = useState(false)
  const today = todayLocal()

  const loadData = useCallback(() => {
    return Promise.all([
      api.todaySummary({ source: 'pool' }),
      api.todaySummary({ source: 'restaurant' }),
      api.todaySummary(),
      api.listTransactions({ dateFrom: today, dateTo: today }),
      api.upcomingBookings({ days: 14 }),
      api.poolLowStock(),
      // Omit `days` so both handlers fall back to the expiry_warning_days
      // setting, which the Members screen already honours. Hardcoding 5 made
      // the two screens disagree about who is expiring.
      api.expiringSoon({}),
      api.getExpiringReminders({}),
      api.getBackupStatus(),
      api.getTodayCheckins()
    ]).then(([p, r, c, t, b, l, e, rem, bk, ci]) => {
      setPool(p)
      setRestaurant(r)
      setCombined(c)
      setTx((t.transactions || []).slice(0, 5))
      setBookings((b.bookings || []).slice(0, 3))
      setLowStock(l.items || [])
      setExpiring(e.members || [])
      setReminders(rem.members || [])
      setBackupStatus(bk)
      // 6-C: compute staleness once at load (avoids an impure Date.now in render).
      const lastBk = bk?.lastBackupAt
      setBackupStale(
        !lastBk || Date.now() - Date.parse(String(lastBk).replace(' ', 'T')) > 36 * 3600 * 1000
      )
      setFootfall(ci.count || 0)
      setLoading(false)
    })
  }, [today])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Manual refresh — keeps current data on screen (no flash back to the
  // loading placeholder) while fresh numbers are fetched.
  const refresh = async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      await loadData()
    } finally {
      setRefreshing(false)
    }
  }

  // P1-5: guided one-at-a-time flow — open (and mark sent) only the next
  // pending member's WhatsApp chat, never a burst of tabs.
  const sendNextReminder = async () => {
    if (!reminders.length) return
    setSendingReminders(true)
    await api.sendReminder({ membershipId: reminders[0].membershipId })
    const rem = await api.getExpiringReminders({})
    setReminders(rem.members || [])
    setSendingReminders(false)
  }

  const kpis = [
    {
      label: 'Pool revenue',
      value: fmt(pool?.total),
      sub: (pool?.count || 0) + ' transactions',
      tone: 'muted'
    },
    {
      label: 'Restaurant',
      value: fmt(restaurant?.total),
      sub: (restaurant?.count || 0) + ' transactions',
      tone: 'muted'
    },
    {
      label: 'Combined today',
      value: fmt(combined?.total),
      sub: 'Cash ' + fmt(combined?.cash),
      tone: 'pos'
    },
    {
      label: 'QR today',
      value: fmt(combined?.qr),
      sub: (combined?.count || 0) + ' total txns',
      tone: 'muted'
    },
    {
      label: 'Footfall today',
      value: String(footfall),
      sub: 'member check-ins',
      tone: 'muted'
    }
  ]

  const alerts = []
  if (reminders.length)
    alerts.push({
      c: 'amber',
      icon: 'message-circle',
      t: reminders.length + ' members need renewal reminders',
      d: 'Send WhatsApp reminders',
      action: true
    })
  else if (expiring.length)
    alerts.push({
      c: 'amber',
      icon: 'calendar-clock',
      t: expiring.length + ' memberships expiring',
      d: 'Within your renewal warning window',
      goTo: 'members'
    })
  // 6-C: flag a stale backup (no success in >36h) so it's noticed early.
  const lastBk = backupStatus?.lastBackupAt
  if (backupStatus?.status === 'failed')
    alerts.push({
      c: 'red',
      icon: 'folder',
      t: 'Backup failed',
      d: 'Check backup settings',
      goTo: 'settings'
    })
  else if (backupStale)
    alerts.push({
      c: 'red',
      icon: 'folder',
      t: 'Backup is stale',
      d: lastBk ? 'Last success: ' + lastBk : 'No successful backup yet — set one up',
      goTo: 'settings'
    })
  else
    alerts.push({
      c: 'green',
      icon: 'folder',
      t: 'Last backup: ' + lastBk,
      d: backupStatus?.status === 'success' ? '✓ Success' : backupStatus?.status || ''
    })
  if (lowStock.length) {
    const d = lowStock
      .slice(0, 2)
      .map((i) => i.item + (i.variant !== '—' ? ' (' + i.variant + ')' : ''))
      .join(' · ')
    alerts.push({
      c: 'red',
      icon: 'alert-triangle',
      t: lowStock.length + ' items low stock',
      d,
      goTo: 'inventory'
    })
  }
  if (bookings.length)
    alerts.push({
      c: 'green',
      icon: 'calendar-days',
      t: bookings.length + ' upcoming bookings',
      d: 'Next 14 days',
      goTo: 'bookings'
    })

  const total = tx.reduce((s, t) => s + t.amount, 0)

  if (loading) {
    return (
      <div className="content fade-in" style={{ display: 'grid', placeItems: 'center', flex: 1 }}>
        <div className="sub">Loading dashboard…</div>
      </div>
    )
  }

  return (
    <div className="content fade-in">
      <SectionHead title="Dashboard" date={formatDateDisplay(today)}>
        <button
          className="btn btn-ghost"
          style={{ padding: '6px 12px', fontSize: 12 }}
          disabled={refreshing}
          onClick={refresh}
        >
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </SectionHead>
      <div
        style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 18 }}
      >
        {kpis.map((k) => (
          <div key={k.label} className="metric">
            <div className="m-label">{k.label}</div>
            <div className="m-value">{k.value}</div>
            <div className={'m-sub ' + k.tone}>{k.sub}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 290px', gap: 16 }}>
        <div>
          <div className="between" style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 500 }}>Recent transactions</div>
          </div>
          {tx.length === 0 ? (
            <div className="sub">No transactions recorded yet today.</div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 56 }}>ID</th>
                  <th style={{ width: 84 }}>Time</th>
                  <th>Customer</th>
                  <th>Product</th>
                  <th className="num" style={{ width: 92 }}>
                    Amount
                  </th>
                  <th style={{ width: 70 }}>Pay</th>
                  <th style={{ width: 70 }}>Staff</th>
                </tr>
              </thead>
              <tbody>
                {tx.map((t) => (
                  <tr key={t.id}>
                    <td style={{ color: '#94a3b8' }}>{t.displayId || t.id}</td>
                    <td style={{ color: '#94a3b8' }}>{t.time}</td>
                    <td style={{ fontWeight: 500 }}>{t.customer}</td>
                    <td style={{ color: '#64748b', fontSize: 12.5 }}>{t.product}</td>
                    <td className="num">{fmt(t.amount)}</td>
                    <td>
                      <PayBadge pay={t.pay} />
                    </td>
                    <td style={{ color: '#64748b' }}>{t.staff}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="tbl-foot">
            {/* This total covers the rows shown (top 5), not the whole day —
                label it as such so it is not misread as today's takings. */}
            <span>{tx.length} most recent</span>
            <span className="total">Total of shown: {fmt(total)}</span>
          </div>
          {bookings.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 10 }}>
                Upcoming bookings
              </div>
              {bookings.map((b) => (
                <div key={b.id} className="card" style={{ padding: '10px 14px', marginBottom: 8 }}>
                  <div style={{ fontWeight: 500, fontSize: 13 }}>{b.bookingName}</div>
                  <div className="sub">
                    {b.dateDisplay} · {b.timeSlot || '—'} · {b.numPeople || '—'} people
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: -1 }}>Alerts</div>
          {alerts.length ? (
            alerts.map((a) => (
              // Alerts that name a problem elsewhere now navigate to it —
              // "13 items low stock" used to be a dead end.
              <div
                key={a.t}
                className={'alert ' + a.c}
                style={a.goTo && go ? { cursor: 'pointer' } : undefined}
                onClick={a.goTo && go ? () => go(a.goTo) : undefined}
              >
                <Icon name={a.icon} size={17} />
                <div style={{ flex: 1 }}>
                  <div className="a-title">{a.t}</div>
                  <div className="a-desc">{a.d}</div>
                  {a.action && (
                    <button
                      className="btn btn-ghost"
                      style={{ marginTop: 8, padding: '5px 10px', fontSize: 12 }}
                      disabled={sendingReminders}
                      onClick={sendNextReminder}
                    >
                      <Icon name="message-circle" size={14} />
                      {sendingReminders
                        ? 'Opening…'
                        : `Send next reminder (${reminders.length} left)`}
                    </button>
                  )}
                </div>
              </div>
            ))
          ) : (
            <div className="sub">No alerts right now.</div>
          )}
        </div>
      </div>
    </div>
  )
}
