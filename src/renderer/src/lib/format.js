import { categoryLabel } from '../../../shared/transaction-types'
export function fmt(n) {
  return 'Rs. ' + Number(n || 0).toLocaleString('en-IN')
}

export function todayLocal() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
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

// Human-relative distance from today, e.g. "in 1 day" / "9 days ago". Used
// alongside formatShortDate so a date reads as both an absolute value and a
// glanceable distance — spec items H-23/P-18.
export function relativeDays(iso) {
  if (!iso) return ''
  const today = new Date(todayLocal() + 'T00:00:00')
  const target = new Date(iso + 'T00:00:00')
  const diffDays = Math.round((target - today) / 86400000)
  if (diffDays === 0) return 'today'
  if (diffDays === 1) return 'in 1 day'
  if (diffDays === -1) return '1 day ago'
  if (diffDays > 1) return `in ${diffDays} days`
  return `${Math.abs(diffDays)} days ago`
}

// Delegates to the shared label map. This used to carry its own copy that
// still said "Day Pass" / "Day Package" after those were renamed to Entry
// Ticket / Combo Ticket everywhere else, so the owner's pricing screen and the
// till disagreed about what the same product is called — the exact ambiguity
// the rename removed.
export function categoryToUiType(category) {
  return categoryLabel(category)
}

export function uiTypeToDbType(type) {
  const map = {
    Membership: 'membership',
    'Day Package': 'day_package',
    'Day Pass': 'day_pass'
  }
  return map[type] || type
}
