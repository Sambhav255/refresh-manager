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

function mapPoolItem(row) {
  const low = row.current_stock <= row.reorder_level
  return {
    id: row.id,
    item: row.name,
    name: row.name,
    category: row.category,
    variant: row.variant || '—',
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
  // came back off a cancelled sale — reading it as "Restock" would make the
  // owner think somebody bought more goggles.
  return row.transaction_type === 'refund' ? 'refund' : 'restock'
}

function mapMovements(rows, currentStock) {
  // The table stores 'out' quantities as positive, so a sale has to be flipped
  // here: nobody can audit a stock drop that is printed as +3.
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
  // each older row ends where the next one started. This also stays correct
  // when `limit` truncates the tail.
  let balance = currentStock
  for (const m of movements) {
    m.balance = Math.round(balance * 1000) / 1000
    balance -= m.delta
  }
  return movements
}

export function registerPoolInventoryHandlers() {
  ipcMain.handle(
    'pool-inventory:list',
    wrap(({ category } = {}) => {
      requireStaffOrOwner()
      let sql = 'SELECT * FROM pool_inventory_items WHERE is_active = 1'
      const params = []
      if (category) {
        sql += ' AND category = ?'
        params.push(category)
      }
      sql += ' ORDER BY category, name, variant'
      const items = getDb()
        .prepare(sql)
        .all(...params)
        .map(mapPoolItem)
      return { items }
    })
  )

  ipcMain.handle(
    'pool-inventory:restock',
    // P0-1: staff id from session, never payload. Quantity must be a positive
    // integer — a negative restock must never silently decrease stock.
    wrap(({ itemId, quantity }) => {
      const session = requireStaffOrOwner()
      const qty = requireRestockQuantity(quantity, { integerOnly: true })
      const db = getDb()
      const tx = db.transaction(() => {
        db.prepare(
          `INSERT INTO pool_inventory_transactions (item_id, txn_type, quantity, reason, staff_id)
           VALUES (?, 'in', ?, 'Restock', ?)`
        ).run(itemId, qty, session.userId)
        db.prepare(
          `UPDATE pool_inventory_items SET current_stock = current_stock + ? WHERE id = ?`
        ).run(qty, itemId)
      })
      tx()
      const item = db
        .prepare('SELECT current_stock FROM pool_inventory_items WHERE id = ?')
        .get(itemId)
      return { success: true, newStock: item.current_stock }
    })
  )

  ipcMain.handle(
    'pool-inventory:sell',
    // P0-1: staff id from session. P0-4: refuse to drive stock negative.
    wrap(({ itemId, quantity, transactionId }) => {
      const session = requireStaffOrOwner()
      const staffId = session.userId
      const qty = Number(quantity)
      if (!Number.isInteger(qty) || qty <= 0) throw new Error('Invalid quantity')
      const db = getDb()
      const tx = db.transaction(() => {
        const item = db
          .prepare(
            'SELECT current_stock, name, selling_price FROM pool_inventory_items WHERE id = ?'
          )
          .get(itemId)
        if (!item) throw new Error('Item not found')
        if (qty > item.current_stock) {
          throw new Error(`Not enough stock: only ${item.current_stock} left`)
        }
        db.prepare(
          `INSERT INTO pool_inventory_transactions (item_id, txn_type, quantity, transaction_id, staff_id, unit_price)
           VALUES (?, 'out', ?, ?, ?, ?)`
        ).run(itemId, qty, transactionId || null, staffId, item.selling_price ?? null)
        db.prepare(
          `UPDATE pool_inventory_items SET current_stock = current_stock - ? WHERE id = ?`
        ).run(qty, itemId)
      })
      tx()
      return { success: true }
    })
  )

  ipcMain.handle(
    'pool-inventory:sell-item',
    // P2-1: staff-facing sale of a pool inventory item (goggles, caps, …).
    // Creates the money transaction AND the stock draw-down in ONE DB
    // transaction. P0-1: amount and staff are derived server-side. P0-4: guarded.
    wrap(({ itemId, quantity, paymentMethod, customerName }) => {
      const session = requireStaffOrOwner()
      const staffId = session.userId
      const qty = Number(quantity)
      if (!Number.isInteger(qty) || qty <= 0 || qty > 999) throw new Error('Invalid quantity')

      const db = getDb()
      const item = db.prepare('SELECT * FROM pool_inventory_items WHERE id = ?').get(itemId)
      if (!item || !item.is_active) throw new Error('Item not available')
      if (!(item.selling_price > 0)) throw new Error('Item has no selling price')

      const pay = paymentMethod?.toLowerCase() === 'qr' ? 'qr' : 'cash'
      const amount = qty * item.selling_price
      const name = customerName || 'Walk-in'
      const label = item.variant ? `${item.name} (${item.variant})` : item.name

      const run = db.transaction(() => {
        if (qty > item.current_stock) {
          throw new Error(`Not enough stock: only ${item.current_stock} left`)
        }
        const result = db
          .prepare(
            `INSERT INTO transactions
             (transaction_type, source, customer_name, amount, payment_method, staff_id, notes)
             VALUES ('pool_inventory', 'pool', ?, ?, ?, ?, ?)`
          )
          .run(name, amount, pay, staffId, `${label} x${qty}`)
        const transactionId = result.lastInsertRowid
        db.prepare(
          `INSERT INTO pool_inventory_transactions (item_id, txn_type, quantity, transaction_id, staff_id, unit_price)
           VALUES (?, 'out', ?, ?, ?, ?)`
        ).run(itemId, qty, transactionId, staffId, item.selling_price)
        db.prepare(
          `UPDATE pool_inventory_items SET current_stock = current_stock - ? WHERE id = ?`
        ).run(qty, itemId)
        return transactionId
      })

      const transactionId = run()
      return { success: true, transactionId, total: amount, paymentMethod: pay }
    })
  )

  ipcMain.handle(
    'pool-inventory:adjust',
    // P0-1: staff id from session, never payload.
    wrap(({ itemId, newQuantity, reason }) => {
      const session = requireOwner()
      // P0-4: an adjustment is a deliberate correction to any value, but the
      // resulting stock may never be negative.
      const target = Number(newQuantity)
      if (!Number.isInteger(target) || target < 0) throw new Error('Stock cannot be negative')
      // An unexplained stock correction is the one movement nobody can audit
      // later — require the reason the UI already asks for.
      const adjustReason = requireText(reason, 'Reason')
      const db = getDb()
      const current = db
        .prepare('SELECT current_stock FROM pool_inventory_items WHERE id = ?')
        .get(itemId)
      if (!current) throw new Error('Item not found')
      const diff = target - current.current_stock
      const tx = db.transaction(() => {
        db.prepare(
          `INSERT INTO pool_inventory_transactions (item_id, txn_type, quantity, reason, staff_id)
           VALUES (?, 'adjustment', ?, ?, ?)`
        ).run(itemId, diff, adjustReason, session.userId)
        db.prepare(`UPDATE pool_inventory_items SET current_stock = ? WHERE id = ?`).run(
          target,
          itemId
        )
      })
      tx()
      return { success: true }
    })
  )

  ipcMain.handle(
    'pool-inventory:add-item',
    wrap(({ name, category, variant, reorderLevel, sellingPrice }) => {
      requireOwner()
      const itemName = requireText(name, 'Item name')
      const itemVariant = variant?.trim() || null
      // There is no delete control, so a duplicate is permanent — and staff
      // then have to guess which of two identical rows to sell. Only ACTIVE
      // items collide; re-adding a retired item is legitimate.
      const clash = getDb()
        .prepare(
          `SELECT id FROM pool_inventory_items
           WHERE is_active = 1 AND name = ? AND IFNULL(variant, '') = IFNULL(?, '')`
        )
        .get(itemName, itemVariant)
      if (clash) {
        throw new Error(
          `"${itemName}"${itemVariant ? ` (${itemVariant})` : ''} already exists — restock it instead.`
        )
      }
      const result = getDb()
        .prepare(
          `INSERT INTO pool_inventory_items (name, category, variant, reorder_level, selling_price)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(
          itemName,
          requireText(category, 'Category'),
          itemVariant,
          requireAmount(reorderLevel, 'Reorder level', 5),
          requireAmount(sellingPrice, 'Selling price', 0)
        )
      return { success: true, itemId: result.lastInsertRowid }
    })
  )

  ipcMain.handle(
    'pool-inventory:update',
    wrap(({ itemId, fields }) => {
      requireOwner()
      const allowed = ['name', 'category', 'variant', 'reorder_level', 'selling_price', 'is_active']
      const sets = []
      const vals = []
      for (const [k, v] of Object.entries(fields || {})) {
        const col = k.replace(/([A-Z])/g, '_$1').toLowerCase()
        if (!allowed.includes(col)) continue
        let value = v
        if (col === 'selling_price') value = requireAmount(v, 'Selling price')
        else if (col === 'reorder_level') value = requireAmount(v, 'Reorder level')
        else if (col === 'name') value = requireText(v, 'Item name')
        else if (col === 'category') value = requireText(v, 'Category')
        sets.push(`${col} = ?`)
        vals.push(value)
      }
      if (!sets.length) return { success: true }
      vals.push(itemId)
      const res = getDb()
        .prepare(`UPDATE pool_inventory_items SET ${sets.join(', ')} WHERE id = ?`)
        .run(...vals)
      if (res.changes === 0) throw new Error('Item not found')
      return { success: true }
    })
  )

  ipcMain.handle(
    'pool-inventory:history',
    // Every movement was written and none was readable: the owner could see
    // stock was 7 but never that it walked down from 20, who adjusted it, or
    // which sale took it. Owner-only, like adjust — it exposes staff names and
    // the money transaction behind each sale.
    wrap(({ itemId, limit } = {}) => {
      requireOwner()
      const db = getDb()
      const item = db
        .prepare('SELECT id, name, variant, current_stock FROM pool_inventory_items WHERE id = ?')
        .get(Number(itemId))
      if (!item) throw new Error('Item not found')
      const cap = Math.min(Number(limit) || HISTORY_DEFAULT_LIMIT, HISTORY_MAX_LIMIT)
      // Order by id, not created_at: created_at only has second resolution, so
      // two movements in the same second would come back in arbitrary order.
      const rows = db
        .prepare(
          `SELECT pit.id, pit.txn_type, pit.quantity, pit.reason, pit.staff_id, pit.unit_price,
                  pit.transaction_id, pit.created_at,
                  u.name AS staff_name,
                  t.amount AS transaction_amount, t.transaction_type, t.customer_name
           FROM pool_inventory_transactions pit
           LEFT JOIN users u ON u.id = pit.staff_id
           LEFT JOIN transactions t ON t.id = pit.transaction_id
           WHERE pit.item_id = ?
           ORDER BY pit.id DESC
           LIMIT ?`
        )
        .all(item.id, cap)
      return {
        item: {
          id: item.id,
          name: item.name,
          variant: item.variant || null,
          stock: item.current_stock
        },
        movements: mapMovements(rows, item.current_stock)
      }
    })
  )

  ipcMain.handle(
    'pool-inventory:low-stock',
    wrap(() => {
      requireStaffOrOwner()
      const items = getDb()
        .prepare(
          `SELECT * FROM pool_inventory_items
           WHERE is_active = 1 AND current_stock <= reorder_level
           ORDER BY current_stock`
        )
        .all()
        .map(mapPoolItem)
      return { items }
    })
  )
}
