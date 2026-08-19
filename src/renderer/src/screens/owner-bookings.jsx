import { useState, useEffect } from 'react'
import { api } from '../lib/api'
import { fmt, todayLocal } from '../lib/format'
import { Icon, Badge, SectionHead } from '../components/ui'

const UPCOMING_DAYS = 60

const emptyForm = {
  bookingName: '',
  contactPerson: '',
  contactPhone: '',
  bookingDate: todayLocal(),
  timeSlot: '',
  numPeople: '',
  facilitiesBooked: '',
  depositPaid: 0,
  depositMethod: 'cash',
  totalExpected: 0,
  notes: ''
}

// Text fields render from one map; money, date, people and notes need their own
// input types, so they are laid out explicitly below.
const TEXT_FIELDS = {
  bookingName: 'Name',
  contactPerson: 'Contact',
  contactPhone: 'Phone',
  timeSlot: 'Time slot',
  facilitiesBooked: 'Facilities'
}

export function OwnerBookings({ session }) {
  const [tab, setTab] = useState('upcoming')
  const [bookings, setBookings] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState('')
  const [confirmCancel, setConfirmCancel] = useState(null)

  const load = () => {
    if (tab === 'upcoming') {
      api.upcomingBookings({ days: UPCOMING_DAYS }).then((r) => setBookings(r.bookings || []))
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
    setError('')
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
      depositMethod: b.depositMethod || 'cash',
      totalExpected: b.totalExpected || 0,
      notes: b.notes || ''
    })
    setError('')
    setShowForm(true)
  }

  const handleSave = async () => {
    setError('')
    const payload = {
      ...form,
      numPeople: form.numPeople === '' ? null : Number(form.numPeople),
      depositPaid: Number(form.depositPaid) || 0,
      totalExpected: Number(form.totalExpected) || 0
    }
    const r = editId
      ? await api.updateBooking({ bookingId: editId, fields: payload })
      : await api.createBooking({ ...payload, createdBy: session?.userId })
    if (r?.success === false) {
      setError(r.error || 'Could not save booking')
      return
    }
    setShowForm(false)
    load()
  }

  // Cancelling never reverses the deposit automatically — forfeiting is normal
  // and auto-refunding would destroy real revenue. The handler returns the
  // outstanding amount so the owner is told about the money and can act on it.
  const doCancel = async (b) => {
    setError('')
    const r = await api.updateBookingStatus({ bookingId: b.id, status: 'cancelled' })
    setConfirmCancel(null)
    if (r?.success === false) {
      setError(r.error || 'Could not cancel booking')
      return
    }
    if (r?.outstandingDeposit > 0) {
      setError(
        `Booking cancelled. ${fmt(r.outstandingDeposit)} deposit is still recorded as revenue — refund it from Transactions if you are giving it back.`
      )
    }
    load()
  }

  const reinstate = async (b) => {
    setError('')
    const r = await api.updateBookingStatus({ bookingId: b.id, status: 'confirmed' })
    if (r?.success === false) {
      setError(r.error || 'Could not reinstate booking')
      return
    }
    load()
  }

  const balance = (b) => (b.totalExpected || 0) - (b.depositPaid || 0)

  return (
    <div className="content fade-in">
      <SectionHead title="Bookings">
        <button className="btn btn-primary" onClick={openNew}>
          <Icon name="plus" size={15} /> New booking
        </button>
      </SectionHead>
      {error && (
        <div className="alert amber" style={{ marginBottom: 12 }}>
          <div className="a-desc">{error}</div>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button
          className={'btn ' + (tab === 'upcoming' ? 'btn-primary' : 'btn-ghost')}
          onClick={() => setTab('upcoming')}
        >
          Next {UPCOMING_DAYS} days
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
          {Object.entries(TEXT_FIELDS).map(([k, label]) => (
            <div key={k} className="field">
              <label>{label}</label>
              <input
                className="input"
                value={form[k]}
                onChange={(e) => setForm({ ...form, [k]: e.target.value })}
              />
            </div>
          ))}
          <div style={{ display: 'flex', gap: 10 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Date</label>
              <input
                className="input"
                type="date"
                value={form.bookingDate}
                onChange={(e) => setForm({ ...form, bookingDate: e.target.value })}
              />
              {form.bookingDate && form.bookingDate < todayLocal() && (
                <div className="sub" style={{ color: '#d97706', fontSize: 11.5, marginTop: 4 }}>
                  This date is in the past.
                </div>
              )}
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>People</label>
              <input
                className="input"
                type="number"
                min="1"
                value={form.numPeople}
                onChange={(e) => setForm({ ...form, numPeople: e.target.value })}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Total expected (Rs.)</label>
              <input
                className="input"
                type="number"
                min="0"
                value={form.totalExpected}
                onChange={(e) => setForm({ ...form, totalExpected: e.target.value })}
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Deposit paid (Rs.)</label>
              <input
                className="input"
                type="number"
                min="0"
                value={form.depositPaid}
                onChange={(e) => setForm({ ...form, depositPaid: e.target.value })}
              />
            </div>
            <div className="field" style={{ width: 130 }}>
              <label>Deposit by</label>
              <select
                className="input"
                value={form.depositMethod}
                onChange={(e) => setForm({ ...form, depositMethod: e.target.value })}
              >
                <option value="cash">Cash</option>
                <option value="qr">QR</option>
              </select>
            </div>
          </div>
          {Number(form.depositPaid) > 0 && (
            <div className="sub" style={{ marginBottom: 10, fontSize: 11.5 }}>
              A deposit records a booking-deposit transaction in today&apos;s takings.
              {Number(form.totalExpected) > 0 &&
                ` Balance due on the day: ${fmt(Number(form.totalExpected) - Number(form.depositPaid))}.`}
            </div>
          )}
          <div className="field">
            <label>Notes</label>
            <textarea
              className="input"
              rows={3}
              style={{ resize: 'vertical', fontFamily: 'inherit' }}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
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
      {confirmCancel && (
        <div className="card" style={{ padding: 16, marginBottom: 14 }}>
          <div style={{ fontWeight: 500, marginBottom: 6 }}>
            Cancel &ldquo;{confirmCancel.bookingName}&rdquo;?
          </div>
          <div className="sub" style={{ marginBottom: 10 }}>
            {confirmCancel.depositPaid > 0
              ? `${fmt(confirmCancel.depositPaid)} deposit has been taken. Cancelling keeps it as revenue (a forfeited deposit) — refund it from Transactions if you are giving it back.`
              : 'No deposit has been taken on this booking.'}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" onClick={() => doCancel(confirmCancel)}>
              Cancel booking
            </button>
            <button className="btn btn-ghost" onClick={() => setConfirmCancel(null)}>
              Keep it
            </button>
          </div>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {bookings.length === 0 && (
          <div className="card" style={{ padding: 22, textAlign: 'center' }}>
            <div className="sub">
              {tab === 'upcoming'
                ? `No bookings in the next ${UPCOMING_DAYS} days.`
                : 'No bookings yet.'}
            </div>
          </div>
        )}
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
                {(b.totalExpected > 0 || b.depositPaid > 0) && (
                  <div className="sub" style={{ color: '#64748b', marginTop: 2 }}>
                    Deposit {fmt(b.depositPaid || 0)}
                    {b.totalExpected > 0 &&
                      ` of ${fmt(b.totalExpected)} · balance ${fmt(balance(b))}`}
                  </div>
                )}
                {b.notes && (
                  <div className="sub" style={{ color: '#94a3b8', marginTop: 2 }}>
                    {b.notes}
                  </div>
                )}
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
                      onClick={() => setConfirmCancel(b)}
                    >
                      Cancel
                    </button>
                  </>
                )}
                {b.status === 'cancelled' && (
                  <button
                    className="btn btn-ghost"
                    style={{ padding: '4px 8px', fontSize: 11 }}
                    onClick={() => reinstate(b)}
                  >
                    Reinstate
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
