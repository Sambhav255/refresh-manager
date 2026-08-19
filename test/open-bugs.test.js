// Executable specifications for the KNOWN OPEN bugs from the 2026-08 QA sweep
// (docs/qa/QA_REPORT.md — "OPEN" sections). Every describe block is skipped:
// the suite stays green until someone picks a bug up.
//
// Workflow for the implementer:
//   1. Change one `describe.skip` to `describe` — the tests inside MUST fail.
//      If they pass before you change any code, the spec is stale; stop and
//      re-verify the bug before writing anything.
//   2. Implement the fix (root cause and file:line are in each header).
//   3. Tests go green. Move the block into qa-regressions.test.js or leave it
//      here unskipped — either way it now guards the fix.
//
// Do NOT delete a block instead of fixing it without recording the decision in
// docs/qa/QA_REPORT.md — several of these are money bugs.
import { describe, it, expect, beforeEach } from 'vitest'
import { __invoke } from 'electron'
import { freshDb, seed, loginStaff, loginOwner, isoOffset } from './helpers.js'

let db
let ids

beforeEach(() => {
  db = freshDb()
  ids = seed(db)
})

// ---------------------------------------------------------------------------
// OPEN-1 (P2, money) — every membership runs one day longer than its
// duration_days. membershipEndDate (src/main/ipc/members.js:85-88) returns
// start + durationDays, and every consumer compares INCLUSIVELY
// (end_date >= today), so a 30-day product grants 31 usable days — roughly 12
// free days per member per year on monthly renewals.
//
// Decision required BEFORE fixing: existing rows keep their (over-generous)
// end dates or get migrated. The tests below assert the convention
// "end_date = start + durationDays - 1, comparisons stay inclusive".
// Whichever convention is chosen, members.js, utils.js:membershipStatus,
// members:expiring-soon, and reminders.js:fetchExpiring must all agree.
// ---------------------------------------------------------------------------
describe('OPEN-1 — membership duration is exactly duration_days', () => {
  it('a 30-day membership started 2026-01-01 is last valid on 2026-01-30', async () => {
    loginStaff(ids)
    const { memberId } = await __invoke('members:create', { name: 'Hari', phone: '9841000001' })
    await __invoke('members:add-membership', {
      memberId,
      productId: ids.memProdId, // seed: 'Monthly', 30 days
      startDate: '2026-01-01',
      paymentMethod: 'cash'
    })
    const row = db
      .prepare(`SELECT start_date, end_date FROM memberships WHERE member_id = ?`)
      .get(memberId)
    expect(row.end_date).toBe('2026-01-30')

    // Inclusive usable days = duration_days exactly.
    const usable = (Date.parse(row.end_date) - Date.parse(row.start_date)) / 86400000 + 1
    expect(usable).toBe(30)
  })

  it('a renewal starting the day after expiry leaves no gap and no overlap', async () => {
    loginStaff(ids)
    const { memberId } = await __invoke('members:create', { name: 'Renewer' })
    await __invoke('members:add-membership', {
      memberId,
      productId: ids.memProdId,
      startDate: '2026-01-01',
      paymentMethod: 'cash'
    })
    await __invoke('members:add-membership', {
      memberId,
      productId: ids.memProdId,
      startDate: '2026-01-31', // day after the corrected end date
      paymentMethod: 'cash'
    })
    const rows = db
      .prepare(
        `SELECT start_date, end_date FROM memberships WHERE member_id = ? ORDER BY start_date`
      )
      .all(memberId)
    expect(rows[0].end_date).toBe('2026-01-30')
    expect(rows[1].start_date).toBe('2026-01-31')
    expect(rows[1].end_date).toBe('2026-03-01') // 31 Jan + 29 days
  })
})

