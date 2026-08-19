import { describe, it, expect, beforeEach } from 'vitest'
import { __invoke } from 'electron'
import { freshDb, seed, loginOwner, loginStaff, OWNER_PASSWORD } from './helpers.js'
import { clearSession, setSession } from '../src/main/session.js'

let db, ids

beforeEach(() => {
  db = freshDb()
  ids = seed(db)
})

// The install used to have no way back in once an admin password was
// forgotten: the setup wizard refuses to run twice, so the only route was
// editing the database by hand. These cover the in-app replacement.
describe('admin password recovery', () => {
  it('an admin can reset another admin password; the new one works and the old does not', async () => {
    loginOwner(ids)
    const added = await __invoke('auth:add-admin', { name: 'Admin Two', password: 'secondpass' })
    expect(added.success).toBe(true)

    const reset = await __invoke('auth:reset-admin-password', {
      userId: added.userId,
      newPassword: 'rescued99'
    })
    expect(reset.success).toBe(true)

    clearSession()
    const oldLogin = await __invoke('auth:login', { username: 'Admin Two', password: 'secondpass' })
    expect(oldLogin.success).toBe(false)

    const newLogin = await __invoke('auth:login', { username: 'Admin Two', password: 'rescued99' })
    expect(newLogin.success).toBe(true)
    expect(newLogin.user.role).toBe('owner')
  })

  it('the actor cannot reset their own password, so a known-good login always survives', async () => {
    loginOwner(ids)
    const res = await __invoke('auth:reset-admin-password', {
      userId: ids.ownerId,
      newPassword: 'selfreset'
    })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/change my password/i)

    // The original password must still work — nothing was stranded.
    clearSession()
    const still = await __invoke('auth:login', { username: 'Owner', password: OWNER_PASSWORD })
    expect(still.success).toBe(true)
  })

  it('reset cannot leave the install with no usable account', async () => {
    loginOwner(ids)
    const added = await __invoke('auth:add-admin', { name: 'Admin Two', password: 'secondpass' })
    // Deactivate the second admin, then try to "recover" it. A deactivated
    // account cannot log in, so the reset must refuse rather than pretend.
    await __invoke('auth:deactivate-admin', { userId: added.userId })
    const dead = await __invoke('auth:reset-admin-password', {
      userId: added.userId,
      newPassword: 'zombie123'
    })
    expect(dead.success).toBe(false)
    expect(dead.error).toMatch(/deactivated/i)

    // Sole remaining admin is the actor, and they still cannot reset
    // themselves — so at least one admin with a known password always remains.
    const self = await __invoke('auth:reset-admin-password', {
      userId: ids.ownerId,
      newPassword: 'oops'
    })
    expect(self.success).toBe(false)

    const activeAdmins = db
      .prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND is_active = 1`)
      .get().n
    expect(activeAdmins).toBeGreaterThanOrEqual(1)
    clearSession()
    expect(
      (await __invoke('auth:login', { username: 'Owner', password: OWNER_PASSWORD })).success
    ).toBe(true)
  })

  it('rejects short passwords, unknown ids and non-admin callers', async () => {
    loginOwner(ids)
    const added = await __invoke('auth:add-admin', { name: 'Admin Two', password: 'secondpass' })

    const short = await __invoke('auth:reset-admin-password', {
      userId: added.userId,
      newPassword: 'ab'
    })
    expect(short.success).toBe(false)
    expect(short.error).toMatch(/4 characters/i)

    // A staff id is not an admin id — the handler must not cross roles.
    const wrongRole = await __invoke('auth:reset-admin-password', {
      userId: ids.staffId,
      newPassword: 'goodpass'
    })
    expect(wrongRole.success).toBe(false)
    expect(wrongRole.error).toMatch(/not found/i)

    loginStaff(ids)
    const asStaff = await __invoke('auth:reset-admin-password', {
      userId: added.userId,
      newPassword: 'goodpass'
    })
    expect(asStaff.success).toBe(false)

    clearSession()
    const anon = await __invoke('auth:reset-admin-password', {
      userId: added.userId,
      newPassword: 'goodpass'
    })
    expect(anon.success).toBe(false)
  })
})

describe('staff PIN recovery', () => {
  it('resets a forgotten PIN and the new one signs in', async () => {
    loginOwner(ids)
    const res = await __invoke('auth:reset-staff-pin', { userId: ids.staffId, newPin: '4321' })
    expect(res.success).toBe(true)

    clearSession()
    expect((await __invoke('auth:login', { pin: '1234' })).success).toBe(false)
    const ok = await __invoke('auth:login', { pin: '4321' })
    expect(ok.success).toBe(true)
    expect(ok.user.userId).toBe(ids.staffId)
  })

  it('enforces the 4-digit rule', async () => {
    loginOwner(ids)
    for (const bad of ['123', '12345', 'abcd', '12a4', '', null, undefined]) {
      const r = await __invoke('auth:reset-staff-pin', { userId: ids.staffId, newPin: bad })
      expect(r.success).toBe(false)
      expect(r.error).toMatch(/4 digits/i)
    }
    // Original PIN untouched by any of the rejected attempts.
    clearSession()
    expect((await __invoke('auth:login', { pin: '1234' })).success).toBe(true)
  })

  it('rejects a PIN already used by another active staff member', async () => {
    loginOwner(ids)
    const other = await __invoke('auth:add-staff', { name: 'Second', pin: '9999' })
    expect(other.success).toBe(true)

    const clash = await __invoke('auth:reset-staff-pin', { userId: ids.staffId, newPin: '9999' })
    expect(clash.success).toBe(false)
    expect(clash.error).toMatch(/already in use/i)

    // Re-setting a staff member to their OWN current PIN is not a collision.
    const same = await __invoke('auth:reset-staff-pin', { userId: ids.staffId, newPin: '1234' })
    expect(same.success).toBe(true)
  })

  it('refuses deactivated staff, unknown ids and non-admin callers', async () => {
    loginOwner(ids)
    const gone = await __invoke('auth:add-staff', { name: 'Gone', pin: '8888' })
    await __invoke('auth:deactivate-user', { userId: gone.userId })
    const dead = await __invoke('auth:reset-staff-pin', { userId: gone.userId, newPin: '7777' })
    expect(dead.success).toBe(false)
    expect(dead.error).toMatch(/deactivated/i)

    const notStaff = await __invoke('auth:reset-staff-pin', { userId: ids.ownerId, newPin: '7777' })
    expect(notStaff.success).toBe(false)
    expect(notStaff.error).toMatch(/not found/i)

    loginStaff(ids)
    const asStaff = await __invoke('auth:reset-staff-pin', { userId: ids.staffId, newPin: '7777' })
    expect(asStaff.success).toBe(false)
  })
})

describe('recovery is audited', () => {
  it('every reset writes an audit entry naming the actor and the target', async () => {
    loginOwner(ids)
    const added = await __invoke('auth:add-admin', { name: 'Admin Two', password: 'secondpass' })
    // A second admin performs both resets, so the actor is unambiguous.
    setSession({ userId: added.userId, name: 'Admin Two', role: 'owner' })

    await __invoke('auth:reset-admin-password', { userId: ids.ownerId, newPassword: 'rescued99' })
    await __invoke('auth:reset-staff-pin', { userId: ids.staffId, newPin: '4321' })

    const pw = await __invoke('audit:list', { action: 'admin:reset-password' })
    expect(pw.entries.length).toBe(1)
    expect(pw.entries[0].actor_name).toBe('Admin Two')
    expect(JSON.parse(pw.entries[0].detail)).toMatchObject({ userId: ids.ownerId, name: 'Owner' })

    const pin = await __invoke('audit:list', { action: 'staff:reset-pin' })
    expect(pin.entries.length).toBe(1)
    expect(pin.entries[0].actor_name).toBe('Admin Two')
    expect(JSON.parse(pin.entries[0].detail)).toMatchObject({ userId: ids.staffId, name: 'Staff' })
  })

  it('failed resets are not audited as if they happened', async () => {
    loginOwner(ids)
    await __invoke('auth:reset-staff-pin', { userId: ids.staffId, newPin: '12' })
    const pin = await __invoke('audit:list', { action: 'staff:reset-pin' })
    expect(pin.entries.length).toBe(0)
  })
})

describe('login roster', () => {
  it('lists active staff and admins by name only', async () => {
    loginOwner(ids)
    await __invoke('auth:add-admin', { name: 'Admin Two', password: 'secondpass' })
    await __invoke('auth:add-staff', { name: 'Second', pin: '9999' })
    clearSession()

    const roster = await __invoke('auth:login-roster', {})
    expect(roster.success).not.toBe(false)
    expect(roster.staff.map((s) => s.name).sort()).toEqual(['Second', 'Staff'])
    expect(roster.admins.map((a) => a.name).sort()).toEqual(['Admin Two', 'Owner'])
  })

  it('is callable with no session, because the login screen needs it first', async () => {
    clearSession()
    const roster = await __invoke('auth:login-roster', {})
    expect(roster.success).not.toBe(false)
    expect(roster.staff.length).toBe(1)
  })

  it('leaks no hash, PIN, password or any other user field', async () => {
    clearSession()
    const roster = await __invoke('auth:login-roster', {})
    const everyone = [...roster.staff, ...roster.admins]
    expect(everyone.length).toBeGreaterThan(0)
    for (const entry of everyone) {
      expect(Object.keys(entry).sort()).toEqual(['id', 'name'])
    }
    // Belt and braces: nothing password-shaped anywhere in the payload.
    const blob = JSON.stringify(roster)
    expect(blob).not.toMatch(/hash|pin|password|\$2[aby]\$/i)
  })

  it('excludes deactivated accounts', async () => {
    loginOwner(ids)
    const admin2 = await __invoke('auth:add-admin', { name: 'Admin Two', password: 'secondpass' })
    const staff2 = await __invoke('auth:add-staff', { name: 'Second', pin: '9999' })
    await __invoke('auth:deactivate-user', { userId: staff2.userId })
    // Admin Two deactivates the original owner (the last-admin guard allows it
    // while another admin remains active).
    setSession({ userId: admin2.userId, name: 'Admin Two', role: 'owner' })
    await __invoke('auth:deactivate-admin', { userId: ids.ownerId })
    clearSession()

    const roster = await __invoke('auth:login-roster', {})
    expect(roster.staff.map((s) => s.name)).toEqual(['Staff'])
    expect(roster.admins.map((a) => a.name)).toEqual(['Admin Two'])
  })
})
