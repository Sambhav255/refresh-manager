import { ipcMain } from 'electron'
import { getDb } from '../db/index.js'
import { requireOwner, requireStaffOrOwner } from '../session.js'
import { addDays, formatShortDate, todayLocal } from './utils.js'

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
        if (!bookingName || !bookingDate) throw new Error('Booking name and date are required')
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
              bookingName,
              contactPerson || null,
              contactPhone || null,
              bookingDate,
              timeSlot || null,
              numPeople ?? null,
              facilitiesBooked || null,
              depositPaid ?? 0,
              depositMethod || null,
              totalExpected ?? 0,
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
        if (allowed.includes(col)) {
          sets.push(`${col} = ?`)
          vals.push(v)
        }
      }
      if (!sets.length) return { success: true }
      sets.push(`updated_at = datetime('now','localtime')`)
      vals.push(bookingId)
      const db = getDb()
      db.transaction(() => {
        db.prepare(`UPDATE bookings SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
        // P2-3: reconcile the linked deposit transaction with the new state.
        syncDepositTransaction(db, bookingId, session.userId)
      })()
      return { success: true }
    })
  )

  ipcMain.handle(
    'bookings:update-status',
    wrap(({ bookingId, status }) => {
      requireStaffOrOwner()
      const allowed = ['pending', 'confirmed', 'completed', 'cancelled']
      if (!allowed.includes(status)) throw new Error('Invalid status')
      getDb()
        .prepare(
          `UPDATE bookings SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?`
        )
        .run(status, bookingId)
      return { success: true }
    })
  )
}
