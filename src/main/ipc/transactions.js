import { ipcMain } from 'electron'
import { getDb } from '../db/index.js'
import { requireOwner, requireStaffOrOwner } from '../session.js'
import { formatTime, productDisplayName, todayLocal } from './utils.js'
import { writeAudit } from '../audit.js'

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
    wrap(({ transactionId, reason, confirmReconciled = false }) => {
      const session = requireOwner()
      const db = getDb()
      const txn = db
        .prepare(
          `SELECT id, amount, is_voided, date(created_at) as day FROM transactions WHERE id = ?`
        )
        .get(transactionId)
      if (!txn) throw new Error('Transaction not found')
      if (txn.is_voided) throw new Error('Transaction is already voided')

      // A transaction that has refunds must never be voided: the refund rows
      // stay live while the original drops out of WHERE is_voided = 0, so every
      // revenue total would double-reverse (net negative). The refund IS the
      // correction — reject the void outright.
      const hasRefunds = db
        .prepare(
          `SELECT 1 FROM transactions WHERE refunds_transaction_id = ? AND is_voided = 0 LIMIT 1`
        )
        .get(transactionId)
      if (hasRefunds) {
        throw new Error(
          'This sale has been refunded and cannot be voided — the refund already reverses it.'
        )
      }

      // 2-E: voiding a transaction on a day that was already cash-reconciled
      // silently changes a day the owner already signed off on. Require an
      // explicit confirmation and record that the void hit a reconciled day.
      const reconciled = db
        .prepare(`SELECT 1 FROM cash_reconciliations WHERE date(reconcile_date) = ? LIMIT 1`)
        .get(txn.day)
      if (reconciled && !confirmReconciled) {
        return {
          success: false,
          requiresConfirmation: true,
          reconciledDay: txn.day,
          error: `This sale is on ${txn.day}, a day already reconciled. Confirm to void it anyway.`
        }
      }

      db.prepare(
        `UPDATE transactions SET is_voided = 1, void_reason = ?, void_by = ?, void_at = datetime('now','localtime') WHERE id = ?`
      ).run(reason, session.userId, transactionId)
      writeAudit(session.userId, 'transaction:void', {
        transactionId,
        amount: txn.amount,
        reason: reason || null,
        reconciledDay: reconciled ? txn.day : null
      })
      return { success: true, wasReconciled: !!reconciled }
    })
  )

  // 3-C: refund (partial or full). Creates a linked negative 'refund'
  // transaction so the ledger stays append-only and auditable (unlike a void,
  // which is for same-shift mistakes). On a FULL refund of an inventory-linked
  // sale, the stock that moved is restored atomically. Owner-gated.
  ipcMain.handle(
    'transactions:refund',
    wrap(({ transactionId, amount, reason }) => {
      const session = requireOwner()
      const db = getDb()
      const original = db.prepare(`SELECT * FROM transactions WHERE id = ?`).get(transactionId)
      if (!original) throw new Error('Transaction not found')
      if (original.is_voided) throw new Error('Cannot refund a voided transaction')
      if (original.transaction_type === 'refund') throw new Error('Cannot refund a refund')
      if (original.amount <= 0) throw new Error('Nothing to refund on this transaction')

      const refundedSoFar =
        -db
          .prepare(
            `SELECT COALESCE(SUM(amount), 0) as s FROM transactions WHERE refunds_transaction_id = ?`
          )
          .get(transactionId).s || 0
      const remaining = original.amount - refundedSoFar
      const refundAmount = amount == null ? remaining : Number(amount)
      if (!(refundAmount > 0)) throw new Error('Refund amount must be positive')
      if (refundAmount > remaining + 1e-9) {
        throw new Error(`Refund exceeds remaining refundable amount (Rs. ${remaining})`)
      }
      const isFull = Math.abs(refundedSoFar + refundAmount - original.amount) < 1e-9

      const run = db.transaction(() => {
        const refund = db
          .prepare(
            `INSERT INTO transactions
             (transaction_type, source, customer_name, phone, product_id, member_id, amount,
              payment_method, staff_id, notes, refunds_transaction_id)
             VALUES ('refund', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            original.source,
            original.customer_name,
            original.phone,
            original.product_id,
            original.member_id,
            -refundAmount,
            original.payment_method,
            session.userId,
            `Refund of #${original.id}${reason ? `: ${reason}` : ''}`,
            original.id
          )
        const refundId = refund.lastInsertRowid

        // Restore inventory only on a full refund (partial money refunds don't
        // map cleanly to whole units of stock).
        if (isFull) {
          for (const table of [
            'pool_inventory_transactions',
            'restaurant_inventory_transactions'
          ]) {
            const items =
              table === 'pool_inventory_transactions'
                ? 'pool_inventory_items'
                : 'restaurant_inventory_items'
            const outs = db
              .prepare(
                `SELECT item_id, quantity, unit_price FROM ${table} WHERE transaction_id = ? AND txn_type = 'out'`
              )
              .all(original.id)
            for (const o of outs) {
              // Carry the original sale's unit price onto the reversal so the
              // turnover report nets the refund at the price actually charged.
              db.prepare(
                `INSERT INTO ${table} (item_id, txn_type, quantity, reason, transaction_id, staff_id, unit_price)
                 VALUES (?, 'in', ?, 'Refund reversal', ?, ?, ?)`
              ).run(o.item_id, o.quantity, refundId, session.userId, o.unit_price ?? null)
              db.prepare(`UPDATE ${items} SET current_stock = current_stock + ? WHERE id = ?`).run(
                o.quantity,
                o.item_id
              )
            }
          }
        }
        return refundId
      })

      const refundTransactionId = run()
      writeAudit(session.userId, 'transaction:refund', {
        originalId: original.id,
        amount: refundAmount,
        full: isFull,
        reason: reason || null
      })
      return {
        success: true,
        refundTransactionId,
        refundAmount,
        full: isFull,
        remaining: remaining - refundAmount
      }
    })
  )
}