// ---------------------------------------------------------------------------
// OPEN-2 (P2, money) — a fully refunded membership stays Active. The refund
// handler (src/main/ipc/transactions.js, refund branch) restores linked
// INVENTORY on a full refund but never touches the memberships row, even
// though it is linked via memberships.transaction_id. The member keeps access
// they were fully refunded for.
// ---------------------------------------------------------------------------
describe('OPEN-2 — full refund of a membership sale ends the membership', () => {
  it('the linked membership is no longer active after a full refund', async () => {
    loginStaff(ids)
    const { memberId } = await __invoke('members:create', { name: 'Deepa' })
    const added = await __invoke('members:add-membership', {
      memberId,
      productId: ids.memProdId,
      startDate: isoOffset(0),
      paymentMethod: 'qr'
    })
    expect(added.success).toBe(true)

    loginOwner(ids)
    const sale = db
      .prepare(`SELECT id, amount FROM transactions WHERE transaction_type = 'membership'`)
      .get()
    const refund = await __invoke('transactions:refund', {
      transactionId: sale.id,
      amount: sale.amount,
      reason: 'joined by mistake'
    })
    expect(refund.success).toBe(true)

    const ms = db
      .prepare(`SELECT status, end_date FROM memberships WHERE member_id = ?`)
      .get(memberId)
    // Whichever representation is chosen (status='cancelled' or end_date moved
    // before today), the member must NOT appear active.
    const search = await __invoke('members:search', { query: 'Deepa' })
    expect(search.members[0].activeMembership).toBeFalsy()
    expect(ms.status === 'active' && ms.end_date >= isoOffset(0)).toBe(false)
  })

  it('a PARTIAL refund leaves the membership alone', async () => {
    loginStaff(ids)
    const { memberId } = await __invoke('members:create', { name: 'Partial' })
    await __invoke('members:add-membership', {
      memberId,
      productId: ids.memProdId,
      startDate: isoOffset(0),
      paymentMethod: 'cash'
    })
    loginOwner(ids)
    const sale = db
      .prepare(`SELECT id, amount FROM transactions WHERE transaction_type = 'membership'`)
      .get()
    await __invoke('transactions:refund', {
      transactionId: sale.id,
      amount: Math.floor(sale.amount / 2),
      reason: 'goodwill'
    })
    const search = await __invoke('members:search', { query: 'Partial' })
    expect(search.members[0].activeMembership).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// OPEN-3 (P3, metrics) — the same member can be checked in repeatedly on one
// day. The only guard is component-local React state, lost on tab switch;
// checkins:create (src/main/ipc/checkins.js:18-32) inserts unconditionally.
// Footfall and daily-average attendance feed owner reports, so a busy desk
// re-searching a member steadily over-reports attendance.
// ---------------------------------------------------------------------------
describe('OPEN-3 — one check-in per member per day', () => {
  it('a second same-day check-in does not create a second row', async () => {
    loginStaff(ids)
    const { memberId } = await __invoke('members:create', { name: 'Anita' })
    const first = await __invoke('checkins:create', { memberId, source: 'member' })
    expect(first.success).toBe(true)

    const second = await __invoke('checkins:create', { memberId, source: 'member' })
    // Contract: NOT an error (reception double-tap must not show a scary red
    // alert) — a success that says it was already done.
    expect(second.success).toBe(true)
    expect(second.alreadyCheckedIn).toBe(true)

    const n = db
      .prepare(
        `SELECT COUNT(*) AS n FROM check_ins WHERE member_id = ? AND date(checked_in_at) = date('now','localtime')`
      )
      .get(memberId).n
    expect(n).toBe(1)
  })

  it('search results carry today’s check-in state so the UI can render truth', async () => {
    loginStaff(ids)
    const { memberId } = await __invoke('members:create', { name: 'Binod', phone: '9841000009' })
    await __invoke('checkins:create', { memberId, source: 'member' })
    const res = await __invoke('members:search', { query: 'Binod' })
    expect(res.members[0].checkedInToday).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// OPEN-4 (P2, auditability) — voided transactions vanish completely.
// transactions:list hardcodes WHERE is_voided = 0 (transactions.js), so the
// mapped isVoided field can never be true for any caller. The only trace of a
// void is the audit log. Contract: an opt-in includeVoided param; default
// behaviour unchanged.
// ---------------------------------------------------------------------------
describe('OPEN-4 — voided transactions are visible on request', () => {
  it('includeVoided:true returns the voided row flagged, default still hides it', async () => {
    loginStaff(ids)
    await __invoke('transactions:create', {
      type: 'day_pass',
      productId: ids.dayPassId,
      customerName: 'V',
      paymentMethod: 'cash'
    })
    loginOwner(ids)
    const before = await __invoke('transactions:list', {})
    const target = before.transactions[0]
    await __invoke('transactions:void', { transactionId: target.id, reason: 'test void' })

    const hidden = await __invoke('transactions:list', {})
    expect(hidden.transactions.find((t) => t.id === target.id)).toBeUndefined()

    const shown = await __invoke('transactions:list', { includeVoided: true })
    const row = shown.transactions.find((t) => t.id === target.id)
    expect(row).toBeTruthy()
    expect(row.isVoided).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// OPEN-5 (P3, money UX) — the refund dialog pre-fills the ORIGINAL amount even
// after a partial refund, and never shows what is still refundable. The main
// process computes `remaining` internally but never returns it on list rows.
// ---------------------------------------------------------------------------
describe('OPEN-5 — list rows expose refundedSoFar / remaining', () => {
  it('a partially refunded sale reports both figures', async () => {
    loginStaff(ids)
    await __invoke('transactions:create', {
      type: 'membership',
      productId: ids.memProdId,
      customerName: 'R',
      paymentMethod: 'qr'
    })
    loginOwner(ids)
    const sale = (await __invoke('transactions:list', {})).transactions[0]
    await __invoke('transactions:refund', {
      transactionId: sale.id,
      amount: 200,
      reason: 'partial'
    })
    const after = (await __invoke('transactions:list', {})).transactions.find(
      (t) => t.id === sale.id
    )
    expect(after.refundedSoFar).toBe(200)
    expect(after.remaining).toBe(sale.amount - 200)
  })
})

// ---------------------------------------------------------------------------
// OPEN-6 (P2, data) — members:create accepts any phone ('abc-123'), corrupting
// the number renewal reminders later depend on. The correct validator already
// exists in the renderer (src/renderer/src/lib/validate.js: 10-digit Nepal
// format) but main never enforces it. Contract: empty/null stays valid (phone
// is optional); anything present must be a 10-digit number.
// ---------------------------------------------------------------------------
describe('OPEN-6 — member phone is validated in main', () => {
  it('rejects malformed phones, keeps empty valid', async () => {
    loginStaff(ids)
    for (const phone of ['abc-123', '123', '98410000011', 'abcdefghij']) {
      const res = await __invoke('members:create', { name: 'P', phone })
      expect(res.success, `accepted phone ${phone}`).toBe(false)
      expect(res.error).toMatch(/phone/i)
    }
    const ok = await __invoke('members:create', { name: 'NoPhone' })
    expect(ok.success).toBe(true)
    const ok2 = await __invoke('members:create', { name: 'GoodPhone', phone: '9841000001' })
    expect(ok2.success).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// OPEN-7 (P2, money) — restaurant-menu:add/update validate only that a name is
// present. A negative or text price on a menu item flows straight into
// checkout totals. Same requireText/requireAmount treatment as the other
// handlers (already exported from src/main/ipc/utils.js).
//
// SECOND DEFECT in the same handler, found while writing this spec:
// restaurant-menu:update takes FLAT fields and writes ALL columns
// unconditionally (`SET name = ?, category = ?, price = ?, ...`), so a partial
// payload like { id, price } silently nulls the name, category, sort order and
// the inventory link. Convert it to the allow-list pattern every other update
// handler uses before (or while) adding value validation.
// ---------------------------------------------------------------------------
describe('OPEN-7 — restaurant menu validation and partial updates', () => {
  it('add rejects blank names, negative and text prices', async () => {
    loginOwner(ids)
    const bads = [
      { name: '   ', category: 'bev', price: 50 },
      { name: 'Coffee', category: 'bev', price: -50 },
      { name: 'Coffee', category: 'bev', price: 'abc' }
    ]
    for (const payload of bads) {
      const res = await __invoke('restaurant-menu:add', payload)
      expect(res.success, `accepted ${JSON.stringify(payload)}`).toBe(false)
    }
  })

  it('update rejects a negative price', async () => {
    loginOwner(ids)
    const res = await __invoke('restaurant-menu:update', {
      id: ids.menuPlainId,
      price: -10
    })
    expect(res.success).toBe(false)
  })

  it('a price-only update does NOT wipe the other columns', async () => {
    loginOwner(ids)
    const before = db
      .prepare(`SELECT * FROM restaurant_menu_items WHERE id = ?`)
      .get(ids.menuLinkedId)
    const res = await __invoke('restaurant-menu:update', {
      id: ids.menuLinkedId,
      price: 175
    })
    expect(res.success).toBe(true)
    const after = db
      .prepare(`SELECT * FROM restaurant_menu_items WHERE id = ?`)
      .get(ids.menuLinkedId)
    expect(after.price).toBe(175)
    expect(after.name).toBe(before.name)
    expect(after.category).toBe(before.category)
    expect(after.inventory_item_id).toBe(before.inventory_item_id)
    expect(after.is_active).toBe(before.is_active)
  })
})

// ---------------------------------------------------------------------------
// OPEN-8 (P2, stock) — selling a menu item linked to a DEACTIVATED stock item
// still draws the invisible stock down (restaurant-menu.js checkout loop
// checks existence, never is_active). The owner sees the item in no list and
// no alert while its stock silently drains.
// ---------------------------------------------------------------------------
describe('OPEN-8 — checkout refuses inactive linked stock', () => {
  it('rejects the sale and moves nothing', async () => {
    loginOwner(ids)
    await __invoke('restaurant-inventory:update', {
      itemId: ids.rInvId,
      fields: { isActive: 0 }
    })
    loginStaff(ids)
    const before = db
      .prepare(`SELECT current_stock FROM restaurant_inventory_items WHERE id = ?`)
      .get(ids.rInvId).current_stock
    const res = await __invoke('restaurant:checkout', {
      items: [{ id: ids.menuLinkedId, quantity: 1 }],
      paymentMethod: 'cash'
    })
    expect(res.success).toBe(false)
    const after = db
      .prepare(`SELECT current_stock FROM restaurant_inventory_items WHERE id = ?`)
      .get(ids.rInvId).current_stock
    expect(after).toBe(before)
    const n = db.prepare(`SELECT COUNT(*) AS n FROM transactions`).get().n
    expect(n).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// OPEN-9 (P2, UX-critical data) — an expired member is indistinguishable from
// someone who never had a membership: members:search and members:list-all only
// fetch active/paused memberships, so "what were you on and when did it end?"
// — the renewal-sale questions — cannot be answered. Contract: a
// lastMembership field carrying the most recent membership regardless of
// status, without changing activeMembership semantics.
// ---------------------------------------------------------------------------
describe('OPEN-9 — expired members expose their last membership', () => {
  it('search returns lastMembership for a lapsed member, null for a stranger', async () => {
    loginStaff(ids)
    const { memberId } = await __invoke('members:create', { name: 'Bikash Rai' })
    await __invoke('members:add-membership', {
      memberId,
      productId: ids.memProdId,
      startDate: '2024-01-01',
      paymentMethod: 'cash'
    })
    await __invoke('members:create', { name: 'Chandra Lama' })

    const res = await __invoke('members:search', { query: 'a' })
    const lapsed = res.members.find((m) => m.name === 'Bikash Rai')
    const never = res.members.find((m) => m.name === 'Chandra Lama')

    expect(lapsed.activeMembership).toBeFalsy()
    expect(lapsed.lastMembership).toBeTruthy()
    expect(lapsed.lastMembership.productName).toContain('Monthly')
    expect(lapsed.lastMembership.endDate).toMatch(/^2024-/)
    expect(never.lastMembership).toBeFalsy()
  })
})

// ---------------------------------------------------------------------------
// OPEN-10 (P2, data) — duplicate inventory items are silently created (no
// UNIQUE constraint, no handler check), and with no delete control the
// duplicate is permanent. Contract: reject an ACTIVE duplicate of the same
// name+variant (pool) / name (restaurant); an inactive duplicate is fine
// (re-adding a retired item).
// ---------------------------------------------------------------------------
describe('OPEN-10 — duplicate inventory items are rejected', () => {
  it('pool: same name+variant is rejected while the original is active', async () => {
    loginOwner(ids)
    const dup = await __invoke('pool-inventory:add-item', {
      name: 'Goggles',
      category: 'gear',
      variant: null
    })
    expect(dup.success).toBe(false)
    expect(dup.error).toMatch(/exists|duplicate/i)
  })

  it('restaurant: same name rejected; different name fine', async () => {
    loginOwner(ids)
    const dup = await __invoke('restaurant-inventory:add-item', {
      name: 'Tea leaves',
      category: 'bev'
    })
    expect(dup.success).toBe(false)
    const ok = await __invoke('restaurant-inventory:add-item', {
      name: 'Green tea leaves',
      category: 'bev'
    })
    expect(ok.success).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// OPEN-11 (P3, scalability) — transactions:list has no pagination; the screen
// renders every row of the range unbounded. Contract: optional limit/offset,
// default behaviour unchanged, plus a totalCount so the UI can page.
// ---------------------------------------------------------------------------
describe('OPEN-11 — transactions:list pagination', () => {
  it('limit/offset window the rows; totalCount reports the full set', async () => {
    const ins = db.prepare(
      `INSERT INTO transactions (transaction_type, source, customer_name, amount, payment_method, staff_id)
       VALUES ('day_pass', 'pool', ?, 300, 'cash', ?)`
    )
    for (let i = 0; i < 25; i++) ins.run(`C${i}`, ids.staffId)

    loginOwner(ids)
    const page1 = await __invoke('transactions:list', { limit: 10, offset: 0 })
    const page2 = await __invoke('transactions:list', { limit: 10, offset: 10 })
    expect(page1.transactions).toHaveLength(10)
    expect(page2.transactions).toHaveLength(10)
    expect(page1.totalCount).toBe(25)
    const ids1 = new Set(page1.transactions.map((t) => t.id))
    expect(page2.transactions.every((t) => !ids1.has(t.id))).toBe(true)
  })
})
