// Kitchen ticket item formatting — no Electron deps so unit tests can import it.
export function normalizeKitchenItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('No kitchen items to print')
  }
  return items.map((row) => ({
    name: String(row.name || row.description || 'Item').trim() || 'Item',
    quantity: Math.max(1, Number(row.quantity) || 1)
  }))
}
