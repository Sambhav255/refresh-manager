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
      sql += ' ORDER BY b.booking_date, b.time_slot'
      const bookings = getDb()
        .prepare(sql)
        .all(...params)
        .map(mapBooking)
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
        createdBy
      }) => {
        const session = requireOwner()
        const name = requireText(bookingName, 'Booking name')
        const date = requireBookingDate(bookingDate)
        const people = requirePartySize(numPeople)
        const deposit = requireAmount(depositPaid, 'Deposit', 0)
        const expected = requireAmount(totalExpected, 'Total expected', 0)
        const db = getDb()
        const bookingId = db.transaction(() => {
          const result = db
            .prepare(
              `INSERT INTO bookings
               (booking_name, contact_person, contact_phone, booking_date, time_slot, num_people,
                facilities_booked, deposit_paid, deposit_method, total_expected, notes, created_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              name,
              contactPerson || null,
              contactPhone || null,
              date,
              timeSlot || null,
              people,
              facilitiesBooked || null,
              deposit,
              depositMethod || null,
              expected,
              notes || null,
              createdBy || session.userId
            )
          const id = result.lastInsertRowid
          syncDepositTransaction(db, id, session.userId)
          return id
        })()
        return { success: true, bookingId }
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
