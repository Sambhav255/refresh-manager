import { getDb } from '../db/index.js'

// P1-1: flip memberships from 'active' to 'expired' once their end_date has
// passed. Run at startup and again just after midnight so reception and the
// retention/churn reports stop treating lapsed members as active.
export function expireLapsedMemberships() {
  try {
    const result = getDb()
      .prepare(
        `UPDATE memberships
         SET status = 'expired'
         WHERE status = 'active' AND end_date < date('now','localtime')`
      )
      .run()
    if (result.changes > 0) {
      console.log(`[maintenance] expired ${result.changes} lapsed membership(s)`)
    }
    return result.changes
  } catch (err) {
    console.error('[maintenance] membership expiry job failed:', err.message)
    return 0
  }
}
