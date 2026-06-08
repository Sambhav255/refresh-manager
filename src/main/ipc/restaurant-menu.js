import { ipcMain } from 'electron'
import { getDb } from '../db/index.js'
import { getSession, requireOwner, requireStaffOrOwner } from '../session.js'

function wrap(handler) {
  return async (_event, payload) => {
    try {
      return await handler(payload || {})
    } catch (err) {
      return { success: false, error: err.message }
    }
  }
}

export function registerRestaurantMenuHandlers() {
  ipcMain.handle(
    'restaurant-menu:list',
    wrap(({ activeOnly = true } = {}) => {
      requireStaffOrOwner()
      let sql = `SELECT * FROM restaurant_menu_items`
      if (activeOnly) sql += ` WHERE is_active = 1`
      sql += ` ORDER BY sort_order, name`
      const items = getDb().prepare(sql).all()
      return { items }
    })
  )

  ipcMain.handle(
    'restaurant-menu:add',
    wrap(({ name, category, price, sortOrder }) => {
      requireOwner()
      if (!name) throw new Error('Name is required')
      const result = getDb()
        .prepare(
          `INSERT INTO restaurant_menu_items (name, category, price, sort_order) VALUES (?, ?, ?, ?)`
        )
        .run(name, category || null, price ?? 0, sortOrder ?? 0)
      return { success: true, id: result.lastInsertRowid }
    })
  )

  ipcMain.handle(
    'restaurant-menu:update',
    wrap(({ id, name, category, price, sortOrder, isActive }) => {
      requireOwner()
      getDb()
        .prepare(
          `UPDATE restaurant_menu_items SET name = ?, category = ?, price = ?, sort_order = ?, is_active = ? WHERE id = ?`
        )
        .run(name, category || null, price ?? 0, sortOrder ?? 0, isActive ? 1 : 0, id)
      return { success: true }
    })
  )

  ipcMain.handle(
    'restaurant-menu:toggle',
    wrap(({ id, isActive }) => {
      requireOwner()
      getDb()
        .prepare(`UPDATE restaurant_menu_items SET is_active = ? WHERE id = ?`)
        .run(isActive ? 1 : 0, id)
      return { success: true }
    })
  )

  ipcMain.handle(
    'restaurant:checkout',
    wrap(({ items, paymentMethod, customerName, staffId }) => {
      const session = requireStaffOrOwner()
      if (!items?.length) throw new Error('Cart is empty')

      const db = getDb()
      const pay = paymentMethod?.toLowerCase() === 'qr' ? 'qr' : 'cash'
      const total = items.reduce((s, i) => s + i.price * i.quantity, 0)
      const name = customerName || 'Walk-in'
      const sid = staffId || session.userId

      const notes = items.map((i) => `${i.name} x${i.quantity}`).join(', ')

      const result = db
        .prepare(
          `INSERT INTO transactions
           (transaction_type, source, customer_name, amount, payment_method, staff_id, notes)
           VALUES ('restaurant', 'restaurant', ?, ?, ?, ?, ?)`
        )
        .run(name, total, pay, sid, notes)

      return {
        success: true,
        transactionId: result.lastInsertRowid,
        total,
        paymentMethod: pay
      }
    })
  )
}
