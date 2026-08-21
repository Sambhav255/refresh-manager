import { useState, useEffect } from 'react'
import { api } from '../lib/api'
import { fmt, todayLocal } from '../lib/format'
import { PayBadge, SectionHead } from '../components/ui'
import { TYPE_LABELS, TYPE_ORDER } from '../../../shared/transaction-types'

const PAGE_SIZE = 100

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
  const [voidId, setVoidId] = useState(null)
  const [reason, setReason] = useState('')
  const [voidConfirmDay, setVoidConfirmDay] = useState(null)
  const [refundTx, setRefundTx] = useState(null)
  const [refundAmount, setRefundAmount] = useState('')
  const [refundReason, setRefundReason] = useState('')
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

  const handleVoid = async (confirmReconciled = false) => {
    if (!voidId) return
    if (!reason.trim()) {
      // Was a silent return — the button looked broken.
      setError('A reason is required to void a transaction.')
      return
    }
    setError('')
    const res = await api.voidTransaction({ transactionId: voidId, reason, confirmReconciled })
    // 2-E: voiding a reconciled day needs an explicit confirm.
    if (res?.requiresConfirmation) {
      setVoidConfirmDay(res.reconciledDay)
      return
    }
    if (res?.success === false) {
      setError(res.error || 'Void failed')
      return
    }
    setVoidId(null)
    setReason('')
    setVoidConfirmDay(null)
    load()
  }

  const openRefund = (t) => {
    setRefundTx(t)
    // Default to what is still refundable, not the original amount — on a
    // partly refunded sale the old default always errored.
    setRefundAmount(String(t.remaining ?? t.amount))
    setRefundReason('')
    setError('')
  }

  const handleRefund = async () => {
    if (!refundTx) return
    setError('')
    const amt = Number(refundAmount)
    const res = await api.refundTransaction({
      transactionId: refundTx.id,
      amount: amt,
      reason: refundReason
    })
    if (res?.success === false) {
      setError(res.error || 'Refund failed')
      return
    }
    setRefundTx(null)
    load()
  }

  const total = tx.reduce((s, t) => s + t.amount, 0)

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
              <td>
                {t.isVoided ? (
                  <span style={{ color: '#ef4444', fontSize: 11 }}>voided</span>
                ) : t.type === 'refund' || t.amount < 0 ? (
                  <span style={{ color: '#94a3b8', fontSize: 11 }}>refund</span>
                ) : (
                  <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                    <button
                      className="btn btn-ghost"
                      style={{ padding: '4px 8px', fontSize: 11 }}
                      onClick={() => {
                        setVoidId(t.id)
                        setVoidConfirmDay(null)
                        setError('')
                      }}
                    >
                      Void
                    </button>
                    <button
                      className="btn btn-ghost"
                      style={{ padding: '4px 8px', fontSize: 11 }}
                      onClick={() => openRefund(t)}
                    >
                      Refund
                    </button>
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
      {voidId && (
        <div className="card" style={{ marginTop: 14, padding: 16 }}>
          <div style={{ fontWeight: 500, marginBottom: 8 }}>Void transaction #{voidId}</div>
          <input
            className="input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason for void"
          />
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
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="btn btn-primary" onClick={() => handleVoid(!!voidConfirmDay)}>
              {voidConfirmDay ? 'Void reconciled day anyway' : 'Confirm void'}
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => {
                setVoidId(null)
                setVoidConfirmDay(null)
                setError('')
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {refundTx && (
        <div className="card" style={{ marginTop: 14, padding: 16 }}>
          <div style={{ fontWeight: 500, marginBottom: 8 }}>
            Refund #{refundTx.id} — {refundTx.customer} ({fmt(refundTx.amount)})
          </div>
          <div className="field">
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
          <input
            className="input"
            value={refundReason}
            onChange={(e) => setRefundReason(e.target.value)}
            placeholder="Reason (optional)"
          />
          {error && (
            <div className="alert red" style={{ marginTop: 10 }}>
              <div className="a-desc">{error}</div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="btn btn-primary" onClick={handleRefund}>
              Confirm refund
            </button>
            <button className="btn btn-ghost" onClick={() => setRefundTx(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
