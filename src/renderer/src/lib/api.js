async function invoke(method, payload) {
  if (typeof window === 'undefined' || !window.api?.[method]) {
    return { success: false, error: 'API not available' }
  }
  try {
    return await window.api[method](payload)
  } catch (err) {
    return { success: false, error: err.message || 'Request failed' }
  }
}

function unwrap(result, fallback = {}) {
  if (!result || result.success === false) {
    return { ...fallback, error: result?.error }
  }
  return result
}

export const api = {
  needsSetup: async () => {
    const r = await invoke('needsSetup')
    return r?.needsSetup ?? false
  },

  setup: (data) => invoke('setup', data),
  login: (data) => invoke('login', data),
  logout: () => invoke('logout'),

  getSession: async () => {
    const r = await invoke('getSession')
    return r?.user ?? null
  },

  listProducts: async (data) => unwrap(await invoke('listProducts', data), { products: [] }),
  updatePrice: (data) => invoke('updatePrice', data),
  priceHistory: async (data) => unwrap(await invoke('priceHistory', data), { history: [] }),
  productPopularity: async () => unwrap(await invoke('productPopularity'), { counts: [] }),

  createTransaction: (data) => invoke('createTransaction', data),
  listTransactions: async (data) =>
    unwrap(await invoke('listTransactions', data), { transactions: [] }),
  todaySummary: async (data) =>
    unwrap(await invoke('todaySummary', data), {
      total: 0,
      cash: 0,
      qr: 0,
      byType: {},
      bySource: { pool: 0, restaurant: 0 },
      count: 0
    }),
  voidTransaction: (data) => invoke('voidTransaction', data),
  refundTransaction: (data) => invoke('refundTransaction', data),

  createMember: (data) => invoke('createMember', data),
  searchMembers: async (data) => unwrap(await invoke('searchMembers', data), { members: [] }),
  listAllMembers: async () => unwrap(await invoke('listAllMembers'), { members: [] }),
  expiringSoon: async (data) => unwrap(await invoke('expiringSoon', data), { members: [] }),
  addMembership: (data) => invoke('addMembership', data),
  pauseMembership: (data) => invoke('pauseMembership', data),
  resumeMembership: (data) => invoke('resumeMembership', data),
  renewMembership: (data) => invoke('renewMembership', data),

  listPoolInventory: async (data) => unwrap(await invoke('listPoolInventory', data), { items: [] }),
  poolLowStock: async () => unwrap(await invoke('poolLowStock'), { items: [] }),
  addPoolItem: (data) => invoke('addPoolItem', data),
  restockPoolItem: (data) => invoke('restockPoolItem', data),
  sellPoolItem: (data) => invoke('sellPoolItem', data),
  updatePoolItem: (data) => invoke('updatePoolItem', data),
  adjustPoolItem: (data) => invoke('adjustPoolItem', data),
  poolItemHistory: (data) => invoke('poolItemHistory', data),
  restaurantItemHistory: (data) => invoke('restaurantItemHistory', data),
  createMemberWithMembership: (data) => invoke('createMemberWithMembership', data),
  createSale: (data) => invoke('createSale', data),
  getSale: (data) => invoke('getSale', data),
  addSalePayment: (data) => invoke('addSalePayment', data),
  listOutstanding: (data) => invoke('listOutstanding', data),
  quoteSale: (data) => invoke('quoteSale', data),
  listPriceRules: (data) => invoke('listPriceRules', data),
  setPriceRule: (data) => invoke('setPriceRule', data),
  deletePriceRule: (data) => invoke('deletePriceRule', data),
  resetAdminPassword: (data) => invoke('resetAdminPassword', data),
  resetStaffPin: (data) => invoke('resetStaffPin', data),
  listLoginRoster: () => invoke('listLoginRoster'),
  hasRecoveryCode: () => invoke('hasRecoveryCode'),
  issueRecoveryCode: (data) => invoke('issueRecoveryCode', data),
  recoverWithCode: (data) => invoke('recoverWithCode', data),
  findMemberMatches: (data) => invoke('findMemberMatches', data),

  listRestaurantInventory: async (data) =>
    unwrap(await invoke('listRestaurantInventory', data), { items: [] }),
  restaurantLowStock: async () => unwrap(await invoke('restaurantLowStock'), { items: [] }),
  addRestaurantItem: (data) => invoke('addRestaurantItem', data),
  restockRestaurantItem: (data) => invoke('restockRestaurantItem', data),
  updateRestaurantItem: (data) => invoke('updateRestaurantItem', data),
  adjustRestaurantItem: (data) => invoke('adjustRestaurantItem', data),

  upcomingBookings: async (data) =>
    unwrap(await invoke('upcomingBookings', data), { bookings: [] }),
  listBookings: async (data) => unwrap(await invoke('listBookings', data), { bookings: [] }),
  createBooking: (data) => invoke('createBooking', data),
  updateBooking: (data) => invoke('updateBooking', data),
  updateBookingStatus: (data) => invoke('updateBookingStatus', data),

  dailyReport: async (data) =>
    unwrap(await invoke('dailyReport', data), { summary: {}, transactions: [] }),
  monthlyReport: async (data) =>
    unwrap(await invoke('monthlyReport', data), { summary: {}, byWeek: [], byProduct: [] }),
  customReport: async (data) =>
    unwrap(await invoke('customReport', data), { summary: {}, transactions: [] }),
  retentionReport: async (data) =>
    unwrap(await invoke('retentionReport', data), { due: 0, renewed: 0, churned: [] }),
  cohortRetention: async (data) =>
    unwrap(await invoke('cohortRetention', data), { cohortSize: 0, retention: [] }),
  inventoryTurnoverReport: async (data) =>
    unwrap(await invoke('inventoryTurnoverReport', data), {
      pool: [],
      restaurant: [],
      lowStock: []
    }),
  bookingReport: async (data) =>
    unwrap(await invoke('bookingReport', data), { bookings: [], summary: {} }),
  staffActivityReport: async (data) =>
    unwrap(await invoke('staffActivityReport', data), { staff: [], transactions: [] }),
  exportExcel: (data) => invoke('exportExcel', data),

  getSettings: async () => unwrap(await invoke('getSettings'), { settings: {} }),
  setSetting: (data) => invoke('setSetting', data),

  sendEod: (data) => invoke('sendEod', data),
  printTicket: (data) => invoke('printTicket', data),
  printMembershipCard: (data) => invoke('printMembershipCard', data),

  createBackup: (data) => invoke('createBackup', data),
  listBackups: async () => unwrap(await invoke('listBackups'), { backups: [] }),
  getBackupStatus: async () => unwrap(await invoke('getBackupStatus'), {}),
  restoreBackup: (data) => invoke('restoreBackup', data),
  pickBackupFolder: (data) => invoke('pickBackupFolder', data),

  getExpiringReminders: async (data) =>
    unwrap(await invoke('getExpiringReminders', data), { members: [] }),
  sendReminder: (data) => invoke('sendReminder', data),
  sendAllReminders: (data) => invoke('sendAllReminders', data),
  clearReminder: (data) => invoke('clearReminder', data),
  getReminderHistory: async (data) =>
    unwrap(await invoke('getReminderHistory', data), { history: [] }),

  savePhoto: (data) => invoke('savePhoto', data),
  getPhotoPath: async (data) => unwrap(await invoke('getPhotoPath', data), { photoPath: null }),

  createReconciliation: (data) => invoke('createReconciliation', data),
  getTodayReconciliation: async () =>
    unwrap(await invoke('getTodayReconciliation'), { reconciliation: null }),
  listReconciliations: async (data) =>
    unwrap(await invoke('listReconciliations', data), { reconciliations: [] }),

  listAudit: async (data) => unwrap(await invoke('listAudit', data), { entries: [] }),

  checkIn: (data) => invoke('checkIn', data),
  getTodayCheckins: async () => unwrap(await invoke('getTodayCheckins'), { count: 0, recent: [] }),
  getFootfall: async (data) =>
    unwrap(await invoke('getFootfall', data), { series: [], total: 0, dailyAverage: 0 }),
  getNotSeen: async (data) => unwrap(await invoke('getNotSeen', data), { members: [] }),

  listMenuItems: async (data) => unwrap(await invoke('listMenuItems', data), { items: [] }),
  addMenuItem: (data) => invoke('addMenuItem', data),
  updateMenuItem: (data) => invoke('updateMenuItem', data),
  toggleMenuItem: (data) => invoke('toggleMenuItem', data),
  restaurantCheckout: (data) => invoke('restaurantCheckout', data),

  listStaff: async () => unwrap(await invoke('listStaff'), { users: [] }),
  addStaff: (data) => invoke('addStaff', data),
  deactivateUser: (data) => invoke('deactivateUser', data),
  changePin: (data) => invoke('changePin', data),

  listAdmins: async () => unwrap(await invoke('listAdmins'), { users: [] }),
  addAdmin: (data) => invoke('addAdmin', data),
  deactivateAdmin: (data) => invoke('deactivateAdmin', data),
  changeAdminPassword: (data) => invoke('changeAdminPassword', data)
}
