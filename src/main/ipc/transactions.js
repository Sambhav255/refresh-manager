import { ipcMain } from 'electron'
import { getDb } from '../db/index.js'
import { requireOwner, requireStaffOrOwner } from '../session.js'
import { formatTime, productDisplayName, productFromRow, todayLocal } from './utils.js'
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
    // Restaurant/pool sales have no product_id; their notes ("Tea x2") read
    // better than the raw transaction_type.
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
    // Lets the refund dialog default to what is actually still refundable
    // instead of the original amount, which errored on a second partial refund.
    // Undefined for callers whose query does not compute it.
    refundedSoFar: row.refunded_so_far ?? undefined,
    remaining: row.refunded_so_far == null ? undefined : row.amount - row.refunded_so_far
  }
}

// Puts back every unit a transaction took off the shelf, as new 'in' rows
// rather than by deleting the originals — the movement history has to keep
// showing that stock went out and came back.
//
// Used by BOTH the refund path and the void path. Void previously did nothing
// here, so a voided sale reversed the money and left the stock decremented
// forever: the shelf count drifted down on what is a routine till correction.
//
// `linkTransactionId` is the row the reversal belongs to — the refund for a
// refund, the original itself for a void (a void mints no new transaction).
function restoreStockFor(db, { originalId, linkTransactionId, staffId, reason }) {
  for (const table of ['pool_inventory_transactions', 'restaurant_inventory_transactions']) {
    const items =
      table === 'pool_inventory_transactions'
        ? 'pool_inventory_items'
        : 'restaurant_inventory_items'
    const outs = db
      .prepare(
        `SELECT item_id, quantity, unit_price FROM ${table} WHERE transaction_id = ? AND txn_type = 'out'`
      )
      .all(originalId)
    for (const o of outs) {
      // Carry the original sale's unit price onto the reversal so the turnover
      // report nets it at the price actually charged, not today's price.
      db.prepare(
        `INSERT INTO ${table} (item_id, txn_type, quantity, reason, transaction_id, staff_id, unit_price)
         VALUES (?, 'in', ?, ?, ?, ?, ?)`
      ).run(o.item_id, o.quantity, reason, linkTransactionId, staffId, o.unit_price ?? null)
      db.prepare(`UPDATE ${items} SET current_stock = current_stock + ? WHERE id = ?`).run(
        o.quantity,
        o.item_id
      )
    }
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
    wrap(
      ({
        dateFrom,
        dateTo,
        type,
        source,
        staffId,
        paymentMethod,
        includeVoided = false,
        limit,
        offset = 0
      }) => {
        requireStaffOrOwner()
        // Voided rows are hidden by default (every existing caller relies on
        // that), but are reachable on request — otherwise a void leaves no
        // trace anywhere except the audit log.
        let sql = `
        SELECT t.*, p.name as product_name, p.category, p.duration_days, p.sub_category,
               u.name as staff_name,
               (SELECT COALESCE(-SUM(r.amount), 0) FROM transactions r
                 WHERE r.refunds_transaction_id = t.id AND r.is_voided = 0) AS refunded_so_far
        FROM transactions t
        LEFT JOIN products p ON p.id = t.product_id
        JOIN users u ON u.id = t.staff_id
        WHERE 1=1
      `
        if (!includeVoided) sql += ` AND t.is_voided = 0`
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
        const db = getDb()
        // totalCount is the size of the FILTERED set, before paging, so the UI
        // can show "showing 10 of 240" and page without a second guess.
        const totalCount = db.prepare(`SELECT COUNT(*) AS n FROM (${sql})`).get(...params).n

        // id breaks the tie: many transactions share a created_at second, and
        // without it SQLite may return the same rows in a different order per
        // query plan, which looks like rows moving when a filter is applied.
        sql += ' ORDER BY t.created_at DESC, t.id DESC'
        const pageParams = [...params]
        if (limit != null) {
          sql += ' LIMIT ? OFFSET ?'
          pageParams.push(Number(limit), Number(offset) || 0)
        }
        const transactions = db
          .prepare(sql)
          .all(...pageParams)
          .map(mapTransaction)
        return { transactions, totalCount }
      }
    )
  )

  ipcMain.handle(
    'transactions:today-summary',
    // The breakdown is derived from LINES, and cash/QR from PAYMENTS, not from
    // the header columns.
    //
    // A sale can now hold several kinds of thing and be settled with more than
    // one method, but the header still carries a single transaction_type and a
    // single payment_method for backward compatibility. Reading those meant a
    // day pass rung up with a pair of goggles reported the goggles as entry
    // revenue, and a sale split 100 cash / 100 QR reported 200 cash — which
    // would have had the End-of-Day cash count short by the QR half on every
    // split payment.
    //
    // Transactions with no lines/payments of their own (refunds, and anything
    // written before the sale model) fall back to their header, so nothing
    // drops out of the totals.
    wrap(({ source } = {}) => {
      requireStaffOrOwner()
      const today = todayLocal()
      const db = getDb()
      const filter = source ? ' AND t.source = ?' : ''
      const params = source ? [today, source] : [today]

      let cash = 0
      let qr = 0
      const byType = {}
      const bySource = { pool: 0, restaurant: 0 }

      // Header rows: the sale totals and the count are still authoritative.
      const headers = db
        .prepare(
          `SELECT t.id, t.transaction_type, t.source, t.payment_method, t.amount
           FROM transactions t
           WHERE t.is_voided = 0 AND date(t.created_at) = ?${filter}`
        )
        .all(...params)

      const grand = headers.reduce((s, h) => s + h.amount, 0)
      for (const h of headers) bySource[h.source] = (bySource[h.source] || 0) + h.amount

      // Revenue by kind, from the lines where a sale has them.
      const lineRows = db
        .prepare(
          `SELECT l.kind, l.ref_id, p.category, SUM(l.line_total) AS amount
           FROM transaction_lines l
           JOIN transactions t ON t.id = l.transaction_id
           LEFT JOIN products p ON p.id = l.ref_id AND l.kind IN ('product','membership')
           WHERE t.is_voided = 0 AND date(t.created_at) = ?${filter}
           GROUP BY l.kind, l.ref_id, p.category`
        )
        .all(...params)
      for (const r of lineRows) {
        // A catalogue line reports under the product's own category (day_pass,
        // day_package, membership); stock and menu lines under their own kind.
        const type =
          r.kind === 'pool_item'
            ? 'pool_inventory'
            : r.kind === 'menu_item'
              ? 'restaurant'
              : r.category || r.kind
        byType[type] = (byType[type] || 0) + r.amount
      }

      // Anything with no lines keeps reporting under its header type.
      const unlined = db
        .prepare(
          `SELECT t.transaction_type, SUM(t.amount) AS amount
           FROM transactions t
           WHERE t.is_voided = 0 AND date(t.created_at) = ?${filter}
             AND NOT EXISTS (SELECT 1 FROM transaction_lines l WHERE l.transaction_id = t.id)
           GROUP BY t.transaction_type`
        )
        .all(...params)
      for (const r of unlined)
        byType[r.transaction_type] = (byType[r.transaction_type] || 0) + r.amount

      // Cash/QR from the payments actually taken.
      const payRows = db
        .prepare(
          `SELECT pm.payment_method, SUM(pm.amount) AS amount
           FROM transaction_payments pm
           JOIN transactions t ON t.id = pm.transaction_id
           WHERE t.is_voided = 0 AND date(t.created_at) = ?${filter}
           GROUP BY pm.payment_method`
        )
        .all(...params)
      for (const r of payRows) {
        if (r.payment_method === 'cash') cash += r.amount
        else qr += r.amount
      }

      // …and from the header for rows that predate the sale model, and for
      // refunds (negative, and they carry no payment row).
      //
      // Keyed on having no LINES, not on having no payments: a sale-model sale
      // deliberately taken on account has no payment rows yet, and must count
      // as zero collected — falling back to its header would put uncollected
      // money in the drawer count.
      const unpaid = db
        .prepare(
          `SELECT t.payment_method, SUM(t.amount) AS amount
           FROM transactions t
           WHERE t.is_voided = 0 AND date(t.created_at) = ?${filter}
             AND NOT EXISTS (SELECT 1 FROM transaction_lines l WHERE l.transaction_id = t.id)
             AND NOT EXISTS (SELECT 1 FROM transaction_payments pm WHERE pm.transaction_id = t.id)
           GROUP BY t.payment_method`
        )
        .all(...params)
      for (const r of unpaid) {
        if (r.payment_method === 'cash') cash += r.amount
        else qr += r.amount
      }

      return { total: grand, cash, qr, byType, bySource, count: headers.length }
    })
  )

  ipcMain.handle(
    'transactions:void',
    wrap(({ transactionId, reason, confirmReconciled = false }) => {
      const session = requireOwner()
      const db = getDb()
      const txn = db
        .prepare(
          `SELECT id, amount, is_voided, transaction_type, date(created_at) as day FROM transactions WHERE id = ?`
        )
        .get(transactionId)
      if (!txn) throw new Error('Transaction not found')
      if (txn.is_voided) throw new Error('Transaction is already voided')

      // Voiding a refund would drop the negative correction out of every
      // WHERE is_voided = 0 total, resurrecting the original sale as revenue
      // the business has already paid back. Mirrors the 'Cannot refund a
      // refund' guard on the refund handler.
      if (txn.transaction_type === 'refund') {
        throw new Error(
          'Cannot void a refund. Refunds are corrections and must stay on the ledger.'
        )
      }

      // A booking deposit belongs to its booking, which stores deposit_paid and
      // a link to this row. Voiding the transaction on its own removed the money
      // from revenue while the booking carried on claiming the deposit had been
      // paid — so staff would collect only the "balance" and the business would
      // be short by the deposit, with nothing in the system disagreeing.
      // Editing the deposit on the booking keeps both sides in step.
      if (txn.transaction_type === 'booking_deposit') {
        throw new Error(
          'This is a booking deposit. Change or clear the deposit on the booking itself so the booking and the ledger stay in step.'
        )
      }

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

      // Flag and stock reversal move together: a void that reversed the money
      // but not the stock is what made the shelf count drift.
      db.transaction(() => {
        db.prepare(
          `UPDATE transactions SET is_voided = 1, void_reason = ?, void_by = ?, void_at = datetime('now','localtime') WHERE id = ?`
        ).run(reason, session.userId, transactionId)
        // A void says the sale never happened, so the whole movement reverses —
        // unlike a partial refund, there is no question of how much to put back.
        restoreStockFor(db, {
          originalId: transactionId,
          linkTransactionId: transactionId,
          staffId: session.userId,
          reason: 'Void reversal'
        })
        // A voided membership sale must not leave the member with access.
        db.prepare(
          `UPDATE memberships SET status = 'cancelled' WHERE transaction_id = ? AND status != 'cancelled'`
        ).run(transactionId)
      })()
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

        // A full refund reverses the whole sale: restore stock AND cancel any
        // membership it bought, so the member is not left with access they
        // were paid back for. A partial refund is a price adjustment, not a
        // cancellation, and maps to no whole units of stock — so neither runs.
        if (isFull) {
          db.prepare(
            `UPDATE memberships SET status = 'cancelled' WHERE transaction_id = ? AND status != 'cancelled'`
          ).run(original.id)

          restoreStockFor(db, {
            originalId: original.id,
            linkTransactionId: refundId,
            staffId: session.userId,
            reason: 'Refund reversal'
          })
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
