import { useState, useEffect } from 'react'
import { api } from '../lib/api'
import { Icon, Badge, SectionHead } from '../components/ui'

export function StaffBookings({ back }) {
  const [bookings, setBookings] = useState([])
  const [loading, setLoading] = useState(true)

  const load = () => {
    setLoading(true)
    api.upcomingBookings({ days: 14 }).then((r) => { setBookings(r.bookings || []); setLoading(false) })
  }

  useEffect(() => { load() }, [])

  const markCompleted = async (id) => {
    await api.updateBookingStatus({ bookingId: id, status: 'completed' })
    load()
  }

  return (
    <div className="content fade-in" style={{ maxWidth: 860, margin: '0 auto' }}>
      <SectionHead title="Upcoming Bookings" date="Next 14 days">
        <button className="btn btn-ghost" onClick={back}><Icon name="chevron-left" size={15} /> Back to home</button>
      </SectionHead>
      {loading ? <div className="sub">Loading…</div> : bookings.length === 0 ? (
        <div className="card" style={{ padding: 28, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>No upcoming bookings in the next 14 days.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {bookings.map((b) => (
            <div key={b.id} className="card" style={{ padding: '14px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{b.bookingName}</div>
                  <div className="sub" style={{ marginTop: 4 }}>{b.dateDisplay} · {b.timeSlot || '—'} · {b.numPeople || '—'} people</div>
                  <div className="sub" style={{ marginTop: 2, color: '#64748b' }}>{b.contactPerson || '—'} · {b.contactPhone || '—'}</div>
                  {b.facilitiesBooked && <div className="sub" style={{ marginTop: 2 }}>{b.facilitiesBooked}</div>}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
                  <Badge kind={b.status === 'confirmed' ? 'Active' : 'Cash'}>{b.status}</Badge>
                  {b.status !== 'completed' && b.status !== 'cancelled' && (
                    <button className="btn btn-ghost" style={{ padding: '5px 11px', fontSize: 12 }} onClick={() => markCompleted(b.id)}>
                      <Icon name="check" size={14} /> Mark completed
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
