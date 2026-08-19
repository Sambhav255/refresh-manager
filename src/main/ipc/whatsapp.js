import { ipcMain, shell } from 'electron'
import { getDb } from '../db/index.js'
import { requireStaffOrOwner } from '../session.js'
import { formatShortDate, todayLocal } from './utils.js'
// 2-H: friendly labels + a stable display order. Any transaction_type not
// listed here still gets a line (using its raw name), so the itemised lines
// always sum to Total — even for types added in the future. Shared with the
// End of Day screen so the message and the screen cannot disagree.
import { TYPE_LABELS, TYPE_ORDER } from '../../shared/transaction-types.js'

function wrap(handler) {
  return async (_event, payload) => {
    try {
      return await handler(payload || {})
    } catch (err) {
      return { success: false, error: err.message }
    }
  }
}

export function generateEODMessage(date) {
  const db = getDb()
  const dateStr = date ? formatShortDate(date) : formatShortDate(todayLocal())
  const queryDate = date || todayLocal()

  const totals = db
    .prepare(
      `SELECT
        SUM(amount) as total,
        SUM(CASE WHEN payment_method = 'cash' THEN amount ELSE 0 END) as cash,
        SUM(CASE WHEN payment_method = 'qr' THEN amount ELSE 0 END) as qr,
        COUNT(*) as count
      FROM transactions
      WHERE date(created_at) = ? AND is_voided = 0`
    )
    .get(queryDate)

  // 2-H: build the breakdown from the ACTUAL type groups present, so the lines
  // always reconcile to Total (no hardcoded set that silently drops types).
  const groups = db
    .prepare(
      `SELECT transaction_type, SUM(amount) as rev, COUNT(*) as count
       FROM transactions
       WHERE date(created_at) = ? AND is_voided = 0
       GROUP BY transaction_type`
    )
    .all(queryDate)
  const byType = new Map(groups.map((g) => [g.transaction_type, g]))

  const orderedTypes = [
    ...TYPE_ORDER.filter((t) => byType.has(t)),
    ...groups.map((g) => g.transaction_type).filter((t) => !TYPE_ORDER.includes(t))
  ]
  const lines = orderedTypes.map((t) => {
    const g = byType.get(t)
    const label = TYPE_LABELS[t] || t
    return `  • ${label}: ${g.count} — Rs. ${g.rev || 0}`
  })

  const staffRow = db
    .prepare(
      `SELECT u.name FROM transactions t
       JOIN users u ON t.staff_id = u.id
       WHERE date(t.created_at) = ?
       ORDER BY t.created_at DESC LIMIT 1`
    )
    .get(queryDate)

  // Cash reconciliation is optional — keep graceful if the table or row is absent.
  let reconRow = null
  try {
    reconRow = db
      .prepare(
        `SELECT discrepancy FROM cash_reconciliations
         WHERE reconcile_date = ?
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(queryDate)
  } catch {
    reconRow = null
  }

  const total = totals.total || 0
  const cash = totals.cash || 0
  const qr = totals.qr || 0
  const count = totals.count || 0

  let reconLine = ''
  if (reconRow && reconRow.discrepancy != null) {
    const discrepancy = reconRow.discrepancy
    const label = discrepancy >= 0 ? 'over' : 'short'
    reconLine = `\n\n⚖️ Cash reconciliation: Rs. ${discrepancy} (${label})`
  }

  const breakdown = lines.length ? lines.join('\n') : '  • (no sales)'

  return `🏊 Refresh Recreation Center
📅 Daily Summary — ${dateStr}

💰 REVENUE
Total: Rs. ${total}
  • Cash: Rs. ${cash}
  • QR: Rs. ${qr}

📋 TRANSACTIONS (${count} total)
${breakdown}${reconLine}

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
