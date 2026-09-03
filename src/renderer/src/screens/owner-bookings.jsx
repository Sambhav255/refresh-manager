import { useState, useEffect } from 'react'
import { api } from '../lib/api'
import { fmt, todayLocal, formatDateDisplay } from '../lib/format'
import { Icon, Badge, SectionHead } from '../components/ui'

const UPCOMING_DAYS = 60

// Mirrors MAX_SERIES_OCCURRENCES in src/main/ipc/bookings.js. The handler is
// the real guard; this only exists so the owner is told before clicking.
const MAX_SERIES = 200

const WEEKDAYS = [
  { value: 0, short: 'Sun', letter: 'S' },
  { value: 1, short: 'Mon', letter: 'M' },
  { value: 2, short: 'Tue', letter: 'T' },
  { value: 3, short: 'Wed', letter: 'W' },
  { value: 4, short: 'Thu', letter: 'T' },
  { value: 5, short: 'Fri', letter: 'F' },
  { value: 6, short: 'Sat', letter: 'S' }
]

// ---------------------------------------------------------------------------
// Local-date maths. Everything goes through a local Date built from Y/M/D so a
// month grid never slides by a day the way UTC parsing of "YYYY-MM-DD" does.
// ---------------------------------------------------------------------------

function pad2(n) {
  return String(n).padStart(2, '0')
}

function monthOf(iso) {
  return iso.slice(0, 7)
}

function monthParts(month) {
  const [y, m] = month.split('-').map(Number)
  return { y, m }
}

function monthRange(month) {
  const { y, m } = monthParts(month)
  const last = new Date(y, m, 0).getDate()
  return { start: `${month}-01`, end: `${month}-${pad2(last)}` }
}

function shiftMonth(month, delta) {
  const { y, m } = monthParts(month)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
}

function monthTitle(month) {
  const { y, m } = monthParts(month)
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

function weekdayOf(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).getDay()
}

function addOneDay(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  const next = new Date(y, m - 1, d + 1)
  return `${next.getFullYear()}-${pad2(next.getMonth() + 1)}-${pad2(next.getDate())}`
}

function dayNumber(iso) {
  return Number(iso.slice(8, 10))
}

