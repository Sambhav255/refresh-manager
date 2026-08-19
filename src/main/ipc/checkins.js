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
    wrap(() => {
      requireStaffOrOwner()
      const today = todayLocal()
      const db = getDb()
      const count =
        db.prepare(`SELECT COUNT(*) as c FROM check_ins WHERE date(checked_in_at) = ?`).get(today)
          ?.c || 0
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
