import { useState, useEffect } from 'react'
import { api } from '../lib/api'
import { todayLocal } from '../lib/format'
import { Icon, Badge, SectionHead } from '../components/ui'
import { BookingCalendar } from './owner-bookings'

// Month helpers deliberately match the calendar's own: "YYYY-MM" in, local
// first/last day out, so the range asked for is exactly the grid drawn.
function monthOf(iso) {
  return iso.slice(0, 7)
}

function monthRange(month) {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, '0')}` }
}

export function StaffBookings({ back }) {
  const [view, setView] = useState('calendar')
  const [bookings, setBookings] = useState([])
  const [month, setMonth] = useState(monthOf(todayLocal()))
  const [selectedDate, setSelectedDate] = useState(todayLocal())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = () => {
    setLoading(true)
    // The calendar shows the whole month including cancelled days — staff need
    // to see that a school is NOT coming, not just that someone once booked.
    const { start, end } = monthRange(month)
    const request =
      view === 'calendar'
        ? api.listBookings({ dateFrom: start, dateTo: end })
        : api.upcomingBookings({ days: 14 })
    request.then((r) => {
      setBookings(r.bookings || [])
      setLoading(false)
    })
  }

  useEffect(() => {
    load()
  }, [view, month])

  const markCompleted = async (id) => {
    setError('')
    const r = await api.updateBookingStatus({ bookingId: id, status: 'completed' })
    if (r?.success === false) {
      setError(r.error || 'Could not update booking')
      return
    }
    load()
  }

  const completeButton = (b) =>
    b.status !== 'completed' && b.status !== 'cancelled' ? (
      <button
        className="btn btn-ghost"
        style={{ padding: '4px 9px', fontSize: 11 }}
        onClick={() => markCompleted(b.id)}
      >
        <Icon name="check" size={13} /> Done
      </button>
    ) : null

  return (
    <div className="content fade-in" style={{ maxWidth: 860, margin: '0 auto' }}>
      <SectionHead
        title="Bookings"
        date={view === 'calendar' ? 'Who is coming, day by day' : 'Next 14 days'}
      >
        <button className="btn btn-ghost" onClick={back}>
          <Icon name="chevron-left" size={15} /> Back to home
        </button>
      </SectionHead>
      {error && (
        <div className="alert red" style={{ marginBottom: 12 }}>
          <div className="a-desc">{error}</div>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button
          className={'btn ' + (view === 'calendar' ? 'btn-primary' : 'btn-ghost')}
          onClick={() => setView('calendar')}
        >
          <Icon name="calendar-days" size={15} /> Calendar
        </button>
        <button
          className={'btn ' + (view === 'list' ? 'btn-primary' : 'btn-ghost')}
          onClick={() => setView('list')}
        >
          <Icon name="list" size={15} /> Upcoming
        </button>
      </div>
      {loading ? (
        <div className="sub">Loading…</div>
      ) : view === 'calendar' ? (
        <BookingCalendar
          bookings={bookings}
          month={month}
          onMonthChange={setMonth}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
          dayActions={completeButton}
        />
      ) : bookings.length === 0 ? (
        <div
          className="card"
          style={{ padding: 28, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}
        >
          No upcoming bookings in the next 14 days.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {bookings.map((b) => (
            <div key={b.id} className="card" style={{ padding: '14px 16px' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start'
                }}
              >
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{b.bookingName}</div>
                  <div className="sub" style={{ marginTop: 4 }}>
                    {b.dateDisplay} · {b.timeSlot || '—'} · {b.numPeople || '—'} people
                  </div>
                  <div className="sub" style={{ marginTop: 2, color: '#64748b' }}>
                    {b.contactPerson || '—'} · {b.contactPhone || '—'}
                  </div>
                  {b.facilitiesBooked && (
                    <div className="sub" style={{ marginTop: 2 }}>
                      {b.facilitiesBooked}
                    </div>
                  )}
                </div>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    alignItems: 'flex-end'
                  }}
                >
                  <Badge kind={b.status === 'confirmed' ? 'Active' : 'Cash'}>{b.status}</Badge>
                  {b.status !== 'completed' && b.status !== 'cancelled' && (
                    <button
                      className="btn btn-ghost"
                      style={{ padding: '5px 11px', fontSize: 12 }}
                      onClick={() => markCompleted(b.id)}
                    >
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
