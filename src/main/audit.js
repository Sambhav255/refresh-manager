import { getDb } from './db/index.js'

// 2-E: append-only audit trail. Writing to it must never break the primary
// action, so failures are swallowed (the log is best-effort tamper-evidence,
// not a transactional dependency). `detail` may be a string or any JSON-able
// value; objects are stringified.
export function writeAudit(actorUserId, action, detail) {
  try {
    const text =
      detail == null ? null : typeof detail === 'string' ? detail : JSON.stringify(detail)
    getDb()
      .prepare(`INSERT INTO audit_log (actor_user_id, action, detail) VALUES (?, ?, ?)`)
      .run(actorUserId ?? null, action, text)
  } catch {
    /* never let audit logging break the caller */
  }
}
