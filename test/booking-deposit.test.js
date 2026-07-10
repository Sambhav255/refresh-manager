import { describe, it, expect, beforeEach } from 'vitest'
import { __invoke } from 'electron'
import { freshDb, seed, loginOwner } from './helpers.js'

let db
let ids

beforeEach(() => {
  db = freshDb()
  ids = seed(db)
  loginOwner(ids)
})

function depositTxns() {
  return db
    .prepare(`SELECT * FROM transactions WHERE transaction_type = 'booking_deposit' ORDER BY id`)
    .all()
}

describe('P2-3 / 5-A — booking deposit transaction stays in sync (idempotent)', () => {
  it('create → change → zero keeps a single linked transaction, no double-counting', async () => {
    // Create with a deposit.
    const created = await __invoke('bookings:create', {
      bookingName: 'Party',
      bookingDate: '2026-03-01',
      depositPaid: 500,
      depositMethod: 'cash'
    })
    expect(created.success).toBe(true)
    let txns = depositTxns().filter((t) => !t.is_voided)
    expect(txns.length).toBe(1)
    expect(txns[0].amount).toBe(500)

    // Change the deposit — same transaction is updated, not duplicated.
    await __invoke('bookings:update', {
      bookingId: created.bookingId,
      fields: { depositPaid: 800, depositMethod: 'qr' }
    })
    txns = depositTxns().filter((t) => !t.is_voided)
    expect(txns.length).toBe(1)
    expect(txns[0].amount).toBe(800)
    expect(txns[0].payment_method).toBe('qr')

    // Zero the deposit — the transaction is voided (dropped from totals), history kept.
    await __invoke('bookings:update', {
      bookingId: created.bookingId,
      fields: { depositPaid: 0 }
    })
    const active = depositTxns().filter((t) => !t.is_voided)
    expect(active.length).toBe(0)
    expect(depositTxns().length).toBe(1) // row still exists, just voided

    // Legitimate zero → re-add still works (sync-void is resurrectable).
    await __invoke('bookings:update', {
      bookingId: created.bookingId,
      fields: { depositPaid: 300 }
    })
    const back = depositTxns().filter((t) => !t.is_voided)
    expect(back.length).toBe(1)
    expect(back[0].amount).toBe(300)
  })

  it('a refunded deposit is never resurrected by a booking edit', async () => {
    const created = await __invoke('bookings:create', {
      bookingName: 'Refunded Party',
      bookingDate: '2026-04-01',
      depositPaid: 2000,
      depositMethod: 'cash'
    })
    const txn = depositTxns().find((t) => t.customer_name === 'Refunded Party')
    await __invoke('transactions:refund', { transactionId: txn.id, reason: 'cancelled plans' })

    // Editing unrelated booking fields must not reinstate/overwrite the txn.
    await __invoke('bookings:update', {
      bookingId: created.bookingId,
      fields: { contactPhone: '9800000009' }
    })
    const after = db.prepare('SELECT * FROM transactions WHERE id = ?').get(txn.id)
    expect(after.amount).toBe(2000) // unchanged, not re-synced
    // Net revenue for this booking stays zero (sale + refund).
    const net = db
      .prepare(
        `SELECT COALESCE(SUM(amount),0) s FROM transactions
         WHERE is_voided = 0 AND (id = ? OR refunds_transaction_id = ?)`
      )
      .get(txn.id, txn.id).s
    expect(net).toBe(0)
  })
})
