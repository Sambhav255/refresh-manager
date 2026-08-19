import { ipcMain } from 'electron'
import { getDb } from '../db/index.js'
import { requireOwner, requireStaffOrOwner } from '../session.js'
import { requireAmount, todayLocal } from './utils.js'
import { writeAudit } from '../audit.js'

// Price rules: what a product costs for a given tier, on a given weekday, from
// a given date. The centre charges a child less than an adult and everyone less
// on a Saturday — facts about THIS business that used to have nowhere to live,
// so staff typed the difference in by hand and the till total was whatever they
// typed. Nothing is seeded here: the owner enters their own rates, and until
// they do, products.price is still the price.

function wrap(handler) {
  return async (_event, payload) => {
    try {
      return await handler(payload || {})
    } catch (err) {
      return { success: false, error: err.message }
    }
  }
}

const TIERS = ['adult', 'child']

// Rupees, rounded to paisa — REAL arithmetic on 3 × 233.33 otherwise leaves
// dust that shows up as a 1-paisa gap between a sale's amount and its lines.
export function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100
}

export function normaliseDate(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  return todayLocal()
}

// 0 = Sunday … 6 = Saturday, matching both JS getDay() and SQLite strftime('%w').
export function dayOfWeekFor(date) {
  return new Date(`${normaliseDate(date)}T00:00:00`).getDay()
}

function normaliseTier(value) {
  if (value === undefined || value === null || value === '') return null
  const tier = String(value).toLowerCase()
  if (!TIERS.includes(tier)) throw new Error(`Unknown price tier: ${value}`)
  return tier
}

function normaliseDayOfWeek(value) {
  if (value === undefined || value === null || value === '') return null
  const day = Number(value)
  if (!Number.isInteger(day) || day < 0 || day > 6) {
    throw new Error('Day must be 0 (Sunday) to 6 (Saturday)')
  }
  return day
}

// The one place a price is decided. Most specific rule wins:
//   product + tier + day  →  product + tier  →  product + day  →  product (rule)
//   →  products.price
// Ties inside a band go to the rule that started most recently, so entering a
// new rate for the same slot supersedes the old one instead of racing it.
// Rules that have not started yet (active_from in the future) are ignored,
// which is what lets the owner enter next month's rates today.
export function resolvePrice(db, { productId, tier, date } = {}) {
  const product = db
    .prepare('SELECT id, name, price, is_active FROM products WHERE id = ?')
    .get(productId)
  if (!product) throw new Error('Product not found')

  const on = normaliseDate(date)
  const wantTier = normaliseTier(tier)
  const day = dayOfWeekFor(on)

  const rule = db
    .prepare(
      `SELECT * FROM price_rules
       WHERE product_id = ?
         AND active_from <= ?
         AND (tier IS NULL OR tier = ?)
         AND (day_of_week IS NULL OR day_of_week = ?)
       ORDER BY (tier IS NOT NULL) DESC, (day_of_week IS NOT NULL) DESC,
                active_from DESC, id DESC
       LIMIT 1`
    )
    .get(productId, on, wantTier, day)

  return {
    productId: product.id,
    productName: product.name,
    tier: wantTier,
    date: on,
    dayOfWeek: day,
    unitPrice: round2(rule ? rule.price : product.price),
    // Lets the UI show "Saturday rate" rather than an unexplained number.
    source: rule ? 'rule' : 'product',
    ruleId: rule ? rule.id : null
  }
}

export function registerPricingHandlers() {
  // Readable by any signed-in user: staff need to see why the till is charging
  // Rs 500 today. Writing is a different matter — see below.
  ipcMain.handle(
    'pricing:list-rules',
    wrap(({ productId } = {}) => {
      requireStaffOrOwner()
      const db = getDb()
      const params = []
      let sql = `
        SELECT r.*, p.name AS product_name, p.price AS product_price
        FROM price_rules r
        JOIN products p ON p.id = r.product_id
      `
      if (productId) {
        sql += ' WHERE r.product_id = ?'
        params.push(productId)
      }
      sql +=
        ' ORDER BY p.name, r.tier IS NULL, r.tier, r.day_of_week IS NULL, r.day_of_week, r.active_from DESC'
      const rules = db
        .prepare(sql)
        .all(...params)
        .map((r) => ({
          id: r.id,
          productId: r.product_id,
          productName: r.product_name,
          productPrice: r.product_price,
          tier: r.tier,
          dayOfWeek: r.day_of_week,
          price: r.price,
          activeFrom: r.active_from
        }))
      return { success: true, rules }
    })
  )

  // Owner-only: a price rule IS the till total. Staff may sell at the rate, not
  // set it. Upsert on (product, tier, day, active_from) so re-entering today's
  // child rate corrects it rather than stacking a second rule behind it.
  ipcMain.handle(
    'pricing:set-rule',
    wrap(({ productId, tier, dayOfWeek, price, activeFrom } = {}) => {
      const session = requireOwner()
      const db = getDb()
      const product = db.prepare('SELECT id, name FROM products WHERE id = ?').get(productId)
      if (!product) throw new Error('Product not found')

      const ruleTier = normaliseTier(tier)
      const day = normaliseDayOfWeek(dayOfWeek)
      const amount = round2(requireAmount(price, 'Price'))
      const from = normaliseDate(activeFrom)

      const existing = db
        .prepare(
          `SELECT id FROM price_rules
           WHERE product_id = ? AND IFNULL(tier, '') = IFNULL(?, '')
             AND IFNULL(day_of_week, -1) = IFNULL(?, -1) AND active_from = ?`
        )
        .get(productId, ruleTier, day, from)

      let ruleId
      if (existing) {
        db.prepare('UPDATE price_rules SET price = ?, created_by = ? WHERE id = ?').run(
          amount,
          session.userId,
          existing.id
        )
        ruleId = existing.id
      } else {
        ruleId = db
          .prepare(
            `INSERT INTO price_rules (product_id, tier, day_of_week, price, active_from, created_by)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run(productId, ruleTier, day, amount, from, session.userId).lastInsertRowid
      }

      writeAudit(session.userId, 'pricing:set-rule', {
        ruleId,
        productId,
        productName: product.name,
        tier: ruleTier,
        dayOfWeek: day,
        price: amount,
        activeFrom: from
      })
      return { success: true, ruleId }
    })
  )

  ipcMain.handle(
    'pricing:delete-rule',
    wrap(({ ruleId } = {}) => {
      const session = requireOwner()
      const db = getDb()
      const rule = db.prepare('SELECT * FROM price_rules WHERE id = ?').get(ruleId)
      if (!rule) throw new Error('Price rule not found')
      db.prepare('DELETE FROM price_rules WHERE id = ?').run(ruleId)
      // Deleting a rule silently moves money: the next sale falls back to the
      // next-most-specific rule (or the catalogue price). Record what it was.
      writeAudit(session.userId, 'pricing:delete-rule', {
        ruleId,
        productId: rule.product_id,
        tier: rule.tier,
        dayOfWeek: rule.day_of_week,
        price: rule.price,
        activeFrom: rule.active_from
      })
      return { success: true }
    })
  )
}
