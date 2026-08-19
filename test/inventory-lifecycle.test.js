import { describe, it, expect, beforeEach } from 'vitest'
import { __invoke } from 'electron'
import { freshDb, seed, loginStaff, loginOwner } from './helpers.js'
import { seedData, sampleCatalogue, loadSampleCatalogue } from '../src/main/db/seed.js'

let db
let ids

beforeEach(() => {
  db = freshDb()
  ids = seed(db)
})

// Helper seed: pool item 'Goggles' (stock 10, price 200) and restaurant item
// 'Tea leaves' (stock 10). Retire == pool-inventory:update / restaurant-
// inventory:update with isActive 0 — there is no delete channel by design.
const retirePool = (itemId) =>
  __invoke('pool-inventory:update', { itemId, fields: { isActive: 0 } })
const restorePool = (itemId) =>
  __invoke('pool-inventory:update', { itemId, fields: { isActive: 1 } })
const retireRestaurant = (itemId) =>
  __invoke('restaurant-inventory:update', { itemId, fields: { isActive: 0 } })
const restoreRestaurant = (itemId) =>
  __invoke('restaurant-inventory:update', { itemId, fields: { isActive: 1 } })

const countRows = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n

// ---------------------------------------------------------------------------
// Retire — the owner asked to be able to remove "say, goggles" from the list.
// It is a soft delete: the row and every movement that references it survive,
// because sales history and reports read straight through them.
// ---------------------------------------------------------------------------
describe('retiring a pool item', () => {
  it('hides it from the active list but keeps the row and its movements', async () => {
    loginStaff(ids)
    await __invoke('pool-inventory:restock', { itemId: ids.poolItemId, quantity: 5 })
    await __invoke('pool-inventory:sell-item', {
      itemId: ids.poolItemId,
      quantity: 2,
      paymentMethod: 'cash'
    })
    const itemsBefore = countRows('pool_inventory_items')
    const movesBefore = countRows('pool_inventory_transactions')
    const txnsBefore = countRows('transactions')

    loginOwner(ids)
    const res = await retirePool(ids.poolItemId)
    expect(res.success).toBe(true)

    // Gone from the list staff and every report read.
    const list = await __invoke('pool-inventory:list')
    expect(list.items.map((i) => i.id)).not.toContain(ids.poolItemId)

    // Nothing was deleted — not the item, not a single stock movement, not the
    // money transaction that the sale wrote.
    expect(countRows('pool_inventory_items')).toBe(itemsBefore)
    expect(countRows('pool_inventory_transactions')).toBe(movesBefore)
    expect(countRows('transactions')).toBe(txnsBefore)
    const row = db.prepare('SELECT * FROM pool_inventory_items WHERE id = ?').get(ids.poolItemId)
    expect(row).toBeTruthy()
    expect(row.is_active).toBe(0)
    expect(row.current_stock).toBe(13) // 10 + 5 - 2, untouched by the retire
  })

  it('keeps the movement history readable after retiring', async () => {
    loginStaff(ids)
    await __invoke('pool-inventory:restock', { itemId: ids.poolItemId, quantity: 5 })
    loginOwner(ids)
    const before = await __invoke('pool-inventory:history', { itemId: ids.poolItemId })

    await retirePool(ids.poolItemId)
    const after = await __invoke('pool-inventory:history', { itemId: ids.poolItemId })

    expect(after.success).not.toBe(false)
    expect(after.movements.length).toBe(before.movements.length)
    expect(after.movements.map((m) => m.label)).toEqual(before.movements.map((m) => m.label))
    expect(after.movements.map((m) => m.balance)).toEqual(before.movements.map((m) => m.balance))
    expect(after.item.stock).toBe(before.item.stock)
  })

  it('drops it out of the low-stock alert', async () => {
    loginOwner(ids)
    await __invoke('pool-inventory:adjust', {
      itemId: ids.poolItemId,
      newQuantity: 1, // reorder level is 5
      reason: 'stock count'
    })
    const low = await __invoke('pool-inventory:low-stock')
    expect(low.items.map((i) => i.id)).toContain(ids.poolItemId)

    await retirePool(ids.poolItemId)
    const after = await __invoke('pool-inventory:low-stock')
    expect(after.items.map((i) => i.id)).not.toContain(ids.poolItemId)
  })

  it('is owner-only — staff cannot retire stock', async () => {
    loginStaff(ids)
    const res = await retirePool(ids.poolItemId)
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/owner/i)
    expect(
      db.prepare('SELECT is_active FROM pool_inventory_items WHERE id = ?').get(ids.poolItemId)
        .is_active
    ).toBe(1)
  })

  it('rejects a non-0/1 active flag instead of writing text into the column', async () => {
    loginOwner(ids)
    const res = await __invoke('pool-inventory:update', {
      itemId: ids.poolItemId,
      fields: { isActive: 'nope' }
    })
    expect(res.success).toBe(false)
    expect(
      db.prepare('SELECT is_active FROM pool_inventory_items WHERE id = ?').get(ids.poolItemId)
        .is_active
    ).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Recovery — "make sure that we can recover things easily and everything's not
// lost just because of some big finger stuff."
// ---------------------------------------------------------------------------
describe('restoring a retired item', () => {
  it('brings a pool item back with its stock and history intact', async () => {
    loginStaff(ids)
    await __invoke('pool-inventory:restock', { itemId: ids.poolItemId, quantity: 5 })
    loginOwner(ids)
    await retirePool(ids.poolItemId)

    const res = await restorePool(ids.poolItemId)
    expect(res.success).toBe(true)

    const list = await __invoke('pool-inventory:list')
    const back = list.items.find((i) => i.id === ids.poolItemId)
    expect(back).toBeTruthy()
    expect(back.stock).toBe(15)
    expect(back.retired).toBe(false)

    const history = await __invoke('pool-inventory:history', { itemId: ids.poolItemId })
    expect(history.movements.length).toBe(1)
  })

  it('lists retired items only when includeRetired is asked for', async () => {
    loginOwner(ids)
    await retirePool(ids.poolItemId)

    const active = await __invoke('pool-inventory:list')
    expect(active.items.map((i) => i.id)).not.toContain(ids.poolItemId)

    const all = await __invoke('pool-inventory:list', { includeRetired: true })
    const found = all.items.find((i) => i.id === ids.poolItemId)
    expect(found).toBeTruthy()
    expect(found.retired).toBe(true)
    expect(found.isActive).toBe(false)
    // A retired item is never flagged low — it is not something to reorder.
    expect(found.low).toBe(false)
  })

  it('explains a name clash rather than failing on a raw constraint', async () => {
    loginOwner(ids)
    await retirePool(ids.poolItemId)
    const added = await __invoke('pool-inventory:add-item', {
      name: 'Goggles',
      category: 'gear',
      sellingPrice: 250
    })
    expect(added.success).toBe(true)

    const res = await restorePool(ids.poolItemId)
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/already back in the list/i)
    expect(res.error).not.toMatch(/UNIQUE/i)
  })

  it('brings a restaurant item back', async () => {
    loginOwner(ids)
    await retireRestaurant(ids.rInvId)
    expect((await __invoke('restaurant-inventory:list')).items.map((i) => i.id)).not.toContain(
      ids.rInvId
    )

    const res = await restoreRestaurant(ids.rInvId)
    expect(res.success).toBe(true)
    const back = (await __invoke('restaurant-inventory:list')).items.find(
      (i) => i.id === ids.rInvId
    )
    expect(back).toBeTruthy()
    expect(back.stock).toBe(10)
  })
})

// ---------------------------------------------------------------------------
// A retired item must not keep selling: it appears in no list and no low-stock
// alert, so its stock would drain where nobody is looking.
// ---------------------------------------------------------------------------
describe('a retired item cannot be sold', () => {
  it('refuses a pool sale and moves neither stock nor money', async () => {
    loginOwner(ids)
    await retirePool(ids.poolItemId)
    loginStaff(ids)

    const res = await __invoke('pool-inventory:sell-item', {
      itemId: ids.poolItemId,
      quantity: 1,
      paymentMethod: 'cash'
    })
    expect(res.success).toBe(false)
    expect(
      db.prepare('SELECT current_stock FROM pool_inventory_items WHERE id = ?').get(ids.poolItemId)
        .current_stock
    ).toBe(10)
    expect(countRows('transactions')).toBe(0)
  })

  it('refuses a restaurant draw-down and moves nothing', async () => {
    loginOwner(ids)
    await retireRestaurant(ids.rInvId)
    loginStaff(ids)

    const before = countRows('restaurant_inventory_transactions')
    const res = await __invoke('restaurant-inventory:sell', { itemId: ids.rInvId, quantity: 1 })
    expect(res.success).toBe(false)
    expect(
      db
        .prepare('SELECT current_stock FROM restaurant_inventory_items WHERE id = ?')
        .get(ids.rInvId).current_stock
    ).toBe(10)
    expect(countRows('restaurant_inventory_transactions')).toBe(before)
  })

  it('sells again once restored', async () => {
    loginOwner(ids)
    await retirePool(ids.poolItemId)
    await restorePool(ids.poolItemId)
    loginStaff(ids)

    const res = await __invoke('pool-inventory:sell-item', {
      itemId: ids.poolItemId,
      quantity: 1,
      paymentMethod: 'cash'
    })
    expect(res.success).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// "Inventory right now there's too much things going on and we do not know the
// exact things that we want to add." A new install starts empty: the 34 seeded
// rows were all priced 0, which is also what left the staff Sell Item screen
// permanently blank.
// ---------------------------------------------------------------------------
describe('a fresh database seeds no catalogue', () => {
  it('has no products and no inventory items', () => {
    const fresh = freshDb()
    expect(fresh.prepare('SELECT COUNT(*) AS n FROM products').get().n).toBe(0)
    expect(fresh.prepare('SELECT COUNT(*) AS n FROM pool_inventory_items').get().n).toBe(0)
    expect(fresh.prepare('SELECT COUNT(*) AS n FROM restaurant_inventory_items').get().n).toBe(0)
  })

  it('still has its default settings', () => {
    const fresh = freshDb()
    const get = (key) => fresh.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value
    expect(get('business_name')).toBe('Refresh Recreation Center')
    expect(get('currency_symbol')).toBe('Rs.')
    expect(get('expiry_warning_days')).toBe('5')
    expect(get('seeded')).toBe('true')
  })

  it('seedData is idempotent and never removes what an install already has', () => {
    const fresh = freshDb()
    // Stand in for a live install that has built up its own catalogue.
    fresh
      .prepare(
        `INSERT INTO pool_inventory_items (name, category, current_stock, reorder_level, selling_price)
         VALUES ('Goggles', 'Accessories', 12, 5, 250)`
      )
      .run()
    fresh
      .prepare(`UPDATE settings SET value = 'Owner Renamed This' WHERE key = 'business_name'`)
      .run()

    seedData(fresh)
    seedData(fresh)

    expect(fresh.prepare('SELECT COUNT(*) AS n FROM pool_inventory_items').get().n).toBe(1)
    expect(
      fresh.prepare('SELECT current_stock FROM pool_inventory_items').get().current_stock
    ).toBe(12)
    // The `seeded` guard means an upgrade cannot overwrite settings either.
    expect(
      fresh.prepare(`SELECT value FROM settings WHERE key = 'business_name'`).get().value
    ).toBe('Owner Renamed This')
  })

  it('keeps the sample catalogue reachable behind an explicit opt-in', () => {
    const fresh = freshDb()
    expect(sampleCatalogue.products.length).toBeGreaterThan(0)
    expect(sampleCatalogue.poolItems.length).toBeGreaterThan(0)
    expect(sampleCatalogue.restaurantItems.length).toBeGreaterThan(0)

    const res = loadSampleCatalogue(fresh)
    expect(res.products).toBe(sampleCatalogue.products.length)
    expect(fresh.prepare('SELECT COUNT(*) AS n FROM pool_inventory_items').get().n).toBe(
      sampleCatalogue.poolItems.length
    )

    // Loading it twice must not duplicate the catalogue.
    const again = loadSampleCatalogue(fresh)
    expect(again.poolItems).toBe(0)
    expect(fresh.prepare('SELECT COUNT(*) AS n FROM pool_inventory_items').get().n).toBe(
      sampleCatalogue.poolItems.length
    )
  })
})
