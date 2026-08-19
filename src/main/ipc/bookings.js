import { ipcMain } from 'electron'
import { getDb } from '../db/index.js'
import { requireOwner, requireStaffOrOwner } from '../session.js'
import { writeAudit } from '../audit.js'
import { addDays, formatShortDate, requireAmount, requireText, todayLocal } from './utils.js'

// A booking whose date is not a real YYYY-MM-DD never matches any ranged query,
// so it becomes invisible in Upcoming and in every report. Reject it at write.
function requireBookingDate(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(text))) {
    throw new Error('Booking date must be a valid date')
  }
  return text
}

function requirePartySize(value) {
  if (value === undefined || value === null || value === '') return null
  const n = Number(value)
  if (!Number.isInteger(n) || n <= 0)
    throw new Error('Number of people must be a whole number above 0')
  return n
}

// Time slots are free text the owner types ("11am-12pm", "1pm-2pm", "09:00").
// Sorting that text puts "9am" after "11am", which scrambles a day's running
// order — the one thing a day-by-day view has to get right. Parse a real start
// time so back-to-back slots read in the order they actually happen.
function parseSlotStartMinutes(slot) {
  const text = typeof slot === 'string' ? slot.trim() : ''
  if (!text) return null
  const m = text.match(/(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/i)
  if (!m) return null
  let hour = Number(m[1])
  const mins = Number(m[2] || 0)
  const suffix = (m[3] || '').toLowerCase().replace(/\./g, '')
  if (suffix.startsWith('p')) hour = hour === 12 ? 12 : hour + 12
  else if (suffix.startsWith('a')) hour = hour === 12 ? 0 : hour
  if (hour > 23 || mins > 59) return null
  return hour * 60 + mins
}

// A slot with no parseable time sorts to the end of its day rather than
// jumping to 00:00 and pretending to be the first thing that morning.
function bySchedule(a, b) {
  if (a.bookingDate !== b.bookingDate) return a.bookingDate < b.bookingDate ? -1 : 1
  if (a.startMinutes !== b.startMinutes) {
    if (a.startMinutes == null) return 1
    if (b.startMinutes == null) return -1
    return a.startMinutes - b.startMinutes
  }
  return a.id - b.id
}

// A repeating booking ("every Tuesday and Thursday until end of term") is
// stored as ordinary independent rows, one per occurrence — no schema change,
// so every existing query, report and the deposit logic keep working. The cap
// is what stops a mistyped end date from writing thousands of rows.
const MAX_SERIES_OCCURRENCES = 200

function dayOfWeek(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

export function expandSeriesDates(startDate, weekdays, untilDate) {
  const days = [...new Set((weekdays || []).map(Number))].filter(
    (n) => Number.isInteger(n) && n >= 0 && n <= 6
  )
  if (!days.length) throw new Error('Pick at least one day of the week to repeat on')
  const start = requireBookingDate(startDate)
  const until = requireBookingDate(untilDate)
  if (until < start) throw new Error('Repeat-until date must be on or after the first booking date')

  const dates = []
  for (let cursor = start; cursor <= until; cursor = addDays(cursor, 1)) {
    if (!days.includes(dayOfWeek(cursor))) continue
    dates.push(cursor)
    // Bail as soon as the cap is passed — the loop can never run away because
    // one of the chosen weekdays comes round at least once every 7 days.
    if (dates.length > MAX_SERIES_OCCURRENCES) {
      throw new Error(
        `A repeating booking can create at most ${MAX_SERIES_OCCURRENCES} bookings — shorten the date range`
      )
    }
  }
  if (!dates.length) throw new Error('That date range does not contain any of the chosen days')
  return dates
}

function wrap(handler) {
  return async (_event, payload) => {
    try {
      return await handler(payload || {})
    } catch (err) {
      return { success: false, error: err.message }
    }
  }
}

// P2-3: keep a booking's deposit in sync with a real money transaction so the
// cash it represents flows into daily revenue, reports, and the EOD total.
// Idempotent: reconciles the linked transaction against the booking's current
// deposit, creating / updating / voiding it as needed (no double-counting).
function syncDepositTransaction(db, bookingId, staffId) {
  const b = db
    .prepare(
      `SELECT booking_name, contact_person, deposit_paid, deposit_method, deposit_transaction_id
       FROM bookings WHERE id = ?`
    )
    .get(bookingId)
  if (!b) return
  const deposit = Number(b.deposit_paid) || 0
  const pay = b.deposit_method?.toLowerCase() === 'qr' ? 'qr' : 'cash'
  const customer = b.contact_person || b.booking_name

  // A linked deposit transaction that has since been REFUNDED, or voided by the
  // owner for cause (void_by set), must never be silently reinstated or
  // overwritten by a booking edit — that would resurrect reversed money into
  // the totals with no offsetting entry. A void done by this sync itself when
  // the deposit was zeroed (void_by IS NULL) stays resurrectable, so the
  // legitimate zero-then-re-add flow keeps working.
  if (b.deposit_transaction_id) {
    const linked = db
      .prepare(
        `SELECT is_voided, void_by,
                (SELECT 1 FROM transactions r WHERE r.refunds_transaction_id = transactions.id AND r.is_voided = 0 LIMIT 1) as refunded
         FROM transactions WHERE id = ?`
      )
      .get(b.deposit_transaction_id)
    if (linked && (linked.refunded || (linked.is_voided && linked.void_by != null))) return
  }

  if (deposit > 0) {
    if (b.deposit_transaction_id) {
      db.prepare(
        `UPDATE transactions SET amount = ?, payment_method = ?, customer_name = ?, is_voided = 0 WHERE id = ?`
      ).run(deposit, pay, customer, b.deposit_transaction_id)
    } else {
      const txn = db
        .prepare(
          `INSERT INTO transactions
           (transaction_type, source, customer_name, amount, payment_method, staff_id, notes)
           VALUES ('booking_deposit', 'pool', ?, ?, ?, ?, ?)`
        )
        .run(customer, deposit, pay, staffId, `Booking deposit: ${b.booking_name}`)
      db.prepare(`UPDATE bookings SET deposit_transaction_id = ? WHERE id = ?`).run(
        txn.lastInsertRowid,
        bookingId
      )
    }
  } else if (b.deposit_transaction_id) {
    // Deposit removed/zeroed — drop it out of the totals without deleting history.
    db.prepare(`UPDATE transactions SET is_voided = 1 WHERE id = ?`).run(b.deposit_transaction_id)
  }
}

function mapBooking(row) {
  return {
    id: row.id,
    bookingName: row.booking_name,
    contactPerson: row.contact_person,
    contactPhone: row.contact_phone,
    bookingDate: row.booking_date,
    dateDisplay: formatShortDate(row.booking_date),
    timeSlot: row.time_slot,
    startMinutes: parseSlotStartMinutes(row.time_slot),
    numPeople: row.num_people,
    facilitiesBooked: row.facilities_booked,
    status: row.status,
    depositPaid: row.deposit_paid,
    depositMethod: row.deposit_method,
    totalExpected: row.total_expected,
    notes: row.notes,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function registerBookingHandlers() {
  ipcMain.handle(
    'bookings:list',
    wrap(({ status, dateFrom, dateTo } = {}) => {
      requireStaffOrOwner()
      let sql = `
        SELECT b.*, u.name as created_by_name
        FROM bookings b
        LEFT JOIN users u ON u.id = b.created_by
        WHERE 1=1
      `
      const params = []
      if (status) {
        sql += ' AND b.status = ?'
        params.push(status)
      }
      if (dateFrom) {
        sql += ' AND b.booking_date >= ?'
        params.push(dateFrom)
      }
      if (dateTo) {
        sql += ' AND b.booking_date <= ?'
        params.push(dateTo)
      }
      sql += ' ORDER BY b.booking_date, b.time_slot, b.id'
      // dateFrom/dateTo is what the calendar's month view asks for. Final order
      // is settled in JS because SQLite can only sort time_slot as text.
      const bookings = getDb()
        .prepare(sql)
        .all(...params)
        .map(mapBooking)
        .sort(bySchedule)
      return { bookings }
    })
  )

  ipcMain.handle(
    'bookings:upcoming',
    wrap(({ days = 14 } = {}) => {
      requireStaffOrOwner()
      const today = todayLocal()
      const end = addDays(today, days)
      const bookings = getDb()
        .prepare(
          `SELECT b.*, u.name as created_by_name
           FROM bookings b
           LEFT JOIN users u ON u.id = b.created_by
           WHERE b.booking_date >= ? AND b.booking_date <= ?
             AND b.status NOT IN ('cancelled', 'completed')
           ORDER BY b.booking_date, b.time_slot`
        )
        .all(today, end)
        .map(mapBooking)
        .sort(bySchedule)
      return { bookings }
    })
  )

  ipcMain.handle(
    'bookings:create',
    wrap(
      ({
        bookingName,
        contactPerson,
        contactPhone,
        bookingDate,
        timeSlot,
        numPeople,
        facilitiesBooked,
        depositPaid,
        depositMethod,
        totalExpected,
        notes,
        createdBy,
        repeat
      }) => {
        const session = requireOwner()
        const name = requireText(bookingName, 'Booking name')
        const date = requireBookingDate(bookingDate)
        const people = requirePartySize(numPeople)
        // Fallback 0 on both: deposit and total are genuinely optional, so a
        // blank field must save rather than being rejected as "required".
        const deposit = requireAmount(depositPaid, 'Deposit', 0)
        const expected = requireAmount(totalExpected, 'Total expected', 0)

        // "Every Tuesday and Thursday until end of term" becomes one ordinary
        // booking row per date. Dates are resolved before the write so a bad
        // range or an over-cap series fails without touching the database.
        const dates =
          repeat && repeat.weekdays
            ? expandSeriesDates(date, repeat.weekdays, repeat.until)
            : [date]

        const db = getDb()
        const insert = db.prepare(
          `INSERT INTO bookings
           (booking_name, contact_person, contact_phone, booking_date, time_slot, num_people,
            facilities_booked, deposit_paid, deposit_method, total_expected, notes, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        // One transaction around the whole series: a school gets all of its
        // dates or none of them, never half a term of bookings.
        const bookingIds = db.transaction(() => {
          const ids = []
          for (const occurrence of dates) {
            // A deposit is paid once for the whole arrangement. Copying it onto
            // every occurrence would book the same money N times over, so only
            // the first date carries it (and its deposit transaction).
            const first = ids.length === 0
            const result = insert.run(
              name,
              contactPerson || null,
              contactPhone || null,
              occurrence,
              timeSlot || null,
              people,
              facilitiesBooked || null,
              first ? deposit : 0,
              first ? depositMethod || null : null,
              expected,
              notes || null,
              createdBy || session.userId
            )
            const id = result.lastInsertRowid
            syncDepositTransaction(db, id, session.userId)
            ids.push(id)
          }
          return ids
        })()
        return {
          success: true,
          bookingId: bookingIds[0],
          bookingIds,
          dates,
          count: bookingIds.length
        }
      }
    )
  )

  ipcMain.handle(
    'bookings:update',
    wrap(({ bookingId, fields }) => {
      const session = requireOwner()
      const allowed = [
        'booking_name',
        'contact_person',
        'contact_phone',
        'booking_date',
        'time_slot',
        'num_people',
        'facilities_booked',
        'deposit_paid',
        'deposit_method',
        'total_expected',
        'notes',
        'status'
      ]
      const sets = []
      const vals = []
      for (const [k, v] of Object.entries(fields || {})) {
        const col = k.replace(/([A-Z])/g, '_$1').toLowerCase()
        if (!allowed.includes(col)) continue
        // The allow-list only ever guarded column NAMES; values went through
        // untouched, so a negative deposit or a garbage date could be written.
        let value = v
        if (col === 'deposit_paid') value = requireAmount(v, 'Deposit', 0)
        else if (col === 'total_expected') value = requireAmount(v, 'Total expected', 0)
        else if (col === 'num_people') value = requirePartySize(v)
        else if (col === 'booking_date') value = requireBookingDate(v)
        else if (col === 'booking_name') value = requireText(v, 'Booking name')
        sets.push(`${col} = ?`)
        vals.push(value)
      }
      if (!sets.length) return { success: true }
      sets.push(`updated_at = datetime('now','localtime')`)
      vals.push(bookingId)
      const db = getDb()
      db.transaction(() => {
        const res = db.prepare(`UPDATE bookings SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
        if (res.changes === 0) throw new Error('Booking not found')
        // P2-3: reconcile the linked deposit transaction with the new state.
        syncDepositTransaction(db, bookingId, session.userId)
      })()
      return { success: true }
    })
  )

  ipcMain.handle(
    'bookings:update-status',
    wrap(({ bookingId, status }) => {
      const session = requireStaffOrOwner()
      const allowed = ['pending', 'confirmed', 'completed', 'cancelled']
      if (!allowed.includes(status)) throw new Error('Invalid status')
      const db = getDb()
      const booking = db
        .prepare(`SELECT deposit_paid, deposit_transaction_id FROM bookings WHERE id = ?`)
        .get(bookingId)
      if (!booking) throw new Error('Booking not found')

      db.prepare(
        `UPDATE bookings SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?`
      ).run(status, bookingId)
      // Staff-reachable state change with reporting impact — keep it traceable.
      writeAudit(session.userId, 'booking:status', { bookingId, status })

      // Cancelling does NOT touch the deposit: a forfeited deposit is normal
      // and reversing it automatically would destroy real revenue. But the
      // money must not go unmentioned — hand it back so the caller can ask.
      const outstandingDeposit =
        status === 'cancelled' && booking.deposit_transaction_id ? booking.deposit_paid || 0 : 0
      return { success: true, outstandingDeposit }
    })
  )
}
