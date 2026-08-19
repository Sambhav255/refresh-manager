// Regression tests for the findings in docs/qa/MONEY_AUDIT.md.
//
// Each was reproduced against a running app before being fixed; these pin the
// fixed behaviour. They are money and stock tests — treat a failure here as a
// business-correctness failure, not a test-maintenance chore.
import { describe, it, expect, beforeEach } from 'vitest'
import { __invoke } from 'electron'
import { freshDb, seed, loginStaff, loginOwner } from './helpers.js'

let db
let ids

beforeEach(() => {
  db = freshDb()
  ids = seed(db)
})

const stockOf = (table, id) =>
  db.prepare(`SELECT current_stock FROM ${table} WHERE id = ?`).get(id).current_stock

// ---------------------------------------------------------------------------
// P1-A — voiding a sale used to reverse the money and leave the stock
// decremented. Measured before the fix: sell 3 (20 -> 17), void, stock stayed
// at 17 forever. Refund restored stock correctly, so the same business event
// gave two different answers depending on which button was pressed.
// ---------------------------------------------------------------------------
describe('MONEY P1-A — a void returns the stock it took', () => {
  it('pool: voiding a sale puts every unit back', async () => {
    loginStaff(ids)
    const before = stockOf('pool_inventory_items', ids.poolItemId)
    await __invoke('pool-inventory:sell-item', {
      itemId: ids.poolItemId,
      quantity: 3,
      paymentMethod: 'cash',
      customerName: 'W'
    })
    expect(stockOf('pool_inventory_items', ids.poolItemId)).toBe(before - 3)

    loginOwner(ids)
    const sale = db
      .prepare(`SELECT id FROM transactions WHERE transaction_type = 'pool_inventory'`)
      .get()
    const res = await __invoke('transactions:void', { transactionId: sale.id, reason: 'mis-rung' })
    expect(res.success).toBe(true)

    expect(stockOf('pool_inventory_items', ids.poolItemId)).toBe(before)
    const summary = await __invoke('transactions:today-summary', {})
    expect(summary.total).toBe(0)
  })

  it('restaurant: voiding an order puts linked stock back', async () => {
    loginStaff(ids)
    const before = stockOf('restaurant_inventory_items', ids.rInvId)
    await __invoke('restaurant:checkout', {
      items: [{ id: ids.menuLinkedId, quantity: 4 }],
      paymentMethod: 'cash'
    })
    expect(stockOf('restaurant_inventory_items', ids.rInvId)).toBe(before - 4)

    loginOwner(ids)
    const sale = db
      .prepare(`SELECT id FROM transactions WHERE transaction_type = 'restaurant'`)
      .get()
    await __invoke('transactions:void', { transactionId: sale.id, reason: 'mis-rung' })
    expect(stockOf('restaurant_inventory_items', ids.rInvId)).toBe(before)
  })

  it('the reversal is recorded as a movement, not a silent adjustment', async () => {
    loginStaff(ids)
    await __invoke('pool-inventory:sell-item', {
      itemId: ids.poolItemId,
      quantity: 2,
      paymentMethod: 'cash',
      customerName: 'W'
    })
    loginOwner(ids)
    const sale = db
      .prepare(`SELECT id FROM transactions WHERE transaction_type = 'pool_inventory'`)
      .get()
    await __invoke('transactions:void', { transactionId: sale.id, reason: 'mis-rung' })

    // Both the original 'out' and the reversing 'in' must survive, so the
    // movement history still shows what happened.
    const rows = db
      .prepare(
        `SELECT txn_type, quantity, reason FROM pool_inventory_transactions
         WHERE item_id = ? ORDER BY id`
      )
      .all(ids.poolItemId)
    expect(rows.some((r) => r.txn_type === 'out' && r.quantity === 2)).toBe(true)
    const reversal = rows.find((r) => r.txn_type === 'in' && r.reason === 'Void reversal')
    expect(reversal).toBeTruthy()
    expect(reversal.quantity).toBe(2)
  })

  it('voiding a membership sale also ends the membership', async () => {
    loginStaff(ids)
    const { memberId } = await __invoke('members:create', { name: 'Voided', phone: '9841000001' })
    await __invoke('members:add-membership', {
      memberId,
      productId: ids.memProdId,
      startDate: '2026-08-01',
      paymentMethod: 'cash'
    })
    loginOwner(ids)
    const sale = db
      .prepare(`SELECT id FROM transactions WHERE transaction_type = 'membership'`)
      .get()
    await __invoke('transactions:void', { transactionId: sale.id, reason: 'entered by mistake' })

    const ms = db.prepare(`SELECT status FROM memberships WHERE member_id = ?`).get(memberId)
    expect(ms.status).toBe('cancelled')
  })

  it('a void that fails leaves neither the flag nor the stock changed', async () => {
    loginOwner(ids)
    const res = await __invoke('transactions:void', { transactionId: 99999, reason: 'ghost' })
    expect(res.success).toBe(false)
    expect(stockOf('pool_inventory_items', ids.poolItemId)).toBe(10)
  })
})

