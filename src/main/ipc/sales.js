import { ipcMain } from 'electron'
import { getDb } from '../db/index.js'
import { requireStaffOrOwner } from '../session.js'
import { requireAmount, requirePaymentMethod, requireText, todayLocal } from './utils.js'
import { resolvePrice, round2 } from './pricing.js'
import { writeAudit } from '../audit.js'

// A sale is a header + lines + payments. `transactions` keeps its role as the
// header — amount is still the sale total — and the lines say what made it up
// while the payments say how much of it has actually been collected. That is
// what lets one sale hold three tickets, a day pass next to a pair of goggles,
// an adult next to a child, a discount, and a deposit now with the balance
// later, none of which the one-product/one-amount row could express.
//
// The renderer never sends a price or an amount for goods: it sends what the
// customer picked, and the till decides what that costs (see pricing.js).

function wrap(handler) {
  return async (_event, payload) => {
    try {
      return await handler(payload || {})
    } catch (err) {
      return { success: false, error: err.message }
    }
  }
}

const KINDS = ['product', 'pool_item', 'menu_item', 'membership']
const MAX_LINE_QUANTITY = 999
// Money comparisons on REALs need slack, or a total that is arithmetically
// exact fails a > check by 1e-13 and refuses a legitimate full payment.
const EPSILON = 1e-9

function requireQuantity(value) {
  const qty = Number(value ?? 1)
  if (!Number.isInteger(qty) || qty <= 0 || qty > MAX_LINE_QUANTITY) {
    throw new Error(`Quantity must be a whole number from 1 to ${MAX_LINE_QUANTITY}`)
  }
  return qty
}

// Every item that has to come off a shelf, keyed so the SAME item appearing on
// two lines is one claim on stock. Checking per line would let a cart holding
// "goggles x6" twice pass against 10 in stock and leave 2 behind on a shelf
// that only ever held 10.
function stockKey(table, itemId) {
  return `${table}:${itemId}`
}

function addStockNeed(needs, { movementTable, itemTable, itemId, name, quantity }) {
  const key = stockKey(itemTable, itemId)
  const existing = needs.get(key)
  if (existing) existing.quantity += quantity
  else needs.set(key, { movementTable, itemTable, itemId, name, quantity })
}

