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
  // Pause flow uses an in-app reason card — window.prompt() is not supported in
  // Electron renderers (it throws), so never use it.
  const [pauseTarget, setPauseTarget] = useState(null) // { membershipId, name }
  const [pauseReason, setPauseReason] = useState('')
  const [error, setError] = useState('')
  const [history, setHistory] = useState(null)

  useEffect(() => {
    api.listAllMembers().then((r) => {
      setMembers(r.members || [])
      setLoading(false)
    })
  }, [])

  const reload = async () => {
    const r = await api.listAllMembers()
    setMembers(r.members || [])
  }

  const sendReminder = async (membershipId) => {
    setBusy(membershipId)
    const res = await api.sendReminder({ membershipId })
    setBusy(null)
    if (res?.success === false) {
      setError(res.error || 'Could not send the reminder')
      return
    }
    setError('')
    reload()
  }

  // Sending marks the membership so it drops out of the pending list. Clearing
  // that mark is the only way to send a second time — the handler and its audit
  // trail existed from the start, but nothing in the UI ever called them, so a
  // reminder that did not reach the member could not be re-sent.
  const allowResend = async (membershipId) => {
    setBusy(membershipId)
    const res = await api.clearReminder({ membershipId })
    setBusy(null)
    if (res?.success === false) {
      setError(res.error || 'Could not clear the reminder')
      return
    }
    setError('')
    reload()
  }

  const toggleHistory = async () => {
    if (history) {
      setHistory(null)
      return
    }
    const r = await api.getReminderHistory({ limit: 50 })
    setHistory(r.history || [])
  }

  const confirmPause = async () => {
    if (!pauseTarget) return
    setBusy(pauseTarget.membershipId)
    setError('')
    const res = await api.pauseMembership({
      membershipId: pauseTarget.membershipId,
      reason: pauseReason
    })
    setBusy(null)
    if (res?.success === false) {
      setError(res.error || 'Pause failed')
      return
    }
    setPauseTarget(null)
    setPauseReason('')
    await reload()
  }

  const resume = async (membershipId) => {
    setBusy(membershipId)
    setError('')
    const res = await api.resumeMembership({ membershipId })
    setBusy(null)
    if (res?.success === false) {
      setError(res.error || 'Resume failed')
      return
    }
    await reload()
  }

  // Single source of truth for a member's displayed status. The filter used to
  // derive this without the paused check while the row renderer included it,
  // so paused members were listed under "Expired" with a "Paused" badge.
  const memberStatus = (m) => {
    const mem = m.activeMembership
    if (!mem && m.pausedMembership) return 'Paused'
    return mem?.uiStatus || 'Expired'
  }

  const filtered = members.filter((m) => {
    const needle = q.trim().toLowerCase()
    // Match the fields independently: concatenating them made "rai9841" match
    // a string that exists in neither the name nor the phone.
    const matchQ =
      !needle ||
      m.name.toLowerCase().includes(needle) ||
      (m.phone || '').toLowerCase().includes(needle)
    const matchStatus = !statusFilter || memberStatus(m) === statusFilter
    return matchQ && matchStatus
  })

  return (
    <div className="content fade-in">
      <SectionHead title="Members">
        <button className="btn btn-ghost" onClick={toggleHistory}>
          <Icon name="message-circle" size={15} />
          {history ? 'Hide reminder history' : 'Reminder history'}
        </button>
      </SectionHead>
      {history && (
        <div className="card" style={{ padding: 16, marginBottom: 14 }}>
          <div style={{ fontWeight: 500, marginBottom: 8 }}>Renewal reminders sent</div>
          {history.length === 0 ? (
            <div className="sub">No reminders have been sent yet.</div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Member</th>
                  <th style={{ width: 130 }}>Phone</th>
                  <th style={{ width: 170 }}>Sent</th>
                  <th style={{ width: 120 }}>By</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 500 }}>{h.member || '—'}</td>
                    <td style={{ color: '#64748b' }}>{h.phone || '—'}</td>
                    <td style={{ color: '#64748b' }}>{h.sentAt}</td>
                    <td style={{ color: '#64748b' }}>{h.sentBy || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
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
          <option>Paused</option>
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
            const paused = x.pausedMembership
            const isPaused = !mem && !!paused
            const status = isPaused ? 'Paused' : mem?.uiStatus || 'Expired'
            const last = x.lastMembership
            const type = (mem || paused)?.productName || last?.productName || '—'
            const expiry = (mem || paused)?.endDisplay || (last ? `ended ${last.endDisplay}` : '—')
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
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {status === 'Expiring soon' &&
                      x.phone &&
                      mem?.id &&
                      (mem.reminderSentAt ? (
                        // Already reminded. Re-sending needs the flag cleared,
                        // so offer that rather than a button that silently
                        // does the same thing twice.
                        <button
                          className="btn btn-ghost"
                          style={{ padding: '4px 8px', fontSize: 11 }}
                          disabled={busy === mem.id}
                          title={`Reminder sent ${mem.reminderSentAt}`}
                          onClick={() => allowResend(mem.id)}
                        >
                          {busy === mem.id ? '…' : 'Allow re-send'}
                        </button>
                      ) : (
                        <button
                          className="btn btn-ghost"
                          style={{ padding: '4px 8px', fontSize: 11 }}
                          disabled={busy === mem.id}
                          onClick={() => sendReminder(mem.id)}
                        >
                          {busy === mem.id ? '…' : 'Send reminder'}
                        </button>
                      ))}
                    {mem?.id && status !== 'Expired' && (
                      <button
                        className="btn btn-ghost"
                        style={{ padding: '4px 8px', fontSize: 11 }}
                        disabled={busy === mem.id}
                        onClick={() => {
                          setPauseTarget({ membershipId: mem.id, name: x.name })
                          setPauseReason('')
                          setError('')
                        }}
                      >
                        Pause
                      </button>
                    )}
                    {isPaused && paused?.id && (
                      <button
                        className="btn btn-ghost"
                        style={{ padding: '4px 8px', fontSize: 11 }}
                        disabled={busy === paused.id}
                        onClick={() => resume(paused.id)}
                      >
                        {busy === paused.id ? '…' : 'Resume'}
                      </button>
                    )}
                  </div>
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
      {error && !pauseTarget && (
        <div className="alert red" style={{ marginTop: 12, maxWidth: 480 }}>
          <div className="a-desc">{error}</div>
        </div>
      )}
      {pauseTarget && (
        <div className="card" style={{ marginTop: 14, padding: 16, maxWidth: 420 }}>
          <div style={{ fontWeight: 500, marginBottom: 8 }}>
            Pause membership — {pauseTarget.name}
          </div>
          <input
            className="input"
            value={pauseReason}
            onChange={(e) => setPauseReason(e.target.value)}
            placeholder="Reason (optional, e.g. travel, injury)"
          />
          <div className="sub" style={{ marginTop: 6, fontSize: 11.5 }}>
            Frozen days are added back to the expiry date on resume.
          </div>
          {error && (
            <div className="alert red" style={{ marginTop: 10 }}>
              <div className="a-desc">{error}</div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button
              className="btn btn-primary"
              disabled={busy === pauseTarget.membershipId}
              onClick={confirmPause}
            >
              {busy === pauseTarget.membershipId ? 'Pausing…' : 'Confirm pause'}
            </button>
            <button className="btn btn-ghost" onClick={() => setPauseTarget(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
