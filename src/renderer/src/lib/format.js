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

export function categoryToUiType(category) {
  const map = {
    membership: 'Membership',
    day_package: 'Day Package',
    day_pass: 'Day Pass'
  }
  return map[category] || category
}

export function uiTypeToDbType(type) {
  const map = {
    Membership: 'membership',
    'Day Package': 'day_package',
    'Day Pass': 'day_pass'
  }
  return map[type] || type
}
