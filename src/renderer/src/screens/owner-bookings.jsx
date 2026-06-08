import { useState, useEffect } from 'react'
import { api } from '../lib/api'
import { todayLocal } from '../lib/format'
import { Icon, Badge, SectionHead } from '../components/ui'

const emptyForm = {
  bookingName: '',
  contactPerson: '',
  contactPhone: '',
  bookingDate: todayLocal(),
  timeSlot: '',
  numPeople: '',
  facilitiesBooked: '',
  depositPaid: 0,
  totalExpected: 0,
  notes: ''
}

export function OwnerBookings({ session }) {
  const [tab, setTab] = useState('upcoming')
  const [bookings, setBookings] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState(emptyForm)

  const load = () => {
    if (tab === 'upcoming') {
      api.upcomingBookings({ days: 60 }).then((r) => setBookings(r.bookings || []))
    } else {
      api.listBookings().then((r) => setBookings(r.bookings || []))
    }
  }

  useEffect(() => {
    load()
  }, [tab])

  const openNew = () => {
    setEditId(null)
    setForm({ ...emptyForm, bookingDate: todayLocal() })
    setShowForm(true)
  }

  const openEdit = (b) => {
    setEditId(b.id)
    setForm({
      bookingName: b.bookingName || '',
      contactPerson: b.contactPerson || '',
      contactPhone: b.contactPhone || '',
      bookingDate: b.bookingDate || todayLocal(),
      timeSlot: b.timeSlot || '',
      numPeople: b.numPeople || '',
      facilitiesBooked: b.facilitiesBooked || '',
      depositPaid: b.depositPaid || 0,
      totalExpected: b.totalExpected || 0,
      notes: b.notes || ''
    })
    setShowForm(true)
  }

  const handleSave = async () => {
    if (editId) {
      await api.updateBooking({ bookingId: editId, fields: form })
    } else {
      await api.createBooking({ ...form, createdBy: session?.userId })
    }
    setShowForm(false)
    load()
  }

  const cancelBooking = async (id) => {
    await api.updateBookingStatus({ bookingId: id, status: 'cancelled' })
    load()
  }

  return (
    <div className="content fade-in">
      <SectionHead title="Bookings">
        <button className="btn btn-primary" onClick={openNew}>
          <Icon name="plus" size={15} /> New booking
        </button>
      </SectionHead>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button
          className={'btn ' + (tab === 'upcoming' ? 'btn-primary' : 'btn-ghost')}
          onClick={() => setTab('upcoming')}
        >
          Upcoming
        </button>
        <button
          className={'btn ' + (tab === 'all' ? 'btn-primary' : 'btn-ghost')}
          onClick={() => setTab('all')}
        >
          All
        </button>
      </div>
      {showForm && (
        <div className="card" style={{ padding: 16, marginBottom: 14 }}>
          <div style={{ fontWeight: 500, marginBottom: 10 }}>
            {editId ? 'Edit booking' : 'New booking'}
          </div>
          {Object.entries({
            bookingName: 'Name',
            contactPerson: 'Contact',
            contactPhone: 'Phone',
            bookingDate: 'Date',
            timeSlot: 'Time slot',
            numPeople: 'People',
            facilitiesBooked: 'Facilities',
            notes: 'Notes'
          }).map(([k, label]) => (
            <div key={k} className="field">
              <label>{label}</label>
              <input
                className="input"
                type={k === 'bookingDate' ? 'date' : 'text'}
                value={form[k]}
                onChange={(e) => setForm({ ...form, [k]: e.target.value })}
              />
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" onClick={handleSave}>
              Save
            </button>
            <button className="btn btn-ghost" onClick={() => setShowForm(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {bookings.map((b) => (
          <div key={b.id} className="card" style={{ padding: '14px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontWeight: 500 }}>{b.bookingName}</div>
                <div className="sub">
                  {b.dateDisplay} · {b.timeSlot || '—'} · {b.numPeople || '—'} people
                </div>
                <div className="sub" style={{ color: '#64748b' }}>
                  {b.contactPerson} · {b.contactPhone}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <Badge kind={b.status === 'confirmed' ? 'Active' : 'Cash'}>{b.status}</Badge>
                {b.status !== 'cancelled' && b.status !== 'completed' && (
                  <>
                    <button
                      className="btn btn-ghost"
                      style={{ padding: '4px 8px', fontSize: 11 }}
                      onClick={() => openEdit(b)}
                    >
                      Edit
                    </button>
                    <button
                      className="btn btn-ghost"
                      style={{ padding: '4px 8px', fontSize: 11 }}
                      onClick={() => cancelBooking(b.id)}
                    >
                      Cancel
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
