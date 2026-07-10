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
