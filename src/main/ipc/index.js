import { registerAuthHandlers } from './auth.js'
import { registerProductHandlers } from './products.js'
import { registerTransactionHandlers } from './transactions.js'
import { registerPoolInventoryHandlers } from './inventory-pool.js'
import { registerMemberHandlers } from './members.js'
import { registerRestaurantInventoryHandlers } from './inventory-restaurant.js'
import { registerBookingHandlers } from './bookings.js'
import { registerReportHandlers } from './reports.js'
import { registerSettingsHandlers } from './settings.js'
import { registerWhatsappHandlers } from './whatsapp.js'
import { registerBackupHandlers } from './backup.js'
import { registerTicketHandlers } from './tickets.js'
import { registerReminderHandlers } from './reminders.js'
import { registerPhotoHandlers } from './photos.js'
import { registerReconciliationHandlers } from './reconciliation.js'
import { registerRestaurantMenuHandlers } from './restaurant-menu.js'
import { registerAuditHandlers } from './audit.js'

export function registerAllHandlers() {
  registerAuthHandlers()
  registerProductHandlers()
  registerTransactionHandlers()
  registerPoolInventoryHandlers()
  registerMemberHandlers()
  registerRestaurantInventoryHandlers()
  registerBookingHandlers()
  registerReportHandlers()
  registerSettingsHandlers()
  registerWhatsappHandlers()
  registerBackupHandlers()
  registerTicketHandlers()
  registerReminderHandlers()
  registerPhotoHandlers()
  registerReconciliationHandlers()
  registerRestaurantMenuHandlers()
  registerAuditHandlers()
}