// Cells for one month: leading blanks so the 1st lands under its weekday, then
// every real date, then trailing blanks to finish the last week.
export function monthCells(month) {
  const { y, m } = monthParts(month)
  const lead = new Date(y, m - 1, 1).getDay()
  const total = new Date(y, m, 0).getDate()
  const cells = []
  for (let i = 0; i < lead; i++) cells.push(null)
  for (let d = 1; d <= total; d++) cells.push(`${month}-${pad2(d)}`)
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

// The dates a "repeats weekly" choice would produce. Stops one past the cap so
// the form can say "too many" without walking years of calendar.
export function previewSeriesDates(startDate, weekdays, until) {
  if (!startDate || !until || !weekdays.length) return { dates: [], overCap: false }
  if (until < startDate) return { dates: [], overCap: false, backwards: true }
  const dates = []
  for (let cursor = startDate; cursor <= until; cursor = addOneDay(cursor)) {
    if (!weekdays.includes(weekdayOf(cursor))) continue
    dates.push(cursor)
    if (dates.length > MAX_SERIES) return { dates, overCap: true }
  }
  return { dates, overCap: false }
}

// "11am-12pm" -> "11am". The month cell has room for the start time only.
function slotStart(timeSlot) {
  if (!timeSlot) return ''
  return timeSlot.split(/[-–—]|\bto\b/i)[0].trim()
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

const STATUS_STYLE = {
  confirmed: { bg: '#dcfce7', fg: '#14532d', border: '#86efac' },
  pending: { bg: '#fef3c7', fg: '#78350f', border: '#fcd34d' },
  completed: { bg: '#e2e8f0', fg: '#334155', border: '#cbd5e1' },
  cancelled: { bg: '#fef2f2', fg: '#b91c1c', border: '#fca5a5' }
}

function statusStyle(status) {
  return STATUS_STYLE[status] || STATUS_STYLE.pending
}

const CELL_CHIP_LIMIT = 3

// Exported so staff-bookings.jsx renders the identical calendar rather than a
// second, slowly-diverging copy of this grid.
export function BookingCalendar({
  bookings,
  month,
  onMonthChange,
  selectedDate,
  onSelectDate,
  dayActions,
  showMoney = false
}) {
  const today = todayLocal()
  const byDate = {}
  for (const b of bookings) {
    // The handler already returns each day in true start-time order, so simply
    // preserving arrival order keeps 11-12 ahead of 1-2.
    ;(byDate[b.bookingDate] ||= []).push(b)
  }
  const cells = monthCells(month)
  const selected = selectedDate && monthOf(selectedDate) === month ? selectedDate : null
  const dayList = selected ? byDate[selected] || [] : []

  return (
    <div>
      <div
        className="card"
        style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button
            className="btn btn-ghost"
            style={{ padding: '4px 9px' }}
            onClick={() => onMonthChange(shiftMonth(month, -1))}
            aria-label="Previous month"
          >
            <Icon name="chevron-left" size={16} />
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ fontWeight: 500, fontSize: 15 }}>{monthTitle(month)}</div>
            {month !== monthOf(today) && (
              <button
                className="btn btn-ghost"
                style={{ padding: '3px 9px', fontSize: 11 }}
                onClick={() => {
                  onMonthChange(monthOf(today))
                  onSelectDate(today)
                }}
              >
                Today
              </button>
            )}
          </div>
          <button
            className="btn btn-ghost"
            style={{ padding: '4px 9px' }}
            onClick={() => onMonthChange(shiftMonth(month, 1))}
            aria-label="Next month"
          >
            <Icon name="chevron-right" size={16} />
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
          {WEEKDAYS.map((d) => (
            <div
              key={d.value}
              className="sub"
              style={{ textAlign: 'center', fontSize: 11, letterSpacing: '.03em' }}
            >
              {d.short}
            </div>
          ))}
          {cells.map((iso, i) => {
            if (!iso) return <div key={`blank-${i}`} />
            const dayBookings = byDate[iso] || []
            const isToday = iso === today
            const isSelected = iso === selected
            return (
              <div
                key={iso}
                // background/border live in .bk-daycell (app.css) rather than
                // here so the class's :hover rule can apply — an inline
                // style always beats a stylesheet rule, hover included.
                className={'bk-daycell' + (isSelected ? ' sel' : '')}
                onClick={() => onSelectDate(iso)}
                style={{
                  minHeight: 84,
                  padding: 5,
                  borderRadius: 8,
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 3,
                  overflow: 'hidden'
                }}
              >
                <div
                  style={{
                    fontSize: 11.5,
                    fontWeight: isToday ? 700 : 500,
                    color: isToday ? '#2563eb' : '#475569',
                    textAlign: 'right'
                  }}
                >
                  {dayNumber(iso)}
                </div>
                {dayBookings.slice(0, CELL_CHIP_LIMIT).map((b) => {
                  const s = statusStyle(b.status)
                  const off = b.status === 'cancelled'
                  return (
                    <div
                      key={b.id}
                      title={`${b.timeSlot || 'time not set'} · ${b.bookingName}${off ? ' (cancelled)' : ''}`}
                      style={{
                        fontSize: 10,
                        lineHeight: 1.25,
                        padding: '2px 4px',
                        borderRadius: 4,
                        background: s.bg,
                        color: s.fg,
                        border: (off ? '1px dashed ' : '1px solid ') + s.border,
                        // Cancelled has to be unmistakable at a glance, not a
                        // subtly different green.
                        textDecoration: off ? 'line-through' : 'none',
                        opacity: off ? 0.75 : 1,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}
                    >
                      {slotStart(b.timeSlot) && (
                        <span style={{ fontWeight: 600 }}>{slotStart(b.timeSlot)} </span>
                      )}
                      {b.bookingName}
                    </div>
                  )
                })}
                {dayBookings.length > CELL_CHIP_LIMIT && (
                  <div className="sub" style={{ fontSize: 9.5 }}>
                    +{dayBookings.length - CELL_CHIP_LIMIT} more
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', paddingTop: 2 }}>
          {['confirmed', 'pending', 'completed', 'cancelled'].map((s) => (
            <div
              key={s}
              className="sub"
              style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 3,
                  background: statusStyle(s).bg,
                  border: (s === 'cancelled' ? '1px dashed ' : '1px solid ') + statusStyle(s).border
                }}
              />
              <span style={{ textDecoration: s === 'cancelled' ? 'line-through' : 'none' }}>
                {s}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ padding: 16, marginTop: 12 }}>
        <div style={{ fontWeight: 500, marginBottom: 2 }}>
          {selected ? formatDateDisplay(selected) : 'Pick a day'}
        </div>
        <div className="sub" style={{ fontSize: 11.5, marginBottom: 10 }}>
          {!selected
            ? 'Click a date above to see who is coming and when.'
            : dayList.length === 0
              ? 'Nothing booked on this day.'
              : `${dayList.length} booking${dayList.length === 1 ? '' : 's'}, in the order they run.`}
        </div>
        {dayList.map((b, i) => {
          const s = statusStyle(b.status)
          const off = b.status === 'cancelled'
          return (
            <div
              key={b.id}
              style={{
                display: 'flex',
                gap: 12,
                padding: '10px 0',
                // A rule between slots is what makes back-to-back 11-12 and 1-2
                // read as two separate visits rather than one block of text.
                borderTop: i === 0 ? 'none' : '1px solid #eef2f7',
                opacity: off ? 0.65 : 1
              }}
            >
              <div
                style={{
                  minWidth: 96,
                  fontVariantNumeric: 'tabular-nums',
                  fontWeight: 600,
                  fontSize: 12.5,
                  color: off ? '#94a3b8' : '#0f172a',
                  textDecoration: off ? 'line-through' : 'none'
                }}
              >
                {b.timeSlot || 'Time not set'}
              </div>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontWeight: 500,
                    textDecoration: off ? 'line-through' : 'none'
                  }}
                >
                  {b.bookingName}
                </div>
                <div className="sub" style={{ color: '#64748b' }}>
                  {b.numPeople || '—'} people
                  {b.contactPerson ? ` · ${b.contactPerson}` : ''}
                  {b.contactPhone ? ` · ${b.contactPhone}` : ''}
                </div>
                {b.facilitiesBooked && (
                  <div className="sub" style={{ color: '#64748b' }}>
                    {b.facilitiesBooked}
                  </div>
                )}
                {showMoney && (b.totalExpected > 0 || b.depositPaid > 0) && (
                  <div className="sub" style={{ color: '#64748b' }}>
                    Deposit {fmt(b.depositPaid || 0)}
                    {b.totalExpected > 0 &&
                      ` of ${fmt(b.totalExpected)} · balance ${fmt((b.totalExpected || 0) - (b.depositPaid || 0))}`}
                  </div>
                )}
                {b.notes && (
                  <div className="sub" style={{ color: 'var(--text-secondary)' }}>
                    {b.notes}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <span
                  className="badge"
                  style={{
                    background: s.bg,
                    color: s.fg,
                    border: (off ? '1px dashed ' : '1px solid ') + s.border
                  }}
                >
                  {b.status}
                </span>
                {dayActions && dayActions(b)}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Owner screen
// ---------------------------------------------------------------------------

const emptyForm = {
  bookingName: '',
  contactPerson: '',
  contactPhone: '',
  bookingDate: todayLocal(),
  timeSlot: '',
  numPeople: '',
  facilitiesBooked: '',
  // Blank, not 0: money is optional and a pre-filled 0 reads as "fill this in".
  depositPaid: '',
  depositMethod: '',
  totalExpected: '',
  notes: ''
}

const emptyRepeat = { on: false, weekdays: [], until: '' }

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
  const [view, setView] = useState('calendar')
  const [tab, setTab] = useState('upcoming')
  const [month, setMonth] = useState(monthOf(todayLocal()))
  const [selectedDate, setSelectedDate] = useState(todayLocal())
  const [bookings, setBookings] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [repeat, setRepeat] = useState(emptyRepeat)
  const [error, setError] = useState('')
  const [confirmCancel, setConfirmCancel] = useState(null)
  const [confirmSave, setConfirmSave] = useState(null)

  const load = () => {
    if (view === 'calendar') {
      const { start, end } = monthRange(month)
      api.listBookings({ dateFrom: start, dateTo: end }).then((r) => setBookings(r.bookings || []))
    } else if (tab === 'upcoming') {
      api.upcomingBookings({ days: UPCOMING_DAYS }).then((r) => setBookings(r.bookings || []))
    } else {
      api.listBookings().then((r) => setBookings(r.bookings || []))
    }
  }

  useEffect(() => {
    load()
  }, [view, tab, month])

  const openNew = (date) => {
    setEditId(null)
    setForm({ ...emptyForm, bookingDate: date || selectedDate || todayLocal() })
    setRepeat(emptyRepeat)
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
      depositPaid: b.depositPaid ? String(b.depositPaid) : '',
      depositMethod: b.depositMethod || '',
      totalExpected: b.totalExpected ? String(b.totalExpected) : '',
      notes: b.notes || ''
    })
    // Occurrences are edited one at a time — a saved booking has no series.
    setRepeat(emptyRepeat)
    setError('')
    setShowForm(true)
  }

  const series = previewSeriesDates(form.bookingDate, repeat.weekdays, repeat.until)
  const repeating = !editId && repeat.on
  const seriesCount = repeating ? series.dates.length : 1
  const seriesBlocked =
    repeating &&
    (repeat.weekdays.length === 0 || !repeat.until || series.overCap || series.backwards)

  const findSlotConflicts = async () => {
    const slot = form.timeSlot?.trim()
    if (!slot) return []
    const dates = repeating ? series.dates : [form.bookingDate]
    if (!dates.length) return []
    const start = dates[0]
    const end = dates[dates.length - 1]
    const r = await api.listBookings({ dateFrom: start, dateTo: end })
    const all = r.bookings || []
    const seen = new Set()
    const conflicts = []
    for (const date of dates) {
      for (const b of all) {
        if (
          b.bookingDate === date &&
          b.timeSlot?.trim() === slot &&
          (b.status === 'pending' || b.status === 'confirmed') &&
          b.id !== editId &&
          !seen.has(b.id)
        ) {
          seen.add(b.id)
          conflicts.push(b)
        }
      }
    }
    return conflicts
  }

  const doSave = async () => {
    setConfirmSave(null)
    setError('')
    const deposit = form.depositPaid === '' ? 0 : Number(form.depositPaid)
    const payload = {
      ...form,
      numPeople: form.numPeople === '' ? null : Number(form.numPeople),
      depositPaid: deposit,
      totalExpected: form.totalExpected === '' ? 0 : Number(form.totalExpected),
      depositMethod: deposit > 0 ? form.depositMethod || 'cash' : null
    }
    const r = editId
      ? await api.updateBooking({ bookingId: editId, fields: payload })
      : await api.createBooking({
          ...payload,
          createdBy: session?.userId,
          repeat: repeating ? { weekdays: repeat.weekdays, until: repeat.until } : undefined
        })
    if (r?.success === false) {
      setError(r.error || 'Could not save booking')
      return
    }
    setShowForm(false)
    if (!editId) setMonth(monthOf(form.bookingDate))
    if (!editId) setSelectedDate(form.bookingDate)
    setRepeat(emptyRepeat)
    load()
  }

  const handleSave = async () => {
    setError('')
    const conflicts = await findSlotConflicts()
    if (conflicts.length > 0) {
      setConfirmSave(conflicts)
      return
    }
    doSave()
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

  const toggleWeekday = (value) =>
    setRepeat((r) => ({
      ...r,
      weekdays: r.weekdays.includes(value)
        ? r.weekdays.filter((d) => d !== value)
        : [...r.weekdays, value].sort((a, b) => a - b)
    }))

  const rowActions = (b) => (
    <>
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
    </>
  )

  return (
    <div className="content fade-in">
      <SectionHead title="Bookings">
        <button className="btn btn-primary" onClick={() => openNew()}>
          <Icon name="plus" size={15} /> New booking
        </button>
      </SectionHead>
      {error && (
        <div className="alert amber" style={{ marginBottom: 12 }}>
          <div className="a-desc">{error}</div>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
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
          <Icon name="list" size={15} /> List
        </button>
        {view === 'list' && (
          <>
            <div style={{ width: 1, background: '#e2e8f0', margin: '0 4px' }} />
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
          </>
        )}
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
              <label>{repeating ? 'First date' : 'Date'}</label>
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

          {!editId && (
            <div
              style={{
                border: '1px solid #e2e8f0',
                borderRadius: 8,
                padding: 12,
                marginBottom: 12
              }}
            >
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={repeat.on}
                  onChange={(e) => setRepeat({ ...emptyRepeat, on: e.target.checked })}
                />
                <span style={{ fontWeight: 500, fontSize: 13 }}>Repeats every week</span>
              </label>
              {repeat.on && (
                <div style={{ marginTop: 10 }}>
                  <div className="sub" style={{ fontSize: 11.5, marginBottom: 6 }}>
                    Which days?
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                    {WEEKDAYS.map((d) => {
                      const on = repeat.weekdays.includes(d.value)
                      return (
                        <button
                          key={d.value}
                          type="button"
                          title={d.short}
                          onClick={() => toggleWeekday(d.value)}
                          style={{
                            width: 34,
                            height: 34,
                            borderRadius: 17,
                            cursor: 'pointer',
                            fontSize: 12,
                            fontWeight: 600,
                            background: on ? '#2563eb' : '#fff',
                            color: on ? '#fff' : '#475569',
                            border: '1px solid ' + (on ? '#2563eb' : '#cbd5e1')
                          }}
                        >
                          {d.letter}
                        </button>
                      )
                    })}
                  </div>
                  <div className="field" style={{ maxWidth: 220 }}>
                    <label>Repeat until (last date)</label>
                    <input
                      className="input"
                      type="date"
                      value={repeat.until}
                      min={form.bookingDate}
                      onChange={(e) => setRepeat({ ...repeat, until: e.target.value })}
                    />
                  </div>
                  {/* Say the number out loud before the click — a mistyped end
                      date is the difference between 8 bookings and 200. */}
                  {series.overCap ? (
                    <div className="sub" style={{ color: '#b91c1c', fontSize: 11.5 }}>
                      That is more than {MAX_SERIES} bookings, which is the limit. Bring the
                      &ldquo;repeat until&rdquo; date closer.
                    </div>
                  ) : series.backwards ? (
                    <div className="sub" style={{ color: '#b91c1c', fontSize: 11.5 }}>
                      The last date is before the first date.
                    </div>
                  ) : repeat.weekdays.length === 0 ? (
                    <div className="sub" style={{ fontSize: 11.5 }}>
                      Pick at least one day of the week.
                    </div>
                  ) : !repeat.until ? (
                    <div className="sub" style={{ fontSize: 11.5 }}>
                      Choose the last date of the term.
                    </div>
                  ) : series.dates.length === 0 ? (
                    <div className="sub" style={{ color: '#b91c1c', fontSize: 11.5 }}>
                      No {repeat.weekdays.map((d) => WEEKDAYS[d].short).join(' or ')} falls in that
                      range.
                    </div>
                  ) : (
                    <div style={{ fontSize: 11.5 }}>
                      <div style={{ fontWeight: 600, marginBottom: 3 }}>
                        This will create {series.dates.length} separate bookings.
                      </div>
                      <div className="sub" style={{ marginBottom: 3 }}>
                        {series.dates.length <= 6
                          ? series.dates.map((d) => formatDateDisplay(d)).join(' · ')
                          : `${formatDateDisplay(series.dates[0])} … ${formatDateDisplay(series.dates[series.dates.length - 1])}`}
                      </div>
                      <div className="sub">
                        Each date is its own booking, so cancelling one day does not cancel the
                        rest.
                        {Number(form.depositPaid) > 0 &&
                          ' The deposit is recorded once, against the first date.'}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Total expected (Rs.) — optional</label>
              <input
                className="input"
                type="number"
                min="0"
                placeholder="Leave blank if not agreed yet"
                value={form.totalExpected}
                onChange={(e) => setForm({ ...form, totalExpected: e.target.value })}
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Deposit paid (Rs.) — optional</label>
              <input
                className="input"
                type="number"
                min="0"
                placeholder="Leave blank if none taken"
                value={form.depositPaid}
                onChange={(e) =>
                  setForm({
                    ...form,
                    depositPaid: e.target.value,
                    // Picking a method only matters once there is money.
                    depositMethod:
                      Number(e.target.value) > 0 && !form.depositMethod
                        ? 'cash'
                        : form.depositMethod
                  })
                }
              />
            </div>
            <div className="field" style={{ width: 130 }}>
              <label>Deposit by</label>
              <select
                className="input"
                value={form.depositMethod}
                disabled={!(Number(form.depositPaid) > 0)}
                onChange={(e) => setForm({ ...form, depositMethod: e.target.value })}
              >
                <option value="">—</option>
                <option value="cash">Cash</option>
                <option value="qr">QR</option>
              </select>
            </div>
          </div>
          <div className="sub" style={{ marginBottom: 10, fontSize: 11.5 }}>
            {Number(form.depositPaid) > 0 ? (
              <>
                A deposit records a booking-deposit transaction in today&apos;s takings.
                {Number(form.totalExpected) > 0 &&
                  ` Balance due on the day: ${fmt(Number(form.totalExpected) - Number(form.depositPaid))}.`}
              </>
            ) : (
              'Both money fields can stay empty — the booking saves either way.'
            )}
          </div>
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
            <button className="btn btn-primary" onClick={handleSave} disabled={seriesBlocked}>
              {editId
                ? 'Save'
                : repeating && seriesCount > 1
                  ? `Create ${seriesCount} bookings`
                  : 'Save'}
            </button>
            <button className="btn btn-ghost" onClick={() => setShowForm(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {confirmSave && (
        <div className="card" style={{ padding: 16, marginBottom: 14 }}>
          <div style={{ fontWeight: 500, marginBottom: 6 }}>Another booking already uses this time slot</div>
          <div className="sub" style={{ marginBottom: 10 }}>
            {confirmSave.map((b) => (
              <div key={b.id}>
                {b.bookingName} · {b.dateDisplay} · {b.timeSlot} ({b.status})
              </div>
            ))}
          </div>
          <div className="sub" style={{ marginBottom: 10, color: '#b45309' }}>
            You can still save — this is only a heads-up in case it is a double-booking.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" onClick={doSave}>Save anyway</button>
            <button className="btn btn-ghost" onClick={() => setConfirmSave(null)}>Go back</button>
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
          <div className="sub" style={{ marginBottom: 10, color: '#94a3b8' }}>
            This cancels {confirmCancel.dateDisplay} only. Other dates for the same group stay
            booked.
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
      {view === 'calendar' ? (
        <BookingCalendar
          bookings={bookings}
          month={month}
          onMonthChange={setMonth}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
          dayActions={rowActions}
          showMoney
        />
      ) : (
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
            <div
              key={b.id}
              className="card"
              style={{
                padding: '14px 16px',
                opacity: b.status === 'cancelled' ? 0.6 : 1,
                borderLeft: b.status === 'cancelled' ? '3px solid #fca5a5' : '3px solid transparent'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <div>
                  <div
                    style={{
                      fontWeight: 500,
                      textDecoration: b.status === 'cancelled' ? 'line-through' : 'none'
                    }}
                  >
                    {b.bookingName}
                  </div>
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
                    <div className="sub" style={{ color: 'var(--text-secondary)', marginTop: 2 }}>
                      {b.notes}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <Badge kind={b.status === 'confirmed' ? 'Active' : 'Cash'}>{b.status}</Badge>
                  {rowActions(b)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
