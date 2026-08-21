import { describe, it, expect, beforeEach } from 'vitest'
import { __invoke } from 'electron'
import { expireLapsedMemberships } from '../src/main/ipc/maintenance.js'
import { freshDb, seed, loginOwner, loginStaff, isoOffset } from './helpers.js'

let db
let ids

beforeEach(() => {
  db = freshDb()
  ids = seed(db)
})

function newMembership(end, name = 'Frozen') {
  const m = db.prepare(`INSERT INTO members (name) VALUES (?)`).run(name).lastInsertRowid
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

// C-7: the Renew dialog wired into owner-members.jsx passes activeMembership.id
// for an expiring-soon member (their row hasn't lapsed by end_date yet, so it
// is still the one and only row status='active' in the DB) and
// lastMembership.id for an expired member. Correction from an earlier draft
// of this comment: expireLapsedMemberships() (src/main/ipc/maintenance.js)
// DOES flip lapsed rows to status='expired' on a daily cron and at startup
// (see the '3-B' describe block above), so an expired member's row is not
// guaranteed to still read 'active' — it depends on whether that job has run
// since it lapsed. That doesn't change which id is correct here, though:
// fetchLastMembership() selects "most recent membership regardless of
// status" (its own comment says so, members.js) — it has no status filter —
// so lastMembership.id is right either way, and members:renew itself looks
// up by id with no status gate at all. Passing the wrong id for an
// expiring-soon member would expire a membership that genuinely still has
// time left on it instead of the row members:renew is meant to replace.
describe('C-7 — members:renew id targeting', () => {
  it('renews an expiring-soon membership using activeMembership.id, keeps the same product', async () => {
    loginOwner(ids)
    const msId = newMembership(isoOffset(3), 'Expiring Soon') // still active, end_date in the future
    const before = await __invoke('members:list-all', {})
    const row = before.members.find((m) => m.name === 'Expiring Soon')
    expect(row.activeMembership).toBeTruthy()
    expect(row.activeMembership.id).toBe(msId)
    expect(row.lastMembership).toBeNull() // never populated when there's an active row

    // members:renew is requireStaffOrOwner — a receptionist can do this too.
    loginStaff(ids)
    const r = await __invoke('members:renew', {
      membershipId: row.activeMembership.id,
      newStartDate: isoOffset(4),
      paymentMethod: 'cash'
    })
    expect(r.success).toBe(true)

    // The old row is the one that got marked expired — not some other row.
    const old = db.prepare('SELECT status FROM memberships WHERE id = ?').get(msId)
    expect(old.status).toBe('expired')

    loginOwner(ids)
    const after = await __invoke('members:list-all', {})
    const rowAfter = after.members.find((m) => m.name === 'Expiring Soon')
    expect(rowAfter.activeMembership).toBeTruthy()
    expect(rowAfter.activeMembership.id).not.toBe(msId) // a new membership row
    expect(rowAfter.activeMembership.uiStatus).toBe('Active')
    expect(rowAfter.activeMembership.startDate).toBe(isoOffset(4))
    expect(rowAfter.activeMembership.endDate).toBe(isoOffset(4 + 29)) // 30-day product, inclusive end
  })

  it('renews an expired membership using lastMembership.id, keeps the same product', async () => {
    loginOwner(ids)
    // Lapsed 5 days ago. This test's own newMembership() inserts it directly
    // via SQL with status='active', so it's still 'active' here regardless
    // of end_date — this deliberately reproduces the state a row is in
    // between lapsing and the next run of expireLapsedMemberships(), since
    // fetchLastMembership() (and therefore lastMembership.id) doesn't care
    // either way — see the describe-block comment above.
    const msId = newMembership(isoOffset(-5), 'Already Expired')
    const before = await __invoke('members:list-all', {})
    const row = before.members.find((m) => m.name === 'Already Expired')
    expect(row.activeMembership).toBeNull()
    expect(row.pausedMembership).toBeNull()
    expect(row.lastMembership).toBeTruthy()
    expect(row.lastMembership.id).toBe(msId)
    expect(row.lastMembership.uiStatus).toBe('Expired')

    loginStaff(ids)
    const r = await __invoke('members:renew', {
      membershipId: row.lastMembership.id,
      newStartDate: isoOffset(0),
      paymentMethod: 'qr'
    })
    expect(r.success).toBe(true)

    const old = db.prepare('SELECT status FROM memberships WHERE id = ?').get(msId)
    expect(old.status).toBe('expired')

    loginOwner(ids)
    const after = await __invoke('members:list-all', {})
    const rowAfter = after.members.find((m) => m.name === 'Already Expired')
    expect(rowAfter.activeMembership).toBeTruthy()
    expect(rowAfter.activeMembership.id).not.toBe(msId)
    expect(rowAfter.activeMembership.uiStatus).toBe('Active')
    expect(rowAfter.pausedMembership).toBeNull()
  })

  it('records a real transaction for the renewal with the given payment method', async () => {
    loginOwner(ids)
    const msId = newMembership(isoOffset(-2), 'Renew Txn')
    const before = await __invoke('members:list-all', {})
    const row = before.members.find((m) => m.name === 'Renew Txn')

    loginStaff(ids)
    const r = await __invoke('members:renew', {
      membershipId: row.lastMembership.id,
      newStartDate: isoOffset(0),
      paymentMethod: 'QR'
    })
    expect(r.success).toBe(true)
    expect(r.transactionId).toBeTruthy()

    const txn = db.prepare('SELECT * FROM transactions WHERE id = ?').get(r.transactionId)
    expect(txn.transaction_type).toBe('membership')
    expect(txn.payment_method).toBe('qr')
    expect(txn.product_id).toBe(ids.memProdId)
    expect(txn.amount).toBe(1000)

    const newMs = db.prepare('SELECT * FROM memberships WHERE id = ?').get(msId)
    expect(newMs.status).toBe('expired')
  })
})
