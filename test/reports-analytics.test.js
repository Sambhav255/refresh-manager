import { describe, it, expect, beforeEach } from 'vitest'
import { __invoke } from 'electron'
import { freshDb, seed, loginOwner } from './helpers.js'

let db
let ids

beforeEach(() => {
  db = freshDb()
  ids = seed(db)
  loginOwner(ids)
})

function saleOn(date, amount) {
  db.prepare(
    `INSERT INTO transactions (transaction_type, source, customer_name, amount, payment_method, staff_id, created_at)
     VALUES ('day_pass','pool','C',?,'cash',?,?)`
  ).run(amount, ids.staffId, `${date} 10:00:00`)
}

describe('4-A — period-over-period monthly report', () => {
  it('returns previous-period totals and percentage deltas', async () => {
    saleOn('2026-03-10', 500)
    saleOn('2026-02-10', 200)
    const rep = await __invoke('reports:monthly', { year: 2026, month: 3 })
    expect(rep.summary.total).toBe(500)
    expect(rep.previous.total).toBe(200)
    expect(rep.deltas.totalPct).toBe(150) // (500-200)/200
  })
})

describe('4-B — cohort retention', () => {
  it('measures how many first-time joiners are still active 1/2/3 months on', async () => {
    const m = db.prepare(`INSERT INTO members (name) VALUES ('Cohorty')`).run().lastInsertRowid
    // First membership starts in March 2026, covers through late May.
    db.prepare(
      `INSERT INTO memberships (member_id, product_id, start_date, end_date, status)
       VALUES (?, ?, '2026-03-05', '2026-05-20', 'active')`
    ).run(m, ids.memProdId)

    const res = await __invoke('reports:cohort-retention', { year: 2026, month: 3 })
    expect(res.cohortSize).toBe(1)
    const byOffset = Object.fromEntries(res.retention.map((r) => [r.monthOffset, r.rate]))
    expect(byOffset[1]).toBe(100) // active on 2026-04-01
    expect(byOffset[2]).toBe(100) // active on 2026-05-01
    expect(byOffset[3]).toBe(0) // expired before 2026-06-01
  })
})

describe('4-C — report indexes exist', () => {
  it('creates the hot-path indexes', () => {
    const idx = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='index'`)
      .all()
      .map((r) => r.name)
    expect(idx).toContain('idx_txn_created')
    expect(idx).toContain('idx_ms_status_end')
  })
})
