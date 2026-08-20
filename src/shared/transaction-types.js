// Single source of truth for transaction-type labels and display order.
//
// Imported by BOTH the main process (the WhatsApp end-of-day message) and the
// renderer (the End of Day screen). They previously kept separate lists, which
// is how the on-screen breakdown came to omit restaurant and pool-item revenue
// while the WhatsApp report included it — staff and owner saw different
// breakdowns of the same day. Keep this file free of electron imports so both
// sides can bundle it.
//
// "Day Pass" and "Day Package" were indistinguishable at the desk — the owner
// asked outright what the difference was. The category strings in the database
// are unchanged (every report, filter and CHECK constraint still reads
// `day_pass` / `day_package`); only what a human reads is renamed, to say the
// actual difference: one facility, or several bundled together.

export const TYPE_LABELS = {
  membership: 'Memberships',
  day_package: 'Combo Tickets',
  day_pass: 'Entry Tickets',
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

// Singular form, for the till: a breakdown row is "Entry Tickets", but the thing
// reception is selling right now is one "Entry Ticket".
export const CATEGORY_LABELS = {
  membership: 'Membership',
  day_package: 'Combo Ticket',
  day_pass: 'Entry Ticket'
}

// What each one actually is, in the words a receptionist would use. Shown next
// to the choice so nobody has to ask the owner which is which again.
export const CATEGORY_HINTS = {
  membership: 'Ongoing member — pick the plan, then how long',
  day_package: 'Several facilities bundled — sauna, steam, jacuzzi',
  day_pass: 'One facility for the day — pool or gym'
}

// The categories the till sells as basket lines. Memberships are deliberately
// absent: they go through createMemberWithMembership, which files the customer
// as a member and matches them against the people already on record.
export const CART_CATEGORIES = ['day_pass', 'day_package']

export function typeLabel(type) {
  return TYPE_LABELS[type] || type
}

export function categoryLabel(category) {
  return CATEGORY_LABELS[category] || category
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
