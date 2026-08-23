import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { __invoke } from 'electron'
import { runMigrations } from '../src/main/db/migrations.js'
import { freshDb, seed, loginStaff, loginOwner } from './helpers.js'
import { registerSalesHandlers } from '../src/main/ipc/sales.js'
import { registerPricingHandlers } from '../src/main/ipc/pricing.js'

let db
let ids

beforeEach(() => {
  db = freshDb()
  ids = seed(db)
  // helpers.js wires the pre-existing modules; the sale model registers its own.
  registerPricingHandlers()
  registerSalesHandlers()
})

const dayPass = (extra = {}) => ({ kind: 'product', refId: ids.dayPassId, quantity: 1, ...extra })
const goggles = (extra = {}) => ({
  kind: 'pool_item',
  refId: ids.poolItemId,
  quantity: 1,
  ...extra
})

function linesOf(saleId) {
  return db
    .prepare('SELECT * FROM transaction_lines WHERE transaction_id = ? ORDER BY id')
    .all(saleId)
}
function paymentsOf(saleId) {
  return db
    .prepare('SELECT * FROM transaction_payments WHERE transaction_id = ? ORDER BY id')
    .all(saleId)
}
function poolStock() {
  return db
    .prepare('SELECT current_stock FROM pool_inventory_items WHERE id = ?')
    .get(ids.poolItemId).current_stock
}

describe('sales:create — a mixed cart is one sale', () => {
  it('writes one transaction whose amount is the sum of its lines', async () => {
    loginStaff(ids)
    const res = await __invoke('sales:create', {
      customerName: 'Ram',
      cart: [dayPass(), goggles()],
      paymentMethod: 'cash'
    })
    expect(res.success).toBe(true)
    expect(res.total).toBe(500) // 300 day pass + 200 goggles

    const header = db.prepare('SELECT * FROM transactions WHERE id = ?').get(res.saleId)
    const lines = linesOf(res.saleId)
    expect(lines).toHaveLength(2)
    expect(header.amount).toBe(lines.reduce((s, l) => s + l.line_total, 0))
    // Invariant: transactions.amount stays the sale total for every report.
    expect(header.amount).toBe(500)
    expect(header.staff_id).toBe(ids.staffId)
    // A day pass sold with goggles is still a day-pass sale.
    expect(header.transaction_type).toBe('day_pass')
    expect(paymentsOf(res.saleId)).toHaveLength(1)
    expect(poolStock()).toBe(9)
  })

  it('multiplies by quantity on every line', async () => {
    loginStaff(ids)
    const res = await __invoke('sales:create', {
      cart: [dayPass({ quantity: 3 }), goggles({ quantity: 2 })],
      paymentMethod: 'qr'
    })
    expect(res.total).toBe(300 * 3 + 200 * 2)
    const lines = linesOf(res.saleId)
    expect(lines.map((l) => [l.quantity, l.unit_price, l.line_total])).toEqual([
      [3, 300, 900],
      [2, 200, 400]
    ])
    expect(poolStock()).toBe(8)
  })

  it('prices an adult and a child differently on the same sale', async () => {
    loginOwner(ids)
    await __invoke('pricing:set-rule', {
      productId: ids.dayPassId,
      tier: 'adult',
      price: 700,
      activeFrom: '2000-01-01'
    })
    await __invoke('pricing:set-rule', {
      productId: ids.dayPassId,
      tier: 'child',
      price: 500,
      activeFrom: '2000-01-01'
    })
    loginStaff(ids)

    const res = await __invoke('sales:create', {
      cart: [dayPass({ tier: 'adult', quantity: 2 }), dayPass({ tier: 'child' })],
      paymentMethod: 'cash'
    })
    expect(res.total).toBe(700 * 2 + 500)
    const lines = linesOf(res.saleId)
    expect(lines.map((l) => [l.tier, l.unit_price])).toEqual([
      ['adult', 700],
      ['child', 500]
    ])
  })
})

