// Regression tests for the bugs found and fixed in the 2026-08 QA sweep
// (docs/qa/QA_REPORT.md). Every test here targets a bug that shipped in a
// working tree at least once — none of these are hypothetical. They must all
// pass against current code; a failure means a fixed bug has come back.
import { describe, it, expect, beforeEach } from 'vitest'
import { __invoke } from 'electron'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { freshDb, seed, loginStaff, loginOwner } from './helpers.js'
import { generateEODMessage } from '../src/main/ipc/whatsapp.js'
import { performBackup } from '../src/main/ipc/backup.js'
import {
  TYPE_LABELS,
  TYPE_ORDER,
  typeLabel,
  orderedTypes
} from '../src/shared/transaction-types.js'

let db
let ids

beforeEach(() => {
  db = freshDb()
  ids = seed(db)
})

// ---------------------------------------------------------------------------
// P1-3 — product display names (was: "undefined — Monthly" / blank cells in
// Today's Log, owner Transactions, dashboard, and every report/Excel export).
// Root cause: mapTransaction passed the raw joined row (name aliased to
// product_name) into productDisplayName, which reads .name.
// ---------------------------------------------------------------------------
describe('QA P1-3 — transaction product names are never "undefined"', () => {
  it('membership rows show the real product name with duration', async () => {
    loginStaff(ids)
    await __invoke('transactions:create', {
      type: 'membership',
      productId: ids.memProdId,
      customerName: 'Hari Shrestha',
      paymentMethod: 'qr'
    })
    loginOwner(ids)
    const { transactions } = await __invoke('transactions:list', {})
    const row = transactions.find((t) => t.type === 'membership')
    expect(row.product).toContain('Monthly')
    expect(String(row.product)).not.toContain('undefined')
  })

  it('day-pass rows show the product name, not a blank cell', async () => {
    loginStaff(ids)
    await __invoke('transactions:create', {
      type: 'day_pass',
      productId: ids.dayPassId,
      customerName: 'Walk-in',
      paymentMethod: 'cash'
    })
    loginOwner(ids)
    const { transactions } = await __invoke('transactions:list', {})
    const row = transactions.find((t) => t.type === 'day_pass')
    expect(row.product).toBe('Day Pass')
  })

  it('rows with no product fall back to notes ("Tea x2"), not the raw enum', async () => {
    loginStaff(ids)
    await __invoke('restaurant:checkout', {
      items: [{ id: ids.menuLinkedId, quantity: 2 }],
      paymentMethod: 'cash'
    })
    loginOwner(ids)
    const { transactions } = await __invoke('transactions:list', {})
    const row = transactions.find((t) => t.type === 'restaurant')
    expect(row.product).toBe('Tea x2')
    expect(row.product).not.toBe('restaurant')
  })

  it('no row in a mixed day ever renders undefined anywhere in its mapping', async () => {
    loginStaff(ids)
    await __invoke('transactions:create', {
      type: 'membership',
      productId: ids.memProdId,
      customerName: 'A',
      paymentMethod: 'cash'
    })
    await __invoke('transactions:create', {
      type: 'day_pass',
      productId: ids.dayPassId,
      customerName: 'B',
      paymentMethod: 'qr'
    })
    await __invoke('restaurant:checkout', {
      items: [{ id: ids.menuPlainId, quantity: 1 }],
      paymentMethod: 'cash'
    })
    loginOwner(ids)
    const { transactions } = await __invoke('transactions:list', {})
    for (const t of transactions) {
      expect(String(t.product)).not.toMatch(/undefined/)
      expect(t.product).toBeTruthy()
    }
  })
})