// Resolve one cart entry against the catalogue. Nothing the payload says about
// money is read here except the discount, which is an explicit decision a human
// has to justify — the unit price always comes from the catalogue or a price
// rule, so a tampered or buggy renderer cannot mis-price a sale.
function priceLine(db, entry, { date, needs }) {
  const kind = String(entry?.kind || '')
  if (!KINDS.includes(kind)) throw new Error(`Unknown line kind: ${entry?.kind}`)

  const quantity = requireQuantity(entry.quantity)
  const refId = entry.refId
  const tier = entry.tier ?? null

  let unitPrice
  let description
  let lineTier = null

  if (kind === 'product' || kind === 'membership') {
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(refId)
    if (!product) throw new Error('Product not found')
    if (!product.is_active) throw new Error(`${product.name} is no longer sold`)
    if (kind === 'membership' && product.category !== 'membership') {
      throw new Error(`${product.name} is not a membership`)
    }
    const priced = resolvePrice(db, { productId: refId, tier, date })
    unitPrice = priced.unitPrice
    lineTier = priced.tier
    description = product.name
  } else if (kind === 'pool_item') {
    // Tiers are a property of a price rule, and price rules are per product. A
    // tier on a goggles line would be silently ignored, which reads on screen
    // as a child discount that was never applied.
    if (tier) throw new Error('Tier pricing applies to products, not inventory items')
    const item = db.prepare('SELECT * FROM pool_inventory_items WHERE id = ?').get(refId)
    if (!item) throw new Error('Item not found')
    if (!item.is_active) throw new Error(`${item.name} is no longer stocked`)
    if (!(item.selling_price > 0)) throw new Error(`${item.name} has no selling price`)
    unitPrice = round2(item.selling_price)
    description = item.variant ? `${item.name} (${item.variant})` : item.name
    addStockNeed(needs, {
      movementTable: 'pool_inventory_transactions',
      itemTable: 'pool_inventory_items',
      itemId: item.id,
      name: description,
      quantity
    })
  } else {
    if (tier) throw new Error('Tier pricing applies to products, not menu items')
    const item = db.prepare(`
      SELECT *,
             CASE
               WHEN manually_unavailable_at IS NOT NULL
                    AND date(manually_unavailable_at) = date('now','localtime')
               THEN 1 ELSE 0
             END AS manuallyUnavailableToday
      FROM restaurant_menu_items WHERE id = ?
    `).get(refId)
    if (!item) throw new Error('Menu item not found')
    if (!item.is_active) throw new Error(`${item.name} is unavailable`)
    if (item.manuallyUnavailableToday) {
      throw new Error(`${item.name} is marked unavailable today`)
    }
    unitPrice = round2(item.price)
    description = item.name
    if (item.inventory_item_id) {
      const stock = db
        .prepare('SELECT id, name, is_active FROM restaurant_inventory_items WHERE id = ?')
        .get(item.inventory_item_id)
      // A dangling or deactivated link must stop the sale, not quietly skip the
      // draw-down: a deactivated stock item is invisible in every list and
      // alert, so its shelf would drain unnoticed.
      if (!stock) throw new Error(`Stock item missing for ${item.name}`)
      if (!stock.is_active)
        throw new Error(`${stock.name} is no longer stocked — ${item.name} cannot be sold`)
      addStockNeed(needs, {
        movementTable: 'restaurant_inventory_transactions',
        itemTable: 'restaurant_inventory_items',
        itemId: stock.id,
        name: stock.name,
        quantity
      })
    }
  }

  const gross = round2(unitPrice * quantity)
  const discount = round2(requireAmount(entry.discount, 'Discount', 0))
  // A discount with no reason is money leaving the till with nothing to audit —
  // it is exactly how staff theft and "friend prices" hide. Refuse it.
  const discountReason = discount > 0 ? requireText(entry.discountReason, 'Discount reason') : null
  if (discount > gross + EPSILON) {
    throw new Error(
      `Discount of Rs. ${discount} is more than the ${description} line (Rs. ${gross})`
    )
  }

  return {
    kind,
    refId: refId ?? null,
    description,
    tier: lineTier,
    quantity,
    unitPrice,
    lineDiscount: discount,
    discountReason,
    lineTotal: round2(gross - discount)
  }
}

// Price a whole cart without writing anything. Shared by sales:quote (so the UI
// can show a live total) and sales:create (so the total it writes is the one it
// quoted) — a second implementation would drift the moment either was touched.
function priceCart(db, cart, { date }) {
  const entries = Array.isArray(cart) ? cart : []
  const needs = new Map()
  const lines = entries.map((entry) => priceLine(db, entry, { date, needs }))
  const subtotal = round2(lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0))
  const discountTotal = round2(lines.reduce((sum, l) => sum + l.lineDiscount, 0))
  return {
    lines,
    subtotal,
    discountTotal,
    total: round2(subtotal - discountTotal),
    stockNeeds: [...needs.values()]
  }
}

// Reads live stock for every item the cart claims. Called inside the sale's
// transaction so the check and the draw-down cannot be separated.
function stockShortfalls(db, stockNeeds) {
  return stockNeeds
    .map((need) => {
      const row = db
        .prepare(`SELECT current_stock FROM ${need.itemTable} WHERE id = ?`)
        .get(need.itemId)
      const available = row ? row.current_stock : 0
      return { name: need.name, needed: need.quantity, available }
    })
    .filter((s) => s.needed > s.available)
}

function assertStockAvailable(db, stockNeeds) {
  const short = stockShortfalls(db, stockNeeds)
  if (short.length) {
    const first = short[0]
    throw new Error(`Not enough stock for ${first.name}: only ${first.available} left`)
  }
}

// A cart can mix things the old single-type header cannot express, but every
// report, filter and EOD breakdown reads transaction_type — so pick the type of
// whichever line carries the most money, preferring the catalogue product
// (a day pass sold with goggles is a day-pass sale that also had goggles).
function deriveHeader(db, lines) {
  const catalogue = lines.filter((l) => l.kind === 'product' || l.kind === 'membership')
  if (catalogue.length) {
    const dominant = catalogue.reduce((a, b) => (b.lineTotal > a.lineTotal ? b : a))
    const product = db.prepare('SELECT category FROM products WHERE id = ?').get(dominant.refId)
    return {
      transactionType: product?.category || 'day_pass',
      // Restaurant lines can ride along, but a product sale belongs to the pool
      // side of the business, which is where its revenue is reported.
      source: 'pool',
      productId: dominant.refId
    }
  }
  const hasPool = lines.some((l) => l.kind === 'pool_item')
  return {
    transactionType: hasPool ? 'pool_inventory' : 'restaurant',
    source: hasPool ? 'pool' : 'restaurant',
    productId: null
  }
}

