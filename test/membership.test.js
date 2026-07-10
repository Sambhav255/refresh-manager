import { describe, it, expect, beforeEach } from 'vitest'
import { __invoke } from 'electron'
import { expireLapsedMemberships } from '../src/main/ipc/maintenance.js'
import { freshDb, seed, loginOwner, isoOffset } from './helpers.js'

let db
let ids

beforeEach(() => {
  db = freshDb()
  ids = seed(db)
})

function newMembership(end) {
  const m = db.prepare(`INSERT INTO members (name) VALUES ('Frozen')`).run().lastInsertRowid
  return db
    .prepare(
      `INSERT INTO memberships (member_id, product_id, start_date, end_date, status)
       VALUES (?, ?, ?, ?, 'active')`
    )
    .run(m, ids.memProdId, isoOffset(-20), end).lastInsertRowid
}

describe('3-B — membership pause / resume', () => {
  it('pauses an active membership and the expiry job leaves it alone', async () => {
    loginOwner(ids)
    const msId = newMembership(isoOffset(10))
    const p = await __invoke('members:pause-membership', { membershipId: msId, reason: 'travel' })
    expect(p.success).toBe(true)
    expect(db.prepare('SELECT status FROM memberships WHERE id=?').get(msId).status).toBe('paused')

    // Even with a past end_date, a paused membership must not be auto-expired.
    db.prepare('UPDATE memberships SET end_date = ? WHERE id = ?').run(isoOffset(-1), msId)
    expireLapsedMemberships()
    expect(db.prepare('SELECT status FROM memberships WHERE id=?').get(msId).status).toBe('paused')
  })

  it('resume extends end_date by the paused span', async () => {
    loginOwner(ids)
    const endInit = isoOffset(10)
    const msId = newMembership(endInit)
    await __invoke('members:pause-membership', { membershipId: msId })

    // Simulate a 5-day freeze.
    db.prepare('UPDATE memberships SET pause_start = ? WHERE id = ?').run(isoOffset(-5), msId)
    const r = await __invoke('members:resume-membership', { membershipId: msId })
    expect(r.success).toBe(true)
    expect(r.pausedDays).toBe(5)

    const row = db.prepare('SELECT status, end_date FROM memberships WHERE id=?').get(msId)
    expect(row.status).toBe('active')
    expect(row.end_date).toBe(isoOffset(15)) // 10 + 5 days
  })

  it('surfaces a paused membership in members:list-all so it can be resumed', async () => {
    loginOwner(ids)
    const msId = newMembership(isoOffset(10))
    await __invoke('members:pause-membership', { membershipId: msId })
    const res = await __invoke('members:list-all', {})
    const frozen = res.members.find((m) => m.name === 'Frozen')
    expect(frozen.activeMembership).toBeNull()
    expect(frozen.pausedMembership).toBeTruthy()
    expect(frozen.pausedMembership.id).toBe(msId)
  })

  it('rejects pausing a non-active or resuming a non-paused membership', async () => {
    loginOwner(ids)
    const msId = newMembership(isoOffset(10))
    const badResume = await __invoke('members:resume-membership', { membershipId: msId })
    expect(badResume.success).toBe(false)
    await __invoke('members:pause-membership', { membershipId: msId })
    const badPause = await __invoke('members:pause-membership', { membershipId: msId })
    expect(badPause.success).toBe(false)
  })
})
