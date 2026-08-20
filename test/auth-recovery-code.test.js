import { describe, it, expect, beforeEach } from 'vitest'
import { __invoke } from 'electron'
import { freshDb, seed, loginOwner, loginStaff, OWNER_PASSWORD } from './helpers.js'
import { clearSession, getSession } from '../src/main/session.js'

let db, ids

beforeEach(() => {
  db = freshDb()
  ids = seed(db)
})

const HASH_KEY = 'recovery_code_hash'
const ISSUED_KEY = 'recovery_code_issued_at'

const setting = (key) => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value

// Convenience: mint a code as the seeded owner and drop the session again, so
// each test starts from "nobody is signed in", which is the real situation.
async function issueCode(currentPassword = OWNER_PASSWORD) {
  loginOwner(ids)
  const r = await __invoke('auth:issue-recovery-code', { currentPassword })
  clearSession()
  return r
}

// The recovery throttle lives in main-process memory, so freshDb() cannot reach
// it and failed attempts accumulate across tests in this file. Every test that
// burns an attempt therefore ends with a SUCCESSFUL recovery, which zeroes the
// counter — and the throttle test itself is deliberately last, because it is
// the only one that leaves a live cooldown behind.
async function successfulRecovery(newPassword) {
  const { code } = await issueCode()
  const res = await __invoke('auth:recover-with-code', {
    code,
    adminName: 'Owner',
    newPassword
  })
  expect(res.success).toBe(true)
  return res
}

describe('issuing a recovery code', () => {
  it('requires the current admin password, so an unattended screen cannot mint one', async () => {
    loginOwner(ids)

    const noPassword = await __invoke('auth:issue-recovery-code', {})
    expect(noPassword.success).toBe(false)
    expect(noPassword.error).toMatch(/current password/i)

    const wrong = await __invoke('auth:issue-recovery-code', { currentPassword: 'notmypassword' })
    expect(wrong.success).toBe(false)
    expect(wrong.error).toMatch(/current password/i)

    // Nothing was written on the way out.
    expect(setting(HASH_KEY)).toBeUndefined()
    expect((await __invoke('auth:has-recovery-code', {})).exists).toBe(false)

    const ok = await __invoke('auth:issue-recovery-code', { currentPassword: OWNER_PASSWORD })
    expect(ok.success).toBe(true)
    expect(ok.code).toBeTruthy()
  })

  it('refuses staff and anonymous callers outright', async () => {
    loginStaff(ids)
    const asStaff = await __invoke('auth:issue-recovery-code', { currentPassword: OWNER_PASSWORD })
    expect(asStaff.success).toBe(false)

    clearSession()
    const anon = await __invoke('auth:issue-recovery-code', { currentPassword: OWNER_PASSWORD })
    expect(anon.success).toBe(false)

    expect(setting(HASH_KEY)).toBeUndefined()
  })

  it('returns the code exactly once and stores only a hash of it', async () => {
    const { code } = await issueCode()

    // Format: four groups of five, from an alphabet with no 0/O/1/I/L/U.
    expect(code).toMatch(/^[2-9A-HJKMNP-TV-Z]{5}(-[2-9A-HJKMNP-TV-Z]{5}){3}$/)
    expect(code).not.toMatch(/[01ILOU]/)

    const stored = setting(HASH_KEY)
    expect(stored).toMatch(/^\$2[aby]\$/)
    expect(stored).not.toContain(code)
    expect(stored).not.toContain(code.replace(/-/g, ''))
    expect(setting(ISSUED_KEY)).toBeTruthy()

    // The plaintext must not have leaked into any other settings row either.
    const blob = JSON.stringify(db.prepare('SELECT key, value FROM settings').all())
    expect(blob).not.toContain(code.replace(/-/g, ''))

    // There is no handler that hands it back — has-recovery-code reports only
    // that one exists.
    loginOwner(ids)
    const has = await __invoke('auth:has-recovery-code', {})
    expect(has.exists).toBe(true)
    expect(has.issuedAt).toBeTruthy()
    expect(JSON.stringify(has)).not.toContain(code.replace(/-/g, ''))

    // Two codes generated back to back are not the same code.
    const second = await __invoke('auth:issue-recovery-code', { currentPassword: OWNER_PASSWORD })
    expect(second.code).not.toBe(code)
  })

  it('is audited when issued', async () => {
    await issueCode()
    loginOwner(ids)
    const log = await __invoke('audit:list', { action: 'admin:recovery-code-issued' })
    expect(log.entries.length).toBe(1)
    expect(log.entries[0].actor_name).toBe('Owner')
  })
})

