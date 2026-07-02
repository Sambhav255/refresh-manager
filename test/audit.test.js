import { describe, it, expect, beforeEach } from 'vitest'
import { __invoke } from 'electron'
import { freshDb, seed, loginOwner, loginStaff } from './helpers.js'

let db
let ids

beforeEach(() => {
  db = freshDb()
  ids = seed(db)
})

function makeSale(name = 'Walk-in', day = null) {
  const created = day ? `${day} 10:00:00` : null
  const info = db
    .prepare(
      `INSERT INTO transactions (transaction_type, source, customer_name, amount, payment_method, staff_id, created_at)
       VALUES ('day_pass','pool',?,300,'cash',?, COALESCE(?, datetime('now','localtime')))`
    )
    .run(name, ids.staffId, created)
  return info.lastInsertRowid
}

describe('2-E — audit log', () => {
  it('records a void with the acting owner and amount', async () => {
    loginOwner(ids)
    const txnId = makeSale('to-void')
    const res = await __invoke('transactions:void', { transactionId: txnId, reason: 'mistake' })
    expect(res.success).toBe(true)

    const entry = db
      .prepare(`SELECT * FROM audit_log WHERE action = 'transaction:void' ORDER BY id DESC LIMIT 1`)
      .get()
    expect(entry).toBeTruthy()
    expect(entry.actor_user_id).toBe(ids.ownerId)
    const detail = JSON.parse(entry.detail)
    expect(detail.transactionId).toBe(txnId)
    expect(detail.amount).toBe(300)
  })

  it('records a settings change but never the value of a sensitive key', async () => {
    loginOwner(ids)
    await __invoke('settings:set', { key: 'whatsapp_owner_number', value: '9800000000' })
    await __invoke('settings:set', { key: 'backup_passphrase', value: 'super-secret' })

    const normal = db
      .prepare(
        `SELECT detail FROM audit_log WHERE action='settings:set' AND detail LIKE '%whatsapp%'`
      )
      .get()
    expect(JSON.parse(normal.detail).value).toBe('9800000000')

    const sensitive = db
      .prepare(
        `SELECT detail FROM audit_log WHERE action='settings:set' AND detail LIKE '%backup_passphrase%'`
      )
      .get()
    expect(JSON.parse(sensitive.detail).value).toBeUndefined()
  })

  it('audit:list is owner-only and returns entries newest-first', async () => {
    loginOwner(ids)
    const txnId = makeSale('x')
    await __invoke('transactions:void', { transactionId: txnId, reason: 'r' })
    const res = await __invoke('audit:list', {})
    expect(res.entries.length).toBeGreaterThan(0)
    expect(res.entries[0].action).toBe('transaction:void')

    loginStaff(ids)
    const denied = await __invoke('audit:list', {})
    expect(denied.success).toBe(false)
  })
})

describe('2-E — reconciliation-aware voids', () => {
  it('blocks voiding a reconciled day until confirmed, then records it', async () => {
    loginOwner(ids)
    const day = '2026-06-15'
    const txnId = makeSale('recon-day', day)
    // Reconcile that day.
    db.prepare(
      `INSERT INTO cash_reconciliations (reconcile_date, system_cash, physical_cash, discrepancy, staff_id)
       VALUES (?, 300, 300, 0, ?)`
    ).run(day, ids.staffId)

    // First attempt is blocked (no confirmation).
    const blocked = await __invoke('transactions:void', { transactionId: txnId, reason: 'fix' })
    expect(blocked.success).toBe(false)
    expect(blocked.requiresConfirmation).toBe(true)
    expect(blocked.reconciledDay).toBe(day)
    expect(db.prepare('SELECT is_voided FROM transactions WHERE id = ?').get(txnId).is_voided).toBe(
      0
    )

    // Confirmed void proceeds and is flagged in the audit log.
    const ok = await __invoke('transactions:void', {
      transactionId: txnId,
      reason: 'fix',
      confirmReconciled: true
    })
    expect(ok.success).toBe(true)
    expect(ok.wasReconciled).toBe(true)
    const entry = db
      .prepare(
        `SELECT detail FROM audit_log WHERE action='transaction:void' ORDER BY id DESC LIMIT 1`
      )
      .get()
    expect(JSON.parse(entry.detail).reconciledDay).toBe(day)
  })
})