describe('sales — prices are derived server-side', () => {
  it('ignores a unit price, an amount and a staff id sent in the payload', async () => {
    loginStaff(ids)
    const res = await __invoke('sales:create', {
      cart: [dayPass({ unitPrice: 1, price: 1, lineTotal: 1, amount: 1 })],
      amount: 1,
      total: 1,
      staffId: ids.ownerId,
      paymentMethod: 'cash'
    })
    expect(res.total).toBe(300)
    const header = db.prepare('SELECT * FROM transactions WHERE id = ?').get(res.saleId)
    expect(header.amount).toBe(300)
    expect(header.staff_id).toBe(ids.staffId)
    expect(linesOf(res.saleId)[0].unit_price).toBe(300)
  })

  it('quotes the same total it charges, and writes nothing', async () => {
    loginStaff(ids)
    const before = db.prepare('SELECT COUNT(*) c FROM transactions').get().c
    const quote = await __invoke('sales:quote', { cart: [dayPass({ quantity: 2 }), goggles()] })
    expect(quote.total).toBe(800)
    expect(quote.lines).toHaveLength(2)
    expect(db.prepare('SELECT COUNT(*) c FROM transactions').get().c).toBe(before)
    expect(db.prepare('SELECT COUNT(*) c FROM transaction_lines').get().c).toBe(0)
    expect(poolStock()).toBe(10)

    const res = await __invoke('sales:create', {
      cart: [dayPass({ quantity: 2 }), goggles()],
      paymentMethod: 'cash'
    })
    expect(res.total).toBe(quote.total)
  })

  it('quotes an empty cart as zero rather than an error', async () => {
    loginStaff(ids)
    const quote = await __invoke('sales:quote', { cart: [] })
    expect(quote.success).toBe(true)
    expect(quote.total).toBe(0)
  })
})

describe('sales — discounts', () => {
  it('rejects a discount with no reason and writes nothing', async () => {
    loginStaff(ids)
    const res = await __invoke('sales:create', {
      cart: [dayPass({ discount: 50 })],
      paymentMethod: 'cash'
    })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/Discount reason/)
    expect(db.prepare('SELECT COUNT(*) c FROM transaction_lines').get().c).toBe(0)
  })

  it('applies a discount with a reason and records both', async () => {
    loginStaff(ids)
    const res = await __invoke('sales:create', {
      cart: [dayPass({ discount: 50, discountReason: 'Staff family' })],
      paymentMethod: 'cash'
    })
    expect(res.total).toBe(250)
    const line = linesOf(res.saleId)[0]
    expect(line.line_discount).toBe(50)
    expect(line.discount_reason).toBe('Staff family')
    expect(db.prepare('SELECT amount FROM transactions WHERE id = ?').get(res.saleId).amount).toBe(
      250
    )
  })

  it('refuses a discount larger than the line', async () => {
    loginStaff(ids)
    const res = await __invoke('sales:create', {
      cart: [dayPass({ discount: 400, discountReason: 'Too generous' })],
      paymentMethod: 'cash'
    })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/more than/)
    expect(db.prepare('SELECT COUNT(*) c FROM transactions').get().c).toBe(0)
  })
})

describe('sales — payments', () => {
  it('leaves a correct outstanding balance after a part payment', async () => {
    loginStaff(ids)
    const res = await __invoke('sales:create', {
      cart: [dayPass({ quantity: 2 })],
      payments: [{ amount: 200, method: 'cash' }]
    })
    expect(res.total).toBe(600)
    expect(res.paid).toBe(200)
    expect(res.balance).toBe(400)

    const outstanding = await __invoke('sales:outstanding', {})
    expect(outstanding.sales.map((s) => [s.id, s.balance])).toEqual([[res.saleId, 400]])
    expect(outstanding.totalOutstanding).toBe(400)

    const second = await __invoke('sales:add-payment', {
      saleId: res.saleId,
      amount: 400,
      method: 'qr'
    })
    expect(second.balance).toBe(0)
    expect((await __invoke('sales:outstanding', {})).sales).toEqual([])

    const sale = (await __invoke('sales:get', { saleId: res.saleId })).sale
    expect(sale.payments.map((p) => [p.amount, p.method])).toEqual([
      [200, 'cash'],
      [400, 'qr']
    ])
    expect(sale.payments.every((p) => p.staffId === ids.staffId)).toBe(true)
  })

  it('rejects an over-payment at checkout and afterwards', async () => {
    loginStaff(ids)
    const over = await __invoke('sales:create', {
      cart: [dayPass()],
      payments: [{ amount: 500, method: 'cash' }]
    })
    expect(over.success).toBe(false)
    expect(over.error).toMatch(/more than the sale total/)
    expect(db.prepare('SELECT COUNT(*) c FROM transactions').get().c).toBe(0)

    const res = await __invoke('sales:create', {
      cart: [dayPass()],
      payments: [{ amount: 100, method: 'cash' }]
    })
    const late = await __invoke('sales:add-payment', { saleId: res.saleId, amount: 250 })
    expect(late.success).toBe(false)
    expect(late.error).toMatch(/Only Rs. 200 is outstanding/)
    expect(paymentsOf(res.saleId)).toHaveLength(1)
  })

  it('records a sale taken entirely on account', async () => {
    loginStaff(ids)
    const res = await __invoke('sales:create', { cart: [dayPass()], payments: [] })
    expect(res.paid).toBe(0)
    expect(res.balance).toBe(300)
    expect(paymentsOf(res.saleId)).toHaveLength(0)
    expect((await __invoke('sales:outstanding', {})).totalOutstanding).toBe(300)
  })

  it('requires a payment method when none is given at all', async () => {
    loginStaff(ids)
    const res = await __invoke('sales:create', { cart: [dayPass()] })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/Payment method is required/)
  })
})

