import { ipcMain } from 'electron'
import { getDb } from '../db/index.js'
import { requireOwner } from '../session.js'
import { todayLocal, addDays } from './utils.js'
import { round2 } from './pricing.js'

const EPSILON = 1e-9

function wrap(handler) {
  return async (_event, payload) => {
    try {
      return await handler(payload || {})
    } catch (err) {
      return { success: false, error: err.message }
    }
  }
}

function percentChange(current, prior) {
  if (prior <= EPSILON) {
    if (current <= EPSILON) return 0
    return null
  }
  return round2(((current - prior) / prior) * 100)
}

function sumRevenue(db, dateFrom, dateTo) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM transactions
       WHERE is_voided = 0 AND date(created_at) >= ? AND date(created_at) <= ?`
    )
    .get(dateFrom, dateTo)
  return round2(row?.total || 0)
}

function paidOnDate(db, date) {
  let cash = 0
  let qr = 0

  const payRows = db
    .prepare(
      `SELECT pm.payment_method, SUM(pm.amount) AS amount
       FROM transaction_payments pm
       JOIN transactions t ON t.id = pm.transaction_id
       WHERE t.is_voided = 0 AND date(pm.paid_at) = ?
       GROUP BY pm.payment_method`
    )
    .all(date)
  for (const r of payRows) {
    if (r.payment_method === 'cash') cash += r.amount
    else qr += r.amount
  }

  // Legacy rows and refunds: no lines/payments on the header itself.
  const legacy = db
    .prepare(
      `SELECT t.payment_method, SUM(t.amount) AS amount
       FROM transactions t
       WHERE t.is_voided = 0 AND date(t.created_at) = ?
         AND NOT EXISTS (SELECT 1 FROM transaction_lines l WHERE l.transaction_id = t.id)
         AND NOT EXISTS (SELECT 1 FROM transaction_payments pm WHERE pm.transaction_id = t.id)
       GROUP BY t.payment_method`
    )
    .all(date)
  for (const r of legacy) {
    if (r.payment_method === 'cash') cash += r.amount
    else qr += r.amount
  }

  return { cash: round2(cash), qr: round2(qr), paid: round2(cash + qr) }
}

function unpaidOnDate(db, date) {
  const rows = db
    .prepare(
      `SELECT t.amount,
              COALESCE((SELECT SUM(p.amount) FROM transaction_payments p
                         WHERE p.transaction_id = t.id), 0) AS paid
       FROM transactions t
       WHERE t.is_voided = 0
         AND t.transaction_type != 'refund'
         AND date(t.created_at) = ?
         AND EXISTS (SELECT 1 FROM transaction_lines l WHERE l.transaction_id = t.id)
         AND t.amount - COALESCE((SELECT SUM(p.amount) FROM transaction_payments p
                                   WHERE p.transaction_id = t.id), 0) > ?`
    )
    .all(date, EPSILON)
  return round2(rows.reduce((s, r) => s + r.amount - r.paid, 0))
}

function totalDues(db) {
  const salesRow = db
    .prepare(
      `SELECT COALESCE(SUM(
                 t.amount - COALESCE((SELECT SUM(p.amount) FROM transaction_payments p
                                      WHERE p.transaction_id = t.id), 0)
               ), 0) AS total
       FROM transactions t
       WHERE t.is_voided = 0
         AND t.transaction_type != 'refund'
         AND EXISTS (SELECT 1 FROM transaction_lines l WHERE l.transaction_id = t.id)
         AND t.amount - COALESCE((SELECT SUM(p.amount) FROM transaction_payments p
                                   WHERE p.transaction_id = t.id), 0) > ?`
    )
    .get(EPSILON)

  const bookingRow = db
    .prepare(
      `SELECT COALESCE(SUM(total_expected - deposit_paid), 0) AS total
       FROM bookings
       WHERE status NOT IN ('cancelled', 'completed')
         AND (total_expected - deposit_paid) > ?`
    )
    .get(EPSILON)

  const salesOutstanding = round2(salesRow?.total || 0)
  const bookingBalance = round2(bookingRow?.total || 0)
  return {
    salesOutstanding,
    bookingBalance,
    dues: round2(salesOutstanding + bookingBalance)
  }
}

function discountsOnDate(db, date) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(l.line_discount), 0) AS total
       FROM transaction_lines l
       JOIN transactions t ON t.id = l.transaction_id
       WHERE t.is_voided = 0 AND date(t.created_at) = ?`
    )
    .get(date)
  return round2(row?.total || 0)
}

function stockValue(db, table) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(
                 current_stock * COALESCE(NULLIF(unit_cost, 0), selling_price, 0)
               ), 0) AS value
       FROM ${table}
       WHERE is_active = 1`
    )
    .get()
  return round2(row?.value || 0)
}

function bookingDepositsOutstanding(db) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count,
              COALESCE(SUM(total_expected - deposit_paid), 0) AS sum
       FROM bookings
       WHERE status NOT IN ('cancelled', 'completed')
         AND total_expected > deposit_paid`
    )
    .get()
  return { count: row?.count || 0, sum: round2(row?.sum || 0) }
}

export function registerDashboardHandlers() {
  ipcMain.handle(
    'dashboard:summary',
    wrap(({ date } = {}) => {
      requireOwner()
      const db = getDb()
      const day = date || todayLocal()

      const paid = paidOnDate(db, day)
      const duesInfo = totalDues(db)
      const discountsToday = discountsOnDate(db, day)

      const weekFrom = addDays(day, -6)
      const weekTotal = sumRevenue(db, weekFrom, day)
      const priorWeekTotal = sumRevenue(db, addDays(day, -13), addDays(day, -7))

      const monthFrom = addDays(day, -29)
      const monthTotal = sumRevenue(db, monthFrom, day)
      const priorMonthTotal = sumRevenue(db, addDays(day, -59), addDays(day, -30))

      const poolStockValue = stockValue(db, 'pool_inventory_items')
      const kitchenStockValue = stockValue(db, 'restaurant_inventory_items')
      const bookingDeposits = bookingDepositsOutstanding(db)

      return {
        success: true,
        date: day,
        todayPaid: paid.paid,
        todayPaidCash: paid.cash,
        todayPaidQr: paid.qr,
        todayUnpaid: unpaidOnDate(db, day),
        dues: duesInfo.dues,
        salesOutstanding: duesInfo.salesOutstanding,
        bookingBalanceDue: duesInfo.bookingBalance,
        discountsToday,
        week: {
          total: weekTotal,
          priorTotal: priorWeekTotal,
          changePercent: percentChange(weekTotal, priorWeekTotal)
        },
        month: {
          total: monthTotal,
          priorTotal: priorMonthTotal,
          changePercent: percentChange(monthTotal, priorMonthTotal)
        },
        stock: {
          pool: poolStockValue,
          kitchen: kitchenStockValue,
          total: round2(poolStockValue + kitchenStockValue)
        },
        bookingDepositsOutstanding: bookingDeposits
      }
    })
  )
}
