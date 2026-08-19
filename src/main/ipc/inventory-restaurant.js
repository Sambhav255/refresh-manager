import { ipcMain } from 'electron'
import { getDb } from '../db/index.js'
import { requireOwner, requireStaffOrOwner } from '../session.js'
import { requireAmount, requireRestockQuantity, requireText } from './utils.js'

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

const HISTORY_DEFAULT_LIMIT = 50
const HISTORY_MAX_LIMIT = 500

const MOVEMENT_LABELS = {
  restock: 'Restock',
  sale: 'Sale',
  adjustment: 'Adjustment',
  refund: 'Refund'
}

function movementKind(row) {
  if (row.txn_type === 'adjustment') return 'adjustment'
  if (row.txn_type === 'out') return 'sale'
  // A refund reversal is stored as an 'in' just like a delivery, but the stock
  // came back off a cancelled sale — labelling it "Restock" would tell the
  // owner a supplier delivered tea leaves that never arrived.
  return row.transaction_type === 'refund' ? 'refund' : 'restock'
}

function mapMovements(rows, currentStock) {
  // The table stores 'out' quantities as positive, so a sale has to be flipped
  // here: nobody can audit a stock drop that is printed as +2.
  const movements = rows.map((row) => {
    const kind = movementKind(row)
    return {
      id: row.id,
      at: row.created_at,
      txnType: row.txn_type,
      kind,
      label: MOVEMENT_LABELS[kind],
      quantity: Math.abs(row.quantity),
      delta: row.txn_type === 'out' ? -row.quantity : row.quantity,
      reason: row.reason || null,
      staffId: row.staff_id,
      staffName: row.staff_name || null,
      unitPrice: row.unit_price ?? null,
      transactionId: row.transaction_id || null,
      transactionAmount: row.transaction_amount ?? null,
      transactionType: row.transaction_type || null,
      customerName: row.customer_name || null,
      balance: null
    }
  })
  // Stock on hand is the only authoritative number, so the balance is walked
  // backwards from it: the newest movement is what produced today's figure, and
  // each older row ends where the next one started. Restaurant units are REAL
  // (kg, litres), so each step is rounded — otherwise 10 - 0.3 prints as
  // 9.699999999999999.
  let balance = currentStock
  for (const m of movements) {
    m.balance = Math.round(balance * 1000) / 1000
    balance -= m.delta
  }
  return movements
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
      const qty = requireRestockQuantity(quantity, { integerOnly: false })
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
      const adjustReason = requireText(reason, 'Reason')
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
        ).run(itemId, diff, adjustReason, session.userId)
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
      const itemName = requireText(name, 'Item name')
      const clash = getDb()
        .prepare(`SELECT id FROM restaurant_inventory_items WHERE is_active = 1 AND name = ?`)
        .get(itemName)
      if (clash) throw new Error(`"${itemName}" already exists — restock it instead.`)
      const result = getDb()
        .prepare(
          `INSERT INTO restaurant_inventory_items (name, category, unit, reorder_level, selling_price)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(
          itemName,
          requireText(category, 'Category'),
          unit?.trim() || 'pcs',
          requireAmount(reorderLevel, 'Reorder level', 5),
          requireAmount(sellingPrice, 'Selling price', 0)
        )
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
    'restaurant-inventory:history',
    // Every movement was written and none was readable: the owner could see
    // stock was 7 but never that it walked down from 20, who adjusted it, or
    // which sale took it. Owner-only, like adjust — it exposes staff names and
    // the money transaction behind each sale.
    wrap(({ itemId, limit } = {}) => {
      requireOwner()
      const db = getDb()
      const item = db
        .prepare(
          'SELECT id, name, unit, current_stock FROM restaurant_inventory_items WHERE id = ?'
        )
        .get(Number(itemId))
      if (!item) throw new Error('Item not found')
      const cap = Math.min(Number(limit) || HISTORY_DEFAULT_LIMIT, HISTORY_MAX_LIMIT)
      // Order by id, not created_at: created_at only has second resolution, so
      // two movements in the same second would come back in arbitrary order.
      const rows = db
        .prepare(
          `SELECT rit.id, rit.txn_type, rit.quantity, rit.reason, rit.staff_id, rit.unit_price,
                  rit.transaction_id, rit.created_at,
                  u.name AS staff_name,
                  t.amount AS transaction_amount, t.transaction_type, t.customer_name
           FROM restaurant_inventory_transactions rit
           LEFT JOIN users u ON u.id = rit.staff_id
           LEFT JOIN transactions t ON t.id = rit.transaction_id
           WHERE rit.item_id = ?
           ORDER BY rit.id DESC
           LIMIT ?`
        )
        .all(item.id, cap)
      return {
        item: {
          id: item.id,
          name: item.name,
          unit: item.unit || 'pcs',
          stock: item.current_stock
        },
        movements: mapMovements(rows, item.current_stock)
      }
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
