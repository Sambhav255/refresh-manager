import { useState, useEffect } from 'react'
import { api } from '../lib/api'
import { fmt, todayLocal } from '../lib/format'
import { PayBadge, SectionHead } from '../components/ui'

export function OwnerTransactions() {
  const [tx, setTx] = useState([])
  const [staff, setStaff] = useState([])
  const [range, setRange] = useState('today')
  const [typeFilter, setTypeFilter] = useState('')
  const [payFilter, setPayFilter] = useState('')
  const [staffFilter, setStaffFilter] = useState('')
  const [voidId, setVoidId] = useState(null)
  const [reason, setReason] = useState('')
  const [voidConfirmDay, setVoidConfirmDay] = useState(null)
  const [refundTx, setRefundTx] = useState(null)
  const [refundAmount, setRefundAmount] = useState('')
  const [refundReason, setRefundReason] = useState('')
  const [error, setError] = useState('')

  const load = () => {
    const today = todayLocal()
    const params = { dateFrom: today, dateTo: today }
    if (range === 'week') {
      const d = new Date()
      d.setDate(d.getDate() - 7)
      params.dateFrom = d.toISOString().slice(0, 10)
    }
    if (typeFilter) params.type = typeFilter
    if (payFilter) params.paymentMethod = payFilter
    if (staffFilter) params.staffId = Number(staffFilter)
    api.listTransactions(params).then((r) => setTx(r.transactions || []))
  }

  useEffect(() => {
    api.listStaff().then((r) => setStaff(r.users || []))
    load()
  }, [])
  useEffect(() => {
    load()
  }, [range, typeFilter, payFilter, staffFilter])

  const handleVoid = async (confirmReconciled = false) => {
    if (!voidId || !reason.trim()) return
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
    setRefundAmount(String(t.amount))
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
          <option value="week">This week</option>
        </select>
        <select
          className="select"
          style={{ width: 140 }}
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          <option value="">All types</option>
          <option value="membership">Membership</option>
          <option value="day_package">Day Package</option>
          <option value="day_pass">Day Pass</option>
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
              <td>
                {t.type === 'refund' || t.amount < 0 ? (
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
        <span>{tx.length} transactions</span>
        <span className="total">Total: {fmt(total)}</span>
      </div>
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