describe('recovering with the code', () => {
  it('sets the new password, and the new password logs in while the old one does not', async () => {
    const { code } = await issueCode()

    const res = await __invoke('auth:recover-with-code', {
      code,
      adminName: 'Owner',
      newPassword: 'rescued99'
    })
    expect(res.success).toBe(true)

    const old = await __invoke('auth:login', { username: 'Owner', password: OWNER_PASSWORD })
    expect(old.success).toBe(false)

    const fresh = await __invoke('auth:login', { username: 'Owner', password: 'rescued99' })
    expect(fresh.success).toBe(true)
    expect(fresh.user.role).toBe('owner')
    expect(fresh.user.userId).toBe(ids.ownerId)
  })

  it('accepts the code without dashes, in lower case, or with stray spaces', async () => {
    const { code } = await issueCode()
    const messy = ' ' + code.replace(/-/g, ' ').toLowerCase() + ' '

    const res = await __invoke('auth:recover-with-code', {
      code: messy,
      adminName: '  Owner  ',
      newPassword: 'typedbadly'
    })
    expect(res.success).toBe(true)

    clearSession()
    expect(
      (await __invoke('auth:login', { username: 'Owner', password: 'typedbadly' })).success
    ).toBe(true)
  })

  it('grants no session — it buys a password, nothing more', async () => {
    const { code } = await issueCode()
    clearSession()

    const res = await __invoke('auth:recover-with-code', {
      code,
      adminName: 'Owner',
      newPassword: 'rescued99'
    })
    expect(res.success).toBe(true)

    // No session, and every owner-gated handler still says no.
    expect(getSession()).toBeNull()
    expect((await __invoke('auth:get-session', {})).user).toBeNull()
    expect((await __invoke('auth:list-admins', {})).success).toBe(false)
    expect((await __invoke('audit:list', {})).success).toBe(false)

    // And it created nobody: still exactly the seeded owner and staff member.
    const counts = db
      .prepare(`SELECT role, COUNT(*) AS n FROM users GROUP BY role`)
      .all()
      .reduce((acc, r) => ({ ...acc, [r.role]: r.n }), {})
    expect(counts).toEqual({ owner: 1, staff: 1 })
  })

  it('cannot be used twice — the code is spent on success', async () => {
    const { code } = await issueCode()

    expect(
      (
        await __invoke('auth:recover-with-code', {
          code,
          adminName: 'Owner',
          newPassword: 'first99'
        })
      ).success
    ).toBe(true)

    // Both settings rows are gone, not just blanked.
    expect(setting(HASH_KEY)).toBeUndefined()
    expect(setting(ISSUED_KEY)).toBeUndefined()
    expect((await __invoke('auth:has-recovery-code', {})).exists).toBe(false)

    const replay = await __invoke('auth:recover-with-code', {
      code,
      adminName: 'Owner',
      newPassword: 'second99'
    })
    expect(replay.success).toBe(false)

    // The replay changed nothing: the first password still works.
    expect(
      (await __invoke('auth:login', { username: 'Owner', password: 'second99' })).success
    ).toBe(false)
    expect((await __invoke('auth:login', { username: 'Owner', password: 'first99' })).success).toBe(
      true
    )
  })

  it('issuing a second code invalidates the first, so only one key is ever live', async () => {
    const { code: first } = await issueCode()
    const { code: second } = await issueCode()
    expect(second).not.toBe(first)

    const stale = await __invoke('auth:recover-with-code', {
      code: first,
      adminName: 'Owner',
      newPassword: 'staleuse'
    })
    expect(stale.success).toBe(false)
    expect(stale.error).toMatch(/not valid/i)
    expect(
      (await __invoke('auth:login', { username: 'Owner', password: 'staleuse' })).success
    ).toBe(false)

    // The replacement works — and clears the attempt the stale code just cost.
    const ok = await __invoke('auth:recover-with-code', {
      code: second,
      adminName: 'Owner',
      newPassword: 'liveuse9'
    })
    expect(ok.success).toBe(true)
    expect(
      (await __invoke('auth:login', { username: 'Owner', password: 'liveuse9' })).success
    ).toBe(true)
  })

  it('says so plainly when no code was ever set up, rather than pretending', async () => {
    const res = await __invoke('auth:recover-with-code', {
      code: 'ABCDE-ABCDE-ABCDE-ABCDE',
      adminName: 'Owner',
      newPassword: 'nochance'
    })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/no recovery code/i)
  })

  it('rejects a short new password without touching the code', async () => {
    const { code } = await issueCode()
    const short = await __invoke('auth:recover-with-code', {
      code,
      adminName: 'Owner',
      newPassword: 'ab'
    })
    expect(short.success).toBe(false)
    expect(short.error).toMatch(/4 characters/i)
    expect(setting(HASH_KEY)).toBeTruthy()

    // Still usable afterwards.
    await successfulRecovery('recovered1')
  })

  it('rejects a wrong code, changes nothing, and audits the attempt', async () => {
    await issueCode()

    const bad = await __invoke('auth:recover-with-code', {
      code: 'ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ',
      adminName: 'Owner',
      newPassword: 'intruder1'
    })
    expect(bad.success).toBe(false)
    expect(bad.error).toMatch(/not valid/i)

    // Nothing moved: password unchanged, code still live.
    expect(
      (await __invoke('auth:login', { username: 'Owner', password: 'intruder1' })).success
    ).toBe(false)
    expect(
      (await __invoke('auth:login', { username: 'Owner', password: OWNER_PASSWORD })).success
    ).toBe(true)
    expect(setting(HASH_KEY)).toBeTruthy()

    // A failed attempt is exactly what the owner needs to see in the log.
    loginOwner(ids)
    const failures = await __invoke('audit:list', { action: 'admin:recovery-failed' })
    expect(failures.entries.length).toBe(1)
    // Nobody was signed in, so there is no actor to name.
    expect(failures.entries[0].actor_name).toBeNull()
    expect(JSON.parse(failures.entries[0].detail)).toMatchObject({ reason: 'bad-code' })
    clearSession()

    await successfulRecovery('recovered1')
  })

  it('audits a successful use', async () => {
    await successfulRecovery('recovered1')
    loginOwner(ids)
    const used = await __invoke('audit:list', { action: 'admin:recovery-used' })
    expect(used.entries.length).toBe(1)
    expect(JSON.parse(used.entries[0].detail)).toMatchObject({
      userId: ids.ownerId,
      name: 'Owner'
    })
  })

  it('does not reveal whether an admin name exists', async () => {
    const { code } = await issueCode()

    // Right code, name that does not exist.
    const ghost = await __invoke('auth:recover-with-code', {
      code,
      adminName: 'Nobody At All',
      newPassword: 'probe123'
    })
    // Wrong code, name that does exist.
    const wrongCode = await __invoke('auth:recover-with-code', {
      code: 'ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ',
      adminName: 'Owner',
      newPassword: 'probe123'
    })

    expect(ghost.success).toBe(false)
    expect(wrongCode.success).toBe(false)
    // Byte-for-byte identical, or the endpoint becomes an account-name oracle.
    expect(ghost.error).toBe(wrongCode.error)
    expect(ghost.error).not.toMatch(/owner|admin|name|exist|found|unknown/i)

    // The real code still works after all that probing.
    const ok = await __invoke('auth:recover-with-code', {
      code,
      adminName: 'Owner',
      newPassword: 'realuse9'
    })
    expect(ok.success).toBe(true)
  })

  it('only ever rescues an active admin, and never a staff account', async () => {
    loginOwner(ids)
    const second = await __invoke('auth:add-admin', { name: 'Admin Two', password: 'secondpass' })
    await __invoke('auth:deactivate-admin', { userId: second.userId })
    const { code } = await issueCode()

    const dead = await __invoke('auth:recover-with-code', {
      code,
      adminName: 'Admin Two',
      newPassword: 'zombie99'
    })
    expect(dead.success).toBe(false)

    // A staff name is not an admin name, and must not read differently either.
    const staffName = await __invoke('auth:recover-with-code', {
      code,
      adminName: 'Staff',
      newPassword: 'zombie99'
    })
    expect(staffName.error).toBe(dead.error)

    // The deactivated account's password is untouched, and it still cannot log in.
    const staffRow = db.prepare('SELECT pin_hash FROM users WHERE id = ?').get(ids.staffId)
    expect(staffRow.pin_hash).toBeTruthy()
    expect(
      (await __invoke('auth:login', { username: 'Admin Two', password: 'zombie99' })).success
    ).toBe(false)

    const ok = await __invoke('auth:recover-with-code', {
      code,
      adminName: 'Owner',
      newPassword: 'realuse9'
    })
    expect(ok.success).toBe(true)
  })
})

