import { ipcMain, dialog } from 'electron'
import ExcelJS from 'exceljs'
import { getDb } from '../db/index.js'
import { requireOwner } from '../session.js'
import { formatTime, productDisplayName, todayLocal } from './utils.js'

const BRAND_BLUE = '001F5B'
const BRAND_LIGHT = 'E8F4FD'

function wrap(handler) {
  return async (_event, payload) => {
    try {
      return await handler(payload || {})
    } catch (err) {
      return { success: false, error: err.message }
    }
  }
}

function mapTransaction(row) {
  return {
    id: row.id,
    displayId: `#${row.id}`,
    time: formatTime(row.created_at),
    customer: row.customer_name,
    phone: row.phone,
    product: row.product_name ? productDisplayName(row) : row.transaction_type,
    productId: row.product_id,
    amount: row.amount,
    pay: row.payment_method === 'cash' ? 'Cash' : 'QR',
    paymentMethod: row.payment_method,
    staff: row.staff_name,
    staffId: row.staff_id,
    type: row.transaction_type,
    source: row.source,
    createdAt: row.created_at,
    isVoided: !!row.is_voided,
    notes: row.notes
  }
}

function fetchTransactionRows(db, { dateFrom, dateTo, type, source, staffId, paymentMethod } = {}) {
  let sql = `
    SELECT t.*, p.name as product_name, p.category, p.duration_days, p.sub_category,
           u.name as staff_name
    FROM transactions t
    LEFT JOIN products p ON p.id = t.product_id
    JOIN users u ON u.id = t.staff_id
    WHERE t.is_voided = 0
  `
  const params = []
  if (dateFrom) {
    sql += ` AND date(t.created_at) >= ?`
    params.push(dateFrom)
  }
  if (dateTo) {
    sql += ` AND date(t.created_at) <= ?`
    params.push(dateTo)
  }
  if (type) {
    sql += ` AND t.transaction_type = ?`
    params.push(type)
  }
  if (source) {
    sql += ` AND t.source = ?`
    params.push(source)
  }
  if (staffId) {
    sql += ` AND t.staff_id = ?`
    params.push(staffId)
  }
  if (paymentMethod) {
    sql += ` AND t.payment_method = ?`
    params.push(paymentMethod)
  }
  sql += ' ORDER BY t.created_at DESC'
  return db.prepare(sql).all(...params)
}

function buildSummary(rows) {
  let total = 0
  let cash = 0
  let qr = 0
  const byType = {}
  const bySource = { pool: 0, restaurant: 0 }

  for (const r of rows) {
    total += r.amount
    if (r.payment_method === 'cash') cash += r.amount
    else qr += r.amount
    byType[r.transaction_type] = (byType[r.transaction_type] || 0) + r.amount
    bySource[r.source] = (bySource[r.source] || 0) + r.amount
  }

  return { total, cash, qr, byType, bySource, count: rows.length }
}

