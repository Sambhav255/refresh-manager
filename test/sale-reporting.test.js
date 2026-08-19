// The sale model lets one sale hold several kinds of thing and be settled with
// more than one method, but `transactions` still carries a single
// transaction_type and payment_method for backward compatibility. Reporting
// therefore reads LINES and PAYMENTS, not those header columns.
//
// Both cases below were measured wrong before the fix: a mixed cart booked the
// goggles as entry revenue, and a split payment reported the whole sale as cash
// — which would have left the End-of-Day drawer count short on every split.
import { describe, it, expect, beforeEach } from 'vitest'
import { __invoke } from 'electron'
import { freshDb, seed, loginStaff, loginOwner } from './helpers.js'
import { registerSalesHandlers } from '../src/main/ipc/sales.js'
import { registerPricingHandlers } from '../src/main/ipc/pricing.js'

let db
let ids

beforeEach(() => {
  db = freshDb()
  ids = seed(db)
  registerPricingHandlers()
  registerSalesHandlers()
})

describe('sale reporting — breakdown comes from lines', () => {
  it('a mixed cart reports each kind under its own type', async () => {
    loginStaff(ids)
    const r = await __invoke('sales:create', {
      customerName: 'W',
      cart: [
        { kind: 'product', refId: ids.dayPassId, quantity: 1 },
        { kind: 'pool_item', refId: ids.poolItemId, quantity: 1 }
      ],
      paymentMethod: 'cash'
    })
    expect(r.success).toBe(true)

    const s = await __invoke('transactions:today-summary', {})
    expect(s.byType.day_pass).toBe(300)
    expect(s.byType.pool_inventory).toBe(200)
    expect(s.total).toBe(500)
    // The invariant the End of Day screen depends on.
    expect(Object.values(s.byType).reduce((a, b) => a + b, 0)).toBe(s.total)
  })

  it('quantity is reflected per kind, not collapsed into the header type', async () => {
    loginStaff(ids)
    await __invoke('sales:create', {
      customerName: 'W',
      cart: [
        { kind: 'product', refId: ids.dayPassId, quantity: 3 },
        { kind: 'pool_item', refId: ids.poolItemId, quantity: 2 }
      ],
      paymentMethod: 'cash'
    })
    const s = await __invoke('transactions:today-summary', {})
    expect(s.byType.day_pass).toBe(900)
    expect(s.byType.pool_inventory).toBe(400)
    expect(Object.values(s.byType).reduce((a, b) => a + b, 0)).toBe(s.total)
  })
})

describe('sale reporting — cash/QR comes from payments', () => {
  it('a split payment is not reported as one method', async () => {
    loginStaff(ids)
    await __invoke('sales:create', {
      customerName: 'W',
      cart: [{ kind: 'pool_item', refId: ids.poolItemId, quantity: 1 }],
      payments: [
        { amount: 100, method: 'cash' },
        { amount: 100, method: 'qr' }
      ]
    })
    const s = await __invoke('transactions:today-summary', {})
    expect(s.cash).toBe(100)
    expect(s.qr).toBe(100)
    expect(s.cash + s.qr).toBe(s.total)
  })

  it('an unpaid (on-account) sale contributes no cash and no QR', async () => {
    loginStaff(ids)
    await __invoke('sales:create', {
      customerName: 'Owes us',
      cart: [{ kind: 'pool_item', refId: ids.poolItemId, quantity: 1 }],
      payments: []
    })
    const s = await __invoke('transactions:today-summary', {})
    expect(s.cash).toBe(0)
    expect(s.qr).toBe(0)
    // The sale is still revenue; only the collection is outstanding.
    expect(s.total).toBe(200)
  })

  it('a later payment against that sale shows up in the cash count', async () => {
    loginStaff(ids)
    const sale = await __invoke('sales:create', {
      customerName: 'Owes us',
      cart: [{ kind: 'pool_item', refId: ids.poolItemId, quantity: 1 }],
      payments: []
    })
    await __invoke('sales:add-payment', { saleId: sale.saleId, amount: 200, method: 'cash' })
    const s = await __invoke('transactions:today-summary', {})
    expect(s.cash).toBe(200)
  })
})

describe('sale reporting — legacy rows keep reporting', () => {
  it('a refund still nets out of the totals', async () => {
    loginStaff(ids)
    await __invoke('transactions:create', {
      type: 'day_pass',
      productId: ids.dayPassId,
      customerName: 'A',
      paymentMethod: 'cash'
    })
    loginOwner(ids)
    const sale = db
      .prepare(`SELECT id, amount FROM transactions WHERE transaction_type = 'day_pass'`)
      .get()
    await __invoke('transactions:refund', {
      transactionId: sale.id,
      amount: sale.amount,
      reason: 'left immediately'
    })
    const s = await __invoke('transactions:today-summary', {})
    // A refund carries no line and no payment row, so it must fall back to its
    // header — otherwise reversed money would vanish from the day and the
    // total would read as though the sale still stood.
    expect(s.total).toBe(0)
    expect(s.cash).toBe(0)
    expect(Object.values(s.byType).reduce((a, b) => a + b, 0)).toBe(0)
  })

  it('a voided sale is excluded from every figure', async () => {
    loginStaff(ids)
    await __invoke('sales:create', {
      customerName: 'W',
      cart: [{ kind: 'pool_item', refId: ids.poolItemId, quantity: 1 }],
      paymentMethod: 'cash'
    })
    loginOwner(ids)
    const sale = db.prepare(`SELECT id FROM transactions`).get()
    await __invoke('transactions:void', { transactionId: sale.id, reason: 'mis-rung' })
    const s = await __invoke('transactions:today-summary', {})
    expect(s.total).toBe(0)
    expect(s.cash).toBe(0)
    expect(s.byType.pool_inventory ?? 0).toBe(0)
  })
})
