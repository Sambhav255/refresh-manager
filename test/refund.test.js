import { describe, it, expect, beforeEach } from 'vitest'
import { __invoke } from 'electron'
import { freshDb, seed, loginStaff, loginOwner } from './helpers.js'

let db
let ids

beforeEach(() => {
  db = freshDb()
  ids = seed(db)
})

async function sellPoolItem(qty) {
  loginStaff(ids)
  const res = await __invoke('pool-inventory:sell-item', {
    itemId: ids.poolItemId,
    quantity: qty,
    paymentMethod: 'cash'
  })
  loginOwner(ids)
  return res
}

function stock() {
  return db.prepare('SELECT current_stock FROM pool_inventory_items WHERE id = ?').get(ids.poolItemId)
    .current_stock
}

describe('3-C — refunds', () => {
  it('full refund reverses money and restores stock atomically', async () => {
    const sale = await sellPoolItem(3) // amount 600, stock 10 -> 7
    expect(stock()).toBe(7)

    const res = await __invoke('transactions:refund', {
      transactionId: sale.transactionId,
      reason: 'returned'
    })
    expect(res.success).toBe(true)
    expect(res.full).toBe(true)
    expect(res.refundAmount).toBe(600)

    const refund = db.prepare('SELECT * FROM transactions WHERE id = ?').get(res.refundTransactionId)
    expect(refund.transaction_type).toBe('refund')
    expect(refund.amount).toBe(-600)
    expect(refund.refunds_transaction_id).toBe(sale.transactionId)
    expect(stock()).toBe(10) // stock restored
  })

  it('supports partial refunds that add up to the original, restoring stock only when complete', async () => {
    const sale = await sellPoolItem(2) // amount 400, stock -> 8
    expect(stock()).toBe(8)

    const first = await __invoke('transactions:refund', {
      transactionId: sale.transactionId,
      amount: 100
    })
    expect(first.success).toBe(true)
    expect(first.full).toBe(false)
    expect(first.remaining).toBe(300)
    expect(stock()).toBe(8) // partial refund does not restore stock

    // Refunding the remainder (amount omitted ⇒ full remaining) completes it.
    const second = await __invoke('transactions:refund', { transactionId: sale.transactionId })
    expect(second.success).toBe(true)
    expect(second.full).toBe(true)
    expect(second.remaining).toBe(0)
    expect(stock()).toBe(10) // now fully refunded ⇒ stock restored
  })

  it('rejects over-refunding and refunding a voided sale', async () => {
    const sale = await sellPoolItem(1) // amount 200
    const over = await __invoke('transactions:refund', {
      transactionId: sale.transactionId,
      amount: 999
    })
    expect(over.success).toBe(false)
    expect(over.error).toMatch(/exceeds/i)

    await __invoke('transactions:void', { transactionId: sale.transactionId, reason: 'x' })
    const afterVoid = await __invoke('transactions:refund', { transactionId: sale.transactionId })
    expect(afterVoid.success).toBe(false)
    expect(afterVoid.error).toMatch(/voided/i)
  })
})
