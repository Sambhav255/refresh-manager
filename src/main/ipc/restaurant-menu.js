import { ipcMain } from 'electron'
import { getDb } from '../db/index.js'
import { requireOwner, requireStaffOrOwner } from '../session.js'
import { requireAmount, requireText } from './utils.js'
import { executeSale } from './sales.js'

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
    // C-3: LEFT JOIN in the linked stock item's current_stock/reorder_level/
    // is_active (null for an unlinked item — always available, since there's
    // nothing to run out of) and fold in the manual same-day override (see
    // restaurant-menu:set-availability below) so the frontend can grey out a
    // tile *before* it goes in a cart, instead of staff only discovering it's
    // unsellable after Confirm. isAvailable is computed here, once, so it
    // can't drift from restaurant:checkout's own stock/override check (Part
    // C) — same "zero or below, or the linked stock item itself retired, is
    // unavailable" rule, now also gated on the override.
    //
    // Fix round 1 (review): a linked stock item can be RETIRED
    // (restaurant-inventory:update isActive:0) while it still has positive
    // current_stock — an ordinary owner action via the restaurant inventory
    // screen's "Show retired"/retire-restore path. That case used to read as
    // available here (currentStock > 0) right up until restaurant:checkout
    // rejected it with "no longer stocked" — exactly the late-checkout-
    // failure pattern this task exists to eliminate. stockItemActive closes
    // that gap the same way checkout's own `!stock.is_active` check does.
    wrap(({ activeOnly = true } = {}) => {
      requireStaffOrOwner()
      let sql = `
        SELECT m.*,
               i.current_stock AS currentStock,
               i.reorder_level AS reorderLevel,
               i.is_active AS stockItemActive,
               CASE
                 WHEN m.manually_unavailable_at IS NOT NULL
                      AND date(m.manually_unavailable_at) = date('now','localtime')
                 THEN 1 ELSE 0
               END AS manuallyUnavailableToday
        FROM restaurant_menu_items m
        LEFT JOIN restaurant_inventory_items i ON i.id = m.inventory_item_id
      `
      if (activeOnly) sql += ` WHERE m.is_active = 1`
      sql += ` ORDER BY m.sort_order, m.name`
      const items = getDb()
        .prepare(sql)
        .all()
        .map((item) => {
          const manuallyUnavailableToday = !!item.manuallyUnavailableToday
          // No linked stock item ⇒ nothing to run out of ⇒ always stock-ok.
          // A linked item is stock-ok only when its stock row is active AND
          // has quantity — a dangling link (inventory_item_id pointing at a
          // deleted row) also reads as currentStock == null here and is left
          // as a pre-existing, out-of-scope edge case (checkout catches it
          // with its own "Stock item missing" error).
          const stockOk =
            item.currentStock == null || (item.currentStock > 0 && item.stockItemActive !== 0)
          const isLowStock =
            item.currentStock != null &&
            item.reorderLevel != null &&
            item.currentStock > 0 &&
            item.currentStock <= item.reorderLevel
          return {
            ...item,
            manuallyUnavailableToday,
            isLowStock,
            isAvailable: stockOk && !manuallyUnavailableToday
          }
        })
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
    'restaurant-menu:set-availability',
    // C-3: a same-day, staff-flippable "86 this item" — deliberately distinct
    // from the owner-only permanent retirement above. Both owner and staff can
    // call this (a cook going home sick or a gas cylinder running out is
    // exactly the kind of thing staff notice first, at the counter). Storing
    // only the timestamp means the override auto-clears the next day just by
    // going stale — date(...) = date('now','localtime') reads a NULL or a
    // yesterday's timestamp identically as "not unavailable today", so nothing
    // needs to run overnight to reset it.
    wrap(({ id, unavailable }) => {
      requireStaffOrOwner()
      const res = getDb()
        .prepare(
          `UPDATE restaurant_menu_items
           SET manually_unavailable_at = CASE WHEN ? THEN datetime('now','localtime') ELSE NULL END
           WHERE id = ?`
        )
        .run(unavailable ? 1 : 0, id)
      if (res.changes === 0) throw new Error('Menu item not found')
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
      if (!items?.length) throw new Error('Cart is empty')

      const db = getDb()
      const menuStmt = db.prepare(`
        SELECT *,
               CASE
                 WHEN manually_unavailable_at IS NOT NULL
                      AND date(manually_unavailable_at) = date('now','localtime')
                 THEN 1 ELSE 0
               END AS manuallyUnavailableToday
        FROM restaurant_menu_items WHERE id = ?
      `)
      const cart = items.map((i) => {
        const qty = Number(i.quantity)
        if (!Number.isInteger(qty) || qty <= 0 || qty > 999) throw new Error('Invalid quantity')
        const menuItem = menuStmt.get(i.id)
        if (!menuItem) throw new Error(`Menu item not found: ${i.name || i.id}`)
        if (!menuItem.is_active) throw new Error(`Item unavailable: ${menuItem.name}`)
        if (menuItem.manuallyUnavailableToday) {
          throw new Error(`${menuItem.name} is marked unavailable today`)
        }
        return { kind: 'menu_item', refId: i.id, quantity: qty }
      })

      const result = executeSale(session, {
        customerName,
        cart,
        paymentMethod
      })
      return {
        success: true,
        transactionId: result.transactionId,
        total: result.total,
        paymentMethod: result.paymentMethod
      }
    })
  )
}
