import { useState, useEffect, useCallback } from 'react'
import { api } from '../lib/api'
import { fmt, todayLocal, formatDateDisplay } from '../lib/format'
import { Icon, PayBadge, SectionHead } from '../components/ui'

function formatChange(percent) {
  if (percent == null) return 'new vs prior'
  if (percent === 0) return 'same as prior'
  const sign = percent > 0 ? '+' : ''
  return `${sign}${percent}% vs prior`
}

export function OwnerDashboard({ go }) {
  const [selectedDate, setSelectedDate] = useState(todayLocal())
  const [summary, setSummary] = useState(null)
  const [tx, setTx] = useState([])
  const [bookings, setBookings] = useState([])
  const [bookingsTotal, setBookingsTotal] = useState(0)
  const [lowStock, setLowStock] = useState([])
  const [expiring, setExpiring] = useState([])
  const [reminders, setReminders] = useState([])
  const [backupStatus, setBackupStatus] = useState(null)
  const [backupStale, setBackupStale] = useState(false)
  const [needsRecoveryCode, setNeedsRecoveryCode] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const isToday = selectedDate === todayLocal()

  const loadData = useCallback(() => {
    return Promise.all([
      api.getDashboardSummary({ date: selectedDate }),
      api.listTransactions({ dateFrom: selectedDate, dateTo: selectedDate }),
      api.upcomingBookings({ days: 14 }),
      api.poolLowStock(),
      api.expiringSoon({}),
      api.getExpiringReminders({}),
      api.getBackupStatus(),
      api.hasRecoveryCode()
    ]).then(([s, t, b, l, e, rem, bk, rc]) => {
      setSummary(s)
      setTx((t.transactions || []).slice(0, 5))
      const upcoming = b.bookings || []
      setBookings(upcoming.slice(0, 3))
      setBookingsTotal(upcoming.length)
      setLowStock(l.items || [])
      setExpiring(e.members || [])
      setReminders(rem.members || [])
      setBackupStatus(bk)
      const lastBk = bk?.lastBackupAt
      setBackupStale(
        !lastBk || Date.now() - Date.parse(String(lastBk).replace(' ', 'T')) > 36 * 3600 * 1000
      )
      setNeedsRecoveryCode(rc?.exists === false)
      setLoading(false)
    })
  }, [selectedDate])

  useEffect(() => {
    setLoading(true)
    loadData()
  }, [loadData])

  const refresh = async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      await loadData()
    } finally {
      setRefreshing(false)
    }
  }

  const kpis = [
    {
      label: isToday ? 'Paid today' : 'Paid',
      value: fmt(summary?.todayPaid),
      sub: `Cash ${fmt(summary?.todayPaidCash)} · QR ${fmt(summary?.todayPaidQr)}`,
      tone: 'pos'
    },
    {
      label: isToday ? 'Unpaid today' : 'Unpaid',
      value: fmt(summary?.todayUnpaid),
      sub: 'part-paid sales',
      tone: summary?.todayUnpaid > 0 ? 'warn' : 'muted'
    },
    {
      label: 'Dues',
      value: fmt(summary?.dues),
      sub: `Sales ${fmt(summary?.salesOutstanding)} · Bookings ${fmt(summary?.bookingBalanceDue)}`,
      tone: summary?.dues > 0 ? 'warn' : 'muted'
    },
    {
      label: isToday ? 'Discounts today' : 'Discounts',
      value: fmt(summary?.discountsToday),
      sub: 'line discounts',
      tone: 'muted'
    },
    {
      label: 'Week vs last week',
      value: fmt(summary?.week?.total),
      sub: formatChange(summary?.week?.changePercent),
      tone: 'muted'
    },
    {
      label: 'Month vs last month',
      value: fmt(summary?.month?.total),
      sub: formatChange(summary?.month?.changePercent),
      tone: 'muted'
    },
    {
      label: 'Stock value',
      value: fmt(summary?.stock?.total),
      sub: `Pool ${fmt(summary?.stock?.pool)} · Kitchen ${fmt(summary?.stock?.kitchen)}`,
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
      goTo: 'members',
      filter: 'Needs renewal'
    })
  else if (expiring.length)
    alerts.push({
      c: 'amber',
      icon: 'calendar-clock',
      t: expiring.length + ' memberships expiring',
      d: 'Within your renewal warning window',
      goTo: 'members',
      filter: 'Needs renewal'
    })
  if (backupStatus?.lastExcelStatus === 'failed')
    alerts.push({
      c: 'red',
      icon: 'sheet',
      t: 'Daily Excel export failed',
      d: 'Check backup folder permissions and settings',
      goTo: 'settings'
    })
  else if (backupStatus?.excelStale)
    alerts.push({
      c: 'red',
      icon: 'sheet',
      t: 'Daily Excel export is stale',
      d: backupStatus?.lastExcelAt
        ? 'Last success: ' + backupStatus.lastExcelAt
        : 'No successful export yet — check backup settings',
      goTo: 'settings'
    })
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
  if (needsRecoveryCode)
    alerts.push({
      c: 'amber',
      icon: 'shield',
      t: 'No recovery code set',
      d: 'Set one up so a forgotten admin password never locks you out',
      goTo: 'settings'
    })
  if (summary?.bookingDepositsOutstanding?.count > 0)
    alerts.push({
      c: 'amber',
      icon: 'calendar-days',
      t: summary.bookingDepositsOutstanding.count + ' bookings with deposits due',
      d: fmt(summary.bookingDepositsOutstanding.sum) + ' outstanding',
      goTo: 'bookings'
    })
  if (bookingsTotal)
    alerts.push({
      c: 'green',
      icon: 'calendar-days',
      t: bookingsTotal + ' upcoming bookings',
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
      <SectionHead title="Dashboard" date={formatDateDisplay(selectedDate)}>
        <input
          type="date"
          className="input"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          style={{ padding: '6px 10px', fontSize: 12 }}
        />
        <button
          className="btn btn-ghost"
          style={{ padding: '6px 10px', fontSize: 12 }}
          disabled={refreshing}
          onClick={refresh}
        >
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </SectionHead>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
          gap: 14,
          marginBottom: 18
        }}
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
            <div className="sub">
              {isToday
                ? 'No transactions recorded yet today.'
                : 'No transactions recorded for this date.'}
            </div>
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
                    <td style={{ color: 'var(--text-secondary)' }}>{t.displayId || t.id}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{t.time}</td>
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
              <div
                key={a.t}
                className={'alert ' + a.c}
                style={a.goTo && go ? { cursor: 'pointer' } : undefined}
                onClick={a.goTo && go ? () => go(a.goTo, a.filter) : undefined}
              >
                <Icon name={a.icon} size={17} />
                <div style={{ flex: 1 }}>
                  <div className="a-title">{a.t}</div>
                  <div className="a-desc">{a.d}</div>
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
