// E2E: create a backup, add a sale, restore, verify the post-backup sale is gone.
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { launchApp, completeSetup, loginOwner, OWNER } from './harness.mjs'

const backupDir = mkdtempSync(join(tmpdir(), 'refresh-e2e-restore-bak-'))
const { app, page, userDataDir, errors, cleanup } = await launchApp({
  area: 'restore',
  keepData: null,
  e2eBackupDir: backupDir
})
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
}

try {
  await completeSetup(page)

  const backup = await page.evaluate(async () => {
    const r = await window.api.createBackup({})
    return { success: r?.success, error: r?.error, filePath: r?.filePath }
  })
  check('backup succeeds', backup.success === true, backup.error || backup.filePath)

  const afterSale = await page.evaluate(async () => {
    const prod = await window.api.addProduct({
      name: 'Pool Day Pass',
      category: 'day_pass',
      price: 300
    })
    await window.api.createTransaction({
      type: 'day_pass',
      source: 'pool',
      customerName: 'after-backup-sale',
      productId: prod.productId,
      paymentMethod: 'cash'
    })
    const tx = await window.api.listTransactions({})
    return {
      count: (tx.transactions || []).length,
      names: (tx.transactions || []).map((t) => t.customer)
    }
  })
  check('sale exists after backup', afterSale.count >= 1 && afterSale.names.includes('after-backup-sale'))

  const restore = await page.evaluate(
    async ({ filePath, password }) =>
      window.api.restoreBackup({ backupFilePath: filePath, password }),
    { filePath: backup.filePath, password: OWNER.password }
  )
  check('restore accepted', restore?.success === true, restore?.error)

  // Restore schedules relaunch + quit; wait for the process to exit.
  await Promise.race([
    app.close().catch(() => {}),
    page.waitForEvent('close', { timeout: 15000 }).catch(() => {})
  ])

  const relaunched = await launchApp({ area: 'restore', keepData: userDataDir })
  try {
    await relaunched.page.waitForSelector('text=Owner / Admin Login', { timeout: 20000 })
    await loginOwner(relaunched.page)

    const afterRestore = await relaunched.page.evaluate(async () => {
      const tx = await window.api.listTransactions({})
      return {
        count: (tx.transactions || []).length,
        names: (tx.transactions || []).map((t) => t.customer)
      }
    })
    check(
      'post-backup sale is gone after restore',
      !afterRestore.names.includes('after-backup-sale'),
      JSON.stringify(afterRestore.names)
    )
  } finally {
    await relaunched.app.close().catch(() => {})
  }

  console.log('\nconsole errors:', errors.length ? errors : 'none')
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length) {
    console.log('\nFAILED:')
    failed.forEach((f) => console.log(` - ${f.name} :: ${f.detail}`))
    process.exitCode = 1
  }
} finally {
  await app.close().catch(() => {})
  cleanup()
}
