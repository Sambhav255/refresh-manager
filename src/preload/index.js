import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload)

const api = {
  // Auth
  needsSetup: () => invoke('auth:needs-setup'),
  setup: (data) => invoke('auth:setup', data),
  login: (data) => invoke('auth:login', data),
  logout: () => invoke('auth:logout'),
  getSession: () => invoke('auth:get-session'),
  addStaff: (data) => invoke('auth:add-staff', data),
  listStaff: () => invoke('auth:list-staff'),
  deactivateUser: (data) => invoke('auth:deactivate-user', data),
  changePin: (data) => invoke('auth:change-pin', data),

  // Transactions
  createTransaction: (data) => invoke('transactions:create', data),
  listTransactions: (data) => invoke('transactions:list', data),
  todaySummary: (data) => invoke('transactions:today-summary', data),
  voidTransaction: (data) => invoke('transactions:void', data),
  refundTransaction: (data) => invoke('transactions:refund', data),

  // Members
  createMember: (data) => invoke('members:create', data),
  searchMembers: (data) => invoke('members:search', data),
  getMember: (data) => invoke('members:get', data),
  addMembership: (data) => invoke('members:add-membership', data),
  renewMembership: (data) => invoke('members:renew', data),
  pauseMembership: (data) => invoke('members:pause-membership', data),
  resumeMembership: (data) => invoke('members:resume-membership', data),
  expiringSoon: (data) => invoke('members:expiring-soon', data),
  listAllMembers: () => invoke('members:list-all'),

  // Products
  listProducts: (data) => invoke('products:list', data),
  updatePrice: (data) => invoke('products:update-price', data),
  addProduct: (data) => invoke('products:add', data),
  toggleProduct: (data) => invoke('products:toggle-active', data),
  priceHistory: (data) => invoke('products:price-history', data),

  // Pool inventory
  listPoolInventory: (data) => invoke('pool-inventory:list', data),
  restockPoolItem: (data) => invoke('pool-inventory:restock', data),
  sellPoolItem: (data) => invoke('pool-inventory:sell-item', data),
  adjustPoolItem: (data) => invoke('pool-inventory:adjust', data),
  addPoolItem: (data) => invoke('pool-inventory:add-item', data),
  updatePoolItem: (data) => invoke('pool-inventory:update', data),
  poolLowStock: () => invoke('pool-inventory:low-stock'),

  // Restaurant inventory
  listRestaurantInventory: (data) => invoke('restaurant-inventory:list', data),
  restockRestaurantItem: (data) => invoke('restaurant-inventory:restock', data),
  sellRestaurantItem: (data) => invoke('restaurant-inventory:sell', data),
  adjustRestaurantItem: (data) => invoke('restaurant-inventory:adjust', data),
  addRestaurantItem: (data) => invoke('restaurant-inventory:add-item', data),
  updateRestaurantItem: (data) => invoke('restaurant-inventory:update', data),
  restaurantLowStock: () => invoke('restaurant-inventory:low-stock'),

  // Bookings
  listBookings: (data) => invoke('bookings:list', data),
  upcomingBookings: (data) => invoke('bookings:upcoming', data),
  createBooking: (data) => invoke('bookings:create', data),
  updateBooking: (data) => invoke('bookings:update', data),
  updateBookingStatus: (data) => invoke('bookings:update-status', data),

  // Reports
  dailyReport: (data) => invoke('reports:daily', data),
  monthlyReport: (data) => invoke('reports:monthly', data),
  customReport: (data) => invoke('reports:custom', data),
  exportExcel: (data) => invoke('reports:export-excel', data),
  retentionReport: (data) => invoke('reports:retention', data),
  inventoryTurnoverReport: (data) => invoke('reports:inventory-turnover', data),
  bookingReport: (data) => invoke('reports:bookings', data),
  staffActivityReport: (data) => invoke('reports:staff-activity', data),

  // Settings
  getSettings: () => invoke('settings:get-all'),
  setSetting: (data) => invoke('settings:set', data),

  // WhatsApp & backup
  sendEod: (data) => invoke('whatsapp:send-eod', data),
  createBackup: (data) => invoke('backup:create', data),
  listBackups: () => invoke('backup:list'),
  getBackupStatus: () => invoke('backup:get-status'),
  restoreBackup: (data) => invoke('backup:restore', data),
  pickBackupFolder: () => invoke('backup:pick-folder'),

  // Reminders
  getExpiringReminders: (data) => invoke('reminders:get-expiring', data),
  sendReminder: (data) => invoke('reminders:send-one', data),
  sendAllReminders: (data) => invoke('reminders:send-all', data),
  clearReminder: (data) => invoke('reminders:clear', data),

  // Photos
  savePhoto: (data) => invoke('photos:save', data),
  getPhotoPath: (data) => invoke('photos:get-path', data),

  // Reconciliation
  createReconciliation: (data) => invoke('reconciliation:create', data),
  getTodayReconciliation: () => invoke('reconciliation:get-today'),
  listReconciliations: (data) => invoke('reconciliation:list', data),

  // Audit trail (owner)
  listAudit: (data) => invoke('audit:list', data),

  // Check-ins / footfall
  checkIn: (data) => invoke('checkins:create', data),
  getTodayCheckins: () => invoke('checkins:today'),
  getFootfall: (data) => invoke('checkins:footfall', data),
  getNotSeen: (data) => invoke('checkins:not-seen', data),

  // Restaurant menu / POS
  listMenuItems: (data) => invoke('restaurant-menu:list', data),
  addMenuItem: (data) => invoke('restaurant-menu:add', data),
  updateMenuItem: (data) => invoke('restaurant-menu:update', data),
  toggleMenuItem: (data) => invoke('restaurant-menu:toggle', data),
  restaurantCheckout: (data) => invoke('restaurant:checkout', data),

  // Tickets
  printTicket: (data) => invoke('tickets:print', data),
  printMembershipCard: (data) => invoke('tickets:print-membership-card', data)
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  window.electron = electronAPI
  window.api = api
}
