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
