import { launchApp, completeSetup, shot, ownerTab } from './harness.mjs'
import { existsSync } from 'fs'
import { join } from 'path'

const { app, page, userDataDir, errors, cleanup } = await launchApp({ area: 'smoke' })
console.log('userDataDir:', userDataDir)

await completeSetup(page)
console.log('setup complete; db isolated:', existsSync(join(userDataDir, 'refresh.db')))

await shot(page, 'smoke', '01-owner-dashboard')

for (const tab of [
  'Transactions',
  'Members',
  'Bookings',
  'Inventory',
  'Restaurant',
  'Reports',
  'Settings'
]) {
  await ownerTab(page, tab)
  console.log('visited:', tab)
}
await shot(page, 'smoke', '02-owner-settings')

console.log('console errors:', errors.length ? errors : 'none')
await app.close()
cleanup()
console.log('SMOKE OK')
