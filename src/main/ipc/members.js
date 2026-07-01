import { ipcMain } from 'electron'
import { getDb } from '../db/index.js'
import { requireOwner, requireStaffOrOwner } from '../session.js'
import {
  addDays,
  formatShortDate,
  initials,
  membershipStatus,
  productDisplayName,
  todayLocal
} from './utils.js'

function wrap(handler) {
  return async (_event, payload) => {
    try {
      return await handler(payload || {})
    } catch (err) {
      return { success: false, error: err.message }
    }
  }
}

function getExpiryWarningDays(db) {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'expiry_warning_days'`).get()
  return parseInt(row?.value || '5', 10)
}

function mapMembership(row, warningDays) {
  if (!row) return null
  const product = {
    name: row.product_name,
    category: row.category,
    duration_days: row.duration_days,
    sub_category: row.sub_category
  }
  return {
    id: row.id,
    memberId: row.member_id,
    productId: row.product_id,
    transactionId: row.transaction_id,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status,
    productName: productDisplayName(product),
    startDisplay: formatShortDate(row.start_date),
    endDisplay: formatShortDate(row.end_date),
    uiStatus: membershipStatus(row.end_date, warningDays)
  }
}

function mapMember(row, activeMembership, warningDays) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    gender: row.gender,
    notes: row.notes,
    photoPath: row.photo_path,
    initials: initials(row.name),
    createdAt: row.created_at,
    activeMembership: mapMembership(activeMembership, warningDays)
  }
}

function fetchActiveMembership(db, memberId) {
  const warningDays = getExpiryWarningDays(db)
  const row = db
    .prepare(
      `SELECT ms.*, p.name as product_name, p.category, p.duration_days, p.sub_category
       FROM memberships ms
       JOIN products p ON p.id = ms.product_id
       WHERE ms.member_id = ? AND ms.status = 'active' AND ms.end_date >= ?
       ORDER BY ms.end_date DESC
       LIMIT 1`
    )
    .get(memberId, todayLocal())
  return mapMembership(row, warningDays)
}

function membershipEndDate(startDate, durationDays) {
  const days = durationDays || 1
  return addDays(startDate, days)
}

export function registerMemberHandlers() {
  ipcMain.handle(
    'members:create',
    wrap(({ name, phone, gender, notes, photoPath }) => {
      requireStaffOrOwner()
      if (!name) throw new Error('Name is required')
      const result = getDb()
        .prepare(
          `INSERT INTO members (name, phone, gender, notes, photo_path) VALUES (?, ?, ?, ?, ?)`
        )
        .run(name, phone || null, gender || null, notes || null, photoPath || null)
      return { success: true, memberId: result.lastInsertRowid }
    })
  )

  ipcMain.handle(
    'members:search',
    wrap(({ query }) => {
      requireStaffOrOwner()
      const db = getDb()
      const q = `%${(query || '').trim()}%`
      const rows = db
        .prepare(`SELECT * FROM members WHERE name LIKE ? OR phone LIKE ? ORDER BY name LIMIT 50`)
        .all(q, q)
      const members = rows.map((row) => {
        const active = db
          .prepare(
            `SELECT ms.*, p.name as product_name, p.category, p.duration_days, p.sub_category
             FROM memberships ms
             JOIN products p ON p.id = ms.product_id
             WHERE ms.member_id = ? AND ms.status = 'active' AND ms.end_date >= ?
             ORDER BY ms.end_date DESC LIMIT 1`
          )
          .get(row.id, todayLocal())
        return mapMember(row, active, getExpiryWarningDays(db))
      })
      return { members }
    })
  )

  ipcMain.handle(
    'members:get',
    wrap(({ memberId }) => {
      requireStaffOrOwner()
      const db = getDb()
      const member = db.prepare('SELECT * FROM members WHERE id = ?').get(memberId)
      if (!member) throw new Error('Member not found')
      return {
        member: mapMember(member, null, getExpiryWarningDays(db)),
        activeMembership: fetchActiveMembership(db, memberId)
      }
    })
  )

  ipcMain.handle(
    'members:add-membership',
    // P0-1: staff_id from the session; amount is always the catalogue price.
    wrap(({ memberId, productId, startDate, paymentMethod, transactionId }) => {
      const session = requireStaffOrOwner()
      const staffId = session.userId
      const db = getDb()
      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId)
      if (!product) throw new Error('Product not found')
      if (!product.duration_days) throw new Error('Product has no duration')

      const start = startDate || todayLocal()
      const endDate = membershipEndDate(start, product.duration_days)
      let txnId = transactionId

      const membershipId = db.transaction(() => {
        if (!txnId) {
          const member = db.prepare('SELECT name, phone FROM members WHERE id = ?').get(memberId)
          const pay = paymentMethod?.toLowerCase() === 'qr' ? 'qr' : 'cash'
          const txn = db
            .prepare(
              `INSERT INTO transactions
               (transaction_type, source, customer_name, phone, product_id, member_id, amount, payment_method, staff_id)
               VALUES ('membership', 'pool', ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(member.name, member.phone, productId, memberId, product.price, pay, staffId)
          txnId = txn.lastInsertRowid
        }
        const result = db
          .prepare(
            `INSERT INTO memberships (member_id, product_id, transaction_id, start_date, end_date, status)
             VALUES (?, ?, ?, ?, ?, 'active')`
          )
          .run(memberId, productId, txnId, start, endDate)
        return result.lastInsertRowid
      })()

      return { success: true, membershipId, transactionId: txnId }
    })
  )

  ipcMain.handle(
    'members:renew',
    // P0-1: staff_id from the session; amount is always the catalogue price.
    wrap(({ membershipId, newStartDate, paymentMethod, transactionId }) => {
      const session = requireStaffOrOwner()
      const staffId = session.userId
      const db = getDb()
      const old = db
        .prepare(
          `SELECT ms.*, p.duration_days, p.price, m.name as member_name, m.phone as member_phone
           FROM memberships ms
           JOIN products p ON p.id = ms.product_id
           JOIN members m ON m.id = ms.member_id
           WHERE ms.id = ?`
        )
        .get(membershipId)
      if (!old) throw new Error('Membership not found')
      if (!old.duration_days) throw new Error('Product has no duration')

      const start = newStartDate || todayLocal()
      const endDate = membershipEndDate(start, old.duration_days)
      let txnId = transactionId

      db.transaction(() => {
        db.prepare(`UPDATE memberships SET status = 'expired' WHERE id = ?`).run(membershipId)
        if (!txnId) {
          const pay = paymentMethod?.toLowerCase() === 'qr' ? 'qr' : 'cash'
          const txn = db
            .prepare(
              `INSERT INTO transactions
               (transaction_type, source, customer_name, phone, product_id, member_id, amount, payment_method, staff_id)
               VALUES ('membership', 'pool', ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              old.member_name,
              old.member_phone,
              old.product_id,
              old.member_id,
              old.price,
              pay,
              staffId
            )
          txnId = txn.lastInsertRowid
        }
        db.prepare(
          `INSERT INTO memberships (member_id, product_id, transaction_id, start_date, end_date, status)
           VALUES (?, ?, ?, ?, ?, 'active')`
        ).run(old.member_id, old.product_id, txnId, start, endDate)
      })()

      return { success: true, transactionId: txnId }
    })
  )

  ipcMain.handle(
    'members:expiring-soon',
    wrap(({ days } = {}) => {
      requireStaffOrOwner()
      const db = getDb()
      const warningDays = days ?? getExpiryWarningDays(db)
      const cutoff = addDays(todayLocal(), warningDays)
      const rows = db
        .prepare(
          `SELECT m.*, ms.id as membership_id, ms.end_date,
                  p.name as product_name, p.category, p.duration_days, p.sub_category
           FROM memberships ms
           JOIN members m ON m.id = ms.member_id
           JOIN products p ON p.id = ms.product_id
           WHERE ms.status = 'active' AND ms.end_date >= ? AND ms.end_date <= ?
           ORDER BY ms.end_date, m.name`
        )
        .all(todayLocal(), cutoff)

      const members = rows.map((row) => ({
        ...mapMember(row, row, warningDays),
        membershipId: row.membership_id,
        endDate: row.end_date,
        endDisplay: formatShortDate(row.end_date),
        productName: productDisplayName(row),
        status: membershipStatus(row.end_date, warningDays)
      }))
      return { members }
    })
  )

  ipcMain.handle(
    'members:list-all',
    wrap(() => {
      requireOwner()
      const db = getDb()
      const warningDays = getExpiryWarningDays(db)
      const rows = db.prepare('SELECT * FROM members ORDER BY name').all()
      const activeSql = `SELECT ms.*, p.name as product_name, p.category, p.duration_days, p.sub_category
             FROM memberships ms
             JOIN products p ON p.id = ms.product_id
             WHERE ms.member_id = ? AND ms.status = 'active' AND ms.end_date >= ?
             ORDER BY ms.end_date DESC LIMIT 1`
      const today = todayLocal()
      const members = rows.map((row) => {
        const active = db.prepare(activeSql).get(row.id, today)
        return mapMember(row, active, warningDays)
      })
      return { members }
    })
  )
}
