import { describe, it, expect, beforeEach } from 'vitest'
import { existsSync } from 'fs'
import { join } from 'path'
import { __invoke, __getUserDataDir } from 'electron'
import { freshDb, seed, loginStaff, loginOwner, OWNER_PASSWORD } from './helpers.js'

let db
let ids

beforeEach(() => {
  db = freshDb()
  ids = seed(db)
})

describe('security — photos:save path traversal', () => {
  it('rejects a non-integer memberId (no file written outside photos dir)', async () => {
    loginStaff(ids)
    const evil = '../../evil'
    const res = await __invoke('photos:save', {
      memberId: evil,
      base64: Buffer.from('not-an-image').toString('base64')
    })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/invalid memberid/i)
    expect(existsSync(join(__getUserDataDir(), 'evil.jpg'))).toBe(false)
  })

  it('rejects an unknown numeric memberId', async () => {
    loginStaff(ids)
    const res = await __invoke('photos:save', {
      memberId: 999999,
      base64: Buffer.from('x').toString('base64')
    })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/member not found/i)
  })
})

describe('security — inventory handlers derive staff from session', () => {
  it('pool restock ignores payload staffId and rejects a bad quantity', async () => {
    loginStaff(ids)
    const ok = await __invoke('pool-inventory:restock', {
      itemId: ids.poolItemId,
      quantity: 5,
      staffId: ids.ownerId // tampered — must be ignored
    })
    expect(ok.success).toBe(true)
    const row = db
      .prepare(
        `SELECT staff_id FROM pool_inventory_transactions WHERE item_id = ? ORDER BY id DESC LIMIT 1`
      )
      .get(ids.poolItemId)
    expect(row.staff_id).toBe(ids.staffId)

    const bad = await __invoke('pool-inventory:restock', {
      itemId: ids.poolItemId,
      quantity: -5
    })
    expect(bad.success).toBe(false)
  })

  it('restaurant sell rejects a negative quantity (cannot sneak stock IN)', async () => {
    loginStaff(ids)
    const before = db
      .prepare('SELECT current_stock FROM restaurant_inventory_items WHERE id = ?')
      .get(ids.rInvId).current_stock
    const res = await __invoke('restaurant-inventory:sell', {
      itemId: ids.rInvId,
      quantity: -5
    })
    expect(res.success).toBe(false)
    const after = db
      .prepare('SELECT current_stock FROM restaurant_inventory_items WHERE id = ?')
      .get(ids.rInvId).current_stock
    expect(after).toBe(before)
  })

  it('restaurant sell blocks overdraw and attributes to the session staff', async () => {
    loginStaff(ids)
    const over = await __invoke('restaurant-inventory:sell', {
      itemId: ids.rInvId,
      quantity: 9999
    })
    expect(over.success).toBe(false)
    expect(over.error).toMatch(/not enough stock/i)

    const ok = await __invoke('restaurant-inventory:sell', {
      itemId: ids.rInvId,
      quantity: 1,
      staffId: ids.ownerId // tampered
    })
    expect(ok.success).toBe(true)
    const row = db
      .prepare(
        `SELECT staff_id FROM restaurant_inventory_transactions WHERE item_id = ? ORDER BY id DESC LIMIT 1`
      )
      .get(ids.rInvId)
    expect(row.staff_id).toBe(ids.staffId)
  })
})

describe('security — owner password lockout', () => {
  it('locks the password path after 5 consecutive failures', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await __invoke('auth:login', { username: 'Owner', password: 'wrong-pass' })
      expect(res.success).toBe(false)
      expect(res.error).toMatch(/incorrect password/i)
    }
    // 6th attempt hits the cooldown — even with the CORRECT password.
    const locked = await __invoke('auth:login', { username: 'Owner', password: OWNER_PASSWORD })
    expect(locked.success).toBe(false)
    expect(locked.error).toMatch(/too many attempts/i)
  })
})

describe('security — audit on booking status changes', () => {
  it('writes an audit row when a booking status changes', async () => {
    loginOwner(ids)
    const created = await __invoke('bookings:create', {
      bookingName: 'Audit Me',
      bookingDate: '2026-05-01'
    })
    loginStaff(ids)
    await __invoke('bookings:update-status', { bookingId: created.bookingId, status: 'cancelled' })
    const entry = db
      .prepare(`SELECT * FROM audit_log WHERE action = 'booking:status' ORDER BY id DESC LIMIT 1`)
      .get()
    expect(entry).toBeTruthy()
    expect(entry.actor_user_id).toBe(ids.staffId)
    expect(JSON.parse(entry.detail).status).toBe('cancelled')
  })
})
