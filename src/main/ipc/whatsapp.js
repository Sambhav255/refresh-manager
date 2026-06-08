import { ipcMain, shell } from 'electron'
import { getDb } from '../db/index.js'
import { requireStaffOrOwner } from '../session.js'
import { formatShortDate, todayLocal } from './utils.js'

function wrap(handler) {
  return async (_event, payload) => {
    try {
      return await handler(payload || {})
    } catch (err) {
      return { success: false, error: err.message }
    }
  }
}

function generateEODMessage(date) {
  const db = getDb()
  const dateStr = date ? formatShortDate(date) : formatShortDate(todayLocal())
  const queryDate = date || todayLocal()

  const summary = db
    .prepare(
      `SELECT
        SUM(amount) as total,
        SUM(CASE WHEN payment_method = 'cash' THEN amount ELSE 0 END) as cash,
        SUM(CASE WHEN payment_method = 'qr' THEN amount ELSE 0 END) as qr,
        COUNT(*) as count,
        SUM(CASE WHEN transaction_type = 'membership' THEN amount ELSE 0 END) as membership_rev,
        SUM(CASE WHEN transaction_type = 'day_package' THEN amount ELSE 0 END) as package_rev,
        SUM(CASE WHEN transaction_type = 'day_pass' THEN amount ELSE 0 END) as pass_rev,
        SUM(CASE WHEN transaction_type = 'membership' THEN 1 ELSE 0 END) as membership_count,
        SUM(CASE WHEN transaction_type = 'day_package' THEN 1 ELSE 0 END) as package_count,
        SUM(CASE WHEN transaction_type = 'day_pass' THEN 1 ELSE 0 END) as pass_count
      FROM transactions
      WHERE date(created_at) = ? AND is_voided = 0`
    )
    .get(queryDate)

  const staffRow = db
    .prepare(
      `SELECT u.name FROM transactions t
       JOIN users u ON t.staff_id = u.id
       WHERE date(t.created_at) = ?
       ORDER BY t.created_at DESC LIMIT 1`
    )
    .get(queryDate)

  return `🏊 Refresh Recreation Center
📅 Daily Summary — ${dateStr}

💰 REVENUE
Total: Rs. ${summary.total || 0}
  • Cash: Rs. ${summary.cash || 0}
  • QR: Rs. ${summary.qr || 0}

📋 TRANSACTIONS (${summary.count || 0} total)
  • Memberships: ${summary.membership_count || 0} — Rs. ${summary.membership_rev || 0}
  • Day Packages: ${summary.package_count || 0} — Rs. ${summary.package_rev || 0}
  • Day Passes: ${summary.pass_count || 0} — Rs. ${summary.pass_rev || 0}

👤 Staff on duty: ${staffRow?.name || 'N/A'}

— Sent from Refresh Manager`
}

export function registerWhatsappHandlers() {
  ipcMain.handle(
    'whatsapp:send-eod',
    wrap(({ date } = {}) => {
      requireStaffOrOwner()
      const ownerNumber = getDb()
        .prepare(`SELECT value FROM settings WHERE key = 'whatsapp_owner_number'`)
        .get()?.value
      if (!ownerNumber) {
        throw new Error('Owner WhatsApp number not configured in Settings.')
      }

      const message = generateEODMessage(date)
      const encoded = encodeURIComponent(message)
      const cleanNumber = ownerNumber.replace(/\D/g, '')
      const url = `https://wa.me/${cleanNumber}?text=${encoded}`

      shell.openExternal(url)
      return { success: true }
    })
  )
}
