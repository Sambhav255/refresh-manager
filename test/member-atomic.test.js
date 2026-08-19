import { describe, it, expect, beforeEach } from 'vitest'
import { __invoke } from 'electron'
import { freshDb, seed, loginStaff, loginOwner } from './helpers.js'

let db
let ids

beforeEach(() => {
  db = freshDb()
  ids = seed(db)
})

const count = (table) => db.prepare(`SELECT COUNT(*) c FROM ${table}`).get().c

// A membership product the owner forgot to give a duration — the real-world
// trigger for the orphaned-member bug this handler exists to close.
function brokenProduct() {
  return db
    .prepare(`INSERT INTO products (name, category, price) VALUES ('No Duration','membership',1500)`)
    .run().lastInsertRowid
}

describe('members:create-with-membership — one member, one transaction, atomically', () => {
  it('writes exactly one member, one membership and one transaction', async () => {
    loginStaff(ids)
    const r = await __invoke('members:create-with-membership', {
      name: 'Sunita Rai',
      phone: '9801112223',
      productId: ids.memProdId,
      paymentMethod: 'qr'
    })
    expect(r.success).toBe(true)
    expect(r.createdMember).toBe(true)
    expect(count('members')).toBe(1)
    expect(count('memberships')).toBe(1)
    expect(count('transactions')).toBe(1)

    const ms = db.prepare('SELECT * FROM memberships WHERE id = ?').get(r.membershipId)
    expect(ms.member_id).toBe(r.memberId)
    expect(ms.transaction_id).toBe(r.transactionId)
    expect(ms.status).toBe('active')
    // end_date is the last valid day: 30 days runs to start + 29.
    expect(ms.start_date).toBe(r.startDate)
    expect(ms.end_date).toBe(r.endDate)
  })

  it('leaves zero members and zero transactions when the membership fails', async () => {
    loginStaff(ids)
    const r = await __invoke('members:create-with-membership', {
      name: 'Orphan Risk',
      phone: '9801112224',
      productId: brokenProduct(),
      paymentMethod: 'cash'
    })
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/duration/i)
    // The whole point: nothing survives a half-finished sale for staff to
    // duplicate on retry.
    expect(count('members')).toBe(0)
    expect(count('memberships')).toBe(0)
    expect(count('transactions')).toBe(0)
  })

  it('rolls back nothing else when an unknown product is sold', async () => {
    loginStaff(ids)
    const r = await __invoke('members:create-with-membership', {
      name: 'Ghost Product',
      productId: 99999
    })
    expect(r.success).toBe(false)
    expect(count('members')).toBe(0)
    expect(count('transactions')).toBe(0)
  })

  it('reuses an existing memberId instead of forking a duplicate', async () => {
    loginStaff(ids)
    const first = await __invoke('members:create-with-membership', {
      name: 'Ramesh Thapa',
      phone: '9805556667',
      productId: ids.memProdId
    })
    expect(first.success).toBe(true)

    const renewal = await __invoke('members:create-with-membership', {
      memberId: first.memberId,
      name: 'Ramesh Thapa',
      phone: '9805556667',
      productId: ids.memProdId
    })
    expect(renewal.success).toBe(true)
    expect(renewal.memberId).toBe(first.memberId)
    expect(renewal.createdMember).toBe(false)

    expect(count('members')).toBe(1)
    expect(count('memberships')).toBe(2)
    expect(count('transactions')).toBe(2)
  })

  it('rejects a memberId that does not exist rather than inventing one', async () => {
    loginStaff(ids)
    const r = await __invoke('members:create-with-membership', {
      memberId: 4242,
      name: 'Nobody',
      productId: ids.memProdId
    })
    expect(r.success).toBe(false)
    expect(count('members')).toBe(0)
  })

  it('takes the amount from the catalogue and the staff id from the session', async () => {
    loginStaff(ids)
    const r = await __invoke('members:create-with-membership', {
      name: 'Tamper Test',
      phone: '9807778889',
      productId: ids.memProdId,
      // P0-1: a tampered renderer must not be able to discount a sale or
      // credit it to someone else.
      amount: 1,
      staffId: ids.ownerId,
      price: 1
    })
    expect(r.success).toBe(true)
    const txn = db.prepare('SELECT * FROM transactions WHERE id = ?').get(r.transactionId)
    expect(txn.amount).toBe(1000) // catalogue price of the seeded Monthly product
    expect(txn.staff_id).toBe(ids.staffId)
    expect(txn.transaction_type).toBe('membership')
    expect(txn.member_id).toBe(r.memberId)
  })

  it('applies the same phone validation as members:create', async () => {
    loginStaff(ids)
    const r = await __invoke('members:create-with-membership', {
      name: 'Bad Phone',
      phone: '12345',
      productId: ids.memProdId
    })
    expect(r.success).toBe(false)
    expect(count('members')).toBe(0)
  })

  it('requires a session', async () => {
    const r = await __invoke('members:create-with-membership', {
      name: 'Anonymous',
      productId: ids.memProdId
    })
    expect(r.success).toBe(false)
    expect(count('members')).toBe(0)
  })
})

describe('members:find-matches — offer the existing person, never assume', () => {
  beforeEach(async () => {
    loginOwner(ids)
    await __invoke('members:create-with-membership', {
      name: 'Sunita Rai',
      phone: '9801112223',
      productId: ids.memProdId
    })
    loginStaff(ids)
  })

  it('finds an exact phone match', async () => {
    const r = await __invoke('members:find-matches', { name: 'Someone Else', phone: '9801112223' })
    expect(r.matches).toHaveLength(1)
    expect(r.matches[0].name).toBe('Sunita Rai')
    expect(r.matches[0].matchedOn).toBe('phone')
    // Reception needs to see what they were on before agreeing to merge.
    expect(r.matches[0].activeMembership).toBeTruthy()
  })

  it('finds a name match regardless of case', async () => {
    const r = await __invoke('members:find-matches', { name: 'sUNITA rai' })
    expect(r.matches).toHaveLength(1)
    expect(r.matches[0].matchedOn).toBe('name')
  })

  it('returns nothing for a genuine stranger', async () => {
    const r = await __invoke('members:find-matches', { name: 'Bikash Gurung', phone: '9849999999' })
    expect(r.matches).toEqual([])
  })

  it('returns nothing when given neither a name nor a phone', async () => {
    const r = await __invoke('members:find-matches', {})
    expect(r.matches).toEqual([])
  })

  it('puts phone matches ahead of name-only matches', async () => {
    db.prepare(`INSERT INTO members (name, phone) VALUES ('Sunita Rai', '9840000000')`).run()
    const r = await __invoke('members:find-matches', { name: 'Sunita Rai', phone: '9840000000' })
    expect(r.matches).toHaveLength(2)
    expect(r.matches[0].matchedOn).toBe('phone')
    expect(r.matches[0].phone).toBe('9840000000')
  })
})
