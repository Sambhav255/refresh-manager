export function todayLocal() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function formatDurationLabel(days) {
  if (days == null) return ''
  if (days === 15) return '15 Days'
  if (days === 30) return 'Monthly'
  if (days === 90) return '3 Months'
  if (days === 180) return '6 Months'
  if (days === 365) return '1 Year'
  return `${days} Days`
}

// Shared input guards. Handlers are the last line of defence for data that
// reaches the database: a renderer bug (or a tampered one) must never be able
// to write a blank name, a negative price, or text into a numeric column.
const MAX_RESTOCK = 100000

export function requireText(value, label) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) throw new Error(`${label} is required`)
  if (text.length > 120) throw new Error(`${label} is too long (max 120 characters)`)
  return text
}

// Returns a finite number >= 0, rejecting '', null, NaN and numeric-looking
// text. Used for prices and reorder levels.
export function requireAmount(value, label, fallback = null) {
  if (value === undefined || value === null || value === '') {
    if (fallback === null) throw new Error(`${label} is required`)
    return fallback
  }
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) throw new Error(`${label} must be a number of 0 or more`)
  return n
}

// Phone is optional, but anything present must be a real Nepal mobile number:
// it is what renewal reminders message and what member search matches on, so a
// typo silently produces an uncontactable member. Mirrors validatePhone in
// src/renderer/src/lib/validate.js.
export function requirePhone(value) {
  if (value === undefined || value === null || value === '') return null
  const raw = String(value).trim()
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  if (digits.length !== 10 || /[a-z]/i.test(raw)) {
    throw new Error('Phone must be 10 digits (Nepal format)')
  }
  return digits
}

// Normalises any incoming payment-method value to 'cash' or 'qr' — the only
// two the schema and the till drawer ever recognise. Shared by sales.js
// (sale/payment creation) and transactions.js (refund method, C-8) so a
// refund's method is validated the exact same way a sale's is, rather than a
// second copy of this rule drifting from the first.
export function requirePaymentMethod(value) {
  return String(value || '').toLowerCase() === 'qr' ? 'qr' : 'cash'
}

export function requireRestockQuantity(value, { integerOnly }) {
  const qty = Number(value)
  const valid = integerOnly ? Number.isInteger(qty) : Number.isFinite(qty)
  if (!valid || qty <= 0) throw new Error('Invalid quantity')
  if (qty > MAX_RESTOCK) throw new Error(`Quantity is too large (max ${MAX_RESTOCK})`)
  return qty
}

// Transaction/report queries alias the joined product name to `product_name`,
// so a raw row cannot be handed to productDisplayName (it reads `.name`) — that
// silently yields "undefined" or "undefined — Monthly". Rebuild the product
// shape from the aliased row first.
export function productFromRow(row) {
  return {
    name: row.product_name,
    category: row.category,
    duration_days: row.duration_days,
    sub_category: row.sub_category
  }
}

export function productDisplayName(product) {
  if (!product) return ''
  if (product.category === 'membership' && product.duration_days) {
    return `${product.name} — ${formatDurationLabel(product.duration_days)}`
  }
  if (product.name === 'Whole Package') {
    return 'Whole Package (Pool + Gym + Sauna + Steam + Jacuzzi)'
  }
  return product.name
}

export function categoryToUiType(category) {
  const map = {
    membership: 'Membership',
    day_package: 'Day Package',
    day_pass: 'Day Pass'
  }
  return map[category] || category
}

export function uiTypeToCategory(type) {
  const map = {
    Membership: 'membership',
    'Day Package': 'day_package',
    'Day Pass': 'day_pass'
  }
  return map[type] || type
}

export function formatTime(iso) {
  if (!iso) return ''
  const d = new Date(iso.replace(' ', 'T'))
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

export function formatDateDisplay(iso) {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  })
}

export function formatShortDate(iso) {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + days)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function membershipStatus(endDate, warningDays = 5) {
  const today = todayLocal()
  if (endDate < today) return 'Expired'
  const warnDate = addDays(today, warningDays)
  if (endDate <= warnDate) return 'Expiring soon'
  return 'Active'
}

export function initials(name) {
  return (name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('')
}
