import { ipcMain } from 'electron'
import { getDb } from '../db/index.js'
import { requireOwner, requireStaffOrOwner } from '../session.js'
import { todayLocal, addDays } from './utils.js'

function wrap(handler) {
  return async (_event, payload) => {
    try {
      return await handler(payload || {})
    } catch (err) {
      return { success: false, error: err.message }
    }
  }
}

// 3-A: attendance / footfall.
export function registerCheckinHandlers() {
  ipcMain.handle(
    'checkins:create',
    wrap(({ memberId, source = 'member' }) => {
      const session = requireStaffOrOwner()
      const db = getDb()
      if (memberId) {
        const member = db.prepare('SELECT id FROM members WHERE id = ?').get(memberId)
        if (!member) throw new Error('Member not found')
      }
      // One check-in per member per day. Reception re-searches a member all the
      // time (to read their expiry), and the button's only guard was React
      // state lost on unmount — so footfall crept up on every re-visit.
      // A repeat is NOT an error: a double-tap must not raise a red alert.
      if (memberId) {
        const already = db
          .prepare(
            `SELECT id, checked_in_at FROM check_ins
             WHERE member_id = ? AND date(checked_in_at) = date('now','localtime')
             ORDER BY id DESC LIMIT 1`
          )
          .get(memberId)
        if (already) {
          return {
            success: true,
            id: already.id,
            alreadyCheckedIn: true,
            checkedInAt: already.checked_in_at
          }
        }
      }

      const result = db
        .prepare(`INSERT INTO check_ins (member_id, staff_id, source) VALUES (?, ?, ?)`)
        .run(memberId || null, session.userId, source)
      return { success: true, id: result.lastInsertRowid, alreadyCheckedIn: false }
    })
  )

  ipcMain.handle(
    'checkins:today',
    // C-6: "Footfall today" on the owner Dashboard was really "member
    // check-ins today" — a walk-in who buys a day pass and never checks in as
    // a member was invisible, despite being the most literal footfall there
    // is. `count` now adds today's day-pass attendee total (a sale's line
    // quantity, since one sale can be for several people) to the check-in
    // count. Known limitation, deliberately not handled: a member who both
    // checks in AND separately buys a day pass on the same visit is counted
    // twice — rare enough that de-duplicating it isn't worth the complexity.
    wrap(() => {
      requireStaffOrOwner()
      const today = todayLocal()
      const db = getDb()
      const checkinCount =
        db.prepare(`SELECT COUNT(*) as c FROM check_ins WHERE date(checked_in_at) = ?`).get(today)
          ?.c || 0
      // Day-pass attendees today: sum the quantity of day-pass catalogue lines
      // on non-voided day-pass sales rung up today. A day-pass sale can carry
      // other lines too (e.g. goggles) — only the day-pass line(s) count
      // people through the door.
      const dayPassCount =
        db
          .prepare(
            `SELECT COALESCE(SUM(tl.quantity), 0) as c
             FROM transactions t
             JOIN transaction_lines tl ON tl.transaction_id = t.id
             JOIN products p ON p.id = tl.ref_id
             WHERE t.transaction_type = 'day_pass'
               AND t.is_voided = 0
               AND date(t.created_at) = ?
               AND tl.kind = 'product'
               AND p.category = 'day_pass'`
          )
          .get(today)?.c || 0
      const count = checkinCount + dayPassCount
      const recent = db
        .prepare(
          `SELECT ci.id, ci.checked_in_at, ci.source, m.name as member_name
           FROM check_ins ci
           LEFT JOIN members m ON m.id = ci.member_id
           WHERE date(ci.checked_in_at) = ?
           ORDER BY ci.id DESC LIMIT 20`
        )
        .all(today)
      return { count, recent }
    })
  )

  ipcMain.handle(
    'checkins:footfall',
    wrap(({ dateFrom, dateTo } = {}) => {
      requireOwner()
      const to = dateTo || todayLocal()
      const from = dateFrom || addDays(to, -29)
      const rows = getDb()
        .prepare(
          `SELECT date(checked_in_at) as day, COUNT(*) as count
           FROM check_ins
           WHERE date(checked_in_at) >= ? AND date(checked_in_at) <= ?
           GROUP BY day ORDER BY day`
        )
        .all(from, to)
      const total = rows.reduce((s, r) => s + r.count, 0)
      const days = rows.length || 1
      return {
        series: rows,
        total,
        dailyAverage: Math.round(total / days),
        dateFrom: from,
        dateTo: to
      }
    })
  )

  // 3-A / feeds 4-B: members with a current membership who haven't checked in
  // for N days — the churn-risk outreach list.
  ipcMain.handle(
    'checkins:not-seen',
    wrap(({ days = 30 } = {}) => {
      requireOwner()
      const today = todayLocal()
      const cutoff = addDays(today, -Math.abs(days))
      const members = getDb()
        .prepare(
          `SELECT m.id, m.name, m.phone,
                  (SELECT MAX(ci.checked_in_at) FROM check_ins ci WHERE ci.member_id = m.id) as last_seen
           FROM members m
           WHERE EXISTS (
             SELECT 1 FROM memberships ms
             WHERE ms.member_id = m.id AND ms.status = 'active' AND ms.end_date >= ?
           )
           AND NOT EXISTS (
             SELECT 1 FROM check_ins ci
             WHERE ci.member_id = m.id AND date(ci.checked_in_at) >= ?
           )
           ORDER BY last_seen IS NULL DESC, last_seen ASC`
        )
        .all(today, cutoff)
      return { members, days: Math.abs(days) }
    })
  )
}
