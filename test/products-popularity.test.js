import { describe, it, expect, beforeEach } from 'vitest'
import { __invoke } from 'electron'
import { registerProductHandlers } from '../src/main/ipc/products.js'
import { freshDb, seed, loginStaff, loginOwner } from './helpers.js'

// helpers.js registerAll() does not wire the product handlers; the mock's
// ipcMain.handle overwrites, so registering here once is safe across tests.
registerProductHandlers()

let db
let ids

beforeEach(() => {
  db = freshDb()
  ids = seed(db)
})

// Insert a sale directly so created_at / is_voided can be controlled.
function insertSale(productId, { daysAgo = 0, isVoided = 0 } = {}) {
  return db
    .prepare(
      `INSERT INTO transactions
       (transaction_type, source, customer_name, product_id, amount, payment_method, staff_id, is_voided, created_at)
       VALUES ('day_pass', 'pool', 'Test', ?, 300, 'cash', ?, ?, datetime('now','localtime', ?))`
    )
    .run(productId, ids.staffId, isVoided, `-${daysAgo} days`).lastInsertRowid
}

describe('products:popularity', () => {
  it('returns per-product sales counts ordered by count descending', async () => {
    loginStaff(ids)
    insertSale(ids.dayPassId)
    insertSale(ids.dayPassId)
    insertSale(ids.dayPassId)
    insertSale(ids.memProdId)

    const res = await __invoke('products:popularity')
    expect(res.success).toBe(true)
    expect(res.counts).toEqual([
      { productId: ids.dayPassId, count: 3 },
      { productId: ids.memProdId, count: 1 }
    ])
  })

  it('only counts sales inside the 60-day window', async () => {
    loginStaff(ids)
    insertSale(ids.dayPassId, { daysAgo: 59 }) // inside window
    insertSale(ids.dayPassId, { daysAgo: 61 }) // outside window
    insertSale(ids.memProdId, { daysAgo: 200 }) // way outside — drops out entirely

    const res = await __invoke('products:popularity')
    expect(res.success).toBe(true)
    expect(res.counts).toEqual([{ productId: ids.dayPassId, count: 1 }])
  })

  it('excludes voided transactions', async () => {
    loginStaff(ids)
    insertSale(ids.dayPassId)
    insertSale(ids.dayPassId, { isVoided: 1 })
    insertSale(ids.memProdId, { isVoided: 1 })

    const res = await __invoke('products:popularity')
    expect(res.success).toBe(true)
    expect(res.counts).toEqual([{ productId: ids.dayPassId, count: 1 }])
  })

  it('excludes refund rows and sales that have been refunded', async () => {
    loginStaff(ids)
    insertSale(ids.dayPassId)
    const refundedId = insertSale(ids.dayPassId)

    loginOwner(ids)
    const refund = await __invoke('transactions:refund', {
      transactionId: refundedId,
      reason: 'test'
    })
    expect(refund.success).toBe(true)

    const res = await __invoke('products:popularity')
    expect(res.success).toBe(true)
    // Only the un-refunded sale counts: the refund row itself is skipped and
    // the refunded original is skipped too.
    expect(res.counts).toEqual([{ productId: ids.dayPassId, count: 1 }])
  })

  it('rejects unauthenticated callers', async () => {
    const res = await __invoke('products:popularity')
    expect(res.success).toBe(false)
  })
})
