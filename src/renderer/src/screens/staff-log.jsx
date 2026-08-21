import { useState, useEffect } from 'react'
import { api } from '../lib/api'
import { fmt, todayLocal, formatDateDisplay } from '../lib/format'
import { PayBadge, SectionHead, ConfirmDestructive } from '../components/ui'

// C-4: same reason categories Task 6 (C-8) put on the owner Transactions
// screen's Void/Refund dialogs — not re-exported from there (it doesn't
// export this list), so duplicated here rather than reaching into another
// screen's module. Keep in sync if either list changes.
const REASONS = [
  'Wrong amount',
  'Wrong item',
  'Wrong payment method',
  'Duplicate',
  'Customer cancelled',
  'Other'
]

// Minutes between a transaction's created_at ("YYYY-MM-DD HH:MM:SS", local)
// and `now` (a Date). The space→T swap mirrors formatTime's own parsing in
// src/main/ipc/utils.js, so the renderer reads the same timestamp the same
// way the main process does.
function minutesSince(createdAt, now) {
  if (!createdAt) return Infinity
  const then = new Date(createdAt.replace(' ', 'T')).getTime()
  if (Number.isNaN(then)) return Infinity
  return (now.getTime() - then) / 60000
}

export function TodaysLog() {
  const [tx, setTx] = useState([])
  const [voidWindowMinutes, setVoidWindowMinutes] = useState(15)
  const [voidTx, setVoidTx] = useState(null)
  const [error, setError] = useState('')
  // Ticks every 30s so a row's void affordance disappears on its own once it
  // ages out of the window, instead of staying visible-but-wrong until the
  // next reload — a disabled/vanished control with no live reason would be
  // exactly the silent-failure mode P6 rules out.
  const [now, setNow] = useState(() => new Date())
  const today = todayLocal()

  const load = () => {
    // includeVoided: true — a sale a staff member just voided from this same
    // screen should still show here, struck through, not vanish as if it had
    // never happened.
    api
      .listTransactions({ dateFrom: today, dateTo: today, includeVoided: true })
      .then((r) => setTx(r.transactions || []))
  }

  useEffect(() => {
    load()
    api.getSettings().then((r) => {
      const n = parseInt(r.settings?.staff_void_window_minutes, 10)
      setVoidWindowMinutes(Number.isFinite(n) && n > 0 ? n : 15)
    })
  }, [today])

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(id)
  }, [])

  const total = tx.reduce((s, t) => s + t.amount, 0)

  // A row qualifies for a void action when: not already voided, not a refund
  // (refunds/negative amounts are corrections, never voidable — mirrors the
  // owner screen's own filter), and still inside the configured window. The
  // backend re-checks all of this (and more — see transactions:void) so this
  // is purely about not showing a control that would just fail; it is not
  // the source of truth.
  const canVoid = (t) =>
    !t.isVoided &&
    t.type !== 'refund' &&
    t.amount >= 0 &&
    minutesSince(t.createdAt, now) <= voidWindowMinutes

  const openVoid = (t) => {
    setVoidTx(t)
    setError('')
  }
  const closeVoid = () => {
    setVoidTx(null)
    setError('')
  }

  const handleVoidConfirm = async (reasonPicked, otherText) => {
    if (!voidTx) return
    setError('')
    const res = await api.voidTransaction({
      transactionId: voidTx.id,
      reason: otherText || reasonPicked
    })
    // Owner/admin already reconciled the day this sale is on — a staff void
    // can't resolve that itself (transactions:void only accepts
    // confirmReconciled from a caller prepared to see the amber warning and
    // click through it, which this dialog doesn't offer). Surface it as a
    // plain failure and point at who can actually clear it.
    if (res?.requiresConfirmation) {
      setError('This day was already reconciled by an owner/admin — ask them to void it.')
      return
    }
    if (res?.success === false) {
      setError(res.error || 'Void failed')
      return
    }
    setVoidTx(null)
    load()
  }

  // Matches the owner Transactions screen's own hover tooltip (Task 6, Part
  // E) — reason and who voided it, on the struck-through row.
  const voidTitle = (t) => {
    const parts = []
    if (t.voidReason) parts.push(`Reason: ${t.voidReason}`)
    if (t.voidBy) parts.push(`Voided by: ${t.voidBy}`)
    return parts.length ? parts.join(' · ') : undefined
  }

  return (
    <div className="content fade-in" style={{ maxWidth: 860, margin: '0 auto' }}>
      <SectionHead title="Today's Log" date={formatDateDisplay(today)} />
      <table className="tbl">
        <thead>
          <tr>
            <th style={{ width: 90 }}>Time</th>
            <th>Customer &amp; Product</th>
            <th className="num" style={{ width: 110 }}>
              Amount
            </th>
            <th style={{ width: 90 }}>Payment</th>
            <th style={{ width: 90 }}></th>
          </tr>
        </thead>
        <tbody>
          {tx.map((t) => (
            <tr
              key={t.id}
              style={t.isVoided ? { opacity: 0.55, textDecoration: 'line-through' } : undefined}
            >
              <td style={{ color: 'var(--text-secondary)' }}>{t.time}</td>
              <td>
                <span style={{ color: 'var(--ink)' }}>{t.product}</span>{' '}
                <span style={{ color: 'var(--text-secondary)' }}>· {t.customer}</span>
              </td>
              <td className="num">{fmt(t.amount)}</td>
              <td>
                <PayBadge pay={t.pay} />
              </td>
              <td>
                {t.isVoided ? (
                  <span style={{ color: '#ef4444', fontSize: 11 }} title={voidTitle(t)}>
                    voided
                  </span>
                ) : (
                  // Out-of-window/ineligible rows show NO affordance at all —
                  // not a disabled button with no explanation. A disabled
                  // control with an invisible reason is the single-button
                  // version of the empty-state failure P6 already rules out.
                  canVoid(t) && (
                    <button
                      className="btn btn-ghost"
                      style={{ padding: '4px 10px', fontSize: 12 }}
                      onClick={() => openVoid(t)}
                    >
                      Void
                    </button>
                  )
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="tbl-foot">
        <span>{tx.length} transactions · today</span>
        <span className="total">Total: {fmt(total)}</span>
      </div>
      {voidTx && (
        <ConfirmDestructive
          open
          title={`Void ${voidTx.displayId || `#${voidTx.id}`}`}
          summary={
            <div>
              <div>
                {voidTx.customer} · {voidTx.product} · {fmt(voidTx.amount)} · {voidTx.pay}
              </div>
              {error && (
                <div className="alert red" style={{ marginTop: 10 }}>
                  <div className="a-desc">{error}</div>
                </div>
              )}
            </div>
          }
          reasons={REASONS}
          confirmLabel="Confirm void"
          onConfirm={handleVoidConfirm}
          onCancel={closeVoid}
        />
      )}
    </div>
  )
}
