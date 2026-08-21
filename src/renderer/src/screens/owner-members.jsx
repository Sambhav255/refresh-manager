import { useState, useEffect } from 'react'
import { api } from '../lib/api'
import { todayLocal } from '../lib/format'
import { Icon, Badge, Avatar, SectionHead } from '../components/ui'

// C-7: "day after the lapsed/current membership's end date", matching the
// addDays convention in src/main/ipc/utils.js — but clamped to never land in
// the past. The server recomputes the real end date from the product's
// duration regardless of what start date is sent, so this is only the
// dialog's pre-filled default (staff can always edit it) — but an
// already-expired membership's end date is, by definition, in the past, and
// defaulting straight to "day after that" would pre-fill a backdated start
// that immediately re-expires the new membership. Today is the safe floor.
function defaultRenewStart(endDateIso) {
  const today = todayLocal()
  if (!endDateIso) return today
  const d = new Date(endDateIso + 'T00:00:00')
  d.setDate(d.getDate() + 1)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const dayAfter = `${y}-${m}-${day}`
  return dayAfter > today ? dayAfter : today
}

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

export function OwnerMembers({ initialFilter = '' } = {}) {
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState(initialFilter)
  const [busy, setBusy] = useState(null)
  // Pause flow uses an in-app reason card — window.prompt() is not supported in
  // Electron renderers (it throws), so never use it.
  const [pauseTarget, setPauseTarget] = useState(null) // { membershipId, name }
  const [pauseReason, setPauseReason] = useState('')
  const [error, setError] = useState('')
  const [history, setHistory] = useState(null)
  // C-7: renew dialog. { membershipId, name, type, endDate } — endDate is the
  // raw ISO end date of the row's current/lapsed membership, used only to
  // compute the dialog's default start date.
  const [renewTarget, setRenewTarget] = useState(null)
  const [renewDate, setRenewDate] = useState('')
  const [renewPay, setRenewPay] = useState('Cash')
  const [renewNotice, setRenewNotice] = useState('')
  // Fix round 1 (review feedback on C-7): Pause must stay reachable on an
  // Expiring-soon row alongside the new Renew button, but a third inline
  // button reopens the exact stacked/misaligned-row problem H-24 was fixing.
  // Reuses the .rowmenu + fixed-position-dropdown pattern Task 6
  // (owner-transactions.jsx, commit fccddaf) already built for Void/Refund —
  // same data-rowmenu marker, same outside-click/Escape/scroll close below.
  const [menuOpenId, setMenuOpenId] = useState(null)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })

  useEffect(() => {
    if (menuOpenId == null) return
    const onDocClick = (e) => {
      if (!e.target.closest('[data-rowmenu]')) setMenuOpenId(null)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setMenuOpenId(null)
    }
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

  // C-7: membershipId is mem?.id for an expiring-soon member (their still-
  // active row — status='active' in the DB, end_date just hasn't passed yet)
  // and last?.id for an expired member (their most recent, already-lapsed
  // row, which members:list-all only populates as lastMembership when there
  // is no active/paused row — see mapMember there). members:renew marks
  // whatever id it's given 'expired' and creates the new active row, so
  // passing the wrong one for an expiring-soon member would expire a
  // membership that's still genuinely active instead of the row that's meant
  // to be replaced.
  const openRenew = (target) => {
    setError('')
    setRenewNotice('')
    setRenewTarget(target)
    setRenewDate(defaultRenewStart(target.endDate))
    setRenewPay('Cash')
  }

  const closeRenew = () => {
    setRenewTarget(null)
  }

  const confirmRenew = async () => {
    if (!renewTarget) return
    setBusy(renewTarget.membershipId)
    setError('')
    const res = await api.renewMembership({
      membershipId: renewTarget.membershipId,
      newStartDate: renewDate,
      paymentMethod: renewPay
    })
    setBusy(null)
    if (res?.success === false) {
      setError(res.error || 'Renewal failed')
      return
    }
    setRenewNotice(`${renewTarget.name} renewed on ${renewTarget.type} — now Active.`)
    setRenewTarget(null)
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
    // C-7 Part C: the dashboard's renewal alert navigates here with this
    // combined filter instead of a single exact status, since a member who
    // needs a renewal is either Expiring soon or already Expired.
    const matchStatus =
      !statusFilter ||
      (statusFilter === 'Needs renewal'
        ? ['Expiring soon', 'Expired'].includes(memberStatus(m))
        : memberStatus(m) === statusFilter)
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
      {renewNotice && (
        <div className="alert green" style={{ marginBottom: 14 }}>
          <div className="a-desc">{renewNotice}</div>
        </div>
      )}
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
          <option>Needs renewal</option>
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
            <th style={{ width: 150 }}>Actions</th>
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
            // C-7: mem?.id for Expiring soon (their still-active row), last?.id
            // for Expired (their most recent lapsed row — members:list-all only
            // ever populates lastMembership when there is no active/paused row,
            // so this never picks up a stray older membership by mistake). See
            // openRenew above for the fuller id-choice rationale.
            const canRenew = status === 'Expired' || status === 'Expiring soon'
            const renewMembershipId = mem?.id || last?.id
            const renewEndDate = (mem || last)?.endDate
            return (
              <tr key={x.id}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                    <MemberAvatar member={x} status={status} />
                    <div>
                      <div style={{ fontWeight: 500 }}>{x.name}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 1 }}>
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
                <td style={{ position: 'relative' }}>
                  {/* P-3: owner surface, 32px minimum. Renew/Pause/Send
                      reminder/Allow re-send/Resume aren't in the brief's
                      destructive list (Void/Refund/Delete/deactivate) —
                      pausing is reversible via Resume right below it, and
                      renewing is a normal positive action — so 32px, not
                      40px, is the target. Shares the exact
                      `padding: '4px 8px', fontSize: 11` style the brief
                      measured Void/Refund at (~23px tall before a fix), so
                      minHeight: 32 is applied on the same evidence rather
                      than a separate live measurement of each variant.

                      C-7/H-24, fix round 1: Expiring soon has THREE possible
                      actions (Renew, Send reminder/Allow re-send, Pause —
                      Pause was wrongly dropped in the first pass and
                      restored here per review). Renew stays the one visible
                      primary button; the other two move into a `.rowmenu`
                      overflow (same pattern Task 6/C-8 built for Void/Refund
                      in owner-transactions.jsx) so every row still caps at
                      two visible elements and flexWrap can stay 'nowrap'
                      without a row ever growing a second line. */}
                  <div
                    style={{
                      display: 'flex',
                      gap: 4,
                      flexWrap: 'nowrap',
                      alignItems: 'center',
                      justifyContent: 'flex-end'
                    }}
                  >
                    {canRenew && renewMembershipId && (
                      <button
                        className="btn btn-primary"
                        style={{ padding: '4px 10px', fontSize: 11, minHeight: 32 }}
                        disabled={busy === renewMembershipId}
                        onClick={() =>
                          openRenew({
                            membershipId: renewMembershipId,
                            name: x.name,
                            type,
                            endDate: renewEndDate
                          })
                        }
                      >
                        {busy === renewMembershipId ? '…' : 'Renew'}
                      </button>
                    )}
                    {status === 'Expiring soon' && mem?.id && (
                      <div data-rowmenu style={{ position: 'relative' }}>
                        <button
                          className="rowmenu"
                          aria-label={`More actions for ${x.name}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            const next = menuOpenId === x.id ? null : x.id
                            if (next) {
                              const r = e.currentTarget.getBoundingClientRect()
                              setMenuPos({ top: r.bottom + 4, left: r.right - 160 })
                            }
                            setMenuOpenId(next)
                          }}
                        >
                          <Icon name="more-vertical" size={18} />
                        </button>
                        {menuOpenId === x.id && (
                          <div
                            data-rowmenu
                            className="card"
                            style={{
                              position: 'fixed',
                              top: menuPos.top,
                              left: menuPos.left,
                              zIndex: 1000,
                              padding: 4,
                              minWidth: 160,
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 2
                            }}
                          >
                            {x.phone &&
                              (mem.reminderSentAt ? (
                                // Already reminded. Re-sending needs the flag
                                // cleared, so offer that rather than a button
                                // that silently does the same thing twice.
                                <button
                                  className="btn btn-ghost"
                                  style={{
                                    justifyContent: 'flex-start',
                                    minHeight: 40,
                                    fontSize: 12.5
                                  }}
                                  disabled={busy === mem.id}
                                  title={`Reminder sent ${mem.reminderSentAt}`}
                                  onClick={() => {
                                    setMenuOpenId(null)
                                    allowResend(mem.id)
                                  }}
                                >
                                  Allow re-send
                                </button>
                              ) : (
                                <button
                                  className="btn btn-ghost"
                                  style={{
                                    justifyContent: 'flex-start',
                                    minHeight: 40,
                                    fontSize: 12.5
                                  }}
                                  disabled={busy === mem.id}
                                  onClick={() => {
                                    setMenuOpenId(null)
                                    sendReminder(mem.id)
                                  }}
                                >
                                  Send reminder
                                </button>
                              ))}
                            <button
                              className="btn btn-ghost"
                              style={{
                                justifyContent: 'flex-start',
                                minHeight: 40,
                                fontSize: 12.5
                              }}
                              disabled={busy === mem.id}
                              onClick={() => {
                                setMenuOpenId(null)
                                setPauseTarget({ membershipId: mem.id, name: x.name })
                                setPauseReason('')
                                setError('')
                              }}
                            >
                              Pause
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                    {status === 'Active' && mem?.id && (
                      <button
                        className="btn btn-ghost"
                        style={{ padding: '4px 8px', fontSize: 11, minHeight: 32 }}
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
                        style={{ padding: '4px 8px', fontSize: 11, minHeight: 32 }}
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
      {error && !pauseTarget && !renewTarget && (
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
      {/* C-7 Part B: a normal positive-action dialog, not a destructive
          confirm — reuses the .modal-backdrop/.modal visual language
          ConfirmDestructive established (app.css) rather than that
          component itself, which is specifically for irreversible actions
          with a mandatory reason. Renewing has neither property. */}
      {renewTarget && (
        <div className="modal-backdrop" onClick={closeRenew}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 12 }}>
              Renew — {renewTarget.name}
            </div>
            <div
              style={{
                fontSize: 13,
                color: 'var(--text-secondary)',
                background: 'var(--bg)',
                borderRadius: 8,
                padding: '10px 12px',
                marginBottom: 14
              }}
            >
              Current plan: {renewTarget.type}
            </div>
            <div className="field">
              <label>Start date</label>
              <input
                className="input"
                type="date"
                value={renewDate}
                onChange={(e) => setRenewDate(e.target.value)}
              />
            </div>
            <div className="field" style={{ marginBottom: 4 }}>
              <label>Payment method</label>
              <div className="toggle-row">
                <button
                  className={'toggle-btn' + (renewPay === 'Cash' ? ' sel' : '')}
                  onClick={() => setRenewPay('Cash')}
                >
                  <Icon name="banknote" size={17} /> Cash
                </button>
                <button
                  className={'toggle-btn' + (renewPay === 'QR' ? ' sel' : '')}
                  onClick={() => setRenewPay('QR')}
                >
                  <Icon name="qr-code" size={17} /> QR (eSewa / Khalti)
                </button>
              </div>
            </div>
            {error && (
              <div className="alert red" style={{ marginTop: 10 }}>
                <div className="a-desc">{error}</div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
              <button className="btn btn-ghost" onClick={closeRenew}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={busy === renewTarget.membershipId || !renewDate}
                onClick={confirmRenew}
              >
                {busy === renewTarget.membershipId ? 'Renewing…' : 'Confirm renewal'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
