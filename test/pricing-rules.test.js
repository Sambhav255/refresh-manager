import { describe, it, expect, beforeEach } from 'vitest'
import { __invoke } from 'electron'
import { freshDb, seed, loginStaff, loginOwner } from './helpers.js'
import { registerPricingHandlers, resolvePrice } from '../src/main/ipc/pricing.js'

// The real-world rates this centre charges, used ONLY as test data — nothing
// seeds them, because the owner enters their own.
const CHILD = 500
const ADULT = 700
const SATURDAY = 500
const SATURDAY_DOW = 6

let db
let ids

beforeEach(() => {
  db = freshDb()
  ids = seed(db)
  // helpers.js wires the pre-existing modules; the sale model registers its own.
  registerPricingHandlers()
})

// A date that definitely falls on the requested weekday, so day-of-week tests
// do not depend on when they are run.
function dateOn(dayOfWeek) {
  const d = new Date()
  d.setDate(d.getDate() + ((dayOfWeek - d.getDay() + 7) % 7))
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}-${String(d.getDate()).padStart(2, '0')}`
}

function setRule(rule) {
  return __invoke('pricing:set-rule', {
    productId: ids.dayPassId,
    activeFrom: '2000-01-01',
    ...rule
  })
}

describe('resolvePrice — precedence, most specific wins', () => {
  it('falls back to the catalogue price when there are no rules', () => {
    expect(resolvePrice(db, { productId: ids.dayPassId }).unitPrice).toBe(300)
    expect(resolvePrice(db, { productId: ids.dayPassId }).source).toBe('product')
  })

  it('prices a child below an adult on the same product', async () => {
    loginOwner(ids)
    await setRule({ tier: 'child', price: CHILD })
    await setRule({ tier: 'adult', price: ADULT })

    const weekday = dateOn(2) // Tuesday — no day rule involved
    expect(
      resolvePrice(db, { productId: ids.dayPassId, tier: 'child', date: weekday }).unitPrice
    ).toBe(CHILD)
    expect(
      resolvePrice(db, { productId: ids.dayPassId, tier: 'adult', date: weekday }).unitPrice
    ).toBe(ADULT)
    // An untiered sale must not silently pick up the adult rule.
    expect(resolvePrice(db, { productId: ids.dayPassId, date: weekday }).unitPrice).toBe(300)
  })

  it('applies a day rule to everyone, and a tier+day rule ahead of both', async () => {
    loginOwner(ids)
    await setRule({ tier: 'child', price: CHILD })
    await setRule({ tier: 'adult', price: ADULT })
    await setRule({ dayOfWeek: SATURDAY_DOW, price: SATURDAY })

    const saturday = dateOn(SATURDAY_DOW)
    const tuesday = dateOn(2)

    // product+day beats the catalogue price for an untiered sale …
    expect(resolvePrice(db, { productId: ids.dayPassId, date: saturday }).unitPrice).toBe(SATURDAY)
    // … but product+tier is MORE specific than product+day, so an adult on a
    // Saturday still pays the adult rate until a tier+day rule says otherwise.
    expect(
      resolvePrice(db, { productId: ids.dayPassId, tier: 'adult', date: saturday }).unitPrice
    ).toBe(ADULT)

    await setRule({ tier: 'adult', dayOfWeek: SATURDAY_DOW, price: SATURDAY })
    expect(
      resolvePrice(db, { productId: ids.dayPassId, tier: 'adult', date: saturday }).unitPrice
    ).toBe(SATURDAY)
    // The weekday adult rate is untouched.
    expect(
      resolvePrice(db, { productId: ids.dayPassId, tier: 'adult', date: tuesday }).unitPrice
    ).toBe(ADULT)
  })

  it('ignores a rule that has not started yet and prefers the most recent one', async () => {
    loginOwner(ids)
    const future = '2999-01-01'
    await setRule({ tier: 'adult', price: ADULT, activeFrom: '2000-01-01' })
    await setRule({ tier: 'adult', price: 9999, activeFrom: future })
    expect(resolvePrice(db, { productId: ids.dayPassId, tier: 'adult' }).unitPrice).toBe(ADULT)

    await setRule({ tier: 'adult', price: 800, activeFrom: '2020-01-01' })
    expect(resolvePrice(db, { productId: ids.dayPassId, tier: 'adult' }).unitPrice).toBe(800)
  })

  it('rejects an unknown product or tier', () => {
    expect(() => resolvePrice(db, { productId: 99999 })).toThrow(/Product not found/)
    expect(() => resolvePrice(db, { productId: ids.dayPassId, tier: 'senior' })).toThrow(/tier/)
  })
})

describe('pricing handlers', () => {
  it('is owner-only for writes and readable by staff', async () => {
    loginStaff(ids)
    const denied = await __invoke('pricing:set-rule', {
      productId: ids.dayPassId,
      tier: 'child',
      price: 1
    })
    expect(denied.success).toBe(false)
    expect(denied.error).toMatch(/Owner/)
    expect(db.prepare('SELECT COUNT(*) c FROM price_rules').get().c).toBe(0)

    const list = await __invoke('pricing:list-rules', {})
    expect(list.success).toBe(true)
    expect(list.rules).toEqual([])
  })

  it('upserts rather than stacking a second rule on the same slot', async () => {
    loginOwner(ids)
    const first = await setRule({ tier: 'child', price: CHILD })
    const second = await setRule({ tier: 'child', price: 550 })
    expect(second.ruleId).toBe(first.ruleId)
    expect(db.prepare('SELECT COUNT(*) c FROM price_rules').get().c).toBe(1)
    expect(resolvePrice(db, { productId: ids.dayPassId, tier: 'child' }).unitPrice).toBe(550)
  })

  it('rejects a bad day, a negative price and an unknown product', async () => {
    loginOwner(ids)
    expect((await setRule({ dayOfWeek: 7, price: 100 })).error).toMatch(/Day must be/)
    expect((await setRule({ price: -5 })).error).toMatch(/0 or more/)
    expect((await __invoke('pricing:set-rule', { productId: 99999, price: 100 })).error).toMatch(
      /Product not found/
    )
    expect(db.prepare('SELECT COUNT(*) c FROM price_rules').get().c).toBe(0)
  })

  it('deletes a rule and falls back to the next most specific price', async () => {
    loginOwner(ids)
    const saturday = dateOn(SATURDAY_DOW)
    await setRule({ dayOfWeek: SATURDAY_DOW, price: SATURDAY })
    expect(resolvePrice(db, { productId: ids.dayPassId, date: saturday }).unitPrice).toBe(SATURDAY)

    const rules = await __invoke('pricing:list-rules', { productId: ids.dayPassId })
    const res = await __invoke('pricing:delete-rule', { ruleId: rules.rules[0].id })
    expect(res.success).toBe(true)
    expect(resolvePrice(db, { productId: ids.dayPassId, date: saturday }).unitPrice).toBe(300)
  })
})
