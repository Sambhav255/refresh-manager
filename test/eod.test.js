import { describe, it, expect, beforeEach } from 'vitest'
import { generateEODMessage } from '../src/main/ipc/whatsapp.js'
import { freshDb, seed } from './helpers.js'

let db
let ids

beforeEach(() => {
  db = freshDb()
  ids = seed(db)
})

const DAY = '2026-06-20'

function sale(type, amount, pay = 'cash') {
  db.prepare(
    `INSERT INTO transactions (transaction_type, source, customer_name, amount, payment_method, staff_id, created_at)
     VALUES (?, 'pool', 'C', ?, ?, ?, ?)`
  ).run(type, amount, pay, ids.staffId, `${DAY} 10:00:00`)
}

// Sum the "Rs. N" amounts from the itemised breakdown lines (each starts "  • ").
function sumBreakdownLines(message) {
  return message
    .split('\n')
    .filter((l) => l.trimStart().startsWith('•') && /Rs\. /.test(l))
    .map((l) => Number(l.split('Rs. ')[1]))
    .reduce((a, b) => a + b, 0)
}

describe('2-H — EOD breakdown reconciles across all transaction types', () => {
  it('itemised lines sum exactly to the printed Total on a mixed day', () => {
    sale('membership', 1000)
    sale('restaurant', 250, 'qr')
    sale('pool_inventory', 600)
    sale('booking_deposit', 500, 'qr')

    const msg = generateEODMessage(DAY)
    const total = Number(msg.match(/Total: Rs\. (\d+)/)[1])
    expect(total).toBe(2350)

    // Every type is a named line (not folded into "Other").
    expect(msg).toContain('Pool Items:')
    expect(msg).toContain('Booking Deposits:')
    expect(msg).not.toContain('Other:')

    // The breakdown lines (excluding the Cash/QR sub-lines under REVENUE) sum
    // to the total. Cash+QR also equals total, so strip the REVENUE block first.
    const txnBlock = msg.split('TRANSACTIONS')[1]
    expect(sumBreakdownLines('TRANSACTIONS' + txnBlock)).toBe(2350)
  })

  it('voided transactions are excluded from the total', () => {
    sale('membership', 1000)
    db.prepare(`UPDATE transactions SET is_voided = 1 WHERE amount = 1000`).run()
    sale('restaurant', 250)
    const msg = generateEODMessage(DAY)
    expect(Number(msg.match(/Total: Rs\. (\d+)/)[1])).toBe(250)
  })
})

describe('H-41 — richer WhatsApp EOD message', () => {
  it('always shows footfall today (check-ins plus day-pass attendees)', () => {
    db.prepare(
      `INSERT INTO check_ins (member_id, checked_in_at, source) VALUES (NULL, ?, 'walk-in')`
    ).run(`${DAY} 09:00:00`)

    const txn = db
      .prepare(
        `INSERT INTO transactions (transaction_type, source, customer_name, amount, payment_method, staff_id, created_at)
         VALUES ('day_pass','pool','Walk-in',300,'cash',?,?)`
      )
      .run(ids.staffId, `${DAY} 09:30:00`)
    db.prepare(
      `INSERT INTO transaction_lines (transaction_id, kind, ref_id, description, quantity, unit_price, line_total)
       VALUES (?, 'product', ?, 'Day Pass', 2, 300, 600)`
    ).run(txn.lastInsertRowid, ids.dayPassId)

    const msg = generateEODMessage(DAY)
    // 1 check-in + 2 day-pass attendees on the one sale.
    expect(msg).toContain('👥 Footfall today: 3')
  })

  it('shows a non-zero void count with its Rs. total, omits the line at zero', () => {
    sale('membership', 1000)
    const withVoid = generateEODMessage(DAY)
    expect(withVoid).not.toContain('Voids today')

    db.prepare(`UPDATE transactions SET is_voided = 1, void_at = ? WHERE amount = 1000`).run(
      `${DAY} 11:00:00`
    )
    const afterVoid = generateEODMessage(DAY)
    expect(afterVoid).toContain('🚫 Voids today: 1 (Rs. 1000)')
  })

  it('lists items at or below reorder level across pool and restaurant, omits the line when none are low', () => {
    const noneLow = generateEODMessage(DAY)
    expect(noneLow).not.toContain('Low stock')

    db.prepare(`UPDATE pool_inventory_items SET current_stock = 0 WHERE id = ?`).run(ids.poolItemId)
    db.prepare(`UPDATE restaurant_inventory_items SET current_stock = 1 WHERE id = ?`).run(
      ids.rInvId
    )
    const withLow = generateEODMessage(DAY)
    expect(withLow).toContain('📦 Low stock: Goggles, Tea leaves')
  })

  it("shows tomorrow's confirmed/pending booking count, omits the line at zero", () => {
    const noBookings = generateEODMessage(DAY)
    expect(noBookings).not.toContain("Tomorrow's bookings")

    db.prepare(
      `INSERT INTO bookings (booking_name, booking_date, status) VALUES ('Party', ?, 'confirmed')`
    ).run('2026-06-21')
    db.prepare(
      `INSERT INTO bookings (booking_name, booking_date, status) VALUES ('Cancelled one', ?, 'cancelled')`
    ).run('2026-06-21')
    const withBooking = generateEODMessage(DAY)
    expect(withBooking).toContain("📅 Tomorrow's bookings: 1")
  })

  it('counts active memberships ending within 7 days, omits the line at zero', () => {
    const member = db.prepare(`INSERT INTO members (name) VALUES ('Expiring Soon')`).run()
    const noneExpiring = generateEODMessage(DAY)
    expect(noneExpiring).not.toContain('Memberships expiring')

    db.prepare(
      `INSERT INTO memberships (member_id, product_id, start_date, end_date, status)
       VALUES (?, ?, '2026-05-20', '2026-06-25', 'active')`
    ).run(member.lastInsertRowid, ids.memProdId)
    const withExpiring = generateEODMessage(DAY)
    expect(withExpiring).toContain('⏰ Memberships expiring in 7 days: 1')
  })

  it('places the new sections after TRANSACTIONS and before cash reconciliation', () => {
    sale('membership', 1000)
    db.prepare(
      `INSERT INTO cash_reconciliations (reconcile_date, system_cash, physical_cash, opening_float, discrepancy, staff_id)
       VALUES (?, 1000, 1000, 0, 0, ?)`
    ).run(DAY, ids.staffId)
    const msg = generateEODMessage(DAY)
    const footfallIdx = msg.indexOf('👥 Footfall today')
    const transactionsIdx = msg.indexOf('📋 TRANSACTIONS')
    const reconIdx = msg.indexOf('⚖️ Cash reconciliation')
    expect(transactionsIdx).toBeGreaterThan(-1)
    expect(footfallIdx).toBeGreaterThan(transactionsIdx)
    expect(reconIdx).toBeGreaterThan(footfallIdx)
  })
})
