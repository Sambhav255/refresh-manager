import { describe, it, expect, beforeEach } from 'vitest'
import { __invoke } from 'electron'
import { freshDb, seed, loginOwner, loginStaff } from './helpers.js'
import { registerDashboardHandlers } from '../src/main/ipc/dashboard.js'
import { registerSalesHandlers } from '../src/main/ipc/sales.js'
import { registerPricingHandlers } from '../src/main/ipc/pricing.js'
import { registerBookingHandlers } from '../src/main/ipc/bookings.js'
import { todayLocal, addDays } from '../src/main/ipc/utils.js'

let db
let ids

beforeEach(() => {
  db = freshDb()
  ids = seed(db)
  registerPricingHandlers()
  registerSalesHandlers()
  registerBookingHandlers()
  registerDashboardHandlers()
})

describe('dashboard:summary', () => {
  it('aggregates paid, unpaid, dues, discounts, trends, stock and booking deposits', async () => {
    const today = todayLocal()
    const priorDay = addDays(today, -10)

    db.prepare(`UPDATE pool_inventory_items SET selling_price = 100 WHERE id = ?`).run(
      ids.poolItemId
    )
    db.prepare(`UPDATE restaurant_inventory_items SET unit_cost = 50 WHERE id = ?`).run(ids.rInvId)

    loginStaff(ids)

    const paid = await __invoke('sales:create', {
      customerName: 'Paid',
      cart: [{ kind: 'pool_item', refId: ids.poolItemId, quantity: 1 }],
      payments: [
        { amount: 50, method: 'cash' },
        { amount: 50, method: 'qr' }
      ]
    })
    expect(paid.success).toBe(true)

    const discounted = await __invoke('sales:create', {
      customerName: 'Discount',
      cart: [
        {
          kind: 'product',
          refId: ids.dayPassId,
          quantity: 1,
          discount: 50,
          discountReason: 'Staff friend'
        }
      ],
      paymentMethod: 'cash'
    })
    expect(discounted.success).toBe(true)

    const part = await __invoke('sales:create', {
      customerName: 'Part',
      cart: [{ kind: 'pool_item', refId: ids.poolItemId, quantity: 1 }],
      payments: [{ amount: 80, method: 'cash' }]
    })
    expect(part.success).toBe(true)

    const oldSale = await __invoke('sales:create', {
      customerName: 'Old week',
      cart: [{ kind: 'product', refId: ids.dayPassId, quantity: 1 }],
      paymentMethod: 'cash'
    })
    expect(oldSale.success).toBe(true)
    db.prepare(`UPDATE transactions SET created_at = ? WHERE id = ?`).run(
      `${priorDay} 12:00:00`,
      oldSale.saleId
    )
    db.prepare(`UPDATE transaction_payments SET paid_at = ? WHERE transaction_id = ?`).run(
      `${priorDay} 12:00:00`,
      oldSale.saleId
    )

    loginOwner(ids)
    await __invoke('bookings:create', {
      bookingName: 'Party',
      bookingDate: addDays(today, 7),
      totalExpected: 5000,
      depositPaid: 1000,
      depositMethod: 'cash'
    })

    const summary = await __invoke('dashboard:summary', { date: today })

    expect(summary.success).toBe(true)
    expect(summary.todayPaid).toBe(1430)
    expect(summary.todayPaidCash).toBe(1380)
    expect(summary.todayPaidQr).toBe(50)
    expect(summary.todayUnpaid).toBe(20)
    expect(summary.discountsToday).toBe(50)
    expect(summary.salesOutstanding).toBe(20)
    expect(summary.bookingBalanceDue).toBe(4000)
    expect(summary.dues).toBe(4020)
    expect(summary.week.total).toBe(1450)
    expect(summary.week.priorTotal).toBe(300)
    expect(summary.week.changePercent).toBe(383.33)
    expect(summary.month.total).toBe(1750)
    expect(summary.month.priorTotal).toBe(0)
    expect(summary.month.changePercent).toBe(null)
    expect(summary.stock.pool).toBe(800)
    expect(summary.stock.kitchen).toBe(500)
    expect(summary.stock.total).toBe(1300)
    expect(summary.bookingDepositsOutstanding.count).toBe(1)
    expect(summary.bookingDepositsOutstanding.sum).toBe(4000)
  })

  it('requires owner access', async () => {
    loginStaff(ids)
    const res = await __invoke('dashboard:summary', {})
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/owner/i)
  })
})
