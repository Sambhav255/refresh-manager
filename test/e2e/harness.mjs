// Playwright-driven Electron harness for manual QA sweeps.
//
// Every launch gets its own --user-data-dir, so a run never touches the real
// refresh.db in ~/Library/Application Support and several agents can drive the
// app at once without tripping the single-instance lock.

import { _electron as electron } from 'playwright-core'
import { mkdtempSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'

const ROOT = resolve(fileURLToPath(import.meta.url), '../../..')
const MAIN = join(ROOT, 'out/main/index.js')

export const OWNER = { name: 'Sambhav', password: 'refresh2024' }
export const STAFF = { name: 'Reception', pin: '4821' }

// Screenshots land under docs/qa/screenshots/<area>/NN-name.png
export function shotDir(area) {
  const dir = join(ROOT, 'docs/qa/screenshots', area)
  mkdirSync(dir, { recursive: true })
  return dir
}

export async function launchApp({ area = 'misc', keepData = null } = {}) {
  const userDataDir = keepData || mkdtempSync(join(tmpdir(), `refresh-e2e-${area}-`))
  const app = await electron.launch({
    args: [MAIN, `--user-data-dir=${userDataDir}`],
    env: { ...process.env, NODE_ENV: 'production' }
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  const errors = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[console] ${m.text()}`)
  })
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))

  return {
    app,
    page,
    userDataDir,
    errors,
    cleanup: () => rmSync(userDataDir, { recursive: true, force: true })
  }
}

// First run shows the setup wizard; complete it to get an owner + staff account.
export async function completeSetup(page) {
  await page.waitForSelector('text=Welcome to Refresh Manager', { timeout: 20000 })
  const inputs = page.locator('.card input')
  await inputs.nth(0).fill(OWNER.name)
  await inputs.nth(1).fill(OWNER.password)
  await inputs.nth(2).fill(OWNER.password)
  await inputs.nth(3).fill(STAFF.name)
  await inputs.nth(4).fill(STAFF.pin)
  await page.click('button:has-text("Complete setup")')
  await page.waitForSelector('.sidebar', { timeout: 20000 })
}

export async function logout(page) {
  await page.keyboard.press('Escape')
  await page.waitForSelector('text=Owner / Admin Login', { timeout: 10000 })
}

export async function loginOwner(page) {
  await page.click('button:has-text("Owner / Admin Login")')
  const inputs = page.locator('.card input')
  await inputs.nth(0).fill(OWNER.name)
  await inputs.nth(1).fill(OWNER.password)
  await page.click('.card button:has-text("Sign in")')
  await page.waitForSelector('.sidebar', { timeout: 15000 })
}

export async function loginStaff(page) {
  await page.click('button:has-text("Staff Login")')
  await page.locator('.card input').first().fill(STAFF.pin)
  await page.waitForSelector('.botnav', { timeout: 15000 })
}

export async function ownerTab(page, label) {
  await page.click(`.nav-item:has-text("${label}")`)
  await page.waitForTimeout(600)
}

export async function shot(page, area, name) {
  const path = join(shotDir(area), `${name}.png`)
  await page.screenshot({ path })
  return path
}
