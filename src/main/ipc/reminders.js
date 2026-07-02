import { ipcMain, shell } from 'electron'
import { getDb } from '../db/index.js'
import { requireOwner } from '../session.js'
import { writeAudit } from '../audit.js'
import { formatShortDate, productDisplayName, todayLocal, addDays } from './utils.js'

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

function getTemplate(db) {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'renewal_reminder_template'`).get()
  return (
    row?.value ||
    `नमस्ते [Name] जी! 🏊
Refresh Recreation Center मा तपाईंको [Membership Type] membership
[Date] मा expire हुँदैछ।`
  )
}

function buildMessage(template, member) {
  return template
    .replace(/\[Name\]/g, member.name)
    .replace(/\[Membership Type\]/g, member.productName)
    .replace(/\[Date\]/g, member.endDisplay)
}

function normalizePhone(phone) {
  const digits = (phone || '').replace(/\D/g, '')
  if (digits.startsWith('977')) return digits
  if (digits.length === 10) return `977${digits}`
  return digits
}

function fetchExpiring(db, days) {
  const warningDays = days ?? getExpiryWarningDays(db)
  const cutoff = addDays(todayLocal(), warningDays)
  const rows = db
    .prepare(
      `SELECT m.id as member_id, m.name, m.phone, ms.id as membership_id, ms.end_date, ms.reminder_sent_at,
              p.name as product_name, p.category, p.duration_days, p.sub_category
       FROM memberships ms
       JOIN members m ON m.id = ms.member_id
       JOIN products p ON p.id = ms.product_id
       WHERE ms.status = 'active' AND ms.end_date >= ? AND ms.end_date <= ?
         AND m.phone IS NOT NULL AND m.phone != ''
         AND (ms.reminder_sent_at IS NULL OR ms.reminder_sent_at = '')
       ORDER BY ms.end_date, m.name`
    )
    .all(todayLocal(), cutoff)

  return rows.map((row) => ({
    memberId: row.member_id,
    membershipId: row.membership_id,
    name: row.name,
    phone: row.phone,
    endDate: row.end_date,
    endDisplay: formatShortDate(row.end_date),
    productName: productDisplayName(row),
    reminderSentAt: row.reminder_sent_at
  }))
}

export function registerReminderHandlers() {
  ipcMain.handle(
    'reminders:get-expiring',
    wrap(({ days } = {}) => {
      requireOwner()
      const db = getDb()
      return { members: fetchExpiring(db, days) }
    })
  )

  ipcMain.handle(
    'reminders:send-one',
    wrap(({ membershipId }) => {
      const session = requireOwner()
      const db = getDb()
      const row = db
        .prepare(
          `SELECT m.name, m.phone, ms.id as membership_id, ms.end_date,
                  p.name as product_name, p.category, p.duration_days, p.sub_category
           FROM memberships ms
           JOIN members m ON m.id = ms.member_id
           JOIN products p ON p.id = ms.product_id
           WHERE ms.id = ?`
        )
        .get(membershipId)
      if (!row) throw new Error('Membership not found')
      if (!row.phone) throw new Error('Member has no phone number')

      const member = {
        name: row.name,
        phone: row.phone,
        endDisplay: formatShortDate(row.end_date),
        productName: productDisplayName(row)
      }
      const message = buildMessage(getTemplate(db), member)
      const phone = normalizePhone(row.phone)
      const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
      shell.openExternal(url)
      db.prepare(
        `UPDATE memberships SET reminder_sent_at = datetime('now','localtime') WHERE id = ?`
      ).run(membershipId)
      // 3-E: record the outreach so the owner has a history and can re-send.
      writeAudit(session.userId, 'reminder:send', {
        membershipId,
        member: row.name,
        phone: row.phone
      })
      return { success: true }
    })
  )

  ipcMain.handle(
    'reminders:send-all',
    // P1-5: no longer bursts open a tab per member and pre-marks everyone as
    // "sent". Instead it returns the pending list so the UI can walk them one at
    // a time, each confirmed via `reminders:send-one`.
    wrap(({ days } = {}) => {
      requireOwner()
      const db = getDb()
      const members = fetchExpiring(db, days)
      return { success: true, members, count: members.length }
    })
  )

  ipcMain.handle(
    'reminders:clear',
    // P1-5: allow re-sending — clears the "sent" flag so the member reappears
    // in the pending list.
    wrap(({ membershipId }) => {
      const session = requireOwner()
      if (!membershipId) throw new Error('membershipId required')
      getDb()
        .prepare(`UPDATE memberships SET reminder_sent_at = NULL WHERE id = ?`)
        .run(membershipId)
      writeAudit(session.userId, 'reminder:clear', { membershipId })
      return { success: true }
    })
  )

  // 3-E: reminder outreach history from the audit trail (owner).
  ipcMain.handle(
    'reminders:history',
    wrap(({ limit = 100 } = {}) => {
      requireOwner()
      const rows = getDb()
        .prepare(
          `SELECT a.detail, a.created_at, u.name as actor_name
           FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id
           WHERE a.action = 'reminder:send'
           ORDER BY a.id DESC LIMIT ?`
        )
        .all(Math.min(Number(limit) || 100, 500))
      const history = rows.map((r) => {
        let d = {}
        try {
          d = JSON.parse(r.detail || '{}')
        } catch {
          d = {}
        }
        return {
          member: d.member || null,
          phone: d.phone || null,
          membershipId: d.membershipId || null,
          sentAt: r.created_at,
          sentBy: r.actor_name || null
        }
      })
      return { history }
    })
  )
}
