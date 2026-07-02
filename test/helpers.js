import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import bcrypt from 'bcryptjs'
import { __setUserDataDir } from 'electron'
import { initDatabase, getDb, closeDatabase } from '../src/main/db/index.js'
import { setSession, clearSession } from '../src/main/session.js'
import { registerTransactionHandlers } from '../src/main/ipc/transactions.js'
import { registerMemberHandlers } from '../src/main/ipc/members.js'
import { registerPoolInventoryHandlers } from '../src/main/ipc/inventory-pool.js'
import { registerRestaurantMenuHandlers } from '../src/main/ipc/restaurant-menu.js'
import { registerBookingHandlers } from '../src/main/ipc/bookings.js'
import { registerBackupHandlers } from '../src/main/ipc/backup.js'
import { registerReconciliationHandlers } from '../src/main/ipc/reconciliation.js'
import { registerSettingsHandlers } from '../src/main/ipc/settings.js'
import { registerAuditHandlers } from '../src/main/ipc/audit.js'
import { registerCheckinHandlers } from '../src/main/ipc/checkins.js'
import { registerReminderHandlers } from '../src/main/ipc/reminders.js'

let registered = false
function registerAll() {
  if (registered) return
  registerTransactionHandlers()
  registerMemberHandlers()
  registerPoolInventoryHandlers()
  registerRestaurantMenuHandlers()
  registerBookingHandlers()
  registerBackupHandlers()
  registerReconciliationHandlers()
  registerSettingsHandlers()
  registerAuditHandlers()
  registerCheckinHandlers()
  registerReminderHandlers()
  registered = true
}

// Fresh temp-file database with the real schema + migrations, handlers wired.
export function freshDb() {
  clearSession()
  closeDatabase()
  __setUserDataDir(mkdtempSync(join(tmpdir(), 'refresh-t-')))
  initDatabase()
  registerAll()
  return getDb()
}

export const OWNER_PASSWORD = 'ownerpass'

export function seed(db) {
  const owner = db
    .prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Owner','owner',?)`)
    .run(bcrypt.hashSync(OWNER_PASSWORD, 10))
  const staff = db
    .prepare(`INSERT INTO users (name, role, pin_hash) VALUES ('Staff','staff',?)`)
    .run(bcrypt.hashSync('1234', 10))
  const dayPass = db
    .prepare(
      `INSERT INTO products (name, category, duration_days, price) VALUES ('Day Pass','day_pass',1,300)`
    )
    .run()
  const memProd = db
    .prepare(
      `INSERT INTO products (name, category, duration_days, price) VALUES ('Monthly','membership',30,1000)`
    )
    .run()
  const poolItem = db
    .prepare(
      `INSERT INTO pool_inventory_items (name, category, current_stock, reorder_level, selling_price) VALUES ('Goggles','gear',10,5,200)`
    )
    .run()
  const rInv = db
    .prepare(
      `INSERT INTO restaurant_inventory_items (name, category, current_stock, reorder_level) VALUES ('Tea leaves','bev',10,3)`
    )
    .run()
  const menuLinked = db
    .prepare(
      `INSERT INTO restaurant_menu_items (name, category, price, inventory_item_id) VALUES ('Tea','bev',150,?)`
    )
    .run(rInv.lastInsertRowid)
  const menuPlain = db
    .prepare(
      `INSERT INTO restaurant_menu_items (name, category, price) VALUES ('Chips','snack',100)`
    )
    .run()

  return {
    ownerId: owner.lastInsertRowid,
    staffId: staff.lastInsertRowid,
    dayPassId: dayPass.lastInsertRowid,
    memProdId: memProd.lastInsertRowid,
    poolItemId: poolItem.lastInsertRowid,
    rInvId: rInv.lastInsertRowid,
    menuLinkedId: menuLinked.lastInsertRowid,
    menuPlainId: menuPlain.lastInsertRowid
  }
}

export function loginStaff(ids) {
  setSession({ userId: ids.staffId, name: 'Staff', role: 'staff' })
}
export function loginOwner(ids) {
  setSession({ userId: ids.ownerId, name: 'Owner', role: 'owner' })
}

export function isoOffset(days) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
