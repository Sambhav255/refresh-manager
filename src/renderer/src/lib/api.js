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

  createTransaction: (data) => invoke('createTransaction', data),
  listTransactions: async (data) => unwrap(await invoke('listTransactions', data), { transactions: [] }),
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

  searchMembers: async (data) => unwrap(await invoke('searchMembers', data), { members: [] }),
  listAllMembers: async () => unwrap(await invoke('listAllMembers'), { members: [] }),
  expiringSoon: async (data) => unwrap(await invoke('expiringSoon', data), { members: [] }),

  listPoolInventory: async (data) => unwrap(await invoke('listPoolInventory', data), { items: [] }),
  poolLowStock: async () => unwrap(await invoke('poolLowStock'), { items: [] }),
  addPoolItem: (data) => invoke('addPoolItem', data),
  restockPoolItem: (data) => invoke('restockPoolItem', data),

  listRestaurantInventory: async (data) =>
    unwrap(await invoke('listRestaurantInventory', data), { items: [] }),
  restaurantLowStock: async () => unwrap(await invoke('restaurantLowStock'), { items: [] }),
  addRestaurantItem: (data) => invoke('addRestaurantItem', data),
  restockRestaurantItem: (data) => invoke('restockRestaurantItem', data),

  upcomingBookings: async (data) => unwrap(await invoke('upcomingBookings', data), { bookings: [] }),
  listBookings: async (data) => unwrap(await invoke('listBookings', data), { bookings: [] }),
  createBooking: (data) => invoke('createBooking', data),
  updateBooking: (data) => invoke('updateBooking', data),
  updateBookingStatus: (data) => invoke('updateBookingStatus', data),

  dailyReport: async (data) => unwrap(await invoke('dailyReport', data), { summary: {}, transactions: [] }),
  monthlyReport: async (data) =>
    unwrap(await invoke('monthlyReport', data), { summary: {}, byWeek: [], byProduct: [] }),
  customReport: async (data) => unwrap(await invoke('customReport', data), { summary: {}, transactions: [] }),
  exportExcel: (data) => invoke('exportExcel', data),

  getSettings: async () => unwrap(await invoke('getSettings'), { settings: {} }),
  setSetting: (data) => invoke('setSetting', data),

  sendEod: (data) => invoke('sendEod', data),
  printTicket: (data) => invoke('printTicket', data),

  listStaff: async () => unwrap(await invoke('listStaff'), { users: [] }),
  addStaff: (data) => invoke('addStaff', data),
  deactivateUser: (data) => invoke('deactivateUser', data),
  changePin: (data) => invoke('changePin', data)
}
