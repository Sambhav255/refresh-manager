import { describe, it, expect, beforeEach } from 'vitest'
import { __invoke } from 'electron'
import { freshDb, seed, loginOwner, loginStaff } from './helpers.js'

let db
let ids

beforeEach(() => {
  db = freshDb()
  ids = seed(db)
})

// Inserts a sale with created_at offset by `minutesAgo` minutes from now
// (SQLite's own 'now','localtime', so it lines up with what the handler
// itself compares against). minutesAgo = null keeps the DB default (now).
function makeSaleMinutesAgo(minutesAgo, amount = 300) {
  const info = db
    .prepare(
      `INSERT INTO transactions (transaction_type, source, customer_name, amount, payment_method, staff_id, created_at)
       VALUES ('day_pass', 'pool', 'C', ?, 'cash', ?,
         datetime('now','localtime', ?))`
    )
    .run(amount, ids.staffId, minutesAgo == null ? '+0 minutes' : `-${minutesAgo} minutes`)
  return info.lastInsertRowid
}

// Inserts a sale on a specific calendar day (not "today"), at a fixed time.
function makeSaleOnDay(day, amount = 300) {
  const info = db
    .prepare(
      `INSERT INTO transactions (transaction_type, source, customer_name, amount, payment_method, staff_id, created_at)
       VALUES ('day_pass', 'pool', 'C', ?, 'cash', ?, ?)`
    )
    .run(amount, ids.staffId, `${day} 10:00:00`)
  return info.lastInsertRowid
}

