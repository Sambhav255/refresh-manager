import { useState, useEffect } from 'react'
import { api } from '../lib/api'
import { fmt, todayLocal } from '../lib/format'
import { Icon, SectionHead } from '../components/ui'
import { reports } from '../data/mock'

const ADVANCED = [
  { key: 'retention', icon: 'user-check', title: 'Member retention', desc: 'Renewals vs churn this month' },
  { key: 'inventory-turnover', icon: 'package', title: 'Inventory turnover', desc: 'Items sold, revenue, low stock' },
  { key: 'bookings', icon: 'calendar-days', title: 'Booking report', desc: 'Bookings by status and deposits' },
  { key: 'staff-activity', icon: 'users', title: 'Staff activity', desc: 'Transactions logged per staff member' }
]


export function OwnerReports() {
  const [busy, setBusy] = useState('')
  const [loadingRecon, setLoadingRecon] = useState(true)
  const [reconciliations, setReconciliations] = useState([])
  const [staffList, setStaffList] = useState([])
  const [customFrom, setCustomFrom] = useState(todayLocal())
  const [customTo, setCustomTo] = useState(todayLocal())
  const [customStaffId, setCustomStaffId] = useState('')

  useEffect(() => {
    api.listReconciliations({}).then((r) => {
      setReconciliations(r.reconciliations || [])
      setLoadingRecon(false)
    })
    api.listStaff().then((r) => setStaffList(r.users || []))
  }, [])

  const exportReport = async (key) => {
    setBusy(key)
    try {
      let data = {}
      let reportType = key
      if (key === 'daily') {
        data = await api.dailyReport({ date: todayLocal() })
      } else if (key === 'monthly') {
        data = await api.monthlyReport()
      } else if (key === 'custom') {
        const filters = {}
        if (customStaffId) filters.staffId = Number(customStaffId)
        data = await api.customReport({ dateFrom: customFrom, dateTo: customTo, filters })
      } else if (key === 'members') {
        const r = await api.listAllMembers()
        data = { summary: { count: r.members?.length || 0, total: 0 }, members: r.members }
        reportType = 'members'
      } else if (key === 'expiry') {
        const r = await api.expiringSoon({ days: 30 })
        data = { summary: { count: r.members?.length || 0, total: 0 }, members: r.members }
        reportType = 'expiry'
      } else if (key === 'inventory') {
        const r = await api.listPoolInventory()
        data = { summary: { count: r.items?.length || 0, total: 0 }, items: r.items }
        reportType = 'inventory'
      } else if (key === 'retention') {
        data = await api.retentionReport({})
        reportType = 'retention'
      } else if (key === 'inventory-turnover') {
        data = await api.inventoryTurnoverReport({})
        reportType = 'inventory-turnover'
      } else if (key === 'bookings') {
        data = await api.bookingReport({})
        reportType = 'booking'
      } else if (key === 'staff-activity') {
        data = await api.staffActivityReport({ dateFrom: customFrom, dateTo: customTo, staffId: customStaffId ? Number(customStaffId) : undefined })
        reportType = 'staff-activity'
      } else if (key === 'reconciliation') {
        const r = await api.listReconciliations({ dateFrom: customFrom, dateTo: customTo })
        data = { summary: { count: r.reconciliations?.length || 0, total: 0 }, reconciliations: r.reconciliations }
        reportType = 'reconciliation'
      }
      await api.exportExcel({ reportType, data })
    } finally {
      setBusy('')
    }
  }

  const reportKeys = ['daily', 'monthly', 'custom', 'members', 'expiry', 'inventory']

  return (
    <div className="content fade-in">
      <SectionHead title="Reports & exports" date="Generate and download Excel reports" />
      {(busy === 'custom' || busy === 'staff-activity' || busy === 'reconciliation') && (
        <div
          className="card"
          style={{ padding: 14, marginBottom: 14, display: 'flex', gap: 10, alignItems: 'center' }}
        >
          <input
            className="input"
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
          />
          <span>to</span>
          <input
            className="input"
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
          />
          {(busy === 'custom' || busy === 'staff-activity') && (
            <select className="select" value={customStaffId} onChange={(e) => setCustomStaffId(e.target.value)} style={{ width: 160 }}>
              <option value="">All staff</option>
              {staffList.filter((s) => s.is_active).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14 }}>
        {reports.map((r, i) => (
          <div
            key={r.title}
            className="card"
            style={{ padding: '16px 16px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 9,
                  background: '#E6F1FB',
                  display: 'grid',
                  placeItems: 'center'
                }}
              >
                <Icon name={r.icon} size={18} color="#185FA5" />
              </div>
              <div style={{ fontSize: 14, fontWeight: 500 }}>{r.title}</div>
            </div>
            <div className="sub" style={{ color: '#64748b', lineHeight: 1.45, minHeight: 32 }}>
              {r.desc}
            </div>
            <button
              className="btn btn-ghost"
              style={{ alignSelf: 'flex-start', padding: '6px 11px', fontSize: 12 }}
              disabled={!!busy}
              onClick={() => exportReport(reportKeys[i])}
            >
              <Icon name="sheet" size={14} color="#16a34a" />
              {busy === reportKeys[i] ? 'Exporting…' : 'Export to Excel'}
            </button>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 24, marginBottom: 10, fontSize: 14, fontWeight: 500 }}>Advanced reports</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 14, marginBottom: 24 }}>
        {ADVANCED.map((r) => (
          <div key={r.key} className="card" style={{ padding: '16px 16px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: 9, background: '#E6F1FB', display: 'grid', placeItems: 'center' }}>
                <Icon name={r.icon} size={18} color="#185FA5" />
              </div>
              <div style={{ fontSize: 14, fontWeight: 500 }}>{r.title}</div>
            </div>
            <div className="sub" style={{ color: '#64748b', lineHeight: 1.45 }}>{r.desc}</div>
            <button className="btn btn-ghost" style={{ alignSelf: 'flex-start', padding: '6px 11px', fontSize: 12 }} disabled={!!busy} onClick={() => exportReport(r.key)}>
              <Icon name="sheet" size={14} color="#16a34a" />
              {busy === r.key ? 'Exporting…' : 'Export to Excel'}
            </button>
          </div>
        ))}
      </div>

      <div className="between" style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 500 }}>Cash reconciliation history</div>
        <button className="btn btn-ghost" style={{ padding: '6px 11px', fontSize: 12 }} disabled={!!busy} onClick={() => exportReport('reconciliation')}>
          <Icon name="sheet" size={14} color="#16a34a" />
          {busy === 'reconciliation' ? 'Exporting…' : 'Export'}
        </button>
      </div>
      {loadingRecon ? (
        <div className="sub">Loading reconciliation history…</div>
      ) : reconciliations.length === 0 ? (
        <div className="sub">No cash reconciliations recorded yet.</div>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>Date</th>
              <th className="num">System</th>
              <th className="num">Physical</th>
              <th className="num">Discrepancy</th>
              <th>Staff</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {reconciliations.map((r) => (
              <tr key={r.id}>
                <td>{r.reconcile_date}</td>
                <td className="num">{fmt(r.system_cash)}</td>
                <td className="num">{fmt(r.physical_cash)}</td>
                <td className="num" style={{ color: r.discrepancy ? '#b45309' : '#16a34a' }}>{fmt(r.discrepancy)}</td>
                <td>{r.staff_name}</td>
                <td style={{ color: '#64748b' }}>{r.reason || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
