import { useState, useEffect } from 'react'
import { api } from '../lib/api'
import { Icon, SectionHead } from '../components/ui'

// 2-E: read-only audit trail viewer for the owner.
const ACTION_LABELS = {
  'backup:restore': 'Backup restored',
  'settings:set': 'Setting changed',
  'staff:add': 'Staff added',
  'staff:deactivate': 'Staff deactivated',
  'staff:change-pin': 'Staff PIN changed',
  'transaction:void': 'Transaction voided',
  'transaction:refund': 'Refund issued',
  'membership:pause': 'Membership paused',
  'membership:resume': 'Membership resumed',
  'reminder:send': 'Reminder sent',
  'reminder:clear': 'Reminder cleared'
}

function summarise(action, detail) {
  let d = {}
  try {
    d = JSON.parse(detail || '{}')
  } catch {
    d = {}
  }
  switch (action) {
    case 'transaction:void':
      return `#${d.transactionId} · Rs. ${d.amount}${d.reconciledDay ? ` · reconciled day ${d.reconciledDay}` : ''}${d.reason ? ` · ${d.reason}` : ''}`
    case 'transaction:refund':
      return `of #${d.originalId} · Rs. ${d.amount}${d.full ? ' (full)' : ' (partial)'}`
    case 'settings:set':
      return d.value !== undefined ? `${d.key} = ${d.value}` : `${d.key} (hidden)`
    case 'membership:pause':
      return `membership #${d.membershipId}${d.reason ? ` · ${d.reason}` : ''}`
    case 'membership:resume':
      return `membership #${d.membershipId} · +${d.pausedDays}d → ${d.newEnd}`
    case 'reminder:send':
      return `${d.member || ''}${d.phone ? ` · ${d.phone}` : ''}`
    case 'staff:add':
      return `${d.name || ''} (#${d.userId})`
    case 'backup:restore':
      return d.from ? d.from.split(/[\\/]/).pop() : ''
    default:
      return detail && detail !== '{}' ? detail : ''
  }
}

export function AuditLog({ back }) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.listAudit({ limit: 300 }).then((r) => {
      setEntries(r.entries || [])
      setLoading(false)
    })
  }, [])

  return (
    <div className="content fade-in">
      <SectionHead title="Audit log">
        <button className="btn btn-ghost" onClick={back}>
          <Icon name="chevron-left" size={15} /> Back
        </button>
      </SectionHead>
      <div className="sub" style={{ marginBottom: 12 }}>
        A tamper-evident record of sensitive actions (voids, refunds, restores, settings and staff
        changes, reminders).
      </div>
      {loading ? (
        <div className="sub">Loading…</div>
      ) : entries.length === 0 ? (
        <div className="sub">No audit entries yet.</div>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 160 }}>When</th>
              <th style={{ width: 130 }}>Who</th>
              <th style={{ width: 170 }}>Action</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td style={{ color: '#94a3b8', fontSize: 12 }}>{e.created_at}</td>
                <td style={{ fontSize: 12.5 }}>{e.actor_name || '—'}</td>
                <td style={{ fontSize: 12.5, fontWeight: 500 }}>
                  {ACTION_LABELS[e.action] || e.action}
                </td>
                <td style={{ fontSize: 12, color: '#64748b' }}>{summarise(e.action, e.detail)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