// ---------------------------------------------------------------------------
// P1-B — voiding a booking deposit removed the money from revenue but left the
// booking claiming deposit_paid = 3000, so staff would collect only the
// "balance" and the business would be short by the deposit.
// ---------------------------------------------------------------------------
describe('MONEY P1-B — a booking deposit cannot be voided out from under its booking', () => {
  it('refuses the void and points at the booking', async () => {
    loginOwner(ids)
    await __invoke('bookings:create', {
      bookingName: 'Birthday',
      bookingDate: '2026-12-01',
      depositPaid: 3000,
      depositMethod: 'cash',
      totalExpected: 20000
    })
    const dep = db
      .prepare(`SELECT id FROM transactions WHERE transaction_type = 'booking_deposit'`)
      .get()

    const res = await __invoke('transactions:void', { transactionId: dep.id, reason: 'oops' })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/booking/i)

    // Ledger and booking still agree.
    const still = db.prepare(`SELECT is_voided FROM transactions WHERE id = ?`).get(dep.id)
    expect(still.is_voided).toBe(0)
    const booking = db.prepare(`SELECT deposit_paid FROM bookings`).get()
    expect(booking.deposit_paid).toBe(3000)
  })

  it('clearing the deposit on the booking keeps both sides in step', async () => {
    loginOwner(ids)
    const { bookingId } = await __invoke('bookings:create', {
      bookingName: 'Birthday',
      bookingDate: '2026-12-01',
      depositPaid: 3000,
      depositMethod: 'cash',
      totalExpected: 20000
    })
    expect((await __invoke('transactions:today-summary', {})).total).toBe(3000)

    await __invoke('bookings:update', { bookingId, fields: { depositPaid: 0 } })

    expect((await __invoke('transactions:today-summary', {})).total).toBe(0)
    expect(db.prepare(`SELECT deposit_paid FROM bookings`).get().deposit_paid).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// P3-A — restaurant units are REAL (kg/litres), so repeated fractional restocks
// accumulated binary float error: 10 + 0.1*3 stored as 10.299999999999999,
// which the inventory table rendered raw.
// ---------------------------------------------------------------------------
describe('MONEY P3-A — fractional restaurant stock does not drift', () => {
  it('repeated 0.1 restocks stay exact', async () => {
    loginOwner(ids)
    await __invoke('restaurant-inventory:adjust', {
      itemId: ids.rInvId,
      newQuantity: 10,
      reason: 'reset'
    })
    for (let i = 0; i < 3; i++) {
      await __invoke('restaurant-inventory:restock', { itemId: ids.rInvId, quantity: 0.1 })
    }
    expect(stockOf('restaurant_inventory_items', ids.rInvId)).toBe(10.3)
  })

  it('fractional sales round too', async () => {
    loginOwner(ids)
    await __invoke('restaurant-inventory:adjust', {
      itemId: ids.rInvId,
      newQuantity: 1,
      reason: 'reset'
    })
    loginStaff(ids)
    for (let i = 0; i < 3; i++) {
      await __invoke('restaurant-inventory:sell', { itemId: ids.rInvId, quantity: 0.1 })
    }
    expect(stockOf('restaurant_inventory_items', ids.rInvId)).toBe(0.7)
  })
})

// ---------------------------------------------------------------------------
// Conservation: the invariant the whole ledger rests on. Every reversal path
// must land the books back where they started.
// ---------------------------------------------------------------------------
describe('MONEY — reversal paths conserve both money and stock', () => {
  it('sell, void, sell again, refund: stock and money both return to zero', async () => {
    loginStaff(ids)
    const start = stockOf('pool_inventory_items', ids.poolItemId)

    await __invoke('pool-inventory:sell-item', {
      itemId: ids.poolItemId,
      quantity: 3,
      paymentMethod: 'cash',
      customerName: 'A'
    })
    loginOwner(ids)
    const first = db
      .prepare(`SELECT id FROM transactions WHERE transaction_type = 'pool_inventory'`)
      .get()
    await __invoke('transactions:void', { transactionId: first.id, reason: 'mis-rung' })

    loginStaff(ids)
    await __invoke('pool-inventory:sell-item', {
      itemId: ids.poolItemId,
      quantity: 2,
      paymentMethod: 'cash',
      customerName: 'B'
    })
    loginOwner(ids)
    const second = db
      .prepare(
        `SELECT id, amount FROM transactions WHERE transaction_type = 'pool_inventory' AND is_voided = 0`
      )
      .get()
    await __invoke('transactions:refund', {
      transactionId: second.id,
      amount: second.amount,
      reason: 'returned'
    })

    expect(stockOf('pool_inventory_items', ids.poolItemId)).toBe(start)
    const summary = await __invoke('transactions:today-summary', {})
    expect(summary.total).toBe(0)
    // And the itemised breakdown still reconciles to that total.
    const lineSum = Object.values(summary.byType).reduce((a, b) => a + b, 0)
    expect(lineSum).toBe(summary.total)
  })
})
