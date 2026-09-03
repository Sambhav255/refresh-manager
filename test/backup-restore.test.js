import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { __invoke, __getUserDataDir } from 'electron'
import { initDatabase, getDb } from '../src/main/db/index.js'
import { performBackup } from '../src/main/ipc/backup.js'
import { freshDb, seed, loginOwner, OWNER_PASSWORD } from './helpers.js'

function setPassphrase(db, value) {
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('backup_passphrase', ?)`).run(
    value
  )
}

let db
let ids

beforeEach(() => {
  db = freshDb()
  ids = seed(db)
  loginOwner(ids)
})

function addMarker(name) {
  return db
    .prepare(
      `INSERT INTO transactions (transaction_type, source, customer_name, amount, payment_method, staff_id)
       VALUES ('day_pass','pool',?,300,'cash',?)`
    )
    .run(name, ids.staffId).lastInsertRowid
}

function countTxns(database) {
  return database.prepare('SELECT COUNT(*) c FROM transactions').get().c
}

describe('P0-3 — backup restore is a safe close/replace/relaunch', () => {
  it('restores the backup snapshot and drops changes made after the backup', async () => {
    addMarker('before-backup')
    const backupDir = mkdtempSync(join(tmpdir(), 'refresh-bak-'))
    const { filePath } = await performBackup({ destinationPath: backupDir, skipOwnerCheck: true })

    // A change made AFTER the backup should be gone after restoring.
    addMarker('after-backup')
    expect(countTxns(db)).toBe(2)

    const res = await __invoke('backup:restore', {
      backupFilePath: filePath,
      password: OWNER_PASSWORD
    })
    expect(res.success).toBe(true)
    expect(res.willRelaunch).toBe(true)

    // The handler closed the connection; reopen against the restored file
    // (this is what app.relaunch would achieve in production).
    initDatabase()
    const reopened = getDb()
    expect(countTxns(reopened)).toBe(1)
    const names = reopened
      .prepare('SELECT customer_name FROM transactions')
      .all()
      .map((r) => r.customer_name)
    expect(names).toContain('before-backup')
    expect(names).not.toContain('after-backup')
  })

  it('rejects a non-SQLite file and leaves the live database untouched', async () => {
    addMarker('live')
    const junk = join(mkdtempSync(join(tmpdir(), 'refresh-junk-')), 'not-a-db.db')
    writeFileSync(junk, 'this is definitely not a sqlite file')

    const res = await __invoke('backup:restore', {
      backupFilePath: junk,
      password: OWNER_PASSWORD
    })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/not a valid database/i)
    // Live DB still open and intact.
    expect(countTxns(db)).toBe(1)
  })

  it('rejects a header-valid but corrupt backup and leaves live data untouched (2-A)', async () => {
    addMarker('live')
    // A file that passes the 16-byte magic check but is not a real database:
    // valid header prefix followed by garbage so integrity_check fails.
    const junkDir = mkdtempSync(join(tmpdir(), 'refresh-corrupt-'))
    const corrupt = join(junkDir, 'corrupt.db')
    const header = Buffer.from('SQLite format 3\0', 'binary')
    writeFileSync(corrupt, Buffer.concat([header, Buffer.alloc(4096, 0xee)]))

    const res = await __invoke('backup:restore', {
      backupFilePath: corrupt,
      password: OWNER_PASSWORD
    })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/integrity/i)
    // Live DB still open and intact — the restore aborted before closing it.
    expect(countTxns(db)).toBe(1)
  })

  it('a freshly created backup passes verification and restores (2-B happy path)', async () => {
    addMarker('marker')
    const backupDir = mkdtempSync(join(tmpdir(), 'refresh-bak-'))
    const result = await performBackup({ destinationPath: backupDir, skipOwnerCheck: true })
    expect(result.success).toBe(true)
    // The backup verified clean at creation; restoring it succeeds.
    const res = await __invoke('backup:restore', {
      backupFilePath: result.filePath,
      password: OWNER_PASSWORD
    })
    expect(res.success).toBe(true)
  })

  it('encrypted backup bundles photos and restores them (2-B/2-F)', async () => {
    setPassphrase(db, 's3cret-pass')
    const pdir = join(__getUserDataDir(), 'photos')
    mkdirSync(pdir, { recursive: true })
    writeFileSync(join(pdir, '1.jpg'), Buffer.from('PHOTO-DATA'))

    addMarker('before-backup')
    const backupDir = mkdtempSync(join(tmpdir(), 'refresh-enc-'))
    const { filePath, encrypted } = await performBackup({
      destinationPath: backupDir,
      skipOwnerCheck: true
    })
    expect(encrypted).toBe(true)
    expect(filePath.endsWith('.rmbak')).toBe(true)

    // Change data and delete the photo after the backup.
    addMarker('after-backup')
    rmSync(join(pdir, '1.jpg'))

    const res = await __invoke('backup:restore', {
      backupFilePath: filePath,
      password: OWNER_PASSWORD
    })
    expect(res.success).toBe(true)
    expect(res.encrypted).toBe(true)

    initDatabase()
    expect(countTxns(getDb())).toBe(1)
    // The photo was restored from inside the encrypted archive.
    expect(existsSync(join(pdir, '1.jpg'))).toBe(true)
    expect(readFileSync(join(pdir, '1.jpg')).toString()).toBe('PHOTO-DATA')
  })

  it('encrypted restore with the wrong passphrase fails, live data intact (2-F)', async () => {
    setPassphrase(db, 'right-pass')
    addMarker('live')
    const backupDir = mkdtempSync(join(tmpdir(), 'refresh-enc-'))
    const { filePath } = await performBackup({ destinationPath: backupDir, skipOwnerCheck: true })

    const res = await __invoke('backup:restore', {
      backupFilePath: filePath,
      password: OWNER_PASSWORD,
      backupPassphrase: 'WRONG-PASS'
    })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/passphrase|decrypt|corrupt/i)
    expect(countTxns(db)).toBe(1)
  })

  it('rejects a wrong admin password', async () => {
    const backupDir = mkdtempSync(join(tmpdir(), 'refresh-bak-'))
    const { filePath } = await performBackup({ destinationPath: backupDir, skipOwnerCheck: true })
    const res = await __invoke('backup:restore', { backupFilePath: filePath, password: 'wrong' })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/incorrect admin password/i)
  })
})
