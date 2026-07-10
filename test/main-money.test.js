import { describe, it, expect, beforeEach } from 'vitest'
import { __invoke } from 'electron'
import { getDb } from '../src/main/db/index.js'
import { expireLapsedMemberships } from '../src/main/ipc/maintenance.js'
import { freshDb, seed, loginStaff, loginOwner, isoOffset } from './helpers.js'

let db
let ids

beforeEach(() => {
  db = freshDb()
  ids = seed(db)
})

describe('P0-1 — staff_id and amount are derived server-side', () => {
  it('transactions:create ignores payload staffId and payload amount', async () => {
    loginStaff(ids)
    const res = await __invoke('transactions:create', {
      type: 'day_pass',
      source: 'pool',
      customerName: 'Walk-in',
      productId: ids.dayPassId,
      amount: 99999, // tampered
      staffId: ids.ownerId, // tampered
      paymentMethod: 'cash'
    })
    expect(res.success).toBe(true)
    const row = db.prepare('SELECT * FROM transactions WHERE id = ?').get(res.transactionId)
    expect(row.amount).toBe(300) // catalogue price, not 99999
    expect(row.staff_id).toBe(ids.staffId) // session staff, not owner
  })

  it('restaurant:checkout ignores payload price and staffId', async () => {
    loginStaff(ids)
    const res = await __invoke('restaurant:checkout', {
      items: [{ id: ids.menuLinkedId, price: 1, quantity: 2 }], // tampered price
      staffId: ids.ownerId, // tampered
      paymentMethod: 'cash'
    })
    expect(res.success).toBe(true)
    expect(res.total).toBe(300) // 150 * 2, not 1 * 2
    const row = db.prepare('SELECT * FROM transactions WHERE id = ?').get(res.transactionId)
    expect(row.amount).toBe(300)
    expect(row.staff_id).toBe(ids.staffId)
  })

  it('members:add-membership records catalogue price and session staff', async () => {
    loginStaff(ids)
    const member = await __invoke('members:create', { name: 'Ram' })
    const res = await __invoke('members:add-membership', {
      memberId: member.memberId,
      productId: ids.memProdId,
      amount: 5, // tampered
      staffId: ids.ownerId, // tampered
      paymentMethod: 'cash'
    })
    expect(res.success).toBe(true)
    const row = db.prepare('SELECT * FROM transactions WHERE id = ?').get(res.transactionId)
    expect(row.amount).toBe(1000)
    expect(row.staff_id).toBe(ids.staffId)
  })
})

describe('P0-2 — restaurant checkout moves inventory atomically', () => {
  it('draws down a linked stock item 1:1 and records an out transaction', async () => {
    loginStaff(ids)
    const res = await __invoke('restaurant:checkout', {
      items: [{ id: ids.menuLinkedId, quantity: 2 }],
      paymentMethod: 'cash'
    })
    expect(res.success).toBe(true)
    const stock = db
      .prepare('SELECT current_stock FROM restaurant_inventory_items WHERE id = ?')
      .get(ids.rInvId).current_stock
    expect(stock).toBe(8)
    const out = db
      .prepare(
        `SELECT * FROM restaurant_inventory_transactions WHERE item_id = ? AND txn_type = 'out'`
      )
      .get(ids.rInvId)
    expect(out.quantity).toBe(2)
    expect(out.transaction_id).toBe(res.transactionId)
  })

  it('rolls back the whole sale if a line would overdraw stock', async () => {
    loginStaff(ids)
    db.prepare('UPDATE restaurant_inventory_items SET current_stock = 1 WHERE id = ?').run(
      ids.rInvId
    )
    const before = db.prepare('SELECT COUNT(*) c FROM transactions').get().c
    const res = await __invoke('restaurant:checkout', {
      items: [{ id: ids.menuLinkedId, quantity: 2 }],
      paymentMethod: 'cash'
    })
    expect(res.success).toBe(false)
    const after = db.prepare('SELECT COUNT(*) c FROM transactions').get().c
    expect(after).toBe(before) // no transaction row written
    const stock = db
      .prepare('SELECT current_stock FROM restaurant_inventory_items WHERE id = ?')
      .get(ids.rInvId).current_stock
    expect(stock).toBe(1) // unchanged
  })

  it('sells an unlinked menu item with no inventory movement', async () => {
    loginStaff(ids)
    const res = await __invoke('restaurant:checkout', {
      items: [{ id: ids.menuPlainId, quantity: 3 }],
      paymentMethod: 'cash'
    })
    expect(res.success).toBe(true)
    expect(res.total).toBe(300)
  })
})

