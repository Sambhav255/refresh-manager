import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { __invoke } from 'electron'
import { performBackup } from '../src/main/ipc/backup.js'
import { freshDb, seed, loginOwner, loginStaff, OWNER_PASSWORD } from './helpers.js'
import { clearSession, setSession } from '../src/main/session.js'

let db, ids

beforeEach(() => {
  db = freshDb()
  ids = seed(db)
})

describe('multi-admin accounts', () => {
  it('admin can add a second admin and both can log in', async () => {
    loginOwner(ids)
    const added = await __invoke('auth:add-admin', { name: 'Admin Two', password: 'secondpass' })
    expect(added.success).toBe(true)

    clearSession()
    const login1 = await __invoke('auth:login', { username: 'Owner', password: OWNER_PASSWORD })
    expect(login1.success).toBe(true)

    clearSession()
    const login2 = await __invoke('auth:login', { username: 'Admin Two', password: 'secondpass' })
    expect(login2.success).toBe(true)
    expect(login2.user.role).toBe('owner')
  })

  it('rejects duplicate admin names among active admins', async () => {
    loginOwner(ids)
    const dup = await __invoke('auth:add-admin', { name: 'Owner', password: 'whatever' })
    expect(dup.success).toBe(false)
    expect(dup.error).toMatch(/already exists/i)
  })

  it('staff cannot add or list admins', async () => {
    loginStaff(ids)
    const add = await __invoke('auth:add-admin', { name: 'Sneaky', password: 'sneakypass' })
    expect(add.success).toBe(false)
    const list = await __invoke('auth:list-admins', {})
    expect(list.success).toBe(false)
  })

  it('lists all admins', async () => {
    loginOwner(ids)
    await __invoke('auth:add-admin', { name: 'Admin Two', password: 'secondpass' })
    const list = await __invoke('auth:list-admins', {})
    expect(list.users.length).toBe(2)
    expect(list.users.every((u) => u.role === 'owner')).toBe(true)
  })

  it('cannot deactivate your own account', async () => {
    loginOwner(ids)
    const res = await __invoke('auth:deactivate-admin', { userId: ids.ownerId })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/own account/i)
  })

  it('deactivated admin cannot log in; last-admin guard blocks removal', async () => {
    loginOwner(ids)
    const added = await __invoke('auth:add-admin', { name: 'Admin Two', password: 'secondpass' })
    // Second admin deactivates the first — allowed while another admin remains.
    setSession({ userId: added.userId, name: 'Admin Two', role: 'owner' })
    const ok = await __invoke('auth:deactivate-admin', { userId: ids.ownerId })
    expect(ok.success).toBe(true)

    clearSession()
    const dead = await __invoke('auth:login', { username: 'Owner', password: OWNER_PASSWORD })
    expect(dead.success).toBe(false)

    // Admin Two is now the last active admin; the guard must refuse to remove
    // them even when the actor is someone else (stale first-admin session).
    setSession({ userId: ids.ownerId, name: 'Owner', role: 'owner' })
    const blocked = await __invoke('auth:deactivate-admin', { userId: added.userId })
    expect(blocked.success).toBe(false)
    expect(blocked.error).toMatch(/at least one active admin/i)
  })

  it('admin can change their own password with correct current password', async () => {
    loginOwner(ids)
    const bad = await __invoke('auth:change-admin-password', {
      currentPassword: 'wrong',
      newPassword: 'newpass99'
    })
    expect(bad.success).toBe(false)

    const good = await __invoke('auth:change-admin-password', {
      currentPassword: OWNER_PASSWORD,
      newPassword: 'newpass99'
    })
    expect(good.success).toBe(true)

    clearSession()
    const oldLogin = await __invoke('auth:login', { username: 'Owner', password: OWNER_PASSWORD })
    expect(oldLogin.success).toBe(false)
    const newLogin = await __invoke('auth:login', { username: 'Owner', password: 'newpass99' })
    expect(newLogin.success).toBe(true)
  })

  it('any active admin password authorizes a backup restore; wrong ones do not', async () => {
    loginOwner(ids)
    await __invoke('auth:add-admin', { name: 'Admin Two', password: 'secondpass' })
    const backupDir = mkdtempSync(join(tmpdir(), 'refresh-adm-'))
    const { filePath } = performBackup({ destinationPath: backupDir, skipOwnerCheck: true })

    const wrong = await __invoke('backup:restore', {
      backupFilePath: filePath,
      password: 'totally-wrong'
    })
    expect(wrong.success).toBe(false)
    expect(wrong.error).toMatch(/password/i)

    const res = await __invoke('backup:restore', {
      backupFilePath: filePath,
      password: 'secondpass'
    })
    expect(res.success).toBe(true)
  })
})
