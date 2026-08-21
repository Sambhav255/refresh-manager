import { useState, useEffect } from 'react'
import { api } from '../lib/api'
import { fmt, todayLocal, formatDateDisplay } from '../lib/format'
import { PayBadge, SectionHead } from '../components/ui'

export function TodaysLog() {
  const [tx, setTx] = useState([])
  const today = todayLocal()

  useEffect(() => {
    api
      .listTransactions({ dateFrom: today, dateTo: today })
      .then((r) => setTx(r.transactions || []))
  }, [today])

  const total = tx.reduce((s, t) => s + t.amount, 0)

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
          </tr>
        </thead>
        <tbody>
          {tx.map((t) => (
            <tr key={t.id}>
              <td style={{ color: 'var(--text-secondary)' }}>{t.time}</td>
              <td>
                <span style={{ color: 'var(--ink)' }}>{t.product}</span>{' '}
                <span style={{ color: 'var(--text-secondary)' }}>· {t.customer}</span>
              </td>
              <td className="num">{fmt(t.amount)}</td>
              <td>
                <PayBadge pay={t.pay} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="tbl-foot">
        <span>{tx.length} transactions · today</span>
        <span className="total">Total: {fmt(total)}</span>
      </div>
    </div>
  )
}