describe('C-4 — staff-side void, time-windowed', () => {
  it('an owner can still void anything regardless of age (must not regress)', async () => {
    loginOwner(ids)
    const oldTxnId = makeSaleOnDay('2020-01-01')
    const res = await __invoke('transactions:void', {
      transactionId: oldTxnId,
      reason: 'owner cleanup'
    })
    expect(res.success).toBe(true)
    expect(
      db.prepare('SELECT is_voided FROM transactions WHERE id = ?').get(oldTxnId).is_voided
    ).toBe(1)
  })

  it('a staff member can void a transaction from 5 minutes ago', async () => {
    const txnId = makeSaleMinutesAgo(5)
    loginStaff(ids)
    const res = await __invoke('transactions:void', { transactionId: txnId, reason: 'wrong item' })
    expect(res.success).toBe(true)
  })

  it('a staff member CANNOT void a transaction from yesterday', async () => {
    const txnId = makeSaleOnDay('2020-01-01')
    loginStaff(ids)
    const res = await __invoke('transactions:void', { transactionId: txnId, reason: 'too old' })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/today|old/i)
    expect(db.prepare('SELECT is_voided FROM transactions WHERE id = ?').get(txnId).is_voided).toBe(
      0
    )
  })

  it('a staff member CANNOT void a same-day transaction older than the default 15-minute window', async () => {
    const txnId = makeSaleMinutesAgo(20)
    loginStaff(ids)
    const res = await __invoke('transactions:void', { transactionId: txnId, reason: 'too old' })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/too old|minute/i)
    expect(db.prepare('SELECT is_voided FROM transactions WHERE id = ?').get(txnId).is_voided).toBe(
      0
    )
  })

  it('the settings value actually changes the window', async () => {
    loginOwner(ids)
    await __invoke('settings:set', { key: 'staff_void_window_minutes', value: '5' })

    const txnId = makeSaleMinutesAgo(10)
    loginStaff(ids)
    const res = await __invoke('transactions:void', { transactionId: txnId, reason: 'too old now' })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/too old|minute/i)

    // And a fresher one still qualifies under the tighter window.
    const freshId = makeSaleMinutesAgo(2)
    const ok = await __invoke('transactions:void', { transactionId: freshId, reason: 'fine' })
    expect(ok.success).toBe(true)
  })

  it('defaults staff_void_window_minutes to 15 when unset', async () => {
    // 14 minutes: still inside the unconfigured default.
    const txnId = makeSaleMinutesAgo(14)
    loginStaff(ids)
    const res = await __invoke('transactions:void', { transactionId: txnId, reason: 'ok' })
    expect(res.success).toBe(true)
  })

  it('requires a non-empty reason for both owner and staff', async () => {
    const staffTxn = makeSaleMinutesAgo(1)
    loginStaff(ids)
    const staffRes = await __invoke('transactions:void', { transactionId: staffTxn, reason: '  ' })
    expect(staffRes.success).toBe(false)
    expect(staffRes.error).toMatch(/reason/i)

    loginOwner(ids)
    const ownerTxn = makeSaleMinutesAgo(1)
    const ownerRes = await __invoke('transactions:void', { transactionId: ownerTxn })
    expect(ownerRes.success).toBe(false)
    expect(ownerRes.error).toMatch(/reason/i)
  })

  it('every existing owner-void guard applies identically to an in-window staff void', async () => {
    // refund-type transaction
    const refundTxn = db
      .prepare(
        `INSERT INTO transactions (transaction_type, source, customer_name, amount, payment_method, staff_id, created_at)
         VALUES ('refund', 'pool', 'C', -100, 'cash', ?, datetime('now','localtime'))`
      )
      .run(ids.staffId).lastInsertRowid
    loginStaff(ids)
    const refundRes = await __invoke('transactions:void', { transactionId: refundTxn, reason: 'x' })
    expect(refundRes.success).toBe(false)
    expect(refundRes.error).toMatch(/refund/i)

    // booking_deposit transaction
    const depositTxn = db
      .prepare(
        `INSERT INTO transactions (transaction_type, source, customer_name, amount, payment_method, staff_id, created_at)
         VALUES ('booking_deposit', 'pool', 'C', 500, 'cash', ?, datetime('now','localtime'))`
      )
      .run(ids.staffId).lastInsertRowid
    const depositRes = await __invoke('transactions:void', {
      transactionId: depositTxn,
      reason: 'x'
    })
    expect(depositRes.success).toBe(false)
    expect(depositRes.error).toMatch(/booking deposit/i)

    // already-voided transaction
    const voidedTxn = makeSaleMinutesAgo(1)
    db.prepare('UPDATE transactions SET is_voided = 1 WHERE id = ?').run(voidedTxn)
    const voidedRes = await __invoke('transactions:void', { transactionId: voidedTxn, reason: 'x' })
    expect(voidedRes.success).toBe(false)
    expect(voidedRes.error).toMatch(/already voided/i)

    // a transaction with a live refund against it
    loginOwner(ids)
    const saleId = makeSaleMinutesAgo(1, 400)
    await __invoke('transactions:refund', { transactionId: saleId, amount: 100 })
    loginStaff(ids)
    const refundedRes = await __invoke('transactions:void', { transactionId: saleId, reason: 'x' })
    expect(refundedRes.success).toBe(false)
    expect(refundedRes.error).toMatch(/refunded/i)

    // reconciled-day guard: same-day, in-window sale, but the day is already
    // reconciled — staff gets the same requiresConfirmation contract as owner,
    // not a silent success.
    const today = db.prepare(`SELECT date('now','localtime') as d`).get().d
    db.prepare(
      `INSERT INTO cash_reconciliations (reconcile_date, system_cash, physical_cash, discrepancy, staff_id)
       VALUES (?, 0, 0, 0, ?)`
    ).run(today, ids.staffId)
    const reconTxn = makeSaleMinutesAgo(1)
    const reconRes = await __invoke('transactions:void', { transactionId: reconTxn, reason: 'x' })
    expect(reconRes.success).toBe(false)
    expect(reconRes.requiresConfirmation).toBe(true)
    expect(
      db.prepare('SELECT is_voided FROM transactions WHERE id = ?').get(reconTxn).is_voided
    ).toBe(0)
  })

  it('records the actor role on the audit log entry, for owner and staff voids', async () => {
    const staffTxn = makeSaleMinutesAgo(1)
    loginStaff(ids)
    await __invoke('transactions:void', { transactionId: staffTxn, reason: 'staff void' })
    const staffEntry = db
      .prepare(
        `SELECT detail FROM audit_log WHERE action = 'transaction:void' ORDER BY id DESC LIMIT 1`
      )
      .get()
    expect(JSON.parse(staffEntry.detail).actorRole).toBe('staff')

    loginOwner(ids)
    const ownerTxn = makeSaleMinutesAgo(1)
    await __invoke('transactions:void', { transactionId: ownerTxn, reason: 'owner void' })
    const ownerEntry = db
      .prepare(
        `SELECT detail FROM audit_log WHERE action = 'transaction:void' ORDER BY id DESC LIMIT 1`
      )
      .get()
    expect(JSON.parse(ownerEntry.detail).actorRole).toBe('owner')
  })

  it('flags voidByRole on transactions:list so the owner screen can tell staff voids apart', async () => {
    const txnId = makeSaleMinutesAgo(1)
    loginStaff(ids)
    await __invoke('transactions:void', { transactionId: txnId, reason: 'staff' })

    loginOwner(ids)
    const list = await __invoke('transactions:list', { includeVoided: true })
    const row = list.transactions.find((t) => t.id === txnId)
    expect(row.voidByRole).toBe('staff')
    expect(row.voidBy).toBe('Staff')
  })

  it('transactions:today-summary reports voidCount and voidTotal', async () => {
    const txnId = makeSaleMinutesAgo(1, 300)
    loginStaff(ids)
    await __invoke('transactions:void', { transactionId: txnId, reason: 'x' })

    const summary = await __invoke('transactions:today-summary', {})
    expect(summary.voidCount).toBe(1)
    expect(summary.voidTotal).toBe(300)
  })
})