describe('sales — stock can never go negative', () => {
  it('refuses an oversell and leaves no header, lines, payments or movement', async () => {
    loginStaff(ids)
    db.prepare('UPDATE pool_inventory_items SET current_stock = 1 WHERE id = ?').run(ids.poolItemId)
    const res = await __invoke('sales:create', {
      cart: [dayPass(), goggles({ quantity: 2 })],
      paymentMethod: 'cash'
    })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/Not enough stock/)
    expect(db.prepare('SELECT COUNT(*) c FROM transactions').get().c).toBe(0)
    expect(db.prepare('SELECT COUNT(*) c FROM transaction_lines').get().c).toBe(0)
    expect(db.prepare('SELECT COUNT(*) c FROM transaction_payments').get().c).toBe(0)
    expect(db.prepare('SELECT COUNT(*) c FROM pool_inventory_transactions').get().c).toBe(0)
    expect(poolStock()).toBe(1)
  })

  it('checks the same item listed twice against the TOTAL, not per line', async () => {
    loginStaff(ids)
    db.prepare('UPDATE pool_inventory_items SET current_stock = 10 WHERE id = ?').run(
      ids.poolItemId
    )
    const res = await __invoke('sales:create', {
      cart: [goggles({ quantity: 6 }), goggles({ quantity: 6 })],
      paymentMethod: 'cash'
    })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/Not enough stock/)
    expect(poolStock()).toBe(10)

    const ok = await __invoke('sales:create', {
      cart: [goggles({ quantity: 6 }), goggles({ quantity: 4 })],
      paymentMethod: 'cash'
    })
    expect(ok.success).toBe(true)
    expect(poolStock()).toBe(0)
    // One movement row per line, so a reversal can restore at the right price.
    expect(
      db
        .prepare('SELECT COUNT(*) c FROM pool_inventory_transactions WHERE transaction_id = ?')
        .get(ok.saleId).c
    ).toBe(2)
  })

  it('aggregates two menu items that draw on the same stock item', async () => {
    loginStaff(ids)
    const largeTea = db
      .prepare(
        `INSERT INTO restaurant_menu_items (name, category, price, inventory_item_id) VALUES ('Large Tea','bev',200,?)`
      )
      .run(ids.rInvId).lastInsertRowid
    db.prepare('UPDATE restaurant_inventory_items SET current_stock = 5 WHERE id = ?').run(
      ids.rInvId
    )

    const res = await __invoke('sales:create', {
      cart: [
        { kind: 'menu_item', refId: ids.menuLinkedId, quantity: 3 },
        { kind: 'menu_item', refId: largeTea, quantity: 3 }
      ],
      paymentMethod: 'cash'
    })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/Not enough stock/)
    expect(
      db
        .prepare('SELECT current_stock FROM restaurant_inventory_items WHERE id = ?')
        .get(ids.rInvId).current_stock
    ).toBe(5)
  })
})

