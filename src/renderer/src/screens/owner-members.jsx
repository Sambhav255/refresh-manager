import { useState, useEffect } from 'react'
import { api } from '../lib/api'
import { Icon, Badge, Avatar, SectionHead } from '../components/ui'

function MemberAvatar({ member, status }) {
  const [src, setSrc] = useState(null)
  useEffect(() => {
    api.getPhotoPath({ memberId: member.id }).then((r) => setSrc(r.photoPath))
  }, [member.id])
  if (src) {
    return (
      <img
        src={src}
        alt=""
        style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'cover' }}
      />
    )
  }
  return <Avatar initials={member.initials} status={status} />
}

export function OwnerMembers() {
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [busy, setBusy] = useState(null)

  useEffect(() => {
    api.listAllMembers().then((r) => {
      setMembers(r.members || [])
      setLoading(false)
    })
  }, [])

  const sendReminder = async (membershipId) => {
    setBusy(membershipId)
    await api.sendReminder({ membershipId })
    setBusy(null)
  }

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
            <th style={{ width: 120 }}>Actions</th>
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
                    <MemberAvatar member={x} status={status} />
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
                <td>
                  {status === 'Expiring soon' && x.phone && mem?.id && (
                    <button
                      className="btn btn-ghost"
                      style={{ padding: '4px 8px', fontSize: 11 }}
                      disabled={busy === mem.id}
                      onClick={() => sendReminder(mem.id)}
                    >
                      {busy === mem.id ? '…' : 'Send reminder'}
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {loading && <div className="sub">Loading members…</div>}
      {!loading && filtered.length === 0 && (
        <div className="sub">No members match your search.</div>
      )}
    </div>
  )
}
