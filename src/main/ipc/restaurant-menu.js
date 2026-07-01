import { ipcMain } from 'electron'
import { getDb } from '../db/index.js'
import { requireOwner, requireStaffOrOwner } from '../session.js'

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
    wrap(({ name, category, price, sortOrder, inventoryItemId }) => {
      requireOwner()
      if (!name) throw new Error('Name is required')
      const result = getDb()
        .prepare(
          `INSERT INTO restaurant_menu_items (name, category, price, sort_order, inventory_item_id)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(name, category || null, price ?? 0, sortOrder ?? 0, inventoryItemId || null)
      return { success: true, id: result.lastInsertRowid }
    })
  )

  ipcMain.handle(
    'restaurant-menu:update',
    wrap(({ id, name, category, price, sortOrder, isActive, inventoryItemId }) => {
      requireOwner()
      getDb()
        .prepare(
          `UPDATE restaurant_menu_items
           SET name = ?, category = ?, price = ?, sort_order = ?, is_active = ?, inventory_item_id = ?
           WHERE id = ?`
        )
        .run(
          name,
          category || null,
          price ?? 0,
          sortOrder ?? 0,
          isActive ? 1 : 0,
          inventoryItemId || null,
          id
        )
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
    // P0-1: staff id comes from the session, never the payload. P0-1: line
    // prices are looked up from the catalogue, never trusted from the cart.
    // P0-2: the sale and any linked stock draw-down happen in one DB transaction.
    wrap(({ items, paymentMethod, customerName }) => {
      const session = requireStaffOrOwner()
      const staffId = session.userId
      if (!items?.length) throw new Error('Cart is empty')

      const db = getDb()
      const pay = paymentMethod?.toLowerCase() === 'qr' ? 'qr' : 'cash'
      const name = customerName || 'Walk-in'

      // Resolve every cart line against the catalogue up front: reject unknown
      // or inactive items, and use the catalogue price (ignore any payload price).
      const menuStmt = db.prepare(`SELECT * FROM restaurant_menu_items WHERE id = ?`)
      const lines = items.map((i) => {
        const qty = Number(i.quantity)
        if (!Number.isInteger(qty) || qty <= 0) throw new Error('Invalid quantity')
        const menuItem = menuStmt.get(i.id)
        if (!menuItem) throw new Error(`Menu item not found: ${i.name || i.id}`)
        if (!menuItem.is_active) throw new Error(`Item unavailable: ${menuItem.name}`)
        return { menuItem, qty }
      })

      const total = lines.reduce((s, l) => s + l.menuItem.price * l.qty, 0)
      const notes = lines.map((l) => `${l.menuItem.name} x${l.qty}`).join(', ')

      const run = db.transaction(() => {
        const result = db
          .prepare(
            `INSERT INTO transactions
             (transaction_type, source, customer_name, amount, payment_method, staff_id, notes)
             VALUES ('restaurant', 'restaurant', ?, ?, ?, ?, ?)`
          )
          .run(name, total, pay, staffId, notes)
        const transactionId = result.lastInsertRowid

        // P0-2 Phase A: draw down 1:1 for any line linked to a stock item.
        for (const { menuItem, qty } of lines) {
          if (!menuItem.inventory_item_id) continue
          const stock = db
            .prepare(`SELECT current_stock, name FROM restaurant_inventory_items WHERE id = ?`)
            .get(menuItem.inventory_item_id)
          if (!stock) continue
          // P0-4: never let stock go negative.
          if (qty > stock.current_stock) {
            throw new Error(`Not enough stock for ${stock.name}: only ${stock.current_stock} left`)
          }
          db.prepare(
            `INSERT INTO restaurant_inventory_transactions (item_id, txn_type, quantity, transaction_id, staff_id)
             VALUES (?, 'out', ?, ?, ?)`
          ).run(menuItem.inventory_item_id, qty, transactionId, staffId)
          db.prepare(
            `UPDATE restaurant_inventory_items SET current_stock = current_stock - ? WHERE id = ?`
          ).run(qty, menuItem.inventory_item_id)
        }

        return transactionId
      })

      const transactionId = run()

      return {
        success: true,
        transactionId,
        total,
        paymentMethod: pay
      }
    })
  )
}
