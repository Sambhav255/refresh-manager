// Drives the recovery-code feature through the real UI:
//   1. A fresh install nudges the owner from the dashboard to set one up.
//   2. Settings -> Staff & Admins generates it behind the current password,
//      shows it once, and never shows it again.
//   3. The nudge disappears once a code exists.
//   4. The code actually rescues a locked-out admin from the login screen, and
//      is spent in the process.
//
// (4) goes through window.api rather than a form on purpose: the login-screen
// entry point lives in App.jsx and is owned by another agent. Calling the same
// preload channel that screen will call proves the whole chain — renderer,
// preload, IPC handler, database — is wired and working underneath it.
import { launchApp, completeSetup, loginOwner, ownerTab, shot, OWNER } from './harness.mjs'

const { app, page, errors, cleanup } = await launchApp({ area: 'recovery' })
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
}
const tab = async (label) => ownerTab(page, label)
const openStaffAdmins = async () => {
  await tab('Settings')
  await page.click('.settings-card:has-text("Staff PINs")')
  await page.waitForSelector('text=Staff & Admins', { timeout: 10000 })
  await page.waitForTimeout(400)
}

// Four groups of five, from an alphabet with no 0/O/1/I/L/U in it.
const CODE_RE =
  /\b[2-9A-HJKMNP-TV-Z]{5}-[2-9A-HJKMNP-TV-Z]{5}-[2-9A-HJKMNP-TV-Z]{5}-[2-9A-HJKMNP-TV-Z]{5}\b/

