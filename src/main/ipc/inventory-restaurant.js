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

function mapRestaurantItem(row) {
  const low = row.current_stock <= row.reorder_level
  return {
    id: row.id,
    item: row.name,
    name: row.name,
    category: row.category,
    unit: row.unit || 'pcs',
    stock: row.current_stock,
    current_stock: row.current_stock,
    reorder: row.reorder_level,
    reorder_level: row.reorder_level,
    price: row.selling_price,
    selling_price: row.selling_price,
    low
  }
}

export function registerRestaurantInventoryHandlers() {
  ipcMain.handle(
    'restaurant-inventory:list',
    wrap(({ category } = {}) => {
      requireStaffOrOwner()
      let sql = 'SELECT * FROM restaurant_inventory_items WHERE is_active = 1'
      const params = []
      if (category) {
        sql += ' AND category = ?'
        params.push(category)
      }
      sql += ' ORDER BY category, name'
      const items = getDb()
        .prepare(sql)
        .all(...params)
        .map(mapRestaurantItem)
      return { items }
    })
  )

  ipcMain.handle(
    'restaurant-inventory:restock',
    // P0-1: staff id from session, never payload. Quantity must be a positive
    // finite number (restaurant units can be fractional, e.g. kg).
    wrap(({ itemId, quantity }) => {
      const session = requireStaffOrOwner()
      const qty = Number(quantity)
      if (!Number.isFinite(qty) || qty <= 0) throw new Error('Invalid quantity')
      const db = getDb()
      const tx = db.transaction(() => {
        db.prepare(
          `INSERT INTO restaurant_inventory_transactions (item_id, txn_type, quantity, reason, staff_id)
           VALUES (?, 'in', ?, 'Restock', ?)`
        ).run(itemId, qty, session.userId)
        db.prepare(
          `UPDATE restaurant_inventory_items SET current_stock = current_stock + ? WHERE id = ?`
        ).run(qty, itemId)
      })
      tx()
      const item = db
        .prepare('SELECT current_stock FROM restaurant_inventory_items WHERE id = ?')
        .get(itemId)
      return { success: true, newStock: item.current_stock }
    })
  )

  ipcMain.handle(
    'restaurant-inventory:sell',
    // P0-1: staff id from session. P0-4: refuse to drive stock negative, and a
    // negative quantity must never sneak stock IN through an 'out' row.
    wrap(({ itemId, quantity, transactionId }) => {
      const session = requireStaffOrOwner()
      const qty = Number(quantity)
      if (!Number.isFinite(qty) || qty <= 0) throw new Error('Invalid quantity')
      const db = getDb()
      const tx = db.transaction(() => {
        const item = db
          .prepare('SELECT current_stock, name FROM restaurant_inventory_items WHERE id = ?')
          .get(itemId)
        if (!item) throw new Error('Item not found')
        if (qty > item.current_stock) {
          throw new Error(`Not enough stock: only ${item.current_stock} left`)
        }
        db.prepare(
          `INSERT INTO restaurant_inventory_transactions (item_id, txn_type, quantity, transaction_id, staff_id)
           VALUES (?, 'out', ?, ?, ?)`
        ).run(itemId, qty, transactionId || null, session.userId)
        db.prepare(
          `UPDATE restaurant_inventory_items SET current_stock = current_stock - ? WHERE id = ?`
        ).run(qty, itemId)
      })
      tx()
      return { success: true }
    })
  )

  ipcMain.handle(
    'restaurant-inventory:adjust',
    // P0-1: staff id from session. P0-4: an adjustment may set any value, never
    // a negative one.
    wrap(({ itemId, newQuantity, reason }) => {
      const session = requireOwner()
      const target = Number(newQuantity)
      if (!Number.isFinite(target) || target < 0) throw new Error('Stock cannot be negative')
      const db = getDb()
      const current = db
        .prepare('SELECT current_stock FROM restaurant_inventory_items WHERE id = ?')
        .get(itemId)
      if (!current) throw new Error('Item not found')
      const diff = target - current.current_stock
      const tx = db.transaction(() => {
        db.prepare(
          `INSERT INTO restaurant_inventory_transactions (item_id, txn_type, quantity, reason, staff_id)
           VALUES (?, 'adjustment', ?, ?, ?)`
        ).run(itemId, diff, reason, session.userId)
        db.prepare(`UPDATE restaurant_inventory_items SET current_stock = ? WHERE id = ?`).run(
          target,
          itemId
        )
      })
      tx()
      return { success: true }
    })
  )

  ipcMain.handle(
    'restaurant-inventory:add-item',
    wrap(({ name, category, unit, reorderLevel, sellingPrice }) => {
      requireOwner()
      const result = getDb()
        .prepare(
          `INSERT INTO restaurant_inventory_items (name, category, unit, reorder_level, selling_price)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(name, category, unit || 'pcs', reorderLevel ?? 5, sellingPrice ?? 0)
      return { success: true, itemId: result.lastInsertRowid }
    })
  )

  ipcMain.handle(
    'restaurant-inventory:update',
    wrap(({ itemId, fields }) => {
      requireOwner()
      const allowed = ['name', 'category', 'unit', 'reorder_level', 'selling_price', 'is_active']
      const sets = []
      const vals = []
      for (const [k, v] of Object.entries(fields || {})) {
        const col = k.replace(/([A-Z])/g, '_$1').toLowerCase()
        if (allowed.includes(col)) {
          sets.push(`${col} = ?`)
          vals.push(v)
        }
      }
      if (!sets.length) return { success: true }
      vals.push(itemId)
      getDb()
        .prepare(`UPDATE restaurant_inventory_items SET ${sets.join(', ')} WHERE id = ?`)
        .run(...vals)
      return { success: true }
    })
  )

  ipcMain.handle(
    'restaurant-inventory:low-stock',
    wrap(() => {
      requireStaffOrOwner()
      const items = getDb()
        .prepare(
          `SELECT * FROM restaurant_inventory_items
           WHERE is_active = 1 AND current_stock <= reorder_level
           ORDER BY current_stock`
        )
        .all()
        .map(mapRestaurantItem)
      return { items }
    })
  )
}