// The renderer may send `payments: [{ amount, method }]` (a split or a part
// payment), or the `paymentMethod` shorthand meaning "paid in full, this way".
// An explicit empty array is a sale taken on account — nothing collected yet.
function normalisePayments({ payments, paymentMethod }, total) {
  if (payments === undefined || payments === null) {
    if (!paymentMethod) throw new Error('Payment method is required')
    return total > 0 ? [{ amount: total, method: requirePaymentMethod(paymentMethod) }] : []
  }
  if (!Array.isArray(payments)) throw new Error('Payments must be a list')
  return payments.map((p) => ({
    amount: requirePositivePayment(p?.amount),
    method: requirePaymentMethod(p?.method ?? p?.paymentMethod)
  }))
}

function requirePositivePayment(value) {
  const amount = round2(requireAmount(value, 'Payment amount'))
  if (!(amount > 0)) throw new Error('Payment amount must be more than zero')
  return amount
}

// A part-paid sale still needs ONE payment_method on the header, because that
// is what the EOD cash/QR split reads. The biggest payment is the honest answer
// (cash wins a tie); an unpaid sale defaults to cash and is corrected the
// moment a payment lands.
function headerPaymentMethod(payments) {
  if (!payments.length) return 'cash'
  return payments.reduce((a, b) => (b.amount > a.amount ? b : a)).method
}

function paidSoFar(db, saleId) {
  return round2(
    db
      .prepare(
        'SELECT COALESCE(SUM(amount), 0) AS paid FROM transaction_payments WHERE transaction_id = ?'
      )
      .get(saleId).paid
  )
}

function loadSale(db, saleId) {
  const sale = db
    .prepare(
      `SELECT t.*, u.name AS staff_name FROM transactions t
       LEFT JOIN users u ON u.id = t.staff_id WHERE t.id = ?`
    )
    .get(saleId)
  if (!sale) throw new Error('Sale not found')
  const lines = db
    .prepare('SELECT * FROM transaction_lines WHERE transaction_id = ? ORDER BY id')
    .all(saleId)
    .map((l) => ({
      id: l.id,
      kind: l.kind,
      refId: l.ref_id,
      description: l.description,
      tier: l.tier,
      quantity: l.quantity,
      unitPrice: l.unit_price,
      lineDiscount: l.line_discount,
      discountReason: l.discount_reason,
      lineTotal: l.line_total
    }))
  const payments = db
    .prepare('SELECT * FROM transaction_payments WHERE transaction_id = ? ORDER BY id')
    .all(saleId)
    .map((p) => ({
      id: p.id,
      amount: p.amount,
      method: p.payment_method,
      paidAt: p.paid_at,
      staffId: p.staff_id
    }))
  const paid = round2(payments.reduce((sum, p) => sum + p.amount, 0))
  return {
    id: sale.id,
    customer: sale.customer_name,
    phone: sale.phone,
    memberId: sale.member_id,
    type: sale.transaction_type,
    source: sale.source,
    // The header total, which is what every report reads — not a re-sum of the
    // lines, so a caller can see immediately if the two ever disagree.
    total: sale.amount,
    paid,
    balance: round2(sale.amount - paid),
    paymentMethod: sale.payment_method,
    staffId: sale.staff_id,
    staff: sale.staff_name,
    notes: sale.notes,
    isVoided: !!sale.is_voided,
    createdAt: sale.created_at,
    lines,
    payments
  }
}

