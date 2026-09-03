// Input-guard tests for the shared requireText / requireAmount /
// requireRestockQuantity helpers (src/main/ipc/utils.js) and every handler
// that adopted them in the 2026-08 QA round. The principle under test: the
// main process is the last line of defence — a buggy or tampered renderer must
// never be able to write blank names, negative money, text in numeric columns,
// or absurd quantities.
import { describe, it, expect, beforeEach } from 'vitest'
import { __invoke } from 'electron'
import { freshDb, seed, loginStaff, loginOwner } from './helpers.js'

let db
let ids

beforeEach(() => {
  db = freshDb()
  ids = seed(db)
  loginOwner(ids)
})

const fails = async (channel, payload, pattern) => {
  const res = await __invoke(channel, payload)
  expect(res.success, `${channel} accepted ${JSON.stringify(payload)}`).toBe(false)
  if (pattern) expect(res.error).toMatch(pattern)
  return res
}

// ---------------------------------------------------------------------------
// Inventory add — both screens
// ---------------------------------------------------------------------------
describe('inventory add-item guards', () => {
  const bads = [
    [{ name: '', category: 'gear' }, /name is required/i],
    [{ name: '   ', category: 'gear' }, /name is required/i],
    [{ name: 'X', category: '  ' }, /category is required/i],
    [{ name: 'X', category: 'gear', sellingPrice: -100 }, /0 or more/],
    [{ name: 'X', category: 'gear', sellingPrice: 'abc' }, /0 or more/],
    [{ name: 'X', category: 'gear', reorderLevel: 'five' }, /0 or more/],
    [{ name: 'X'.repeat(121), category: 'gear' }, /too long/i]
  ]

  it('pool: rejects blank/negative/text inputs', async () => {
    for (const [payload, pattern] of bads) {
      await fails('pool-inventory:add-item', payload, pattern)
    }
    // Nothing junk got through.
    const junk = db
      .prepare(
        `SELECT COUNT(*) AS n FROM pool_inventory_items WHERE name = '' OR selling_price < 0`
      )
      .get().n
    expect(junk).toBe(0)
  })

  it('restaurant: rejects the same battery', async () => {
    for (const [payload, pattern] of bads) {
      await fails('restaurant-inventory:add-item', payload, pattern)
    }
  })

  it('pool: a valid add still works and trims the variant', async () => {
    const res = await __invoke('pool-inventory:add-item', {
      name: 'Kickboard',
      category: 'gear',
      variant: '  Junior  ',
      reorderLevel: 3,
      sellingPrice: 350
    })
    expect(res.success).toBe(true)
    const row = db.prepare(`SELECT * FROM pool_inventory_items WHERE id = ?`).get(res.itemId)
    expect(row.variant).toBe('Junior')
    expect(row.selling_price).toBe(350)
  })
})

// ---------------------------------------------------------------------------
// Restock — cap and rejection set. The 999 cap on the SELL paths predates this;
// the restock cap (100,000) is new, because 1e21 passed Number.isInteger and
// left 1.000000001e+21 in an INTEGER column with no UI path to correct it.
// ---------------------------------------------------------------------------
describe('restock quantity guards', () => {
  it('pool: rejects zero, negative, fractional, text, and huge quantities', async () => {
    for (const quantity of [0, -5, 2.5, 'abc', 100001, 999999999999, 1e21]) {
      await fails('pool-inventory:restock', { itemId: ids.poolItemId, quantity })
    }
    const stock = db
      .prepare(`SELECT current_stock FROM pool_inventory_items WHERE id = ?`)
      .get(ids.poolItemId).current_stock
    expect(stock).toBe(10) // untouched from seed
  })

  it('pool: accepts exactly the cap (100000)', async () => {
    const res = await __invoke('pool-inventory:restock', {
      itemId: ids.poolItemId,
      quantity: 100000
    })
    expect(res.success).toBe(true)
  })

  it('restaurant: fractional is allowed (kg units) but the same bounds hold', async () => {
    const ok = await __invoke('restaurant-inventory:restock', {
      itemId: ids.rInvId,
      quantity: 2.5
    })
    expect(ok.success).toBe(true)
    for (const quantity of [0, -1, 'abc', 100001, 1e21]) {
      await fails('restaurant-inventory:restock', { itemId: ids.rInvId, quantity })
    }
  })
})