describe('P0-4 — inventory cannot go negative', () => {
  it('rejects selling more than in stock and writes nothing', async () => {
    loginStaff(ids)
    const before = db.prepare('SELECT COUNT(*) c FROM transactions').get().c
    const res = await __invoke('pool-inventory:sell-item', {
      itemId: ids.poolItemId,
      quantity: 999,
      paymentMethod: 'cash'
    })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/only 10 left/i)
    const stock = db
      .prepare('SELECT current_stock FROM pool_inventory_items WHERE id = ?')
      .get(ids.poolItemId).current_stock
    expect(stock).toBe(10)
    expect(db.prepare('SELECT COUNT(*) c FROM transactions').get().c).toBe(before)
  })

  it('rejects an adjustment to a negative target', async () => {
    loginOwner(ids)
    const res = await __invoke('pool-inventory:adjust', {
      itemId: ids.poolItemId,
      newQuantity: -5,
      reason: 'oops'
    })
    expect(res.success).toBe(false)
    const stock = db
      .prepare('SELECT current_stock FROM pool_inventory_items WHERE id = ?')
      .get(ids.poolItemId).current_stock
    expect(stock).toBe(10)
  })
})

describe('P2-1 — staff can sell a pool inventory item atomically', () => {
  it('creates the sale and draws down stock in one operation', async () => {
    loginStaff(ids)
    const res = await __invoke('pool-inventory:sell-item', {
      itemId: ids.poolItemId,
      quantity: 3,
      paymentMethod: 'qr'
    })
    expect(res.success).toBe(true)
    expect(res.total).toBe(600) // 3 * 200
    const txn = db.prepare('SELECT * FROM transactions WHERE id = ?').get(res.transactionId)
    expect(txn.transaction_type).toBe('pool_inventory')
    expect(txn.amount).toBe(600)
    expect(txn.staff_id).toBe(ids.staffId)
    expect(txn.payment_method).toBe('qr')
    const stock = db
      .prepare('SELECT current_stock FROM pool_inventory_items WHERE id = ?')
      .get(ids.poolItemId).current_stock
    expect(stock).toBe(7)
    const out = db
      .prepare(`SELECT * FROM pool_inventory_transactions WHERE item_id = ? AND txn_type = 'out'`)
      .get(ids.poolItemId)
    expect(out.quantity).toBe(3)
    expect(out.transaction_id).toBe(res.transactionId)
  })
})

describe('P1-1 — memberships expire automatically', () => {
  function addMembership(memberName, endDate) {
    const m = db.prepare(`INSERT INTO members (name) VALUES (?)`).run(memberName)
    db.prepare(
      `INSERT INTO memberships (member_id, product_id, start_date, end_date, status)
       VALUES (?, ?, ?, ?, 'active')`
    ).run(m.lastInsertRowid, ids.memProdId, isoOffset(-40), endDate)
    return m.lastInsertRowid
  }

  it('flips lapsed active memberships to expired and leaves current ones active', () => {
    addMembership('Lapsed', isoOffset(-1))
    addMembership('Current', isoOffset(1))
    const changed = expireLapsedMemberships()
    expect(changed).toBe(1)
    const statuses = getDb()
      .prepare(`SELECT m.name, ms.status FROM memberships ms JOIN members m ON m.id = ms.member_id`)
      .all()
    const byName = Object.fromEntries(statuses.map((r) => [r.name, r.status]))
    expect(byName.Lapsed).toBe('expired')
    expect(byName.Current).toBe('active')
  })

  it('members:search does not show a lapsed member as active (defence in depth)', async () => {
    // status still 'active' in the row, but end_date is in the past
    addMembership('Ghost', isoOffset(-1))
    loginStaff(ids)
    const res = await __invoke('members:search', { query: 'Ghost' })
    const ghost = res.members.find((m) => m.name === 'Ghost')
    expect(ghost).toBeTruthy()
    expect(ghost.activeMembership).toBeNull()
  })
})
