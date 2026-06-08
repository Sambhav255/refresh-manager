import { useState, useEffect } from 'react'
import { api } from '../lib/api'
import { Icon, Badge, Avatar, SectionHead } from '../components/ui'

export function OwnerMembers() {
  const [members, setMembers] = useState([])
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  useEffect(() => {
    api.listAllMembers().then((r) => setMembers(r.members || []))
  }, [])

  const filtered = members.filter((m) => {
    const mem = m.activeMembership
    const status = mem?.uiStatus || 'Expired'
    const matchQ =
      !q.trim() || (m.name + (m.phone || '')).toLowerCase().includes(q.trim().toLowerCase())
    const matchStatus = !statusFilter || status === statusFilter
    return matchQ && matchStatus
  })

  return (
    <div className="content fade-in">
      <SectionHead title="Members" />
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'center' }}>
        <div style={{ position: 'relative', width: 260 }}>
          <span
            style={{
              position: 'absolute',
              left: 12,
              top: '50%',
              transform: 'translateY(-50%)',
              display: 'flex'
            }}
          >
            <Icon name="search" size={15} color="#94a3b8" />
          </span>
          <input
            className="input"
            style={{ paddingLeft: 34 }}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search members…"
          />
        </div>
        <select
          className="select"
          style={{ width: 150 }}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All statuses</option>
          <option>Active</option>
          <option>Expiring soon</option>
          <option>Expired</option>
        </select>
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th>Member</th>
            <th style={{ width: 180 }}>Membership type</th>
            <th style={{ width: 130 }}>Status</th>
            <th style={{ width: 140 }}>Expiry date</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((x) => {
            const mem = x.activeMembership
            const status = mem?.uiStatus || 'Expired'
            const type = mem?.productName || '—'
            const expiry = mem?.endDisplay || '—'
            return (
              <tr key={x.id}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                    <Avatar initials={x.initials} status={status} />
                    <div>
                      <div style={{ fontWeight: 500 }}>{x.name}</div>
                      <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 1 }}>
                        {x.phone || '—'}
                      </div>
                    </div>
                  </div>
                </td>
                <td style={{ color: '#64748b' }}>{type}</td>
                <td>
                  <Badge kind={status} />
                </td>
                <td
                  style={{
                    color:
                      status === 'Expired'
                        ? '#991b1b'
                        : status === 'Expiring soon'
                          ? '#b45309'
                          : '#64748b'
                  }}
                >
                  {expiry}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