function monthRange(year, month) {
  const m = String(month).padStart(2, '0')
  const dateFrom = `${year}-${m}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const dateTo = `${year}-${m}-${String(lastDay).padStart(2, '0')}`
  return { dateFrom, dateTo }
}

function fetchByWeek(db, dateFrom, dateTo) {
  return db
    .prepare(
      `SELECT
         CAST((CAST(strftime('%d', t.created_at) AS INTEGER) - 1) / 7 + 1 AS INTEGER) as week,
         MIN(date(t.created_at)) as weekStart,
         MAX(date(t.created_at)) as weekEnd,
         SUM(t.amount) as total,
         COUNT(*) as count
       FROM transactions t
       WHERE t.is_voided = 0 AND date(t.created_at) >= ? AND date(t.created_at) <= ?
       GROUP BY week
       ORDER BY week`
    )
    .all(dateFrom, dateTo)
    .map((row) => ({
      week: row.week,
      weekStart: row.weekStart,
      weekEnd: row.weekEnd,
      total: row.total,
      count: row.count
    }))
}

function fetchByProduct(db, dateFrom, dateTo) {
  return db
    .prepare(
      `SELECT t.product_id, p.name as product_name, p.category, p.duration_days, p.sub_category,
              SUM(t.amount) as total, COUNT(*) as count
       FROM transactions t
       LEFT JOIN products p ON p.id = t.product_id
       WHERE t.is_voided = 0 AND date(t.created_at) >= ? AND date(t.created_at) <= ?
       GROUP BY t.product_id
       ORDER BY total DESC`
    )
    .all(dateFrom, dateTo)
    .map((row) => ({
      productId: row.product_id,
      product: row.product_name ? productDisplayName(row) : 'Other',
      total: row.total,
      count: row.count
    }))
}

function styleHeaderRow(row) {
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_BLUE } }
    cell.font = { color: { argb: 'FFFFFF' }, bold: true }
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
  })
  row.height = 24
}

function applyAlternatingRows(sheet, startRow, endRow) {
  for (let i = startRow; i <= endRow; i++) {
    if (i % 2 === 0) {
      sheet.getRow(i).eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_LIGHT } }
      })
    }
  }
}

function resolveDateRange(reportType, data) {
  if (data.date) return data.date
  if (data.year != null && data.month != null) {
    return `${data.year}-${String(data.month).padStart(2, '0')}`
  }
  if (data.dateFrom && data.dateTo) return `${data.dateFrom}_${data.dateTo}`
  return todayLocal()
}

function addSummarySheet(workbook, summary) {
  const sheet = workbook.addWorksheet('Summary')
  sheet.columns = [
    { header: 'Category', key: 'category', width: 28 },
    { header: 'Count', key: 'count', width: 12 },
    { header: 'Amount (NPR)', key: 'amount', width: 18 }
  ]
  styleHeaderRow(sheet.getRow(1))
  const rows = [
    { category: 'Total revenue', count: summary.count, amount: summary.total },
    { category: 'Cash', count: '', amount: summary.cash },
    { category: 'QR', count: '', amount: summary.qr },
    { category: 'Pool', count: '', amount: summary.bySource?.pool ?? 0 },
    { category: 'Restaurant', count: '', amount: summary.bySource?.restaurant ?? 0 }
  ]
  for (const [type, amount] of Object.entries(summary.byType || {})) {
    rows.push({ category: type, count: '', amount })
  }
  sheet.addRows(rows)
  applyAlternatingRows(sheet, 2, sheet.rowCount)
}

function addTransactionsSheet(workbook, transactions, summary) {
  const sheet = workbook.addWorksheet('Transactions')
  sheet.columns = [
    { header: '#', key: 'id', width: 8 },
    { header: 'Time', key: 'time', width: 12 },
    { header: 'Customer', key: 'customer', width: 22 },
    { header: 'Phone', key: 'phone', width: 16 },
    { header: 'Type', key: 'type', width: 16 },
    { header: 'Product', key: 'product', width: 28 },
    { header: 'Amount (NPR)', key: 'amount', width: 16 },
    { header: 'Payment', key: 'payment', width: 12 },
    { header: 'Staff', key: 'staff', width: 16 },
    { header: 'Notes', key: 'notes', width: 22 }
  ]
  styleHeaderRow(sheet.getRow(1))
  for (const t of transactions) {
    sheet.addRow({
      id: t.id,
      time: t.time,
      customer: t.customer,
      phone: t.phone || '',
      type: t.type,
      product: t.product,
      amount: t.amount,
      payment: t.pay,
      staff: t.staff,
      notes: t.notes || ''
    })
  }
  if (transactions.length) applyAlternatingRows(sheet, 2, sheet.rowCount)
  const totalRow = sheet.addRow({
    customer: 'TOTAL',
    amount: summary?.total ?? transactions.reduce((s, t) => s + t.amount, 0)
  })
  totalRow.font = { bold: true }
}

function addByWeekSheet(workbook, byWeek) {
  const sheet = workbook.addWorksheet('By Week')
  sheet.columns = [
    { header: 'Week', key: 'week', width: 10 },
    { header: 'Start', key: 'weekStart', width: 14 },
    { header: 'End', key: 'weekEnd', width: 14 },
    { header: 'Count', key: 'count', width: 12 },
    { header: 'Amount (NPR)', key: 'total', width: 18 }
  ]
  styleHeaderRow(sheet.getRow(1))
  sheet.addRows(byWeek)
  if (byWeek.length) applyAlternatingRows(sheet, 2, sheet.rowCount)
}

function addByProductSheet(workbook, byProduct) {
  const sheet = workbook.addWorksheet('By Product')
  sheet.columns = [
    { header: 'Product', key: 'product', width: 32 },
    { header: 'Count', key: 'count', width: 12 },
    { header: 'Amount (NPR)', key: 'total', width: 18 }
  ]
  styleHeaderRow(sheet.getRow(1))
  sheet.addRows(byProduct)
  if (byProduct.length) applyAlternatingRows(sheet, 2, sheet.rowCount)
}

async function exportToExcel({ reportType, data, savePath }) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Refresh Manager'
  addSummarySheet(workbook, data.summary || {})
  if (data.transactions?.length) {
    addTransactionsSheet(workbook, data.transactions, data.summary)
  }
  if (data.byWeek?.length) addByWeekSheet(workbook, data.byWeek)
  if (data.byProduct?.length) addByProductSheet(workbook, data.byProduct)
  const dateRange = resolveDateRange(reportType, data)
  let filePath = savePath
  if (!filePath) {
    const result = await dialog.showSaveDialog({
      defaultPath: `Refresh_${reportType}_${dateRange}.xlsx`,
      filters: [{ name: 'Excel', extensions: ['xlsx'] }]
    })
    if (result.canceled || !result.filePath) return { success: false, cancelled: true }
    filePath = result.filePath
  }
  await workbook.xlsx.writeFile(filePath)
  return { success: true, filePath }
}

export function registerReportHandlers() {
  ipcMain.handle(
    'reports:daily',
    wrap(({ date, source } = {}) => {
      requireOwner()
      const d = date || todayLocal()
      const db = getDb()
      const rows = fetchTransactionRows(db, { dateFrom: d, dateTo: d, source })
      const summary = buildSummary(rows)
      const transactions = rows.map(mapTransaction)
      return { summary, transactions, date: d }
    })
  )

  ipcMain.handle(
    'reports:monthly',
    wrap(({ year, month } = {}) => {
      requireOwner()
      const now = new Date()
      const y = year ?? now.getFullYear()
      const m = month ?? now.getMonth() + 1
      const { dateFrom, dateTo } = monthRange(y, m)
      const db = getDb()
      const rows = fetchTransactionRows(db, { dateFrom, dateTo })
      const summary = buildSummary(rows)
      const byWeek = fetchByWeek(db, dateFrom, dateTo)
      const byProduct = fetchByProduct(db, dateFrom, dateTo).slice(0, 5)

      const newMembers =
        db
          .prepare(
            `SELECT COUNT(DISTINCT ms.member_id) as count FROM memberships ms
             WHERE ms.start_date >= ? AND ms.start_date <= ?
               AND NOT EXISTS (
                 SELECT 1 FROM memberships prev
                 WHERE prev.member_id = ms.member_id AND prev.id < ms.id
               )`
          )
          .get(dateFrom, dateTo)?.count || 0

      const renewals =
        db
          .prepare(
            `SELECT COUNT(DISTINCT ms.member_id) as count FROM memberships ms
             WHERE ms.start_date >= ? AND ms.start_date <= ?
               AND EXISTS (
                 SELECT 1 FROM memberships prev
                 WHERE prev.member_id = ms.member_id AND prev.id < ms.id
               )`
          )
          .get(dateFrom, dateTo)?.count || 0

      return {
        summary,
        byWeek,
        byProduct,
        newMembers,
        renewals,
        year: y,
        month: m,
        dateFrom,
        dateTo
      }
    })
  )

  ipcMain.handle(
    'reports:custom',
    wrap(({ dateFrom, dateTo, filters = {} } = {}) => {
      requireOwner()
      if (!dateFrom || !dateTo) throw new Error('dateFrom and dateTo are required')
      const db = getDb()
      const rows = fetchTransactionRows(db, { dateFrom, dateTo, ...filters })
      const summary = buildSummary(rows)
      const transactions = rows.map(mapTransaction)
      return { summary, transactions, dateFrom, dateTo }
    })
  )

  ipcMain.handle(
    'reports:retention',
    wrap(({ year, month } = {}) => {
      requireOwner()
      const now = new Date()
      const y = year ?? now.getFullYear()
      const m = month ?? now.getMonth() + 1
      const { dateFrom, dateTo } = monthRange(y, m)
      const db = getDb()
      const due =
        db
          .prepare(
            `SELECT COUNT(*) as count FROM memberships WHERE end_date >= ? AND end_date <= ?`
          )
          .get(dateFrom, dateTo)?.count || 0
      const renewed =
        db
          .prepare(
            `SELECT COUNT(DISTINCT ms.member_id) as count FROM memberships ms WHERE ms.start_date >= ? AND ms.start_date <= ? AND EXISTS (SELECT 1 FROM memberships prev WHERE prev.member_id = ms.member_id AND prev.id < ms.id)`
          )
          .get(dateFrom, dateTo)?.count || 0
      const churned = db
        .prepare(
          `SELECT m.name, m.phone, ms.end_date, p.name as product_name FROM memberships ms JOIN members m ON m.id = ms.member_id JOIN products p ON p.id = ms.product_id WHERE ms.end_date >= ? AND ms.end_date <= ? AND ms.status != 'active' AND NOT EXISTS (SELECT 1 FROM memberships newer WHERE newer.member_id = ms.member_id AND newer.start_date > ms.end_date) ORDER BY ms.end_date`
        )
        .all(dateFrom, dateTo)
      const retentionRate = due > 0 ? Math.round((renewed / due) * 100) : 0
      return { due, renewed, retentionRate, churned, year: y, month: m, dateFrom, dateTo }
    })
  )

  ipcMain.handle(
    'reports:inventory-turnover',
    wrap(({ year, month } = {}) => {
      requireOwner()
      const now = new Date()
      const y = year ?? now.getFullYear()
      const m = month ?? now.getMonth() + 1
      const { dateFrom, dateTo } = monthRange(y, m)
      const db = getDb()
      const pool = db
        .prepare(
          `SELECT pi.name, pi.variant, SUM(pit.quantity) as sold, SUM(pit.quantity * pi.selling_price) as revenue FROM pool_inventory_transactions pit JOIN pool_inventory_items pi ON pi.id = pit.item_id WHERE pit.txn_type = 'out' AND date(pit.created_at) >= ? AND date(pit.created_at) <= ? GROUP BY pi.id ORDER BY sold DESC`
        )
        .all(dateFrom, dateTo)
      const restaurant = db
        .prepare(
          `SELECT ri.name, SUM(rit.quantity) as sold, SUM(rit.quantity * ri.selling_price) as revenue FROM restaurant_inventory_transactions rit JOIN restaurant_inventory_items ri ON ri.id = rit.item_id WHERE rit.txn_type = 'out' AND date(rit.created_at) >= ? AND date(rit.created_at) <= ? GROUP BY ri.id ORDER BY sold DESC`
        )
        .all(dateFrom, dateTo)
      const lowStock = [
        ...db
          .prepare(
            `SELECT name, variant, current_stock, reorder_level, 'pool' as source FROM pool_inventory_items WHERE is_active = 1 AND current_stock <= reorder_level`
          )
          .all(),
        ...db
          .prepare(
            `SELECT name, unit as variant, current_stock, reorder_level, 'restaurant' as source FROM restaurant_inventory_items WHERE is_active = 1 AND current_stock <= reorder_level`
          )
          .all()
      ]
      return { pool, restaurant, lowStock, year: y, month: m }
    })
  )

  ipcMain.handle(
    'reports:bookings',
    wrap(({ year, month } = {}) => {
      requireOwner()
      const now = new Date()
      const y = year ?? now.getFullYear()
      const m = month ?? now.getMonth() + 1
      const { dateFrom, dateTo } = monthRange(y, m)
      const db = getDb()
      const bookings = db
        .prepare(
          `SELECT * FROM bookings WHERE booking_date >= ? AND booking_date <= ? ORDER BY booking_date`
        )
        .all(dateFrom, dateTo)
      const byStatus = {}
      let depositTotal = 0
      let expectedTotal = 0
      for (const b of bookings) {
        byStatus[b.status] = (byStatus[b.status] || 0) + 1
        depositTotal += b.deposit_paid || 0
        expectedTotal += b.total_expected || 0
      }
      return {
        bookings,
        summary: { count: bookings.length, byStatus, depositTotal, expectedTotal },
        year: y,
        month: m
      }
    })
  )

  ipcMain.handle(
    'reports:staff-activity',
    wrap(({ dateFrom, dateTo, staffId } = {}) => {
      requireOwner()
      const from = dateFrom || todayLocal()
      const to = dateTo || todayLocal()
      const db = getDb()
      let staffSql = `SELECT u.id, u.name, COUNT(t.id) as txn_count, SUM(t.amount) as total FROM users u JOIN transactions t ON t.staff_id = u.id WHERE u.role = 'staff' AND t.is_voided = 0 AND date(t.created_at) >= ? AND date(t.created_at) <= ?`
      const params = [from, to]
      if (staffId) {
        staffSql += ` AND u.id = ?`
        params.push(staffId)
      }
      staffSql += ` GROUP BY u.id ORDER BY total DESC`
      const staff = db.prepare(staffSql).all(...params)
      const rows = fetchTransactionRows(db, { dateFrom: from, dateTo: to, staffId })
      const transactions = rows.map(mapTransaction)
      return { staff, transactions, dateFrom: from, dateTo: to }
    })
  )

  ipcMain.handle(
    'reports:export-excel',
    wrap(async ({ reportType, data, savePath }) => {
      requireOwner()
      if (!reportType || !data) throw new Error('reportType and data are required')
      return exportToExcel({ reportType, data, savePath })
    })
  )
}
