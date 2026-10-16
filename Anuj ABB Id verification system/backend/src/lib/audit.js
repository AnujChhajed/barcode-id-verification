import { logger } from "./logger.js";

/**
 * Business audit trail. Every privileged or state-changing action goes here.
 *
 * Rules:
 *   - Append only. Never updated or deleted.
 *   - Never stores passwords, tokens, keys or unnecessary personal data.
 *   - `oldValue` / `newValue` are JSON snapshots; callers must pass only the
 *     fields that actually changed and that are safe to retain.
 */
export async function writeAudit(pool, entry) {
  try {
    await pool.query(
      `INSERT INTO audit_logs (
         actor_id, action, entity_type, entity_id,
         old_values, new_values, reason, ip_address, user_agent, occurred_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW());`,
      [
        entry.actorUserId || null,
        entry.action,
        entry.entityType,
        entry.entityId ? String(entry.entityId) : null,
        entry.oldValue === undefined || entry.oldValue === null ? null : JSON.stringify(entry.oldValue),
        entry.newValue === undefined || entry.newValue === null ? null : JSON.stringify(entry.newValue),
        entry.reason || null,
        entry.ipAddress || null,
        entry.userAgent || null,
      ],
    );
  } catch (error) {
    logger.error("Failed to write audit log entry", { action: entry.action, error: error.message });
  }
}
