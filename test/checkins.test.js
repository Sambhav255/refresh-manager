import { describe, it, expect, beforeEach } from 'vitest'
import { __invoke } from 'electron'
import { freshDb, seed, loginStaff, loginOwner, isoOffset } from './helpers.js'

let db
let ids

beforeEach(() => {
  db = freshDb()
  ids = seed(db)
})

function addMember(name) {
  return db.prepare(`INSERT INTO members (name) VALUES (?)`).run(name).lastInsertRowid
}
function addActiveMembership(memberId) {
  db.prepare(
    `INSERT INTO memberships (member_id, product_id, start_date, end_date, status)
     VALUES (?, ?, ?, ?, 'active')`
  ).run(memberId, ids.memProdId, isoOffset(-10), isoOffset(20))
}

describe('3-A — check-ins / footfall', () => {
  it('records a check-in with the acting staff and counts it today', async () => {
    loginStaff(ids)
    const m = addMember('Sita')
    const res = await __invoke('checkins:create', { memberId: m, source: 'member' })
    expect(res.success).toBe(true)

    const row = db.prepare('SELECT * FROM check_ins WHERE id = ?').get(res.id)
    expect(row.member_id).toBe(m)
    expect(row.staff_id).toBe(ids.staffId)

    const today = await __invoke('checkins:today', {})
    expect(today.count).toBe(1)
    expect(today.recent[0].member_name).toBe('Sita')
  })

  it('computes footfall totals and a daily average over a range', async () => {
    loginOwner(ids)
    // Three DIFFERENT visitors today. This used to check the same member in
    // three times and expect 3 — which was the footfall-inflation bug itself
    // (checkins:create now counts a member once per day).
    for (const name of ['Gita', 'Bimala', 'Sunita']) {
      await __invoke('checkins:create', { memberId: addMember(name) })
    }
    const ff = await __invoke('checkins:footfall', {})
    expect(ff.total).toBe(3)
    expect(ff.dailyAverage).toBeGreaterThanOrEqual(1)
  })

  it('counts a member once per day however many times they are checked in', async () => {
    loginOwner(ids)
    const m = addMember('Gita')
    for (let i = 0; i < 3; i++) await __invoke('checkins:create', { memberId: m })
    const ff = await __invoke('checkins:footfall', {})
    expect(ff.total).toBe(1)
  })

  it('not-seen lists an active member with no recent check-in, excludes a visitor', async () => {
    loginOwner(ids)
    const stale = addMember('Stale')
    addActiveMembership(stale)
    const active = addMember('Regular')
    addActiveMembership(active)
    // Regular checked in today; Stale never did.
    loginStaff(ids)
    await __invoke('checkins:create', { memberId: active })

    loginOwner(ids)
    const res = await __invoke('checkins:not-seen', { days: 30 })
    const names = res.members.map((m) => m.name)
    expect(names).toContain('Stale')
    expect(names).not.toContain('Regular')
  })
})
