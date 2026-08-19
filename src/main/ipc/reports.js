import { ipcMain, dialog } from 'electron'
import ExcelJS from 'exceljs'
import { getDb } from '../db/index.js'
import { requireOwner } from '../session.js'
import { formatTime, productDisplayName, productFromRow, todayLocal } from './utils.js'

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
    product: row.product_name
      ? productDisplayName(productFromRow(row))
      : row.notes || row.transaction_type,
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

// A malformed month (e.g. '2026-08' instead of 8) used to sail through
// monthRange and produce an all-zero report, which reads as "no trade" rather
// than "you asked the wrong question". Shared by every month-scoped report.
function requireYearMonth(year, month) {
  const now = new Date()
  const y = Number(year ?? now.getFullYear())
  const m = Number(month ?? now.getMonth() + 1)
  if (!Number.isInteger(y) || y < 2000 || y > 2100) throw new Error('Invalid year')
  if (!Number.isInteger(m) || m < 1 || m > 12) throw new Error('Month must be between 1 and 12')
  return { y, m }
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
      product: row.product_name ? productDisplayName(productFromRow(row)) : 'Other',
      total: row.total,
      count: row.count
    }))
}

// 4-A: metrics used for period-over-period comparison.
function newMemberCount(db, dateFrom, dateTo) {
  return (
    db
      .prepare(
        `SELECT COUNT(DISTINCT ms.member_id) as count FROM memberships ms
         WHERE ms.start_date >= ? AND ms.start_date <= ?
           AND NOT EXISTS (SELECT 1 FROM memberships prev WHERE prev.member_id = ms.member_id AND prev.id < ms.id)`
      )
      .get(dateFrom, dateTo)?.count || 0
  )
}
function revenueTotal(db, dateFrom, dateTo) {
  return (
    db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
         WHERE is_voided = 0 AND date(created_at) >= ? AND date(created_at) <= ?`
      )
      .get(dateFrom, dateTo)?.total || 0
  )
}
function footfallInRange(db, dateFrom, dateTo) {
  return (
    db
      .prepare(
        `SELECT COUNT(*) as c FROM check_ins WHERE date(checked_in_at) >= ? AND date(checked_in_at) <= ?`
      )
      .get(dateFrom, dateTo)?.c || 0
  )
}
function prevMonthRange(year, month) {
  const py = month === 1 ? year - 1 : year
  const pm = month === 1 ? 12 : month - 1
  return monthRange(py, pm)
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
    { header: 'Period (days 1–7, 8–14, …)', key: 'period', width: 26 },
    { header: 'Start', key: 'weekStart', width: 14 },
    { header: 'End', key: 'weekEnd', width: 14 },
    { header: 'Count', key: 'count', width: 12 },
    { header: 'Amount (NPR)', key: 'total', width: 18 }
  ]
  styleHeaderRow(sheet.getRow(1))
  sheet.addRows(
    byWeek.map((w) => {
      const startDay = (w.week - 1) * 7 + 1
      const endDay = w.week * 7
      return {
        period: `Days ${startDay}–${endDay}`,
        weekStart: w.weekStart,
        weekEnd: w.weekEnd,
        count: w.count,
        total: w.total
      }
    })
  )
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

function addRetentionSheets(workbook, data) {
  const sheet = workbook.addWorksheet('Retention')
  sheet.columns = [
    { header: 'Metric', key: 'metric', width: 28 },
    { header: 'Value', key: 'value', width: 18 }
  ]
  styleHeaderRow(sheet.getRow(1))
  sheet.addRows([
    { metric: 'Memberships due', value: data.due ?? 0 },
    { metric: 'Renewed', value: data.renewed ?? 0 },
    { metric: 'Retention rate (%)', value: data.retentionRate ?? 0 }
  ])
  applyAlternatingRows(sheet, 2, sheet.rowCount)

  const churnSheet = workbook.addWorksheet('Churned Members')
  churnSheet.columns = [
    { header: 'Name', key: 'name', width: 24 },
    { header: 'Phone', key: 'phone', width: 16 },
    { header: 'Product', key: 'product', width: 28 },
    { header: 'End date', key: 'end_date', width: 14 }
  ]
  styleHeaderRow(churnSheet.getRow(1))
  const churned = data.churned || []
  churnSheet.addRows(
    churned.map((c) => ({
      name: c.name,
      phone: c.phone || '',
      product: c.product_name || '',
      end_date: c.end_date
    }))
  )
  if (churned.length) applyAlternatingRows(churnSheet, 2, churnSheet.rowCount)
}

function addInventoryTurnoverSheets(workbook, data) {
  const poolSheet = workbook.addWorksheet('Pool Items')
  poolSheet.columns = [
    { header: 'Item', key: 'name', width: 28 },
    { header: 'Variant', key: 'variant', width: 18 },
    { header: 'Sold', key: 'sold', width: 12 },
    { header: 'Revenue (NPR)', key: 'revenue', width: 18 }
  ]
  styleHeaderRow(poolSheet.getRow(1))
  const pool = data.pool || []
  poolSheet.addRows(
    pool.map((p) => ({
      name: p.name,
      variant: p.variant || '',
      sold: p.sold ?? 0,
      revenue: p.revenue ?? 0
    }))
  )
  if (pool.length) applyAlternatingRows(poolSheet, 2, poolSheet.rowCount)

  const restSheet = workbook.addWorksheet('Restaurant Items')
  restSheet.columns = [
    { header: 'Item', key: 'name', width: 28 },
    { header: 'Sold', key: 'sold', width: 12 },
    { header: 'Revenue (NPR)', key: 'revenue', width: 18 }
  ]
  styleHeaderRow(restSheet.getRow(1))
  const restaurant = data.restaurant || []
  restSheet.addRows(
    restaurant.map((r) => ({
      name: r.name,
      sold: r.sold ?? 0,
      revenue: r.revenue ?? 0
    }))
  )
  if (restaurant.length) applyAlternatingRows(restSheet, 2, restSheet.rowCount)

  const lowSheet = workbook.addWorksheet('Low Stock')
  lowSheet.columns = [
    { header: 'Item', key: 'name', width: 28 },
    { header: 'Source', key: 'source', width: 14 },
    { header: 'Current', key: 'current_stock', width: 12 },
    { header: 'Reorder', key: 'reorder_level', width: 12 }
  ]
  styleHeaderRow(lowSheet.getRow(1))
  const lowStock = data.lowStock || []
  lowSheet.addRows(
    lowStock.map((l) => ({
      name: l.name,
      source: l.source,
      current_stock: l.current_stock ?? 0,
      reorder_level: l.reorder_level ?? 0
    }))
  )
  if (lowStock.length) applyAlternatingRows(lowSheet, 2, lowSheet.rowCount)
}

function addBookingsSheets(workbook, data) {
  const summary = data.summary || {}
  const summarySheet = workbook.addWorksheet('Bookings Summary')
  summarySheet.columns = [
    { header: 'Metric', key: 'metric', width: 28 },
    { header: 'Value', key: 'value', width: 18 }
  ]
  styleHeaderRow(summarySheet.getRow(1))
  const summaryRows = [
    { metric: 'Total bookings', value: summary.count ?? 0 },
    { metric: 'Deposit total (NPR)', value: summary.depositTotal ?? 0 },
    { metric: 'Expected total (NPR)', value: summary.expectedTotal ?? 0 }
  ]
  for (const [status, count] of Object.entries(summary.byStatus || {})) {
    summaryRows.push({ metric: `Status: ${status}`, value: count })
  }
  summarySheet.addRows(summaryRows)
  applyAlternatingRows(summarySheet, 2, summarySheet.rowCount)

  const sheet = workbook.addWorksheet('Bookings')
  sheet.columns = [
    { header: 'Booking', key: 'booking_name', width: 24 },
    { header: 'Contact', key: 'contact_person', width: 20 },
    { header: 'Phone', key: 'contact_phone', width: 16 },
    { header: 'Date', key: 'booking_date', width: 14 },
    { header: 'Time slot', key: 'time_slot', width: 16 },
    { header: 'People', key: 'num_people', width: 10 },
    { header: 'Facilities', key: 'facilities_booked', width: 24 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Deposit (NPR)', key: 'deposit_paid', width: 16 },
    { header: 'Deposit method', key: 'deposit_method', width: 16 },
    { header: 'Expected (NPR)', key: 'total_expected', width: 16 },
    { header: 'Notes', key: 'notes', width: 24 }
  ]
  styleHeaderRow(sheet.getRow(1))
  const bookings = data.bookings || []
  sheet.addRows(
    bookings.map((b) => ({
      booking_name: b.booking_name,
      contact_person: b.contact_person || '',
      contact_phone: b.contact_phone || '',
      booking_date: b.booking_date,
      time_slot: b.time_slot || '',
      num_people: b.num_people ?? 0,
      facilities_booked: b.facilities_booked || '',
      status: b.status,
      deposit_paid: b.deposit_paid ?? 0,
      deposit_method: b.deposit_method || '',
      total_expected: b.total_expected ?? 0,
      notes: b.notes || ''
    }))
  )
  if (bookings.length) applyAlternatingRows(sheet, 2, sheet.rowCount)
}

function addStaffTotalsSheet(workbook, staff) {
  const sheet = workbook.addWorksheet('Staff Totals')
  sheet.columns = [
    { header: 'Staff', key: 'name', width: 24 },
    { header: 'Transactions', key: 'txn_count', width: 16 },
    { header: 'Total (NPR)', key: 'total', width: 18 }
  ]
  styleHeaderRow(sheet.getRow(1))
  const staffRows = staff || []
  sheet.addRows(
    staffRows.map((s) => ({
      name: s.name,
      txn_count: s.txn_count ?? 0,
      total: s.total ?? 0
    }))
  )
  if (staffRows.length) applyAlternatingRows(sheet, 2, sheet.rowCount)
}

function buildDefaultSheets(workbook, data) {
  addSummarySheet(workbook, data.summary || {})
  if (data.transactions?.length) {
    addTransactionsSheet(workbook, data.transactions, data.summary)
  }
  if (data.byWeek?.length) addByWeekSheet(workbook, data.byWeek)
  if (data.byProduct?.length) addByProductSheet(workbook, data.byProduct)
}

async function exportToExcel({ reportType, data, savePath }) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Refresh Manager'
  switch (reportType) {
    case 'retention':
      addRetentionSheets(workbook, data)
      break
    case 'inventory-turnover':
      addInventoryTurnoverSheets(workbook, data)
      break
    case 'bookings':
      addBookingsSheets(workbook, data)
      break
    case 'staff-activity':
      addStaffTotalsSheet(workbook, data.staff)
      if (data.transactions?.length) {
        addTransactionsSheet(workbook, data.transactions)
      }
      break
    default:
      buildDefaultSheets(workbook, data)
      break
  }
  if (workbook.worksheets.length === 0) {
    workbook.addWorksheet('Summary')
  }
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
      const { y, m } = requireYearMonth(year, month)
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

      // 4-A: previous-period comparison so trends are visible.
      const footfall = footfallInRange(db, dateFrom, dateTo)
      const prev = prevMonthRange(y, m)
      const previous = {
        total: revenueTotal(db, prev.dateFrom, prev.dateTo),
        newMembers: newMemberCount(db, prev.dateFrom, prev.dateTo),
        footfall: footfallInRange(db, prev.dateFrom, prev.dateTo)
      }
      const pct = (cur, was) => (was > 0 ? Math.round(((cur - was) / was) * 100) : null)
      const deltas = {
        totalPct: pct(summary.total, previous.total),
        newMembersPct: pct(newMembers, previous.newMembers),
        footfallPct: pct(footfall, previous.footfall)
      }

      return {
        summary,
        byWeek,
        byProduct,
        newMembers,
        renewals,
        footfall,
        previous,
        deltas,
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
      const { y, m } = requireYearMonth(year, month)
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

  // 4-B: cohort retention — of the members who FIRST joined in month M, how many
  // still hold an active membership 1/2/3 months later.
  ipcMain.handle(
    'reports:cohort-retention',
    wrap(({ year, month } = {}) => {
      requireOwner()
      const { y, m } = requireYearMonth(year, month)
      const { dateFrom, dateTo } = monthRange(y, m)
      const db = getDb()
      const cohort = db
        .prepare(
          `SELECT ms.member_id, MIN(ms.start_date) as first_start
           FROM memberships ms
           GROUP BY ms.member_id
           HAVING first_start >= ? AND first_start <= ?`
        )
        .all(dateFrom, dateTo)
      const cohortSize = cohort.length
      const spans = db.prepare(
        `SELECT 1 FROM memberships WHERE member_id = ? AND start_date <= ? AND end_date >= ? LIMIT 1`
      )
      const retention = [1, 2, 3].map((k) => {
        const d = new Date(y, m - 1 + k, 1)
        const checkDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
        let active = 0
        for (const c of cohort) {
          if (spans.get(c.member_id, checkDate, checkDate)) active++
        }
        return {
          monthOffset: k,
          active,
          rate: cohortSize > 0 ? Math.round((active / cohortSize) * 100) : 0
        }
      })
      return { cohortSize, retention, year: y, month: m }
    })
  )

  ipcMain.handle(
    'reports:inventory-turnover',
    wrap(({ year, month } = {}) => {
      requireOwner()
      const { y, m } = requireYearMonth(year, month)
      const { dateFrom, dateTo } = monthRange(y, m)
      const db = getDb()
      // Revenue uses the unit price recorded at sale time (falling back to the
      // current selling price for pre-migration rows), and refund reversals
      // ('in' rows tagged 'Refund reversal') net OUT of both sold and revenue —
      // so a refunded sale no longer counts as turnover, and later price changes
      // don't rewrite history.
      const turnoverSql = (txnTable, itemTable, extraCols) => `
        SELECT ${extraCols},
          SUM(CASE
                WHEN t.txn_type = 'out' THEN t.quantity
                WHEN t.txn_type = 'in' AND t.reason = 'Refund reversal' THEN -t.quantity
                ELSE 0 END) as sold,
          SUM(CASE
                WHEN t.txn_type = 'out' THEN t.quantity * COALESCE(t.unit_price, i.selling_price)
                WHEN t.txn_type = 'in' AND t.reason = 'Refund reversal'
                  THEN -t.quantity * COALESCE(t.unit_price, i.selling_price)
                ELSE 0 END) as revenue
        FROM ${txnTable} t JOIN ${itemTable} i ON i.id = t.item_id
        WHERE (t.txn_type = 'out' OR (t.txn_type = 'in' AND t.reason = 'Refund reversal'))
          AND date(t.created_at) >= ? AND date(t.created_at) <= ?
        GROUP BY i.id ORDER BY sold DESC`
      const pool = db
        .prepare(
          turnoverSql('pool_inventory_transactions', 'pool_inventory_items', 'i.name, i.variant')
        )
        .all(dateFrom, dateTo)
      const restaurant = db
        .prepare(
          turnoverSql('restaurant_inventory_transactions', 'restaurant_inventory_items', 'i.name')
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
      const { y, m } = requireYearMonth(year, month)
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
