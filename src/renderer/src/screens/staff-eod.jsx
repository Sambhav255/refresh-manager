import { useState, useEffect } from 'react'
import { api } from '../lib/api'
import { fmt, todayLocal, formatDateDisplay } from '../lib/format'
import { Icon } from '../components/ui'
import { orderedTypes, typeLabel } from '../../../shared/transaction-types'

export function EndOfDay({ session }) {
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [step, setStep] = useState('summary')
  const [physicalCash, setPhysicalCash] = useState('')
  const [reason, setReason] = useState('')
  const [reconciled, setReconciled] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const today = todayLocal()

  useEffect(() => {
    api.todaySummary().then((s) => {
      setSummary(s)
      setLoading(false)
    })
    api.getTodayReconciliation().then((r) => {
      if (r.reconciliation) setReconciled(true)
    })
  }, [])

  const systemCash = summary?.cash || 0
  const physical = Number(physicalCash) || 0
  const discrepancy = physical - systemCash
  const balanced = Math.abs(discrepancy) < 0.01

  const saveReconciliation = async () => {
    setError('')
    if (!physicalCash) {
      setError('Enter physical cash count')
      return
    }
    if (!balanced && !reason.trim()) {
      setError('Please note the reason for the discrepancy')
      return
    }
    const r = await api.createReconciliation({
      systemCash,
      physicalCash: physical,
      reason: balanced ? null : reason,
      staffId: session?.userId
    })
    if (r?.success === false) {
      setError(r.error || 'Failed to save reconciliation')
      return
    }
    setReconciled(true)
    setStep('send')
  }

  const handleSend = async () => {
    setError('')
    const result = await api.sendEod({ date: today })
    if (result?.success === false) {
      setError(result.error || 'Failed to send report')
      return
    }
    setSent(true)
  }

  // Built from the types actually present, so the itemised lines always
  // reconcile to the headline total. The old hardcoded three-line list silently
  // dropped restaurant, pool-item, booking-deposit and refund revenue.
  const rows = summary
    ? [
        { label: 'Cash', value: fmt(summary.cash) },
        { label: 'QR (eSewa / Khalti)', value: fmt(summary.qr) },
        ...orderedTypes(summary.byType).map((t) => ({
          label: typeLabel(t),
          value: fmt(summary.byType[t] || 0)
        }))
      ]
    : []

  if (loading)
    return (
      <div className="content fade-in" style={{ display: 'grid', placeItems: 'center' }}>
        <div className="sub">Loading end of day summary…</div>
      </div>
    )

  return (
    <div
      className="content fade-in"
      style={{ display: 'grid', placeItems: 'start center', paddingTop: 24 }}
    >
      <div className="card scale-in" style={{ width: 420, padding: 24 }}>
        <div style={{ textAlign: 'center', paddingBottom: 18 }}>
          <div className="m-label" style={{ fontSize: 12 }}>
            Total revenue today
          </div>
          <div style={{ fontSize: 34, fontWeight: 500, margin: '4px 0 4px' }}>
            {fmt(summary?.total)}
          </div>
          <div className="sub">
            {summary?.count || 0} transactions · {formatDateDisplay(today)}
          </div>
        </div>
        {step === 'summary' && (
          <>
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 6 }}>
              {rows.map((r) => (
                <div
                  key={r.label}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '10px 0',
                    fontSize: 13,
                    borderBottom: '1px solid #f1f5f9'
                  }}
                >
                  <span style={{ color: '#64748b' }}>{r.label}</span>
                  <span>{r.value}</span>
                </div>
              ))}
            </div>
            <button
              className="btn btn-primary btn-block"
              style={{ marginTop: 18 }}
              onClick={() => setStep('reconcile')}
            >
              Cash reconciliation
            </button>
          </>
        )}
        {step === 'reconcile' && !reconciled && (
          <div className="fade-in">
            <div className="alert" style={{ marginBottom: 12, background: '#f8fafc' }}>
              <div className="a-desc">
                System cash total: <strong>{fmt(systemCash)}</strong>
              </div>
            </div>
            <div className="field">
              <label>Physical cash count (Rs.)</label>
              <input
                className="input"
                type="number"
                value={physicalCash}
                onChange={(e) => setPhysicalCash(e.target.value)}
                placeholder="Count cash in drawer"
              />
            </div>
            {physicalCash && balanced && (
              <div className="alert green" style={{ marginBottom: 10 }}>
                <Icon name="check" size={17} />
                <div className="a-desc">Cash balanced ✓</div>
              </div>
            )}
            {physicalCash && !balanced && (
              <>
                <div className="alert amber" style={{ marginBottom: 10 }}>
                  <Icon name="alert-triangle" size={17} />
                  <div className="a-desc">
                    Discrepancy of {fmt(Math.abs(discrepancy))} (
                    {discrepancy > 0 ? 'over' : 'short'})
                  </div>
                </div>
                <div className="field">
                  <label>Reason</label>
                  <input
                    className="input"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Short/over, refund, error…"
                  />
                </div>
              </>
            )}
            {error && (
              <div className="alert red" style={{ marginBottom: 10 }}>
                <div className="a-desc">{error}</div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn btn-ghost" onClick={() => setStep('summary')}>
                Back
              </button>
              <button className="btn btn-primary btn-block" onClick={saveReconciliation}>
                Save & continue
              </button>
            </div>
          </div>
        )}
        {(step === 'send' || reconciled) && step !== 'summary' && (
          <div className="fade-in">
            {reconciled && (
              <div className="alert green" style={{ marginBottom: 12 }}>
                <Icon name="check" size={17} />
                <div className="a-desc">Cash reconciliation saved</div>
              </div>
            )}
            {error && (
              <div className="alert red" style={{ marginTop: 12 }}>
                <Icon name="alert-triangle" size={17} />
                <div className="a-desc">{error}</div>
              </div>
            )}
            <button
              className={'btn btn-block ' + (sent ? 'btn-ghost' : 'btn-teal')}
              style={{
                marginTop: 8,
                ...(sent ? { color: '#0F6E56', borderColor: '#bbe3d6', background: '#eafaf4' } : {})
              }}
              onClick={handleSend}
              disabled={sent}
            >
              <Icon name={sent ? 'check-check' : 'message-circle'} size={17} />
              {sent ? 'Report sent to owner' : 'Send to owner via WhatsApp'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
