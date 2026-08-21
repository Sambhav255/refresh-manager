import { describe, it, expect } from 'vitest'
import { relativeDays, todayLocal } from '../src/renderer/src/lib/format.js'

// Pure-function test for the relative-distance label used by <RelativeDate>
// (spec items H-23/P-18). Dates are derived from todayLocal() rather than
// hardcoded so the test doesn't rot as the clock moves forward.
function isoOffset(days) {
  const d = new Date(todayLocal() + 'T00:00:00')
  d.setDate(d.getDate() + days)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

describe('relativeDays', () => {
  it('returns empty string for falsy input', () => {
    expect(relativeDays('')).toBe('')
    expect(relativeDays(null)).toBe('')
    expect(relativeDays(undefined)).toBe('')
  })

  it('labels today as "today"', () => {
    expect(relativeDays(isoOffset(0))).toBe('today')
  })

  it('labels 1 day in the future as "in 1 day"', () => {
    expect(relativeDays(isoOffset(1))).toBe('in 1 day')
  })

  it('labels 1 day in the past as "1 day ago"', () => {
    expect(relativeDays(isoOffset(-1))).toBe('1 day ago')
  })

  it('labels N days in the future with the plural branch', () => {
    expect(relativeDays(isoOffset(9))).toBe('in 9 days')
    expect(relativeDays(isoOffset(30))).toBe('in 30 days')
  })

  it('labels N days in the past with the plural branch', () => {
    expect(relativeDays(isoOffset(-9))).toBe('9 days ago')
    expect(relativeDays(isoOffset(-30))).toBe('30 days ago')
  })
})
