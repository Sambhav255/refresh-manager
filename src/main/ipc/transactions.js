import { ipcMain } from 'electron'
import { getDb } from '../db/index.js'
import { requireOwner, requireStaffOrOwner } from '../session.js'
import { formatTime, productDisplayName, todayLocal } from './utils.js'

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
    isVoided: !!row.is_voided
  }
}

export function registerTransactionHandlers() {
  ipcMain.handle(
    'transactions:create',
    wrap(
      // P0-1: staff_id is taken from the authenticated session, never the
      // payload; amount is re-derived from the product catalogue when a product
      // is given, so a tampered/buggy renderer cannot mis-price or mis-attribute
      // a sale. (staffId/amount are intentionally NOT destructured here.)
      ({
        type,
        source = 'pool',
        customerName,
        phone,
        productId,
        memberId,
        paymentMethod,
        notes
      }) => {
        const session = requireStaffOrOwner()
        const staffId = session.userId
        const db = getDb()
        const pay = paymentMethod?.toLowerCase() === 'qr' ? 'qr' : 'cash'

        let amount = 0
        if (productId) {
          const product = db.prepare('SELECT price FROM products WHERE id = ?').get(productId)
          if (!product) throw new Error('Product not found')
          amount = product.price
        }

        const result = db
          .prepare(
            `INSERT INTO transactions
             (transaction_type, source, customer_name, phone, product_id, member_id, amount, payment_method, staff_id, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            type,
            source,
            customerName,
            phone || null,
            productId || null,
            memberId || null,
            amount,
            pay,
            staffId,
            notes || null
          )
        return { success: true, transactionId: result.lastInsertRowid }
      }
    )
  )

  ipcMain.handle(
    'transactions:list',
    wrap(({ dateFrom, dateTo, type, source, staffId, paymentMethod }) => {
      requireStaffOrOwner()
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
      const transactions = getDb()
        .prepare(sql)
        .all(...params)
        .map(mapTransaction)
      return { transactions }
    })
  )

  ipcMain.handle(
    'transactions:today-summary',
    wrap(({ source } = {}) => {
      requireStaffOrOwner()
      const today = todayLocal()
      let sql = `
        SELECT transaction_type, source, payment_method, SUM(amount) as total, COUNT(*) as count
        FROM transactions
        WHERE is_voided = 0 AND date(created_at) = ?
      `
      const params = [today]
      if (source) {
        sql += ' AND source = ?'
        params.push(source)
      }
      sql += ' GROUP BY transaction_type, source, payment_method'
      const rows = getDb()
        .prepare(sql)
        .all(...params)

      let total = 0
      let cash = 0
      let qr = 0
      const byType = {}
      const bySource = { pool: 0, restaurant: 0 }

      for (const r of rows) {
        total += r.total
        if (r.payment_method === 'cash') cash += r.total
        else qr += r.total
        byType[r.transaction_type] = (byType[r.transaction_type] || 0) + r.total
        bySource[r.source] = (bySource[r.source] || 0) + r.total
      }

      return { total, cash, qr, byType, bySource, count: rows.reduce((s, r) => s + r.count, 0) }
    })
  )

  ipcMain.handle(
    'transactions:void',
    wrap(({ transactionId, reason }) => {
      const session = requireOwner()
      getDb()
        .prepare(
          `UPDATE transactions SET is_voided = 1, void_reason = ?, void_by = ?, void_at = datetime('now','localtime') WHERE id = ?`
        )
        .run(reason, session.userId, transactionId)
      return { success: true }
    })
  )
}
