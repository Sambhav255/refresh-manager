import { contextBridge, ipcRenderer } from 'electron'

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload)

const api = {
  // Auth
  needsSetup: () => invoke('auth:needs-setup'),
  setup: (data) => invoke('auth:setup', data),
  login: (data) => invoke('auth:login', data),
  logout: () => invoke('auth:logout'),
  switchStaffPin: (data) => invoke('auth:switch-staff-pin', data),
  setCartGuard: (data) => invoke('auth:set-cart-guard', data),
  getSession: () => invoke('auth:get-session'),
  addStaff: (data) => invoke('auth:add-staff', data),
  listStaff: () => invoke('auth:list-staff'),
  deactivateUser: (data) => invoke('auth:deactivate-user', data),
  changePin: (data) => invoke('auth:change-pin', data),
  addAdmin: (data) => invoke('auth:add-admin', data),
  listAdmins: () => invoke('auth:list-admins'),
  deactivateAdmin: (data) => invoke('auth:deactivate-admin', data),
  changeAdminPassword: (data) => invoke('auth:change-admin-password', data),

  // Dashboard (owner)
  getDashboardSummary: (data) => invoke('dashboard:summary', data),

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
  createMemberWithMembership: (data) => invoke('members:create-with-membership', data),

  // Sale model (cart-based checkout): lines + payments.
  createSale: (data) => invoke('sales:create', data),
  getSale: (data) => invoke('sales:get', data),
  addSalePayment: (data) => invoke('sales:add-payment', data),
  listOutstanding: (data) => invoke('sales:outstanding', data),
  quoteSale: (data) => invoke('sales:quote', data),

  // Pricing rules (tiers + day overrides)
  listPriceRules: (data) => invoke('pricing:list-rules', data),
  setPriceRule: (data) => invoke('pricing:set-rule', data),
  deletePriceRule: (data) => invoke('pricing:delete-rule', data),

  // Auth recovery + login roster
  resetAdminPassword: (data) => invoke('auth:reset-admin-password', data),
  resetStaffPin: (data) => invoke('auth:reset-staff-pin', data),
  listLoginRoster: () => invoke('auth:login-roster'),
  // Last-resort recovery for the single-admin case: a code issued in advance,
  // stored hashed, usable once without being signed in.
  hasRecoveryCode: () => invoke('auth:has-recovery-code'),
  issueRecoveryCode: (data) => invoke('auth:issue-recovery-code', data),
  recoverWithCode: (data) => invoke('auth:recover-with-code', data),
  findMemberMatches: (data) => invoke('members:find-matches', data),
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
  productPopularity: () => invoke('products:popularity'),

  // Pool inventory
  listPoolInventory: (data) => invoke('pool-inventory:list', data),
  restockPoolItem: (data) => invoke('pool-inventory:restock', data),
  sellPoolItem: (data) => invoke('pool-inventory:sell-item', data),
  adjustPoolItem: (data) => invoke('pool-inventory:adjust', data),
  poolItemHistory: (data) => invoke('pool-inventory:history', data),
  addPoolItem: (data) => invoke('pool-inventory:add-item', data),
  updatePoolItem: (data) => invoke('pool-inventory:update', data),
  poolLowStock: () => invoke('pool-inventory:low-stock'),

  // Restaurant inventory
  listRestaurantInventory: (data) => invoke('restaurant-inventory:list', data),
  restockRestaurantItem: (data) => invoke('restaurant-inventory:restock', data),
  sellRestaurantItem: (data) => invoke('restaurant-inventory:sell', data),
  adjustRestaurantItem: (data) => invoke('restaurant-inventory:adjust', data),
  restaurantItemHistory: (data) => invoke('restaurant-inventory:history', data),
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
  cohortRetention: (data) => invoke('reports:cohort-retention', data),
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
  openBackupFolder: () => invoke('backup:open-folder'),
  exportSupportLogs: () => invoke('backup:export-logs'),

  // Reminders
  getExpiringReminders: (data) => invoke('reminders:get-expiring', data),
  sendReminder: (data) => invoke('reminders:send-one', data),
  sendAllReminders: (data) => invoke('reminders:send-all', data),
  clearReminder: (data) => invoke('reminders:clear', data),
  getReminderHistory: (data) => invoke('reminders:history', data),

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
  setMenuItemAvailability: (data) => invoke('restaurant-menu:set-availability', data),
  restaurantCheckout: (data) => invoke('restaurant:checkout', data),

  // Tickets
  printTicket: (data) => invoke('tickets:print', data),
  printKitchenTicket: (data) => invoke('tickets:print-kitchen', data),
  printMembershipCard: (data) => invoke('tickets:print-membership-card', data),

  // Diagnostics
  logDiagnostic: (data) => invoke('diagnostics:log', data),
  getDiagnosticsInfo: () => invoke('diagnostics:get-info'),
  openDiagnosticsFolder: () => invoke('diagnostics:open-folder'),
  // Updates
  getUpdateInfo: () => invoke('updates:get-info'),
  checkForUpdates: () => invoke('updates:check'),
  downloadUpdate: () => invoke('updates:download'),
  installDownloadedUpdate: () => invoke('updates:install-downloaded'),
  pickUpdateInstaller: () => invoke('updates:pick-installer'),
  installUpdateFromFile: (data) => invoke('updates:install-from-file', data),
  getChangelog: () => invoke('updates:get-changelog'),


  // Frameless window: the custom title-bar buttons are the only chrome.
  minimizeWindow: () => invoke('window:minimize'),
  toggleMaximizeWindow: () => invoke('window:toggle-maximize')
}

// Least privilege: only the curated `api` object is exposed. The raw toolkit
// bridge (window.electron / unrestricted ipcRenderer) is deliberately NOT
// exposed — the renderer must go through the typed surface above.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  window.api = api
}
