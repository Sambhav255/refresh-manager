// settings:get-all is reachable with a staff PIN, and it used to return every
// row in the table. That handed any staff member the plaintext backup
// passphrase — and with a backup file, the decrypted history of the whole
// business: members, phone numbers and every transaction.
import { describe, it, expect, beforeEach } from 'vitest'
import { __invoke } from 'electron'
import { freshDb, seed, loginStaff, loginOwner } from './helpers.js'

let db
let ids

beforeEach(() => {
  db = freshDb()
  ids = seed(db)
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('backup_passphrase', ?)`).run(
    'correct horse battery staple'
  )
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('recovery_code_hash', ?)`).run(
    '$2a$10$notarealhashbutlongenoughtolooklikeone'
  )
})

const secretsIn = (payload) => {
  const blob = JSON.stringify(payload)
  return {
    passphrase: blob.includes('correct horse battery staple'),
    hash: blob.includes('$2a$10$notarealhash')
  }
}

describe('settings secrets never leave the main process', () => {
  it('staff cannot read the backup passphrase or the recovery hash', async () => {
    loginStaff(ids)
    const res = await __invoke('settings:get-all', {})
    const leaked = secretsIn(res)
    expect(leaked.passphrase).toBe(false)
    expect(leaked.hash).toBe(false)
    expect(res.settings.backup_passphrase).toBeUndefined()
    expect(res.settings.recovery_code_hash).toBeUndefined()
  })

  it('the owner cannot read them either — nothing needs the value', async () => {
    loginOwner(ids)
    const res = await __invoke('settings:get-all', {})
    const leaked = secretsIn(res)
    expect(leaked.passphrase).toBe(false)
    expect(leaked.hash).toBe(false)
  })

  it('but "is it set" is still reported, which is all any screen needs', async () => {
    loginOwner(ids)
    const res = await __invoke('settings:get-all', {})
    expect(res.configured.backup_passphrase).toBe(true)
    expect(res.configured.recovery_code_hash).toBe(true)
  })

  it('an unset secret reports false rather than going missing', async () => {
    db.prepare(`UPDATE settings SET value = '' WHERE key = 'backup_passphrase'`).run()
    loginOwner(ids)
    const res = await __invoke('settings:get-all', {})
    expect(res.configured.backup_passphrase).toBe(false)
  })

  it('ordinary settings still come back untouched', async () => {
    loginStaff(ids)
    const res = await __invoke('settings:get-all', {})
    expect(res.settings.business_name).toBeTruthy()
  })

  it('the main process can still read the real passphrase to encrypt with', () => {
    // The value must remain in the table — redaction is at the IPC boundary,
    // not in storage, or backups could no longer be encrypted or restored.
    const row = db.prepare(`SELECT value FROM settings WHERE key = 'backup_passphrase'`).get()
    expect(row.value).toBe('correct horse battery staple')
  })
})