describe("sales — 86'd menu items", () => {
  it('refuses a menu item marked unavailable today and writes nothing', async () => {
    loginStaff(ids)
    db.prepare(
      `UPDATE restaurant_menu_items SET manually_unavailable_at = datetime('now','localtime') WHERE id = ?`
    ).run(ids.menuLinkedId)
    const res = await __invoke('sales:create', {
      cart: [{ kind: 'menu_item', refId: ids.menuLinkedId, quantity: 1 }],
      paymentMethod: 'cash'
    })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/unavailable/i)
    expect(db.prepare('SELECT COUNT(*) c FROM transactions').get().c).toBe(0)
  })
})

describe('sales — a failure mid-sale writes nothing', () => {
  it('rolls back the whole sale when a later line is invalid', async () => {
    loginStaff(ids)
    const res = await __invoke('sales:create', {
      cart: [dayPass(), goggles(), { kind: 'product', refId: 99999, quantity: 1 }],
      paymentMethod: 'cash'
    })
    expect(res.success).toBe(false)
    expect(db.prepare('SELECT COUNT(*) c FROM transactions').get().c).toBe(0)
    expect(db.prepare('SELECT COUNT(*) c FROM transaction_lines').get().c).toBe(0)
    expect(db.prepare('SELECT COUNT(*) c FROM transaction_payments').get().c).toBe(0)
    expect(db.prepare('SELECT COUNT(*) c FROM pool_inventory_transactions').get().c).toBe(0)
    expect(poolStock()).toBe(10)
  })

  it('rolls back when the stock disappears between pricing and writing', async () => {
    loginStaff(ids)
    // Simulate the shelf emptying under us: the availability check runs inside
    // the sale's transaction, so the whole thing must come back out.
    db.prepare('UPDATE pool_inventory_items SET current_stock = 0 WHERE id = ?').run(ids.poolItemId)
    const res = await __invoke('sales:create', {
      cart: [dayPass(), goggles()],
      paymentMethod: 'cash'
    })
    expect(res.success).toBe(false)
    expect(db.prepare('SELECT COUNT(*) c FROM transactions').get().c).toBe(0)
    expect(db.prepare('SELECT COUNT(*) c FROM transaction_lines').get().c).toBe(0)
  })
})

describe('sales — session and access', () => {
  it('refuses to sell to nobody', async () => {
    const res = await __invoke('sales:create', { cart: [dayPass()], paymentMethod: 'cash' })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/Not authenticated/)
  })
})

