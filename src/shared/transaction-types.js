// Single source of truth for transaction-type labels and display order.
//
// Imported by BOTH the main process (the WhatsApp end-of-day message) and the
// renderer (the End of Day screen). They previously kept separate lists, which
// is how the on-screen breakdown came to omit restaurant and pool-item revenue
// while the WhatsApp report included it — staff and owner saw different
// breakdowns of the same day. Keep this file free of electron imports so both
// sides can bundle it.

export const TYPE_LABELS = {
  membership: 'Memberships',
  day_package: 'Day Packages',
  day_pass: 'Day Passes',
  restaurant: 'Restaurant',
  pool_inventory: 'Pool Items',
  booking_deposit: 'Booking Deposits',
  refund: 'Refunds'
}

export const TYPE_ORDER = [
  'membership',
  'day_package',
  'day_pass',
  'restaurant',
  'pool_inventory',
  'booking_deposit',
  'refund'
]

export function typeLabel(type) {
  return TYPE_LABELS[type] || type
}

// Orders the types present in `byType` (a { type: amount } map), keeping known
// types in TYPE_ORDER and appending any unknown ones so a future transaction
// type can never be silently dropped from a breakdown.
export function orderedTypes(byType) {
  const present = Object.keys(byType || {})
  return [
    ...TYPE_ORDER.filter((t) => present.includes(t)),
    ...present.filter((t) => !TYPE_ORDER.includes(t))
  ]
}