// ---------------------------------------------------------------------------
// P1-4 — voiding a refund (was: accepted; removed the negative correction so
// the refunded sale counted as revenue again — Rs. 10,000 of phantom income).
// ---------------------------------------------------------------------------
describe('QA P1-4 — a refund row can never be voided', () => {
  it('rejects the void and leaves the day total unchanged', async () => {
    loginStaff(ids)
    await __invoke('transactions:create', {
      type: 'day_pass',
      productId: ids.dayPassId,
      customerName: 'C',
      paymentMethod: 'cash'
    })
    loginOwner(ids)
    const { transactions } = await __invoke('transactions:list', {})
    const sale = transactions.find((t) => t.type === 'day_pass')

    const refund = await __invoke('transactions:refund', {
      transactionId: sale.id,
      amount: sale.amount,
      reason: 'customer left'
    })
    expect(refund.success).toBe(true)

    const afterRefund = await __invoke('transactions:today-summary', {})
    const refundRow = db
      .prepare(`SELECT id FROM transactions WHERE transaction_type = 'refund'`)
      .get()

    const res = await __invoke('transactions:void', {
      transactionId: refundRow.id,
      reason: 'should be refused'
    })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/refund/i)

    // The books did not move: total is still net zero for this pair.
    const afterVoidAttempt = await __invoke('transactions:today-summary', {})
    expect(afterVoidAttempt.total).toBe(afterRefund.total)
    // And the refund row is still live.
    const still = db.prepare(`SELECT is_voided FROM transactions WHERE id = ?`).get(refundRow.id)
    expect(still.is_voided).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// P1-5 — EOD / WhatsApp breakdown sharing. The renderer and generateEODMessage
// now import the same TYPE_LABELS/TYPE_ORDER from src/shared. These tests pin
// the shared module's contract so neither side can silently diverge again.
// ---------------------------------------------------------------------------
describe('QA P1-5 — shared transaction-type breakdown contract', () => {
  it('the shared map covers every transaction type the schema allows', () => {
    // Pulled from the CHECK constraint on transactions.transaction_type.
    const schemaTypes = [
      'membership',
      'day_package',
      'day_pass',
      'restaurant',
      'pool_inventory',
      'booking_deposit',
      'refund'
    ]
    for (const t of schemaTypes) {
      expect(TYPE_LABELS[t], `missing label for ${t}`).toBeTruthy()
      expect(TYPE_ORDER).toContain(t)
    }
  })

  it('orderedTypes appends unknown future types instead of dropping them', () => {
    const byType = { day_pass: 500, some_future_type: 100, membership: 1000 }
    const order = orderedTypes(byType)
    expect(order).toEqual(['membership', 'day_pass', 'some_future_type'])
    expect(typeLabel('some_future_type')).toBe('some_future_type')
  })

  it('today-summary byType always reconciles to its own total', async () => {
    loginStaff(ids)
    await __invoke('transactions:create', {
      type: 'day_pass',
      productId: ids.dayPassId,
      customerName: 'A',
      paymentMethod: 'cash'
    })
    await __invoke('pool-inventory:sell-item', {
      itemId: ids.poolItemId,
      quantity: 2,
      paymentMethod: 'cash',
      customerName: 'B'
    })
    await __invoke('restaurant:checkout', {
      items: [{ id: ids.menuPlainId, quantity: 1 }],
      paymentMethod: 'qr'
    })
    const s = await __invoke('transactions:today-summary', {})
    const lineSum = Object.values(s.byType).reduce((a, b) => a + b, 0)
    expect(lineSum).toBe(s.total)
    expect(s.cash + s.qr).toBe(s.total)
    // The types that actually traded are all present as keys.
    expect(Object.keys(s.byType).sort()).toEqual(
      ['day_pass', 'pool_inventory', 'restaurant'].sort()
    )
  })

  it('the WhatsApp message and byType agree on a mixed day', async () => {
    loginStaff(ids)
    await __invoke('transactions:create', {
      type: 'day_pass',
      productId: ids.dayPassId,
      customerName: 'A',
      paymentMethod: 'cash'
    })
    await __invoke('restaurant:checkout', {
      items: [{ id: ids.menuPlainId, quantity: 2 }],
      paymentMethod: 'qr'
    })
    const s = await __invoke('transactions:today-summary', {})
    const msg = generateEODMessage()
    for (const [type, amount] of Object.entries(s.byType)) {
      expect(msg).toContain(`${typeLabel(type)}:`)
      expect(msg).toContain(`Rs. ${amount}`)
    }
  })
})

// ---------------------------------------------------------------------------
// P1-8 — auth:setup hardening (was: untrimmed names permanently locked the
// owner out of a fresh install; re-entrant submit created duplicate accounts).
// ---------------------------------------------------------------------------
describe('QA P1-8 — auth:setup trims, caps, and is idempotent', () => {
  // These need an EMPTY users table, so they do not use seed().
  beforeEach(() => {
    db = freshDb()
  })

  it('stores trimmed names and the trimmed name logs in', async () => {
    const setup = await __invoke('auth:setup', {
      ownerName: '  Sambhav  ',
      password: 'refresh2024',
      staffName: '  Reception  ',
      staffPin: '4821'
    })
    expect(setup.success).toBe(true)
    expect(setup.user.name).toBe('Sambhav')

    await __invoke('auth:logout', {})
    const login = await __invoke('auth:login', {
      username: 'Sambhav',
      password: 'refresh2024'
    })
    expect(login.success).toBe(true)
  })

  it('rejects whitespace-only names', async () => {
    const res = await __invoke('auth:setup', {
      ownerName: '   ',
      password: 'refresh2024',
      staffName: 'Reception',
      staffPin: '4821'
    })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/required/i)
  })

  it('rejects names longer than 60 characters', async () => {
    const res = await __invoke('auth:setup', {
      ownerName: 'O'.repeat(61),
      password: 'refresh2024',
      staffName: 'Reception',
      staffPin: '4821'
    })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/60/)
  })

  it('a second setup is refused and creates no extra accounts', async () => {
    await __invoke('auth:setup', {
      ownerName: 'Owner',
      password: 'refresh2024',
      staffName: 'Staff',
      staffPin: '4821'
    })
    const again = await __invoke('auth:setup', {
      ownerName: 'Owner2',
      password: 'refresh2024',
      staffName: 'Staff2',
      staffPin: '9999'
    })
    expect(again.success).toBe(false)
    const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n
    expect(count).toBe(2)
  })

  it('two concurrent setup submits create exactly one owner and one staff', async () => {
    const payload = {
      ownerName: 'Owner',
      password: 'refresh2024',
      staffName: 'Staff',
      staffPin: '4821'
    }
    const [a, b] = await Promise.all([
      __invoke('auth:setup', payload),
      __invoke('auth:setup', payload)
    ])
    // Exactly one wins; the loser gets a clean error, and no duplicates exist.
    expect([a.success, b.success].filter(Boolean).length).toBe(1)
    const owners = db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role='owner'`).get().n
    const staff = db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role='staff'`).get().n
    expect(owners).toBe(1)
    expect(staff).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// P2 — backup timestamp convention (was: last_backup_at written in UTC but
// read as local, so a fresh backup looked ~6h old in Kathmandu and the 36h
// staleness alert fired ~5h45m early).
// ---------------------------------------------------------------------------
describe('QA P2 — last_backup_at uses local time like the rest of the schema', () => {
  it('a fresh backup timestamp is within a minute of local now', () => {
    loginOwner(ids)
    const dest = mkdtempSync(join(tmpdir(), 'refresh-bk-'))
    performBackup({ destinationPath: dest, skipOwnerCheck: true })

    const stamp = db.prepare(`SELECT value FROM settings WHERE key = 'last_backup_at'`).get().value
    const localNow = db.prepare(`SELECT datetime('now','localtime') AS n`).get().n
    const diffSeconds = Math.abs(
      (Date.parse(localNow.replace(' ', 'T')) - Date.parse(stamp.replace(' ', 'T'))) / 1000
    )
    // Would be ~20,700s (5h45m) if either side regressed to UTC.
    expect(diffSeconds).toBeLessThan(60)
  })
})

// ---------------------------------------------------------------------------
// P3 — deterministic ordering (was: same-second rows shuffled between filtered
// and unfiltered views because ORDER BY created_at DESC had no tiebreak).
// ---------------------------------------------------------------------------
describe('QA P3 — transaction ordering is stable for same-second rows', () => {
  it('same-timestamp rows come back id-descending in every filter state', async () => {
    const at = '2026-08-19 10:00:00'
    const ins = db.prepare(
      `INSERT INTO transactions (transaction_type, source, customer_name, amount, payment_method, staff_id, created_at)
       VALUES ('day_pass', 'pool', ?, 300, 'cash', ?, ?)`
    )
    for (const c of ['A', 'B', 'C', 'D', 'E']) ins.run(c, ids.staffId, at)

    loginOwner(ids)
    const all = await __invoke('transactions:list', {})
    const filtered = await __invoke('transactions:list', { staffId: ids.staffId })

    const idsOf = (r) => r.transactions.map((t) => t.id)
    const sortedDesc = [...idsOf(all)].sort((x, y) => y - x)
    expect(idsOf(all)).toEqual(sortedDesc)
    expect(idsOf(filtered)).toEqual(idsOf(all))
  })
})

// ---------------------------------------------------------------------------
// Booking cancel — the deposit is deliberately NOT auto-reversed (forfeits are
// normal), but the handler must surface it so the UI can ask.
// ---------------------------------------------------------------------------
describe('QA — cancelling a booking surfaces its outstanding deposit', () => {
  it('returns outstandingDeposit on cancel, 0 on other transitions', async () => {
    loginOwner(ids)
    const { bookingId } = await __invoke('bookings:create', {
      bookingName: 'Birthday',
      bookingDate: '2026-09-01',
      depositPaid: 3000,
      depositMethod: 'cash',
      totalExpected: 20000
    })

    const done = await __invoke('bookings:update-status', {
      bookingId,
      status: 'confirmed'
    })
    expect(done.outstandingDeposit).toBe(0)

    const cancelled = await __invoke('bookings:update-status', {
      bookingId,
      status: 'cancelled'
    })
    expect(cancelled.success).toBe(true)
    expect(cancelled.outstandingDeposit).toBe(3000)

    // The deposit transaction itself is untouched — still live revenue until
    // the owner explicitly decides forfeit vs refund.
    const dep = db
      .prepare(`SELECT is_voided FROM transactions WHERE transaction_type = 'booking_deposit'`)
      .get()
    expect(dep.is_voided).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// P0-2 root-cause guard — the POS bug shipped because the handler's "Menu item
// not found" error looked like a data problem when the real issue was a
// missing id in the payload. Pin the error surface so it stays diagnosable.
// ---------------------------------------------------------------------------
describe('QA P0-2 — restaurant checkout error surface', () => {
  it('a line without an id fails loudly, names the item, and writes nothing', async () => {
    loginStaff(ids)
    const res = await __invoke('restaurant:checkout', {
      items: [{ name: 'Tea', price: 150, quantity: 1 }],
      paymentMethod: 'cash'
    })
    expect(res.success).toBe(false)
    expect(res.error).toContain('Tea')
    const n = db.prepare(`SELECT COUNT(*) AS n FROM transactions`).get().n
    expect(n).toBe(0)
  })

  it('the same cart WITH ids succeeds and draws down stock', async () => {
    loginStaff(ids)
    const before = db
      .prepare(`SELECT current_stock FROM restaurant_inventory_items WHERE id = ?`)
      .get(ids.rInvId).current_stock
    const res = await __invoke('restaurant:checkout', {
      items: [{ id: ids.menuLinkedId, quantity: 1 }],
      paymentMethod: 'cash'
    })
    expect(res.success).toBe(true)
    const after = db
      .prepare(`SELECT current_stock FROM restaurant_inventory_items WHERE id = ?`)
      .get(ids.rInvId).current_stock
    expect(after).toBe(before - 1)
  })
})
