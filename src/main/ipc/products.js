import { ipcMain } from 'electron'
import { getDb } from '../db/index.js'
import { requireOwner, requireStaffOrOwner } from '../session.js'
import { productDisplayName, requireAmount, requireText } from './utils.js'

function wrap(handler) {
  return async (_event, payload) => {
    try {
      return await handler(payload || {})
    } catch (err) {
      return { success: false, error: err.message }
    }
  }
}

export function registerProductHandlers() {
  ipcMain.handle(
    'products:list',
    wrap(({ category, activeOnly = true }) => {
      requireStaffOrOwner()
      let sql = 'SELECT * FROM products WHERE 1=1'
      const params = []
      if (activeOnly) {
        sql += ' AND is_active = 1'
      }
      if (category) {
        sql += ' AND category = ?'
        params.push(category)
      }
      sql += ' ORDER BY category, name, duration_days'
      const products = getDb()
        .prepare(sql)
        .all(...params)
        .map((p) => ({
          ...p,
          displayName: productDisplayName(p)
        }))
      return { products }
    })
  )

  ipcMain.handle(
    'products:update-price',
    wrap(({ productId, newPrice }) => {
      const session = requireOwner()
      // Without this an undefined/blank price reached the driver as a raw bind
      // error, and a negative price would have been written straight through.
      const price = requireAmount(newPrice, 'Price')
      const db = getDb()
      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId)
      if (!product) throw new Error('Product not found')

      const tx = db.transaction(() => {
        db.prepare(
          `INSERT INTO price_history (product_id, old_price, new_price, changed_by) VALUES (?, ?, ?, ?)`
        ).run(productId, product.price, price, session.userId)
        db.prepare(
          `UPDATE products SET price = ?, updated_at = datetime('now','localtime') WHERE id = ?`
        ).run(price, productId)
      })
      tx()
      return { success: true }
    })
  )

  ipcMain.handle(
    'products:add',
    wrap(({ name, category, subCategory, durationDays, price }) => {
      requireOwner()
      const result = getDb()
        .prepare(
          `INSERT INTO products (name, category, sub_category, duration_days, price) VALUES (?, ?, ?, ?, ?)`
        )
        .run(
          requireText(name, 'Product name'),
          requireText(category, 'Category'),
          subCategory || null,
          durationDays ?? null,
          requireAmount(price, 'Price', 0)
        )
      return { success: true, productId: result.lastInsertRowid }
    })
  )

  ipcMain.handle(
    'products:toggle-active',
    wrap(({ productId, isActive }) => {
      requireOwner()
      getDb()
        .prepare(`UPDATE products SET is_active = ? WHERE id = ?`)
        .run(isActive ? 1 : 0, productId)
      return { success: true }
    })
  )

  // Sales counts per product over the last 60 days so the staff "New
  // Transaction" picker can default to what actually gets sold most.
  // Voided sales, refund rows and sales that have been refunded are excluded.
  ipcMain.handle(
    'products:popularity',
    wrap(() => {
      requireStaffOrOwner()
      const rows = getDb()
        .prepare(
          `SELECT t.product_id AS product_id, COUNT(*) AS count
           FROM transactions t
           WHERE t.product_id IS NOT NULL
             AND t.is_voided = 0
             AND t.transaction_type != 'refund'
             AND NOT EXISTS (
               SELECT 1 FROM transactions r
               WHERE r.refunds_transaction_id = t.id AND r.is_voided = 0
             )
             AND date(t.created_at) >= date('now','localtime','-60 days')
           GROUP BY t.product_id
           ORDER BY count DESC, t.product_id`
        )
        .all()
      return {
        success: true,
        counts: rows.map((r) => ({ productId: r.product_id, count: r.count }))
      }
    })
  )

  ipcMain.handle(
    'products:price-history',
    wrap(({ productId }) => {
      requireOwner()
      const history = getDb()
        .prepare(
          `SELECT ph.*, u.name as changed_by_name
           FROM price_history ph
           JOIN users u ON u.id = ph.changed_by
           WHERE ph.product_id = ?
           ORDER BY ph.changed_at DESC
           LIMIT 20`
        )
        .all(productId)
      return { history }
    })
  )
}
