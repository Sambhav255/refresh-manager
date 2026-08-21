import { describe, it, expect, beforeEach } from 'vitest'
import { __invoke } from 'electron'
import { freshDb, seed, loginStaff } from './helpers.js'

let db
let ids

beforeEach(() => {
  db = freshDb()
  ids = seed(db)
  loginStaff(ids)
})

describe('H-40 — opening float shifts the discrepancy calculation', () => {
  it('a physical count that matches float + cash sales is balanced', async () => {
    const res = await __invoke('reconciliation:create', {
      systemCash: 9580,
      physicalCash: 10080,
      openingFloat: 500,
      reason: null
    })
    expect(res.success).toBe(true)
    expect(res.discrepancy).toBe(0)
  })

  it('the same physical count without the float shows a discrepancy of -500', async () => {
    const res = await __invoke('reconciliation:create', {
      systemCash: 9580,
      physicalCash: 9580,
      openingFloat: 500,
      reason: 'left float in the safe'
    })
    expect(res.success).toBe(true)
    expect(res.discrepancy).toBe(-500)
  })

  it('an omitted opening float defaults to 0 and reproduces the pre-H-40 formula', async () => {
    const res = await __invoke('reconciliation:create', {
      systemCash: 9580,
      physicalCash: 9580
    })
    expect(res.success).toBe(true)
    expect(res.discrepancy).toBe(0)
  })

  it('persists opening_float on the stored row', async () => {
    await __invoke('reconciliation:create', {
      systemCash: 9580,
      physicalCash: 10080,
      openingFloat: 500
    })
    const row = db.prepare(`SELECT * FROM cash_reconciliations ORDER BY id DESC LIMIT 1`).get()
    expect(row.opening_float).toBe(500)
    expect(row.discrepancy).toBe(0)
  })

  it('reconciliation:get-today surfaces the opening float alongside the rest of the row', async () => {
    await __invoke('reconciliation:create', {
      systemCash: 9580,
      physicalCash: 10080,
      openingFloat: 500
    })
    const { reconciliation } = await __invoke('reconciliation:get-today')
    expect(reconciliation.opening_float).toBe(500)
  })
})
