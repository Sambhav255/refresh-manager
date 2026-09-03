import ExcelJS from 'exceljs'
import { existsSync, readdirSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'
import { getBuildIdentity } from './build-info.js'
import { SCHEMA_VERSION } from './db/migrations.js'

const DAILY_PREFIX = 'refresh_daily_'
const MAX_DAILY_FILES = 90

export function dailyExportFilename(dateStr) {
  return `${DAILY_PREFIX}${dateStr}.xlsx`
}

function pruneOldExports(folder) {
  if (!folder || !existsSync(folder)) return
  const files = readdirSync(folder)
    .filter((f) => f.startsWith(DAILY_PREFIX) && f.endsWith('.xlsx'))
    .map((f) => ({ f, t: statSync(join(folder, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)
  for (const { f } of files.slice(MAX_DAILY_FILES)) {
    try {
      unlinkSync(join(folder, f))
    } catch {
      /* ignore */
    }
  }
}

function addSheet(wb, name, headers, rows, mapRow) {
  const ws = wb.addWorksheet(name)
  ws.addRow(headers)
  ws.getRow(1).font = { bold: true }
  for (const row of rows) ws.addRow(mapRow(row))
}

export async function writeDailyExport(db, folder, dateStr) {
  if (!folder) throw new Error('Backup destination not configured')
  const filePath = join(folder, dailyExportFilename(dateStr))
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Refresh Manager'

  const txRows = db
    .prepare(
      `SELECT t.*, u.name AS staff_name FROM transactions t
       JOIN users u ON u.id = t.staff_id ORDER BY t.created_at`
    )
    .all()
  addSheet(
    wb,
    'Sales',
    ['ID', 'Date', 'Type', 'Source', 'Customer', 'Amount', 'Payment', 'Staff', 'Voided'],
    txRows,
    (r) => [
      r.id,
      r.created_at,
      r.transaction_type,
      r.source,
      r.customer_name || '',
      r.amount,
      r.payment_method,
      r.staff_name,
      r.is_voided ? 'yes' : 'no'
    ]
  )

  const lineRows = db
    .prepare(
      `SELECT tl.*, t.created_at AS sale_at FROM transaction_lines tl
       JOIN transactions t ON t.id = tl.transaction_id ORDER BY tl.id`
    )
    .all()
  addSheet(
    wb,
    'Lines',
    ['ID', 'Sale ID', 'Description', 'Qty', 'Unit Price', 'Discount'],
    lineRows,
    (r) => [r.id, r.transaction_id, r.description, r.quantity, r.unit_price, r.discount || 0]
  )

  const payRows = db
    .prepare(
      `SELECT tp.*, t.created_at AS sale_at FROM transaction_payments tp
       JOIN transactions t ON t.id = tp.transaction_id ORDER BY tp.id`
    )
    .all()
  addSheet(wb, 'Payments', ['ID', 'Sale ID', 'Method', 'Amount'], payRows, (r) => [
    r.id,
    r.transaction_id,
    r.payment_method,
    r.amount
  ])

  const memberRows = db.prepare(`SELECT * FROM members ORDER BY id`).all()
  addSheet(wb, 'Members', ['ID', 'Name', 'Phone', 'Created'], memberRows, (r) => [
    r.id,
    r.name,
    r.phone || '',
    r.created_at
  ])

  const poolInv = db.prepare(`SELECT * FROM pool_inventory_items WHERE is_active = 1`).all()
  addSheet(wb, 'Pool Inventory', ['ID', 'Name', 'Stock', 'Price'], poolInv, (r) => [
    r.id,
    r.name,
    r.current_stock,
    r.selling_price
  ])

  const restInv = db.prepare(`SELECT * FROM restaurant_inventory_items WHERE is_active = 1`).all()
  addSheet(wb, 'Restaurant Inventory', ['ID', 'Name', 'Stock', 'Cost'], restInv, (r) => [
    r.id,
    r.name,
    r.current_stock,
    r.cost_per_unit || 0
  ])

  const bookingRows = db.prepare(`SELECT * FROM bookings ORDER BY booking_date`).all()
  addSheet(
    wb,
    'Bookings',
    ['ID', 'Name', 'Date', 'Status', 'Deposit', 'Total Expected'],
    bookingRows,
    (r) => [
      r.id,
      r.booking_name,
      r.booking_date,
      r.status,
      r.deposit_amount || 0,
      r.total_expected || 0
    ]
  )

  const identity = getBuildIdentity()
  const active = txRows.filter((t) => !t.is_voided)
  const summary = wb.addWorksheet('Summary')
  summary.addRow(['Export date', dateStr])
  summary.addRow(['App version', identity.version])
  summary.addRow(['Schema version', String(SCHEMA_VERSION)])
  summary.addRow(['Sales count', active.length])
  summary.addRow([
    'Cash total',
    active.filter((t) => t.payment_method === 'cash').reduce((s, t) => s + t.amount, 0)
  ])
  summary.addRow([
    'QR total',
    active.filter((t) => t.payment_method === 'qr').reduce((s, t) => s + t.amount, 0)
  ])

  await wb.xlsx.writeFile(filePath)
  pruneOldExports(folder)
  return filePath
}

export function shouldRunCatchupExport(db) {
  const pathRow = db.prepare(`SELECT value FROM settings WHERE key = 'backup_path'`).get()
  if (!pathRow?.value) return false
  const auto = db.prepare(`SELECT value FROM settings WHERE key = 'backup_auto_enabled'`).get()
  if (auto?.value === 'false') return false
  const last = db.prepare(`SELECT value FROM settings WHERE key = 'last_excel_at'`).get()
  const today = db.prepare(`SELECT date('now','localtime') AS d`).get().d
  if (!last?.value) return true
  return last.value.slice(0, 10) < today
}

export function markExportDone(db, filePath) {
  const now = db.prepare(`SELECT datetime('now','localtime') AS now`).get().now
  const set = db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`)
  set.run('last_excel_at', now)
  set.run('last_excel_path', filePath)
  set.run('last_excel_status', 'success')
}

export function markExportFailed(db) {
  db.prepare(
    `INSERT OR REPLACE INTO settings (key, value) VALUES ('last_excel_status', 'failed')`
  ).run()
}
