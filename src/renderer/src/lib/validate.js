export function validatePin(pin) {
  if (!/^\d{4}$/.test(pin || '')) return 'PIN must be exactly 4 digits'
  return null
}

export function validatePhone(phone) {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (digits.length !== 10) return 'Phone must be 10 digits (Nepal format)'
  return null
}

export function validatePrice(value) {
  const n = Number(value)
  if (Number.isNaN(n) || n < 0) return 'Price must be a non-negative number'
  return null
}

export function validateFutureDate(dateStr) {
  if (!dateStr) return 'Date is required'
  const today = new Date().toISOString().slice(0, 10)
  if (dateStr < today) return 'Booking date must be in the future'
  return null
}

export function validateRequired(value, label = 'Field') {
  if (!value || !String(value).trim()) return `${label} is required`
  return null
}
