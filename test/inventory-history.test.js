import { describe, it, expect, beforeEach } from 'vitest'
import { __invoke } from 'electron'
import { freshDb, seed, loginStaff, loginOwner } from './helpers.js'

let db
let ids

beforeEach(() => {
  db = freshDb()
  ids = seed(db)
})

// Seed pool item: Goggles, stock 10, price 200. Seed restaurant item: Tea
// leaves, stock 10, linked to the 'Tea' menu item at 150.
async function poolHistory(payload) {
  loginOwner(ids)
  return __invoke('pool-inventory:history', payload)
}

describe('P2 — pool inventory history', () => {
  it('returns a restock, a sale and an adjustment newest-first with signed deltas', async () => {
    loginStaff(ids)
    await __invoke('pool-inventory:restock', { itemId: ids.poolItemId, quantity: 10 }) // 10 -> 20
    await __invoke('pool-inventory:sell-item', {
      itemId: ids.poolItemId,
      quantity: 3,
      paymentMethod: 'cash'
    }) // 20 -> 17
    loginOwner(ids)
    await __invoke('pool-inventory:adjust', {
      itemId: ids.poolItemId,
      newQuantity: 7,
      reason: 'stock count'
    }) // 17 -> 7

    const res = await poolHistory({ itemId: ids.poolItemId })
    expect(res.success).not.toBe(false)
    expect(res.item.stock).toBe(7)
    expect(res.movements.map((m) => m.label)).toEqual(['Adjustment', 'Sale', 'Restock'])

    const [adjust, sale, restock] = res.movements
    expect(adjust.delta).toBe(-10)
    expect(adjust.reason).toBe('stock count')
    expect(sale.delta).toBe(-3) // stored positive as an 'out', read as a decrease
    expect(sale.quantity).toBe(3)
    expect(restock.delta).toBe(10)
    expect(restock.reason).toBe('Restock')
  })

  it('walks the running balance from 20 down to 7', async () => {
    loginStaff(ids)
    await __invoke('pool-inventory:restock', { itemId: ids.poolItemId, quantity: 10 })
    await __invoke('pool-inventory:sell-item', {
      itemId: ids.poolItemId,
      quantity: 3,
      paymentMethod: 'cash'
    })
    loginOwner(ids)
    await __invoke('pool-inventory:adjust', {
      itemId: ids.poolItemId,
      newQuantity: 7,
      reason: 'stock count'
    })

    const res = await poolHistory({ itemId: ids.poolItemId })
    expect(res.movements.map((m) => m.balance)).toEqual([7, 17, 20])
  })

  it('names the user behind each movement', async () => {
    loginStaff(ids)
    await __invoke('pool-inventory:restock', { itemId: ids.poolItemId, quantity: 2 })
    loginOwner(ids)
    await __invoke('pool-inventory:adjust', {
      itemId: ids.poolItemId,
      newQuantity: 5,
      reason: 'breakage'
    })

    const res = await poolHistory({ itemId: ids.poolItemId })
    expect(res.movements.map((m) => m.staffName)).toEqual(['Owner', 'Staff'])
  })

  it('links a sale to the money transaction it came from', async () => {
    loginStaff(ids)
    const sale = await __invoke('pool-inventory:sell-item', {
      itemId: ids.poolItemId,
      quantity: 2,
      paymentMethod: 'qr'
    })

    const res = await poolHistory({ itemId: ids.poolItemId })
    const [movement] = res.movements
    expect(movement.transactionId).toBe(sale.transactionId)
    expect(movement.transactionAmount).toBe(400)
    expect(movement.transactionType).toBe('pool_inventory')
    expect(movement.unitPrice).toBe(200)
  })

  it('scopes history to the requested item only', async () => {
    loginOwner(ids)
    const other = await __invoke('pool-inventory:add-item', {
      name: 'Swim Cap',
      category: 'gear',
      reorderLevel: 2,
      sellingPrice: 100
    })
    await __invoke('pool-inventory:restock', { itemId: other.itemId, quantity: 4 })
    await __invoke('pool-inventory:restock', { itemId: ids.poolItemId, quantity: 6 })

    const res = await poolHistory({ itemId: ids.poolItemId })
    expect(res.movements).toHaveLength(1)
    expect(res.movements[0].delta).toBe(6)

    const otherRes = await poolHistory({ itemId: other.itemId })
    expect(otherRes.movements).toHaveLength(1)
    expect(otherRes.movements[0].delta).toBe(4)
  })

  it('shows both the original sale and the reversal after a refund', async () => {
    loginStaff(ids)
    const sale = await __invoke('pool-inventory:sell-item', {
      itemId: ids.poolItemId,
      quantity: 3,
      paymentMethod: 'cash'
    })
    loginOwner(ids)
    const refund = await __invoke('transactions:refund', {
      transactionId: sale.transactionId,
      reason: 'returned'
    })
    expect(refund.full).toBe(true)

    const res = await poolHistory({ itemId: ids.poolItemId })
    expect(res.movements).toHaveLength(2)
    const [reversal, original] = res.movements
    // The reversal is an 'in' row, but it must not read as a delivery.
    expect(reversal.label).toBe('Refund')
    expect(reversal.delta).toBe(3)
    expect(reversal.reason).toBe('Refund reversal')
    expect(reversal.balance).toBe(10)
    expect(original.label).toBe('Sale')
    expect(original.delta).toBe(-3)
    expect(original.balance).toBe(7)
  })

  it('refuses staff — history exposes who did what', async () => {
    loginStaff(ids)
    const res = await __invoke('pool-inventory:history', { itemId: ids.poolItemId })
    expect(res.success).toBe(false)
    expect(res.movements).toBeUndefined()
  })

  it('returns an empty list for an item that has never moved', async () => {
    loginOwner(ids)
    const fresh = await __invoke('pool-inventory:add-item', {
      name: 'Kickboard',
      category: 'gear',
      reorderLevel: 2,
      sellingPrice: 300
    })
    const res = await poolHistory({ itemId: fresh.itemId })
    expect(res.success).not.toBe(false)
    expect(res.movements).toEqual([])
  })

  it('honours limit, keeping the newest movements', async () => {
    loginStaff(ids)
    for (let i = 1; i <= 5; i++) {
      await __invoke('pool-inventory:restock', { itemId: ids.poolItemId, quantity: i })
    }

    const res = await poolHistory({ itemId: ids.poolItemId, limit: 2 })
    expect(res.movements).toHaveLength(2)
    expect(res.movements.map((m) => m.delta)).toEqual([5, 4])
    // Truncating the tail must not corrupt the balance: stock is 25 after
    // 10 + 1+2+3+4+5, so the newest row still ends at 25.
    expect(res.movements.map((m) => m.balance)).toEqual([25, 20])

    const all = await poolHistory({ itemId: ids.poolItemId })
    expect(all.movements).toHaveLength(5) // default limit is well above 5
  })

  it('reports an unknown item rather than returning a silent empty history', async () => {
    const res = await poolHistory({ itemId: 999999 })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/not found/i)
  })
})

