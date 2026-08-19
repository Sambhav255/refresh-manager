import { ipcMain } from 'electron'
import { getDb } from '../db/index.js'
import { requireOwner, requireStaffOrOwner } from '../session.js'
import { requireAmount, requireText } from './utils.js'

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
      const result = getDb()
        .prepare(
          `INSERT INTO restaurant_menu_items (name, category, price, sort_order, inventory_item_id)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(
          requireText(name, 'Name'),
          category || null,
          requireAmount(price, 'Price', 0),
          requireAmount(sortOrder, 'Sort order', 0),
          inventoryItemId || null
        )
      return { success: true, id: result.lastInsertRowid }
    })
  )

  ipcMain.handle(
    'restaurant-menu:update',
    // Partial update: only the fields present in the payload are written. This
    // used to be a full-row UPDATE, so a caller sending { id, price } silently
    // nulled the name, category, sort order and the inventory link. Callers
    // still MAY send every field — that keeps working — but no longer must.
    wrap((payload) => {
      requireOwner()
      const { id } = payload
      const columns = {
        name: 'name',
        category: 'category',
        price: 'price',
        sortOrder: 'sort_order',
        isActive: 'is_active',
        inventoryItemId: 'inventory_item_id'
      }
      const sets = []
      const vals = []
      for (const [key, col] of Object.entries(columns)) {
        if (!(key in payload)) continue
        const v = payload[key]
        let value
        if (key === 'name') value = requireText(v, 'Name')
        else if (key === 'price') value = requireAmount(v, 'Price')
        else if (key === 'sortOrder') value = requireAmount(v, 'Sort order', 0)
        else if (key === 'isActive') value = v ? 1 : 0
        else value = v || null
        sets.push(`${col} = ?`)
        vals.push(value)
      }
      if (!sets.length) return { success: true }
      vals.push(id)
      const res = getDb()
        .prepare(`UPDATE restaurant_menu_items SET ${sets.join(', ')} WHERE id = ?`)
        .run(...vals)
      if (res.changes === 0) throw new Error('Menu item not found')
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
        // Cap per line: unlinked items have no stock check, so an absurd qty
        // (1e21 passes Number.isInteger) would otherwise corrupt daily totals.
        if (!Number.isInteger(qty) || qty <= 0 || qty > 999) throw new Error('Invalid quantity')
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
            .prepare(
              `SELECT current_stock, name, is_active FROM restaurant_inventory_items WHERE id = ?`
            )
            .get(menuItem.inventory_item_id)
          // A dangling or deactivated link must stop the sale, not silently
          // skip the draw-down: a deactivated stock item is invisible in every
          // list and alert, so its stock would drain unnoticed.
          if (!stock) throw new Error(`Stock item missing for ${menuItem.name}`)
          if (!stock.is_active) {
            throw new Error(`${stock.name} is no longer stocked — ${menuItem.name} cannot be sold`)
          }
          // P0-4: never let stock go negative.
          if (qty > stock.current_stock) {
            throw new Error(`Not enough stock for ${stock.name}: only ${stock.current_stock} left`)
          }
          db.prepare(
            `INSERT INTO restaurant_inventory_transactions (item_id, txn_type, quantity, transaction_id, staff_id, unit_price)
             VALUES (?, 'out', ?, ?, ?, ?)`
          ).run(menuItem.inventory_item_id, qty, transactionId, staffId, menuItem.price)
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