// Deliberately LAST: this is the only test that leaves a live cooldown in
// main-process memory, which freshDb() cannot clear.
describe('recovery is throttled', () => {
  it('locks out after repeated wrong codes, and says so on the attempt that arms it', async () => {
    await issueCode()

    const first = await __invoke('auth:recover-with-code', {
      code: 'ZZZZZ-ZZZZZ-ZZZZZ-AAAAA',
      adminName: 'Owner',
      newPassword: 'guess111'
    })
    expect(first.error).toMatch(/not valid/i)
    expect(first.error).not.toMatch(/try again/i)

    const second = await __invoke('auth:recover-with-code', {
      code: 'ZZZZZ-ZZZZZ-ZZZZZ-BBBBB',
      adminName: 'Owner',
      newPassword: 'guess222'
    })
    expect(second.error).not.toMatch(/try again/i)

    // The attempt that arms the lock says so, rather than letting the next one
    // discover a wait that already started.
    const third = await __invoke('auth:recover-with-code', {
      code: 'ZZZZZ-ZZZZZ-ZZZZZ-CCCCC',
      adminName: 'Owner',
      newPassword: 'guess333'
    })
    expect(third.success).toBe(false)
    expect(third.error).toMatch(/too many attempts/i)
    expect(third.error).toMatch(/minute/i)

    // The cooldown is stricter than the password path's one minute.
    expect(third.error).toMatch(/15 minutes/)

    // While locked, even the CORRECT code is refused — the lock is not a
    // per-guess check that a lucky attacker can slip past.
    const { code } = await issueCode()
    const locked = await __invoke('auth:recover-with-code', {
      code,
      adminName: 'Owner',
      newPassword: 'legit999'
    })
    expect(locked.success).toBe(false)
    expect(locked.error).toMatch(/too many attempts/i)
    expect(
      (await __invoke('auth:login', { username: 'Owner', password: 'legit999' })).success
    ).toBe(false)

    // Every guess landed in the audit trail.
    loginOwner(ids)
    const failures = await __invoke('audit:list', { action: 'admin:recovery-failed' })
    expect(failures.entries.length).toBe(3)
  })
})
