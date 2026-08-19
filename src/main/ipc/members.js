import { ipcMain } from 'electron'
import { getDb } from '../db/index.js'
import { requireOwner, requireStaffOrOwner } from '../session.js'
import { writeAudit } from '../audit.js'
import {
  addDays,
  formatShortDate,
  initials,
  membershipStatus,
  productDisplayName,
  requirePhone,
  requireText,
  todayLocal
} from './utils.js'

function daysBetween(fromDate, toDate) {
  return Math.max(0, Math.round((Date.parse(toDate) - Date.parse(fromDate)) / 86400000))
}

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
    uiStatus: membershipStatus(row.end_date, warningDays),
    // Lets the UI tell "not reminded yet" from "reminded, and re-sending needs
    // the flag cleared first" — without it the owner could not see either.
    reminderSentAt: row.reminder_sent_at || null
  }
}

function mapMember(row, activeMembership, warningDays, extras = {}) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    gender: row.gender,
    notes: row.notes,
    photoPath: row.photo_path,
    initials: initials(row.name),
    createdAt: row.created_at,
    activeMembership: mapMembership(activeMembership, warningDays),
    // lastMembership answers the two questions reception asks on every renewal
    // ("what were you on?", "when did it run out?"). Without it a lapsed member
    // renders identically to someone who never bought anything.
    lastMembership: extras.lastMembership
      ? mapMembership(extras.lastMembership, warningDays)
      : null,
    checkedInToday: extras.checkedInToday ?? undefined
  }
}

// Most recent membership regardless of status, for display only — never used
// for the active/expired decision.
function fetchLastMembership(db, memberId) {
  return db
    .prepare(
      `SELECT ms.*, p.name as product_name, p.category, p.duration_days, p.sub_category
       FROM memberships ms
       JOIN products p ON p.id = ms.product_id
       WHERE ms.member_id = ?
       ORDER BY ms.end_date DESC, ms.id DESC LIMIT 1`
    )
    .get(memberId)
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

// end_date is the LAST VALID DAY: every consumer compares inclusively
// (end_date >= today). So a 30-day product must end on start + 29, not
// start + 30 — the latter granted 31 usable days and gave away roughly 12
// free days per member per year on monthly renewals.
//
// Only new memberships are affected: end_date is computed once at purchase and
// stored, so existing rows keep the dates their members were sold.
function membershipEndDate(startDate, durationDays) {
  const days = durationDays || 1
  return addDays(startDate, days - 1)
}

// The two write paths below are shared by the single-step handlers and by
// members:create-with-membership. Keeping one copy is the point: the combined
// handler must sell a membership on exactly the terms members:add-membership
// does, and a second copy would drift away from it the first time either is
// touched.
function insertMember(db, { name, phone, gender, notes, photoPath }) {
  const result = db
    .prepare(`INSERT INTO members (name, phone, gender, notes, photo_path) VALUES (?, ?, ?, ?, ?)`)
    .run(
      requireText(name, 'Name'),
      requirePhone(phone),
      gender || null,
      notes || null,
      photoPath || null
    )
  return result.lastInsertRowid
}

// P0-1: staffId is the caller's session user and the amount is always the
// catalogue price — neither is ever taken from the renderer payload.
// Callers must run this inside a db.transaction(): it writes two rows.
function insertMembership(
  db,
  { memberId, productId, startDate, paymentMethod, transactionId, staffId }
) {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId)
  if (!product) throw new Error('Product not found')
  if (!product.duration_days) throw new Error('Product has no duration')

  const start = startDate || todayLocal()
  const endDate = membershipEndDate(start, product.duration_days)
  let txnId = transactionId

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

  return {
    membershipId: result.lastInsertRowid,
    transactionId: txnId,
    startDate: start,
    endDate
  }
}