// ── the migration back-fill ─────────────────────────────────────────────────
//
// Same shape as test/migration.test.js: a database as an OLD install left it,
// migrated forwards, so the back-fill is exercised against real history rather
// than against rows this suite just wrote.
function oldDatabase() {
  const database = new Database(':memory:')
  database.pragma('foreign_keys = ON')
  database.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE members (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE restaurant_inventory_items (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE pool_inventory_items (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE transactions (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_type TEXT NOT NULL CHECK(transaction_type IN ('membership','day_package','day_pass','pool_inventory','restaurant')),
      source           TEXT NOT NULL DEFAULT 'pool' CHECK(source IN ('pool','restaurant')),
      customer_name    TEXT NOT NULL,
      phone            TEXT,
      product_id       INTEGER,
      member_id        INTEGER,
      amount           REAL NOT NULL,
      payment_method   TEXT NOT NULL CHECK(payment_method IN ('cash','qr')),
      staff_id         INTEGER NOT NULL,
      notes            TEXT,
      is_voided        INTEGER DEFAULT 0,
      void_reason      TEXT,
      void_by          INTEGER,
      void_at          TEXT,
      created_at       TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE memberships (id INTEGER PRIMARY KEY, member_id INTEGER, product_id INTEGER,
      transaction_id INTEGER REFERENCES transactions(id), start_date TEXT, end_date TEXT, status TEXT);
    CREATE TABLE pool_inventory_transactions (id INTEGER PRIMARY KEY, item_id INTEGER, txn_type TEXT,
      quantity INTEGER, transaction_id INTEGER REFERENCES transactions(id), staff_id INTEGER);
    CREATE TABLE restaurant_inventory_transactions (id INTEGER PRIMARY KEY, item_id INTEGER, txn_type TEXT,
      quantity REAL, transaction_id INTEGER REFERENCES transactions(id), staff_id INTEGER);
    CREATE TABLE bookings (id INTEGER PRIMARY KEY, booking_name TEXT, deposit_paid REAL);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
  `)
  database.prepare(`INSERT INTO users (id, name) VALUES (1,'Staff')`).run()
  database.prepare(`INSERT INTO products (id, name) VALUES (1,'Monthly')`).run()
  database
    .prepare(
      `INSERT INTO transactions (id, transaction_type, source, customer_name, product_id, amount, payment_method, staff_id)
       VALUES (7,'membership','pool','Ram',1,1000,'cash',1)`
    )
    .run()
  // A restaurant sale: no product id at all, only a note — the shape that has
  // to survive the back-fill without inventing an item id.
  database
    .prepare(
      `INSERT INTO transactions (id, transaction_type, source, customer_name, amount, payment_method, staff_id, notes)
       VALUES (8,'restaurant','restaurant','Walk-in',250,'qr',1,'Tea x2')`
    )
    .run()
  // A voided sale still belongs in history.
  database
    .prepare(
      `INSERT INTO transactions (id, transaction_type, source, customer_name, amount, payment_method, staff_id, is_voided)
       VALUES (9,'pool_inventory','pool','Walk-in',200,'cash',1,1)`
    )
    .run()
  return database
}

describe('migration back-fill — history renders through the same code path', () => {
  it('gives every pre-existing transaction exactly one line and one payment', () => {
    const old = oldDatabase()
    runMigrations(old)

    const counts = old
      .prepare(
        `SELECT t.id,
                (SELECT COUNT(*) FROM transaction_lines l WHERE l.transaction_id = t.id) AS lines,
                (SELECT COUNT(*) FROM transaction_payments p WHERE p.transaction_id = t.id) AS payments
         FROM transactions t ORDER BY t.id`
      )
      .all()
    expect(counts).toEqual([
      { id: 7, lines: 1, payments: 1 },
      { id: 8, lines: 1, payments: 1 },
      { id: 9, lines: 1, payments: 1 }
    ])

    // The line reproduces the sale total, so header and lines agree.
    const membership = old.prepare('SELECT * FROM transaction_lines WHERE transaction_id = 7').get()
    expect(membership.kind).toBe('membership')
    expect(membership.ref_id).toBe(1)
    expect(membership.description).toBe('Monthly')
    expect(membership.quantity).toBe(1)
    expect(membership.line_total).toBe(1000)

    // A restaurant sale had no item id — the note is the honest description.
    const restaurant = old.prepare('SELECT * FROM transaction_lines WHERE transaction_id = 8').get()
    expect(restaurant.ref_id).toBe(null)
    expect(restaurant.description).toBe('Tea x2')

    // Old sales were paid in full, by the method and on the date of the header.
    const payment = old.prepare('SELECT * FROM transaction_payments WHERE transaction_id = 8').get()
    expect(payment.amount).toBe(250)
    expect(payment.payment_method).toBe('qr')
    expect(payment.staff_id).toBe(1)

    // Nothing is left looking outstanding.
    const unpaid = old
      .prepare(
        `SELECT COUNT(*) c FROM transactions t
         WHERE t.amount > COALESCE((SELECT SUM(p.amount) FROM transaction_payments p WHERE p.transaction_id = t.id), 0)`
      )
      .get().c
    expect(unpaid).toBe(0)
    old.close()
  })

  it('is idempotent — a second run adds nothing and does not throw', () => {
    const old = oldDatabase()
    runMigrations(old)
    const version = old.pragma('user_version', { simple: true })
    const before = old.prepare('SELECT COUNT(*) c FROM transaction_lines').get().c

    expect(() => runMigrations(old)).not.toThrow()
    expect(old.pragma('user_version', { simple: true })).toBe(version)
    expect(old.prepare('SELECT COUNT(*) c FROM transaction_lines').get().c).toBe(before)
    expect(old.prepare('SELECT COUNT(*) c FROM transaction_payments').get().c).toBe(3)
    expect(old.pragma('foreign_key_check')).toEqual([])
    old.close()
  })

  it('leaves a brand-new database with the sale-model tables and no stray rows', () => {
    expect(db.prepare('SELECT COUNT(*) c FROM transaction_lines').get().c).toBe(0)
    expect(db.prepare('SELECT COUNT(*) c FROM price_rules').get().c).toBe(0)
  })
})
