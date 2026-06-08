import { useState, useEffect } from 'react'
import { api } from '../lib/api'
import { fmt, todayLocal, formatDateDisplay } from '../lib/format'
import { Icon } from '../components/ui'

export function EndOfDay() {
  const [summary, setSummary] = useState(null)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const today = todayLocal()

  useEffect(() => { api.todaySummary().then(setSummary) }, [])

  const handleSend = async () => {
    setError('')
    const result = await api.sendEod({ date: today })
    if (result?.success === false) { setError(result.error || 'Failed to send report'); return }
    setSent(true)
  }

  const rows = summary ? [
    { label: 'Cash', value: fmt(summary.cash) },
    { label: 'QR (eSewa / Khalti)', value: fmt(summary.qr) },
    { label: 'Memberships sold', value: fmt(summary.byType?.membership || 0) },
    { label: 'Day packages', value: fmt(summary.byType?.day_package || 0) },
    { label: 'Day passes', value: fmt(summary.byType?.day_pass || 0) }
  ] : []

  return (
    <div className="content fade-in" style={{ display: 'grid', placeItems: 'start center', paddingTop: 24 }}>
      <div className="card scale-in" style={{ width: 420, padding: 24 }}>
        <div style={{ textAlign: 'center', paddingBottom: 18 }}>
          <div className="m-label" style={{ fontSize: 12 }}>Total revenue today</div>
          <div style={{ fontSize: 34, fontWeight: 500, margin: '4px 0 4px' }}>{fmt(summary?.total)}</div>
          <div className="sub">{summary?.count || 0} transactions · {formatDateDisplay(today)}</div>
        </div>
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 6 }}>
          {rows.map((r) => (
            <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', fontSize: 13, borderBottom: '1px solid #f1f5f9' }}>
              <span style={{ color: '#64748b' }}>{r.label}</span><span>{r.value}</span>
            </div>
          ))}
        </div>
        {error && <div className="alert red" style={{ marginTop: 12 }}><Icon name="alert-triangle" size={17} /><div className="a-desc">{error}</div></div>}
        <button className={'btn btn-block ' + (sent ? 'btn-ghost' : 'btn-teal')} style={{ marginTop: 18, ...(sent ? { color: '#0F6E56', borderColor: '#bbe3d6', background: '#eafaf4' } : {}) }} onClick={handleSend} disabled={sent}>
          <Icon name={sent ? 'check-check' : 'message-circle'} size={17} />
          {sent ? 'Report sent to owner' : 'Send to owner via WhatsApp'}
        </button>
      </div>
    </div>
  )
}