try {
  await completeSetup(page)

  // ---------- 1. The dashboard prompt on a fresh install ----------
  await tab('Dashboard')
  const promptSelector = '.alert:has-text("No recovery code set")'
  const promptCount = await page.locator(promptSelector).count()
  check('dashboard prompts for a recovery code when none exists', promptCount === 1)

  if (promptCount) {
    const promptClass = await page.locator(promptSelector).first().getAttribute('class')
    // Prevention, not an error: amber is the same tone as "memberships
    // expiring", not the red used for a failed backup.
    check(
      'the prompt is a quiet amber nudge, not a red alarm',
      /amber/.test(promptClass) && !/red/.test(promptClass),
      promptClass
    )
    const promptText = await page.locator(promptSelector).first().innerText()
    check(
      'the prompt explains why it matters',
      /locks you out|locked out/i.test(promptText),
      promptText.replace(/\n/g, ' ')
    )
    await shot(page, 'recovery', '01-dashboard-prompt')

    // It is a lead, not a dead end.
    await page.locator(promptSelector).first().click()
    await page.waitForTimeout(700)
    const onSettings = await page.locator('.settings-card').count()
    check('clicking the prompt opens Settings', onSettings > 0, `${onSettings} cards`)
  }

  // ---------- 2. Generating the code, gated behind the password ----------
  await openStaffAdmins()
  const before = await page.locator('.content').innerText()
  check('Staff & Admins offers a Recovery code section', /Recovery code/.test(before))
  check('it says no code is set yet', /No recovery code yet/i.test(before))
  await shot(page, 'recovery', '02-settings-no-code')

  const pwField = page.locator('input[placeholder="Your current password"]')
  const genButton = page.locator('button:has-text("Generate recovery code")')
  check('the generate button is gated by a password field', (await pwField.count()) === 1)

  // Wrong password must not mint anything.
  await pwField.fill('definitely-not-the-password')
  await genButton.click()
  await page.waitForTimeout(900)
  const afterWrong = await page.locator('.content').innerText()
  check(
    'a wrong current password is refused',
    /current password is incorrect/i.test(afterWrong),
    afterWrong.replace(/\n/g, ' ').slice(0, 120)
  )
  check('no code is revealed on a refused attempt', !CODE_RE.test(afterWrong))
  await shot(page, 'recovery', '03-wrong-password')

  // Correct password mints it.
  await pwField.fill(OWNER.password)
  await genButton.click()
  await page.waitForSelector('.recovery-code-value', { timeout: 10000 })
  const shown = (await page.locator('.recovery-code-value').innerText()).trim()
  check('the correct password generates a code', CODE_RE.test(shown), shown)

  const revealText = await page.locator('.content').innerText()
  check('it tells the owner to write it down', /write this down/i.test(revealText))
  check(
    'it warns the code will never be shown again',
    /only time it will ever be shown/i.test(revealText)
  )
  check(
    'it says a new code cancels the old one',
    /cancels this one/i.test(revealText),
    revealText.replace(/\n/g, ' ').slice(0, 160)
  )
  check(
    'it says to keep it away from this computer',
    /away from this computer|safe|drawer/i.test(revealText)
  )
  await shot(page, 'recovery', '04-code-shown-once')

  // ---------- 3. Shown once, and only once ----------
  await page.click('button:has-text("I have written it down")')
  await page.waitForTimeout(600)
  const dismissed = await page.locator('.content').innerText()
  check('dismissing hides the code', !CODE_RE.test(dismissed))
  check('the section now reports a code is set', /A recovery code is set/i.test(dismissed))
  check(
    'the button now offers to replace it',
    (await page.locator('button:has-text("Replace recovery code")').count()) === 1
  )

  // Leaving and coming back must not resurrect it — it exists on paper only.
  await tab('Dashboard')
  await openStaffAdmins()
  const revisited = await page.locator('.content').innerText()
  check('re-opening the screen never shows the code again', !CODE_RE.test(revisited))
  check('but it still knows a code exists', /A recovery code is set/i.test(revisited))
  await shot(page, 'recovery', '05-settings-code-set')

  // ---------- 4. The dashboard nudge stands down ----------
  await tab('Dashboard')
  const stillPrompting = await page.locator(promptSelector).count()
  check('the dashboard prompt disappears once a code exists', stillPrompting === 0)
  await shot(page, 'recovery', '06-dashboard-no-prompt')

  // ---------- 5. The code actually rescues a locked-out admin ----------
  await page.click('button:has-text("Log out")')
  await page.waitForSelector('text=Owner / Admin Login', { timeout: 10000 })

  const NEW_PASSWORD = 'rescued-2026'
  const wrongTry = await page.evaluate(
    (c) => window.api.recoverWithCode({ ...c, code: 'ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ' }),
    { adminName: OWNER.name, newPassword: NEW_PASSWORD }
  )
  check(
    'a wrong code is refused from the login screen',
    wrongTry?.success === false && /not valid/i.test(wrongTry.error || ''),
    wrongTry?.error
  )

  const rescue = await page.evaluate((c) => window.api.recoverWithCode(c), {
    code: shown,
    adminName: OWNER.name,
    newPassword: NEW_PASSWORD
  })
  check('the real code is accepted', rescue?.success === true, rescue?.error)

  // It reset a password; it did not let anyone in.
  const sessionAfter = await page.evaluate(() => window.api.getSession())
  check('recovery grants no session', !sessionAfter?.user, JSON.stringify(sessionAfter))
  const stillLocked = await page.locator('text=Owner / Admin Login').count()
  check('the app is still sitting on the login screen', stillLocked > 0)

  // The new password works; the old one does not.
  const oldTry = await page.evaluate((c) => window.api.login(c), {
    username: OWNER.name,
    password: OWNER.password
  })
  check('the forgotten password no longer works', oldTry?.success === false)

  await loginOwner(page, NEW_PASSWORD)
  check('the rescued admin can sign in with the new password', true)
  await shot(page, 'recovery', '07-signed-in-after-recovery')

  // ---------- 6. Single use ----------
  const replay = await page.evaluate((c) => window.api.recoverWithCode(c), {
    code: shown,
    adminName: OWNER.name,
    newPassword: 'second-go-99'
  })
  check('the code cannot be spent twice', replay?.success === false, replay?.error)
  const secondTry = await page.evaluate((c) => window.api.login(c), {
    username: OWNER.name,
    password: 'second-go-99'
  })
  check('the replay changed no password', secondTry?.success === false)

  await tab('Dashboard')
  const promptBack = await page.locator(promptSelector).count()
  check('the dashboard asks for a fresh code once the old one is spent', promptBack === 1)
  await shot(page, 'recovery', '08-dashboard-prompt-returns')
} catch (err) {
  check('script completed without throwing', false, err.message)
  try {
    await shot(page, 'recovery', '99-crash')
  } catch {
    /* the window may already be gone */
  }
} finally {
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  if (errors.length) console.log('\nRenderer errors:\n' + errors.join('\n'))
  await app.close()
  cleanup()
  process.exit(failed.length ? 1 : 0)
}
