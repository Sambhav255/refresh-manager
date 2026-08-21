import { useState, useEffect } from 'react'
import { api } from '../lib/api'
import { fmt, todayLocal } from '../lib/format'
import { PayBadge, SectionHead, ConfirmDestructive, Icon } from '../components/ui'
import { TYPE_LABELS, TYPE_ORDER } from '../../../shared/transaction-types'

const PAGE_SIZE = 100

// C-8: same reason categories for Void and Refund — the plan's own §12 open
// question already answered "no second list needed" once Refund's reason
// became required too (see task-6-report.md).
const REASONS = [
  'Wrong amount',
  'Wrong item',
  'Wrong payment method',
  'Duplicate',
  'Customer cancelled',
  'Other'
]

// Local-date arithmetic. Using toISOString() here shifted the week start by a
// day whenever the local clock was behind UTC midnight (00:00–05:44 in
// Kathmandu), silently widening the range.
function shiftDays(iso, delta) {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d + delta)
  const p = (n) => String(n).padStart(2, '0')
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`
}

export function OwnerTransactions() {
  const [tx, setTx] = useState([])
  const [staff, setStaff] = useState([])
  const [range, setRange] = useState('today')
  const [typeFilter, setTypeFilter] = useState('')
  const [payFilter, setPayFilter] = useState('')
  const [staffFilter, setStaffFilter] = useState('')
  const [showVoided, setShowVoided] = useState(false)
  const [customFrom, setCustomFrom] = useState(todayLocal())
  const [customTo, setCustomTo] = useState(todayLocal())
  const [page, setPage] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  // C-8 Part A: which row's overflow menu is open, if any.
  const [menuOpenId, setMenuOpenId] = useState(null)
  // `.tbl` clips overflow for its rounded corners, so an absolutely
  // positioned menu anchored inside a table row (position: absolute, top:
  // 100%) gets cut off on rows near the bottom of the table. Fixed
  // positioning computed from the trigger's own bounding rect escapes that
  // clip, at the cost of not tracking scroll — acceptable for a menu that's
  // closed by any outside click/scroll anyway.
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })
  // C-8 Part B: the transaction object (not just an id) a Void confirm is
  // targeting, so ConfirmDestructive's summary can show real context
  // (customer/product/amount/payment) without a second API call.
  const [voidTx, setVoidTx] = useState(null)
  const [voidConfirmDay, setVoidConfirmDay] = useState(null)
  const [refundTx, setRefundTx] = useState(null)
  const [refundAmount, setRefundAmount] = useState('')
  // C-8 Part D: cash vs QR reversal — defaults to the original sale's method
  // (see openRefund) since forcing a pick on every otherwise-fast refund
  // would be friction the punch-list's own P1 (speed beats completeness on
  // staff-facing flows) argues against.
  const [refundMethod, setRefundMethod] = useState('cash')
  const [error, setError] = useState('')

  const load = () => {
    const today = todayLocal()
    let params = { dateFrom: today, dateTo: today }
    if (range === 'week') params = { dateFrom: shiftDays(today, -6), dateTo: today }
    else if (range === 'month') params = { dateFrom: shiftDays(today, -29), dateTo: today }
    else if (range === 'custom') params = { dateFrom: customFrom, dateTo: customTo }
    if (typeFilter) params.type = typeFilter
    if (payFilter) params.paymentMethod = payFilter
    if (staffFilter) params.staffId = Number(staffFilter)
    if (showVoided) params.includeVoided = true
    params.limit = PAGE_SIZE
    params.offset = page * PAGE_SIZE
    api.listTransactions(params).then((r) => {
      setTx(r.transactions || [])
      setTotalCount(r.totalCount ?? (r.transactions || []).length)
    })
  }

  useEffect(() => {
    // Admins too: every refund is owner-gated and attributed to the owner, so
    // a staff-only list left those rows unfilterable.
    Promise.all([api.listStaff(), api.listAdmins()]).then(([s, a]) =>
      setStaff([...(s.users || []), ...(a.users || [])])
    )
    load()
  }, [])
  // Any filter change resets to the first page, otherwise you can land on an
  // offset past the end of a narrower result set and see an empty table.
  useEffect(() => {
    if (page !== 0) setPage(0)
    else load()
  }, [range, typeFilter, payFilter, staffFilter, showVoided, customFrom, customTo])
  useEffect(() => {
    load()
  }, [page])

  // Part A: close the row menu on outside click or Escape. No generic
  // popover-positioning library — two menu items don't need one.
  useEffect(() => {
    if (menuOpenId == null) return
    const onDocClick = (e) => {
      if (!e.target.closest('[data-rowmenu]')) setMenuOpenId(null)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setMenuOpenId(null)
    }
    // The menu is fixed-positioned (computed once, at open time — see
    // menuPos above), so it won't track a scroll; close it instead. Scroll
    // doesn't bubble, so this has to be a capture-phase window listener to
    // catch it regardless of which element scrolled (`.content`, most often).
    const onScroll = () => setMenuOpenId(null)
    document.addEventListener('mousedown', onDocClick)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [menuOpenId])

  const openVoid = (t) => {
    setVoidTx(t)
    setVoidConfirmDay(null)
    setError('')
  }
  const closeVoid = () => {
    setVoidTx(null)
    setVoidConfirmDay(null)
    setError('')
  }

  // reasonPicked is one of REASONS; otherText is only set when reasonPicked
  // === 'Other'. The stored reason is the free-text detail when given
  // (it's the informative part), otherwise the picklist label itself.
  const handleVoidConfirm = async (reasonPicked, otherText) => {
    if (!voidTx) return
    setError('')
    const res = await api.voidTransaction({
      transactionId: voidTx.id,
      reason: otherText || reasonPicked,
      confirmReconciled: !!voidConfirmDay
    })
    // 2-E: voiding a reconciled day needs an explicit second confirm — keep
    // the SAME dialog open (voidTx stays set) with the amber warning and
    // relabelled confirm button.
    if (res?.requiresConfirmation) {
      setVoidConfirmDay(res.reconciledDay)
      return
    }
    if (res?.success === false) {
      setError(res.error || 'Void failed')
      return
    }
    setVoidTx(null)
    setVoidConfirmDay(null)
    load()
  }

  const openRefund = (t) => {
    setRefundTx(t)
    // Default to what is still refundable, not the original amount — on a
    // partly refunded sale the old default always errored.
    setRefundAmount(String(t.remaining ?? t.amount))
    // Default the refund method to how the sale was originally paid — see
    // the refundMethod declaration above for why this isn't an unselected
    // required choice.
    setRefundMethod(t.paymentMethod === 'qr' ? 'qr' : 'cash')
    setError('')
  }
  const closeRefund = () => {
    setRefundTx(null)
    setError('')
  }

  const handleRefundConfirm = async (reasonPicked, otherText) => {
    if (!refundTx) return
    setError('')
    const amt = Number(refundAmount)
    const res = await api.refundTransaction({
      transactionId: refundTx.id,
      amount: amt,
      reason: otherText || reasonPicked,
      paymentMethod: refundMethod
    })
    if (res?.success === false) {
      setError(res.error || 'Refund failed')
      return
    }
    setRefundTx(null)
    load()
  }

  const total = tx.reduce((s, t) => s + t.amount, 0)

  // Part E: hover title for a voided row — reason + who voided it. A native
  // title attribute rather than a custom tooltip component, per the brief;
  // an expand affordance was the other option, but the table already fits
  // this without widening any row, and title needs no extra markup or state.
  const voidTitle = (t) => {
    const parts = []
    if (t.voidReason) parts.push(`Reason: ${t.voidReason}`)
    if (t.voidBy) parts.push(`Voided by: ${t.voidBy}`)
    return parts.length ? parts.join(' · ') : undefined
  }

  return (
    <div className="content fade-in">
      <SectionHead title="Transactions" />
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'center' }}>
        <select
          className="select"
          style={{ width: 130 }}
          value={range}
          onChange={(e) => setRange(e.target.value)}
        >
          <option value="today">Today</option>
          <option value="week">Last 7 days</option>
          <option value="month">Last 30 days</option>
          <option value="custom">Custom range…</option>
        </select>
        {range === 'custom' && (
          <>
            <input
              className="input"
              type="date"
              style={{ width: 150 }}
              value={customFrom}
              max={customTo}
              onChange={(e) => setCustomFrom(e.target.value)}
            />
            <input
              className="input"
              type="date"
              style={{ width: 150 }}
              value={customTo}
              min={customFrom}
              onChange={(e) => setCustomTo(e.target.value)}
            />
          </>
        )}
        <select
          className="select"
          style={{ width: 150 }}
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          <option value="">All types</option>
          {/* Every type the schema allows, from the shared label map — the
              hardcoded three left restaurant, pool-item, deposit and refund
              rows unfilterable. */}
          {TYPE_ORDER.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <select
          className="select"
          style={{ width: 110 }}
          value={payFilter}
          onChange={(e) => setPayFilter(e.target.value)}
        >
          <option value="">All payments</option>
          <option value="cash">Cash</option>
          <option value="qr">QR</option>
        </select>
        <select
          className="select"
          style={{ width: 130 }}
          value={staffFilter}
          onChange={(e) => setStaffFilter(e.target.value)}
        >
          <option value="">All staff</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <label
          className="sub"
          style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
        >
          <input
            type="checkbox"
            checked={showVoided}
            onChange={(e) => setShowVoided(e.target.checked)}
          />
          Show voided
        </label>
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th style={{ width: 56 }}>ID</th>
            <th style={{ width: 84 }}>Time</th>
            <th>Customer</th>
            <th>Product</th>
            <th className="num" style={{ width: 96 }}>
              Amount
            </th>
            <th style={{ width: 76 }}>Payment</th>
            <th style={{ width: 80 }}></th>
          </tr>
        </thead>
        <tbody>
          {tx.length === 0 && (
            <tr>
              <td colSpan={7} style={{ textAlign: 'center', color: '#94a3b8', padding: '18px 0' }}>
                No transactions match these filters.
              </td>
            </tr>
          )}
          {tx.map((t) => (
            <tr
              key={t.id}
              style={t.isVoided ? { opacity: 0.55, textDecoration: 'line-through' } : undefined}
            >
              <td style={{ color: 'var(--text-secondary)' }}>{t.displayId || t.id}</td>
              <td style={{ color: 'var(--text-secondary)' }}>{t.time}</td>
              <td style={{ fontWeight: 500 }}>{t.customer}</td>
              <td style={{ color: '#64748b', fontSize: 12.5 }}>{t.product}</td>
              <td className="num">{fmt(t.amount)}</td>
              <td>
                <PayBadge pay={t.pay} />
              </td>
              <td style={{ position: 'relative' }}>
                {t.isVoided ? (
                  // The row itself is already struck through (style above) —
                  // this label just needs to say why and by whom, on hover.
                  <span style={{ color: '#ef4444', fontSize: 11 }} title={voidTitle(t)}>
                    voided
                  </span>
                ) : t.type === 'refund' || t.amount < 0 ? (
                  <span style={{ color: '#94a3b8', fontSize: 11 }}>refund</span>
                ) : (
                  <div
                    data-rowmenu
                    style={{ position: 'relative', display: 'flex', justifyContent: 'flex-end' }}
                  >
                    <button
                      className="rowmenu"
                      aria-label={`Actions for transaction ${t.displayId || `#${t.id}`}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        const next = menuOpenId === t.id ? null : t.id
                        if (next) {
                          const r = e.currentTarget.getBoundingClientRect()
                          setMenuPos({ top: r.bottom + 4, left: r.right - 128 })
                        }
                        setMenuOpenId(next)
                      }}
                    >
                      <Icon name="more-vertical" size={18} />
                    </button>
                    {menuOpenId === t.id && (
                      <div
                        data-rowmenu
                        className="card"
                        style={{
                          position: 'fixed',
                          top: menuPos.top,
                          left: menuPos.left,
                          zIndex: 1000,
                          padding: 4,
                          minWidth: 128,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 2
                        }}
                      >
                        <button
                          className="btn btn-ghost"
                          style={{ justifyContent: 'flex-start', minHeight: 40, fontSize: 12.5 }}
                          onClick={() => {
                            setMenuOpenId(null)
                            openVoid(t)
                          }}
                        >
                          Void
                        </button>
                        <button
                          className="btn btn-ghost"
                          style={{ justifyContent: 'flex-start', minHeight: 40, fontSize: 12.5 }}
                          onClick={() => {
                            setMenuOpenId(null)
                            openRefund(t)
                          }}
                        >
                          Refund
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="tbl-foot">
        <span>
          {totalCount > tx.length
            ? `${tx.length} of ${totalCount} transactions`
            : `${tx.length} transactions`}
        </span>
        <span className="total">Total: {fmt(total)}</span>
      </div>
      {totalCount > PAGE_SIZE && (
        <div
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            justifyContent: 'flex-end',
            marginTop: 10
          }}
        >
          <button className="btn btn-ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <span className="sub">
            Page {page + 1} of {Math.ceil(totalCount / PAGE_SIZE)}
          </span>
          <button
            className="btn btn-ghost"
            disabled={(page + 1) * PAGE_SIZE >= totalCount}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </div>
      )}
      {voidTx && (
        <ConfirmDestructive
          open
          title={`Void transaction ${voidTx.displayId || `#${voidTx.id}`}`}
          summary={
            <div>
              <div>
                {voidTx.customer} · {voidTx.product} · {fmt(voidTx.amount)} · {voidTx.pay}
              </div>
              {voidConfirmDay && (
                <div className="alert amber" style={{ marginTop: 10 }}>
                  <div className="a-desc">
                    This sale is on {voidConfirmDay}, a day already cash-reconciled. Voiding it will
                    change a day you already closed. Confirm to proceed.
                  </div>
                </div>
              )}
              {error && (
                <div className="alert red" style={{ marginTop: 10 }}>
                  <div className="a-desc">{error}</div>
                </div>
              )}
            </div>
          }
          reasons={REASONS}
          confirmLabel={voidConfirmDay ? 'Void reconciled day anyway' : 'Confirm void'}
          onConfirm={handleVoidConfirm}
          onCancel={closeVoid}
        />
      )}
      {refundTx && (
        <ConfirmDestructive
          open
          title={`Refund ${refundTx.displayId || `#${refundTx.id}`} — ${refundTx.customer} (${fmt(refundTx.amount)})`}
          summary={
            <div>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>Refund amount (Rs.)</label>
                <input
                  className="input"
                  type="number"
                  value={refundAmount}
                  onChange={(e) => setRefundAmount(e.target.value)}
                />
                <div className="sub" style={{ marginTop: 4, fontSize: 11.5 }}>
                  {refundTx.refundedSoFar > 0 &&
                    `${fmt(refundTx.refundedSoFar)} of ${fmt(refundTx.amount)} already refunded — ${fmt(refundTx.remaining)} remaining. `}
                  Full refund restores any linked stock. Partial refunds are money-only.
                </div>
              </div>
              <div style={{ marginBottom: error ? 10 : 0 }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: 12,
                    fontWeight: 500,
                    color: 'var(--text-secondary)',
                    marginBottom: 6
                  }}
                >
                  Refund method
                </label>
                <div className="seg">
                  <button
                    type="button"
                    className={refundMethod === 'cash' ? 'on' : ''}
                    onClick={() => setRefundMethod('cash')}
                  >
                    Cash
                  </button>
                  <button
                    type="button"
                    className={refundMethod === 'qr' ? 'on' : ''}
                    onClick={() => setRefundMethod('qr')}
                  >
                    QR
                  </button>
                </div>
              </div>
              {error && (
                <div className="alert red" style={{ marginTop: 10 }}>
                  <div className="a-desc">{error}</div>
                </div>
              )}
            </div>
          }
          reasons={REASONS}
          confirmLabel="Confirm refund"
          onConfirm={handleRefundConfirm}
          onCancel={closeRefund}
        />
      )}
    </div>
  )
}
