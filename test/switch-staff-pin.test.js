import { describe, it, expect, beforeEach } from 'vitest'
import { __invoke } from 'electron'
import bcrypt from 'bcryptjs'
import { freshDb, seed, loginStaff } from './helpers.js'
import { setCartGuard } from '../src/main/cart-guard.js'

let db
let ids

beforeEach(() => {
  db = freshDb()
  ids = seed(db)
  setCartGuard(false)
})

describe('auth:switch-staff-pin', () => {
  it('switches to another staff member without logging out', async () => {
    const other = db
      .prepare(`INSERT INTO users (name, role, pin_hash) VALUES ('Other','staff',?)`)
      .run(bcrypt.hashSync('5678', 10))
    loginStaff(ids)

    const result = await __invoke('auth:switch-staff-pin', { pin: '5678' })
    expect(result.success).toBe(true)
    expect(result.user).toEqual({ userId: other.lastInsertRowid, name: 'Other', role: 'staff' })

    const session = await __invoke('auth:get-session', {})
    expect(session.user).toEqual({ userId: other.lastInsertRowid, name: 'Other', role: 'staff' })
  })

  it('refuses to switch when the till cart has unsaved items', async () => {
    db.prepare(`INSERT INTO users (name, role, pin_hash) VALUES ('Other','staff',?)`).run(
      bcrypt.hashSync('5678', 10)
    )
    loginStaff(ids)
    setCartGuard(true)

    const result = await __invoke('auth:switch-staff-pin', { pin: '5678' })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/current sale/i)

    const session = await __invoke('auth:get-session', {})
    expect(session.user.userId).toBe(ids.staffId)
  })

  it('rejects a wrong PIN', async () => {
    loginStaff(ids)
    const result = await __invoke('auth:switch-staff-pin', { pin: '0000' })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/incorrect pin/i)
  })
})