export function registerSalesHandlers() {
  // Price a cart without touching the database, so the till can show a running
  // total that is exactly what checkout will charge.
  ipcMain.handle(
    'sales:quote',
    wrap(({ cart, date } = {}) => {
      requireStaffOrOwner()
      const db = getDb()
      // An empty cart is the till's opening state, not an error.
      if (!cart?.length) {
        return { success: true, lines: [], subtotal: 0, discountTotal: 0, total: 0, shortfalls: [] }
      }
      const priced = priceCart(db, cart, { date: date || todayLocal() })
      return {
        success: true,
        lines: priced.lines,
        subtotal: priced.subtotal,
        discountTotal: priced.discountTotal,
        total: priced.total,
        // Advisory only — the binding check happens inside the sale.
        shortfalls: stockShortfalls(db, priced.stockNeeds)
      }
    })
  )

  // One db.transaction() for the whole sale: header, lines, payments and every
  // stock movement land together or not at all. A sale that half-wrote would be
  // money on the ledger with nothing sold, or stock off the shelf with nothing
  // to show for it.
  ipcMain.handle(
    'sales:create',
    // staffId, prices and totals are all derived here; anything the payload
    // says about them is ignored (they are not even destructured).
    wrap(({ customerName, phone, memberId, notes, cart, payments, paymentMethod } = {}) => {
      const session = requireStaffOrOwner()
      const staffId = session.userId
      const db = getDb()
      if (!cart?.length) throw new Error('Cart is empty')

      // The server clock, never a date from the payload: letting the cart pick
      // the date would let it pick the Saturday rate on a Tuesday.
      const priced = priceCart(db, cart, { date: todayLocal() })
      const collected = normalisePayments({ payments, paymentMethod }, priced.total)
      const paid = round2(collected.reduce((sum, p) => sum + p.amount, 0))
      // Taking more than the sale is worth turns the till into a black hole: the
      // day's cash no longer reconciles and there is no record of a refund.
      if (paid > priced.total + EPSILON) {
        throw new Error(`Payments (Rs. ${paid}) are more than the sale total (Rs. ${priced.total})`)
      }

      const header = deriveHeader(db, priced.lines)
      const summary = priced.lines.map((l) => `${l.description} x${l.quantity}`).join(', ')

      const run = db.transaction(() => {
        // Inside the transaction, so the check and the draw-down cannot drift.
        assertStockAvailable(db, priced.stockNeeds)

        const saleId = db
          .prepare(
            `INSERT INTO transactions
             (transaction_type, source, customer_name, phone, product_id, member_id, amount,
              payment_method, staff_id, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            header.transactionType,
            header.source,
            customerName?.trim() || 'Walk-in',
            phone || null,
            header.productId,
            memberId || null,
            priced.total,
            headerPaymentMethod(collected),
            staffId,
            notes ? `${summary} — ${notes}` : summary
          ).lastInsertRowid

        const insertLine = db.prepare(
          `INSERT INTO transaction_lines
           (transaction_id, kind, ref_id, description, tier, quantity, unit_price,
            line_discount, discount_reason, line_total)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        for (const line of priced.lines) {
          insertLine.run(
            saleId,
            line.kind,
            line.refId,
            line.description,
            line.tier,
            line.quantity,
            line.unitPrice,
            line.lineDiscount,
            line.discountReason,
            line.lineTotal
          )
        }

        const insertPayment = db.prepare(
          `INSERT INTO transaction_payments (transaction_id, amount, payment_method, staff_id)
           VALUES (?, ?, ?, ?)`
        )
        for (const payment of collected) {
          insertPayment.run(saleId, payment.amount, payment.method, staffId)
        }

        // One movement row per LINE (not per item) so the price actually charged
        // stays attached to the units that moved — void and refund reversals
        // replay these rows to put stock back at the right price.
        for (const line of priced.lines) {
          if (line.kind === 'pool_item') {
            drawDown(db, {
              movementTable: 'pool_inventory_transactions',
              itemTable: 'pool_inventory_items',
              itemId: line.refId,
              line,
              saleId,
              staffId
            })
          } else if (line.kind === 'menu_item') {
            const menuItem = db
              .prepare('SELECT inventory_item_id FROM restaurant_menu_items WHERE id = ?')
              .get(line.refId)
            if (menuItem?.inventory_item_id) {
              drawDown(db, {
                movementTable: 'restaurant_inventory_transactions',
                itemTable: 'restaurant_inventory_items',
                itemId: menuItem.inventory_item_id,
                line,
                saleId,
                staffId
              })
            }
          }
        }

        return saleId
      })

      const saleId = run()
      if (priced.discountTotal > 0) {
        writeAudit(session.userId, 'sale:discount', {
          saleId,
          discountTotal: priced.discountTotal,
          reasons: priced.lines
            .filter((l) => l.lineDiscount > 0)
            .map((l) => ({
              description: l.description,
              amount: l.lineDiscount,
              reason: l.discountReason
            }))
        })
      }
      return {
        success: true,
        saleId,
        // Same row — every existing caller of the old path speaks transactionId.
        transactionId: saleId,
        total: priced.total,
        paid,
        balance: round2(priced.total - paid),
        lines: priced.lines
      }
    })
  )

  ipcMain.handle(
    'sales:get',
    wrap(({ saleId } = {}) => {
      requireStaffOrOwner()
      return { success: true, sale: loadSale(getDb(), saleId) }
    })
  )

  // The balance of a part-paid sale, collected later. Staff id comes from the
  // session so the ledger shows who actually took the money, not who sold it.
  ipcMain.handle(
    'sales:add-payment',
    wrap(({ saleId, amount, method, paymentMethod } = {}) => {
      const session = requireStaffOrOwner()
      const db = getDb()
      const sale = db.prepare('SELECT * FROM transactions WHERE id = ?').get(saleId)
      if (!sale) throw new Error('Sale not found')
      if (sale.is_voided) throw new Error('This sale has been voided')
      if (sale.transaction_type === 'refund') throw new Error('A refund cannot take a payment')

      const pay = requirePositivePayment(amount)
      const already = paidSoFar(db, saleId)
      const balance = round2(sale.amount - already)
      if (pay > balance + EPSILON) {
        throw new Error(`Only Rs. ${balance} is outstanding on this sale`)
      }
      db.prepare(
        `INSERT INTO transaction_payments (transaction_id, amount, payment_method, staff_id)
         VALUES (?, ?, ?, ?)`
      ).run(saleId, pay, requirePaymentMethod(method ?? paymentMethod), session.userId)

      const paid = round2(already + pay)
      return { success: true, paid, balance: round2(sale.amount - paid) }
    })
  )

  // Sales whose payments do not yet cover their total — the money the business
  // is still owed, which the old model could not represent at all.
  ipcMain.handle(
    'sales:outstanding',
    wrap(({ limit } = {}) => {
      requireStaffOrOwner()
      let sql = `
        SELECT t.id, t.customer_name, t.phone, t.amount, t.created_at, t.transaction_type,
               COALESCE((SELECT SUM(p.amount) FROM transaction_payments p
                          WHERE p.transaction_id = t.id), 0) AS paid
        FROM transactions t
        WHERE t.is_voided = 0
          AND t.transaction_type != 'refund'
          AND EXISTS (SELECT 1 FROM transaction_lines l WHERE l.transaction_id = t.id)
          AND t.amount - COALESCE((SELECT SUM(p.amount) FROM transaction_payments p
                                    WHERE p.transaction_id = t.id), 0) > ?
        ORDER BY t.created_at DESC, t.id DESC
      `
      const params = [EPSILON]
      if (limit != null) {
        sql += ' LIMIT ?'
        params.push(Number(limit))
      }
      const sales = getDb()
        .prepare(sql)
        .all(...params)
        .map((r) => ({
          id: r.id,
          customer: r.customer_name,
          phone: r.phone,
          type: r.transaction_type,
          total: r.amount,
          paid: round2(r.paid),
          balance: round2(r.amount - r.paid),
          createdAt: r.created_at
        }))
      return {
        success: true,
        sales,
        totalOutstanding: round2(sales.reduce((s, r) => s + r.balance, 0))
      }
    })
  )
}

function drawDown(db, { movementTable, itemTable, itemId, line, saleId, staffId }) {
  db.prepare(
    `INSERT INTO ${movementTable} (item_id, txn_type, quantity, transaction_id, staff_id, unit_price)
     VALUES (?, 'out', ?, ?, ?, ?)`
  ).run(itemId, line.quantity, saleId, staffId, line.unitPrice)
  // ROUND keeps a fractional restaurant stock (0.3 kg) from accumulating float
  // dust; it is a no-op for whole pool units.
  db.prepare(
    `UPDATE ${itemTable} SET current_stock = ROUND(current_stock - ?, 3) WHERE id = ?`
  ).run(line.quantity, itemId)
}
