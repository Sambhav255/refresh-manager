import { describe, it, expect } from 'vitest'
import { normalizeKitchenItems } from '../src/main/kitchen-ticket-format.js'

describe('kitchen ticket items', () => {
  it('normalizes names and quantities without prices', () => {
    const items = normalizeKitchenItems([
      { name: 'Momo', quantity: 2 },
      { description: 'Tea', quantity: 0 }
    ])
    expect(items).toEqual([
      { name: 'Momo', quantity: 2 },
      { name: 'Tea', quantity: 1 }
    ])
  })

  it('rejects an empty item list', () => {
    expect(() => normalizeKitchenItems([])).toThrow(/no kitchen items/i)
    expect(() => normalizeKitchenItems(null)).toThrow(/no kitchen items/i)
  })
})