export function registerMemberHandlers() {
  ipcMain.handle(
    'members:create',
    wrap((payload) => {
      requireStaffOrOwner()
      return { success: true, memberId: insertMember(getDb(), payload) }
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
        const checkedIn = db
          .prepare(
            `SELECT 1 FROM check_ins
             WHERE member_id = ? AND date(checked_in_at) = date('now','localtime') LIMIT 1`
          )
          .get(row.id)
        return mapMember(row, active, getExpiryWarningDays(db), {
          lastMembership: active ? null : fetchLastMembership(db, row.id),
          checkedInToday: !!checkedIn
        })
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
    wrap((payload) => {
      const session = requireStaffOrOwner()
      const db = getDb()
      const { membershipId, transactionId } = db.transaction(() =>
        insertMembership(db, { ...payload, staffId: session.userId })
      )()
      return { success: true, membershipId, transactionId }
    })
  )

  // Sell a membership in one round trip. The wizard used to call members:create
  // and then members:add-membership: every sale minted a fresh member row (so a
  // renewal silently forked the customer's history), and a membership that
  // failed — a product with no duration is the common one — left the member row
  // behind, which staff then duplicated again on retry. One transaction, and an
  // optional memberId so a recognised customer is reused rather than forked.
  ipcMain.handle(
    'members:create-with-membership',
    // P0-1: staff_id from the session; amount is always the catalogue price.
    wrap(
      ({
        memberId,
        name,
        phone,
        gender,
        notes,
        photoPath,
        productId,
        startDate,
        paymentMethod
      }) => {
        const session = requireStaffOrOwner()
        const db = getDb()

        return db.transaction(() => {
          let id = memberId
          if (id) {
            if (!db.prepare('SELECT id FROM members WHERE id = ?').get(id)) {
              throw new Error('Member not found')
            }
          } else {
            id = insertMember(db, { name, phone, gender, notes, photoPath })
          }
          const membership = insertMembership(db, {
            memberId: id,
            productId,
            startDate,
            paymentMethod,
            staffId: session.userId
          })
          return {
            success: true,
            memberId: id,
            createdMember: !memberId,
            ...membership
          }
        })()
      }
    )
  )

  // Does this walk-in already exist? Phone is the strong signal — it is unique
  // per person in practice — and a case-insensitive name match is the weak one,
  // because two real people genuinely do share a name. Both are returned, and
  // labelled, so the UI can offer rather than assume.
  ipcMain.handle(
    'members:find-matches',
    wrap(({ name, phone }) => {
      requireStaffOrOwner()
      const db = getDb()
      const digits = requirePhone(phone)
      const text = typeof name === 'string' ? name.trim() : ''
      if (!digits && !text) return { matches: [] }

      const rows = db
        .prepare(
          `SELECT * FROM members
           WHERE (? IS NOT NULL AND phone = ?) OR (? <> '' AND lower(name) = lower(?))
           ORDER BY name LIMIT 10`
        )
        .all(digits, digits, text, text)

      const warningDays = getExpiryWarningDays(db)
      const matches = rows.map((row) => {
        const active = fetchActiveMembership(db, row.id)
        const mapped = mapMember(row, null, warningDays, {
          // Reception's next question after "is this you?" is "what were you
          // on?" — a lapsed member has no active row to answer it with.
          lastMembership: active ? null : fetchLastMembership(db, row.id)
        })
        mapped.activeMembership = active
        mapped.matchedOn = digits && row.phone === digits ? 'phone' : 'name'
        return mapped
      })
      // Phone matches first: they are the ones worth merging without hesitating.
      matches.sort((a, b) => (a.matchedOn === 'phone' ? 0 : 1) - (b.matchedOn === 'phone' ? 0 : 1))
      return { matches }
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
      // 3-B: also surface a paused membership so the owner can resume it.
      const pausedSql = `SELECT ms.*, p.name as product_name, p.category, p.duration_days, p.sub_category
             FROM memberships ms
             JOIN products p ON p.id = ms.product_id
             WHERE ms.member_id = ? AND ms.status = 'paused'
             ORDER BY ms.id DESC LIMIT 1`
      const today = todayLocal()
      const members = rows.map((row) => {
        const active = db.prepare(activeSql).get(row.id, today)
        const paused = db.prepare(pausedSql).get(row.id)
        // Expired members matched neither query, so their row showed "—" for
        // both type and expiry — exactly the win-back information the owner
        // needs. Fall back to the most recent membership for display.
        const mapped = mapMember(row, active, warningDays, {
          lastMembership: active || paused ? null : fetchLastMembership(db, row.id)
        })
        mapped.pausedMembership = paused ? mapMembership(paused, warningDays) : null
        return mapped
      })
      return { members }
    })
  )

  // 3-B: freeze a membership (travel/injury). The expiry job ignores paused
  // rows (it only touches status='active'), so a frozen membership is never
  // auto-expired.
  ipcMain.handle(
    'members:pause-membership',
    wrap(({ membershipId, reason }) => {
      const session = requireOwner()
      const db = getDb()
      const ms = db.prepare(`SELECT id, status FROM memberships WHERE id = ?`).get(membershipId)
      if (!ms) throw new Error('Membership not found')
      if (ms.status !== 'active') throw new Error('Only an active membership can be paused')
      db.prepare(
        `UPDATE memberships SET status = 'paused', pause_start = ?, pause_reason = ? WHERE id = ?`
      ).run(todayLocal(), reason || null, membershipId)
      writeAudit(session.userId, 'membership:pause', { membershipId, reason: reason || null })
      return { success: true }
    })
  )

  // 3-B: resume a frozen membership and push end_date out by the paused span so
  // the member isn't charged for days they couldn't use.
  ipcMain.handle(
    'members:resume-membership',
    wrap(({ membershipId }) => {
      const session = requireOwner()
      const db = getDb()
      const ms = db
        .prepare(`SELECT id, status, end_date, pause_start FROM memberships WHERE id = ?`)
        .get(membershipId)
      if (!ms) throw new Error('Membership not found')
      if (ms.status !== 'paused') throw new Error('Membership is not paused')
      const today = todayLocal()
      const pausedDays = ms.pause_start ? daysBetween(ms.pause_start, today) : 0
      const newEnd = addDays(ms.end_date, pausedDays)
      db.prepare(
        `UPDATE memberships SET status = 'active', pause_end = ?, end_date = ? WHERE id = ?`
      ).run(today, newEnd, membershipId)
      writeAudit(session.userId, 'membership:resume', { membershipId, pausedDays, newEnd })
      return { success: true, pausedDays, endDate: newEnd }
    })
  )
}