describe('P2 — restaurant inventory history', () => {
  it('records a restock, a menu sale and an adjustment against the linked item', async () => {
    loginStaff(ids)
    await __invoke('restaurant-inventory:restock', { itemId: ids.rInvId, quantity: 10 }) // 10 -> 20
    await __invoke('restaurant:checkout', {
      items: [{ id: ids.menuLinkedId, quantity: 2 }],
      paymentMethod: 'cash'
    }) // 20 -> 18
    loginOwner(ids)
    await __invoke('restaurant-inventory:adjust', {
      itemId: ids.rInvId,
      newQuantity: 7,
      reason: 'spoilage'
    }) // 18 -> 7

    const res = await __invoke('restaurant-inventory:history', { itemId: ids.rInvId })
    expect(res.movements.map((m) => m.label)).toEqual(['Adjustment', 'Sale', 'Restock'])
    expect(res.movements.map((m) => m.delta)).toEqual([-11, -2, 10])
    expect(res.movements.map((m) => m.balance)).toEqual([7, 18, 20])
    expect(res.movements[0].reason).toBe('spoilage')
    expect(res.movements[0].staffName).toBe('Owner')
    expect(res.movements[1].staffName).toBe('Staff')
  })

  it('keeps fractional units readable in the running balance', async () => {
    loginOwner(ids)
    await __invoke('restaurant-inventory:restock', { itemId: ids.rInvId, quantity: 0.3 })
    await __invoke('restaurant-inventory:adjust', {
      itemId: ids.rInvId,
      newQuantity: 10,
      reason: 'count'
    })

    const res = await __invoke('restaurant-inventory:history', { itemId: ids.rInvId })
    expect(res.movements.map((m) => m.balance)).toEqual([10, 10.3])
  })

  it('shows the reversal alongside the sale after a refunded order', async () => {
    loginStaff(ids)
    const order = await __invoke('restaurant:checkout', {
      items: [{ id: ids.menuLinkedId, quantity: 2 }],
      paymentMethod: 'cash'
    })
    loginOwner(ids)
    await __invoke('transactions:refund', { transactionId: order.transactionId })

    const res = await __invoke('restaurant-inventory:history', { itemId: ids.rInvId })
    expect(res.movements.map((m) => m.label)).toEqual(['Refund', 'Sale'])
    expect(res.movements.map((m) => m.delta)).toEqual([2, -2])
    expect(res.movements.map((m) => m.balance)).toEqual([10, 8])
  })

  it('scopes to the requested item, refuses staff, and honours limit', async () => {
    loginOwner(ids)
    const other = await __invoke('restaurant-inventory:add-item', {
      name: 'Coffee beans',
      category: 'bev',
      unit: 'kg',
      reorderLevel: 1,
      sellingPrice: 0
    })
    await __invoke('restaurant-inventory:restock', { itemId: other.itemId, quantity: 5 })
    for (let i = 1; i <= 3; i++) {
      await __invoke('restaurant-inventory:restock', { itemId: ids.rInvId, quantity: i })
    }

    const scoped = await __invoke('restaurant-inventory:history', { itemId: ids.rInvId })
    expect(scoped.movements).toHaveLength(3)

    const limited = await __invoke('restaurant-inventory:history', { itemId: ids.rInvId, limit: 1 })
    expect(limited.movements).toHaveLength(1)
    expect(limited.movements[0].delta).toBe(3)

    const otherRes = await __invoke('restaurant-inventory:history', { itemId: other.itemId })
    expect(otherRes.movements).toHaveLength(1)
    expect(otherRes.item.unit).toBe('kg')

    loginStaff(ids)
    const denied = await __invoke('restaurant-inventory:history', { itemId: ids.rInvId })
    expect(denied.success).toBe(false)
  })

  it('returns an empty list for an item that has never moved', async () => {
    loginOwner(ids)
    const fresh = await __invoke('restaurant-inventory:add-item', {
      name: 'Sugar',
      category: 'dry',
      reorderLevel: 1,
      sellingPrice: 0
    })
    const res = await __invoke('restaurant-inventory:history', { itemId: fresh.itemId })
    expect(res.movements).toEqual([])
  })
})
