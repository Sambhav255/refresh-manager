import { useState } from 'react'
import { api } from '../lib/api'
import { todayLocal } from '../lib/format'
import { Icon, SectionHead } from '../components/ui'
import { reports } from '../data/mock'

export function OwnerReports() {
  const [busy, setBusy] = useState('')
  const [customFrom, setCustomFrom] = useState(todayLocal())
  const [customTo, setCustomTo] = useState(todayLocal())

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
        data = await api.customReport({ dateFrom: customFrom, dateTo: customTo })
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
      {busy === 'custom' && (
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
    </div>
  )
}
