// Renderer-synced flag: true while a staff till or wizard cart has unsaved items.
// auth:switch-staff-pin refuses to run when this is set.
let hasItems = false

export function setCartGuard(value) {
  hasItems = !!value
}

export function cartHasItems() {
  return hasItems
}
