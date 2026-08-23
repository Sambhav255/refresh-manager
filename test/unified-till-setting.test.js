import { describe, it, expect, beforeEach } from 'vitest'
import { __invoke } from 'electron'
import { freshDb, seed, loginOwner, loginStaff } from './helpers.js'

let db
let ids

beforeEach(() => {
  db = freshDb()
  ids = seed(db)
})

describe('unified_till owner setting', () => {
  it('defaults off — unified_till is absent until an owner sets it', async () => {
    loginOwner(ids)
    const res = await __invoke('settings:get-all', {})
    expect(res.settings.unified_till).toBeUndefined()
  })

  it('owner can persist unified_till=1 via settings:set and read it back', async () => {
    loginOwner(ids)
    const set = await __invoke('settings:set', { key: 'unified_till', value: '1' })
    expect(set.success).toBe(true)
    const get = await __invoke('settings:get-all', {})
    expect(get.settings.unified_till).toBe('1')
    const row = db.prepare(`SELECT value FROM settings WHERE key = 'unified_till'`).get()
    expect(row.value).toBe('1')
  })

  it('owner can turn unified_till off again with 0', async () => {
    loginOwner(ids)
    await __invoke('settings:set', { key: 'unified_till', value: '1' })
    const off = await __invoke('settings:set', { key: 'unified_till', value: '0' })
    expect(off.success).toBe(true)
    const get = await __invoke('settings:get-all', {})
    expect(get.settings.unified_till).toBe('0')
  })

  it('staff can read unified_till but cannot change it', async () => {
    loginOwner(ids)
    await __invoke('settings:set', { key: 'unified_till', value: '1' })
    loginStaff(ids)
    const get = await __invoke('settings:get-all', {})
    expect(get.settings.unified_till).toBe('1')
    const set = await __invoke('settings:set', { key: 'unified_till', value: '0' })
    expect(set.success).toBe(false)
    const row = db.prepare(`SELECT value FROM settings WHERE key = 'unified_till'`).get()
    expect(row.value).toBe('1')
  })
})