// ---------------------------------------------------------------------------
// Adjust — the most sensitive stock operation must carry a reason.
// ---------------------------------------------------------------------------
describe('stock adjustment requires a reason', () => {
  it('pool: rejects a missing/blank reason, accepts and records a real one', async () => {
    await fails('pool-inventory:adjust', { itemId: ids.poolItemId, newQuantity: 7 }, /reason/i)
    await fails(
      'pool-inventory:adjust',
      { itemId: ids.poolItemId, newQuantity: 7, reason: '   ' },
      /reason/i
    )
    const ok = await __invoke('pool-inventory:adjust', {
      itemId: ids.poolItemId,
      newQuantity: 7,
      reason: 'Stock count 2026-08-19'
    })
    expect(ok.success).toBe(true)
    const trail = db
      .prepare(
        `SELECT reason FROM pool_inventory_transactions WHERE item_id = ? AND txn_type = 'adjustment'`
      )
      .get(ids.poolItemId)
    expect(trail.reason).toBe('Stock count 2026-08-19')
  })

  it('restaurant: same contract', async () => {
    await fails('restaurant-inventory:adjust', { itemId: ids.rInvId, newQuantity: 4 }, /reason/i)
    const ok = await __invoke('restaurant-inventory:adjust', {
      itemId: ids.rInvId,
      newQuantity: 4,
      reason: 'spoilage'
    })
    expect(ok.success).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// pool-inventory:update — value validation + missing-row guard (this is the
// handler behind the new owner "Price" control that unblocks Sell Item).
// ---------------------------------------------------------------------------
describe('pool-inventory:update guards', () => {
  it('rejects negative and text selling prices', async () => {
    await fails('pool-inventory:update', {
      itemId: ids.poolItemId,
      fields: { sellingPrice: -50 }
    })
    await fails('pool-inventory:update', {
      itemId: ids.poolItemId,
      fields: { sellingPrice: 'abc' }
    })
  })

  it('reports "not found" for a missing item instead of silent success', async () => {
    await fails(
      'pool-inventory:update',
      { itemId: 99999, fields: { sellingPrice: 100 } },
      /not found/i
    )
  })

  it('a valid price update lands and is visible to the sell path', async () => {
    const res = await __invoke('pool-inventory:update', {
      itemId: ids.poolItemId,
      fields: { sellingPrice: 275 }
    })
    expect(res.success).toBe(true)
    const price = db
      .prepare(`SELECT selling_price FROM pool_inventory_items WHERE id = ?`)
      .get(ids.poolItemId).selling_price
    expect(price).toBe(275)
  })
})

// ---------------------------------------------------------------------------
// products — update-price validation (a raw bind error used to surface when
// newPrice was undefined; negatives went straight through) + add validation.
// ---------------------------------------------------------------------------
describe('product price guards', () => {
  it('update-price rejects missing, negative, and text prices', async () => {
    await fails('products:update-price', { productId: ids.dayPassId }, /price/i)
    await fails('products:update-price', { productId: ids.dayPassId, newPrice: -1 })
    await fails('products:update-price', { productId: ids.dayPassId, newPrice: 'abc' })
  })

  it('a valid update writes the price AND its history row', async () => {
    const res = await __invoke('products:update-price', {
      productId: ids.dayPassId,
      newPrice: 550
    })
    expect(res.success).toBe(true)
    const p = db.prepare(`SELECT price FROM products WHERE id = ?`).get(ids.dayPassId)
    expect(p.price).toBe(550)
    const h = db
      .prepare(
        `SELECT old_price, new_price FROM price_history WHERE product_id = ? ORDER BY id DESC LIMIT 1`
      )
      .get(ids.dayPassId)
    expect(h.old_price).toBe(300)
    expect(h.new_price).toBe(550)
  })

  it('products:add rejects blank names and negative prices', async () => {
    await fails('products:add', { name: '  ', category: 'day_pass' }, /name/i)
    await fails('products:add', { name: 'Night Pass', category: 'day_pass', price: -5 })
  })

  it('owner can add a day_pass product', async () => {
    const res = await __invoke('products:add', {
      name: 'Sauna Day',
      category: 'day_pass',
      price: 400
    })
    expect(res.success).toBe(true)
    const row = db.prepare(`SELECT * FROM products WHERE id = ?`).get(res.productId)
    expect(row.name).toBe('Sauna Day')
    expect(row.category).toBe('day_pass')
    expect(row.price).toBe(400)
  })

  it('membership without durationDays is rejected', async () => {
    await fails(
      'products:add',
      { name: 'Gym', category: 'membership', price: 2500 },
      /duration/i
    )
  })
})

// ---------------------------------------------------------------------------
// bookings — create/update value validation + missing-row guards. A booking
// with a garbage date matches no ranged query, so it silently disappears from
// Upcoming and every report; a negative deposit made syncDepositTransaction
// VOID the linked transaction while the booking claimed a negative deposit.
// ---------------------------------------------------------------------------
describe('booking guards', () => {
  it('create rejects garbage dates, blank names, and bad party sizes', async () => {
    await fails('bookings:create', { bookingName: 'B', bookingDate: 'not-a-date' }, /date/i)
    await fails('bookings:create', { bookingName: 'B', bookingDate: '2026-13-45' }, /date/i)
    await fails('bookings:create', { bookingName: '   ', bookingDate: '2026-09-01' }, /name/i)
    for (const numPeople of [0, -40, 'abcdef', 2.5]) {
      await fails('bookings:create', {
        bookingName: 'B',
        bookingDate: '2026-09-01',
        numPeople
      })
    }
  })

  it('create rejects negative and text deposits / totals', async () => {
    await fails('bookings:create', {
      bookingName: 'B',
      bookingDate: '2026-09-01',
      depositPaid: -3000
    })
    await fails('bookings:create', {
      bookingName: 'B',
      bookingDate: '2026-09-01',
      depositPaid: 'abc'
    })
    await fails('bookings:create', {
      bookingName: 'B',
      bookingDate: '2026-09-01',
      totalExpected: -1
    })
  })

  it('update validates VALUES, not just column names', async () => {
    const { bookingId } = await __invoke('bookings:create', {
      bookingName: 'Valid',
      bookingDate: '2026-09-01',
      totalExpected: 20000
    })
    await fails('bookings:update', { bookingId, fields: { depositPaid: -3000 } })
    await fails('bookings:update', { bookingId, fields: { bookingDate: 'garbage' } }, /date/i)
    await fails('bookings:update', { bookingId, fields: { numPeople: -2 } })
    await fails('bookings:update', { bookingId, fields: { bookingName: '   ' } }, /name/i)
    // The booking survived all of it unchanged.
    const row = db.prepare(`SELECT * FROM bookings WHERE id = ?`).get(bookingId)
    expect(row.deposit_paid).toBe(0)
    expect(row.booking_date).toBe('2026-09-01')
  })

  it('update and update-status report "not found" for missing ids', async () => {
    await fails(
      'bookings:update',
      { bookingId: 99999, fields: { bookingName: 'ghost' } },
      /not found/i
    )
    await fails('bookings:update-status', { bookingId: 99999, status: 'completed' }, /not found/i)
  })

  it('update-status still rejects unknown statuses', async () => {
    const { bookingId } = await __invoke('bookings:create', {
      bookingName: 'B',
      bookingDate: '2026-09-01'
    })
    await fails('bookings:update-status', { bookingId, status: 'zombie' }, /status/i)
  })
})

// ---------------------------------------------------------------------------
// Authorization — the new/changed handlers keep their role gates.
// ---------------------------------------------------------------------------
describe('guarded handlers keep their role gates', () => {
  it('staff cannot add items, adjust stock, update prices, or edit bookings', async () => {
    loginStaff(ids)
    const ownerOnly = [
      ['pool-inventory:add-item', { name: 'X', category: 'g' }],
      ['pool-inventory:adjust', { itemId: ids.poolItemId, newQuantity: 5, reason: 'r' }],
      ['pool-inventory:update', { itemId: ids.poolItemId, fields: { sellingPrice: 1 } }],
      ['products:update-price', { productId: ids.dayPassId, newPrice: 100 }],
      ['products:add', { name: 'X', category: 'day_pass', price: 100 }],
      ['bookings:update', { bookingId: 1, fields: { bookingName: 'X' } }]
    ]
    for (const [channel, payload] of ownerOnly) {
      const res = await __invoke(channel, payload)
      expect(res.success, `${channel} allowed staff`).toBe(false)
      expect(res.error).toMatch(/owner/i)
    }
  })

  it('staff cannot products:add', async () => {
    loginStaff(ids)
    const res = await __invoke('products:add', {
      name: 'Sauna Day',
      category: 'day_pass',
      price: 400
    })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/owner/i)
  })

  it('validation happens AFTER the auth check, never leaking to logged-out callers', async () => {
    const { clearSession } = await import('../src/main/session.js')
    clearSession()
    const res = await __invoke('pool-inventory:add-item', { name: '', category: '' })
    expect(res.success).toBe(false)
    // The error is the auth failure, not the validation message — a logged-out
    // caller learns nothing about the input contract.
    expect(res.error).not.toMatch(/name is required/i)
  })
})
