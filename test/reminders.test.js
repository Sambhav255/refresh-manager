import { describe, it, expect, beforeEach } from 'vitest'
import { __invoke } from 'electron'
import { freshDb, seed, loginOwner, isoOffset } from './helpers.js'

let db
let ids

beforeEach(() => {
  db = freshDb()
  ids = seed(db)
})

function expiringMembership(name, phone) {
  const m = db.prepare(`INSERT INTO members (name, phone) VALUES (?, ?)`).run(name, phone)
  const msId = db
    .prepare(
      `INSERT INTO memberships (member_id, product_id, start_date, end_date, status)
       VALUES (?, ?, ?, ?, 'active')`
    )
    .run(m.lastInsertRowid, ids.memProdId, isoOffset(-20), isoOffset(3)).lastInsertRowid
  return msId
}

describe('3-E — reminder history and re-send', () => {
  it('logs each send to history and clearing allows a re-send', async () => {
    loginOwner(ids)
    const msId = expiringMembership('Hari', '9800000001')

    await __invoke('reminders:send-one', { membershipId: msId })
    let hist = await __invoke('reminders:history', {})
    expect(hist.history.length).toBe(1)
    expect(hist.history[0].member).toBe('Hari')
    expect(hist.history[0].sentBy).toBe('Owner')

    // Once sent, it drops out of the pending list.
    let pending = await __invoke('reminders:get-expiring', { days: 5 })
    expect(pending.members.find((m) => m.membershipId === msId)).toBeFalsy()

    // Clearing re-enables it, and a second send appears in history.
    await __invoke('reminders:clear', { membershipId: msId })
    pending = await __invoke('reminders:get-expiring', { days: 5 })
    expect(pending.members.find((m) => m.membershipId === msId)).toBeTruthy()

    await __invoke('reminders:send-one', { membershipId: msId })
    hist = await __invoke('reminders:history', {})
    expect(hist.history.length).toBe(2)
  })
})
