import { hashToken, newToken } from "../lib/ids.js";
import { addMinutes } from "../lib/time.js";

/**
 * Server-side sessions using PostgreSQL.
 *
 * The raw token lives only in the client cookie; the database stores its
 * SHA-256 hash. Sessions expire, can be revoked individually (logout) or in
 * bulk (password change, account suspension), and are validated fail-closed.
 */

export async function createSession(pool, { userId, timeoutMinutes }) {
  const token = newToken();
  const sessionId = hashToken(token);
  const now = new Date();
  const expiresAt = addMinutes(now, timeoutMinutes);

  await pool.query(
    `INSERT INTO sessions (id, user_id, created_at, expires_at, revoked_at, last_seen_at)
     VALUES ($1, $2, NOW(), $3, NULL, NOW());`,
    [sessionId, userId, expiresAt],
  );

  return { token, sessionId, expiresAt };
}

/** Returns the session row only when it is present, unrevoked and unexpired. */
export async function findActiveSession(pool, token, now = new Date()) {
  if (typeof token !== "string" || token.length === 0) return null;
  const sessionId = hashToken(token);

  const { rows } = await pool.query(
    `SELECT * FROM sessions
     WHERE id = $1 AND revoked_at IS NULL AND expires_at > $2
     LIMIT 1;`,
    [sessionId, now],
  );

  return rows[0] || null;
}

export async function touchSession(pool, sessionId, now = new Date()) {
  await pool.query("UPDATE sessions SET last_seen_at = NOW() WHERE id = $1;", [sessionId]);
}

export async function revokeSession(pool, sessionId) {
  await pool.query(
    "UPDATE sessions SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL;",
    [sessionId],
  );
}

export async function revokeAllSessionsForUser(pool, userId) {
  await pool.query(
    "UPDATE sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL;",
    [userId],
  );
}

/** Housekeeping: drop sessions that expired or were revoked before `beforeIso`. */
export async function purgeStaleSessions(pool, before) {
  const { rowCount } = await pool.query(
    "DELETE FROM sessions WHERE expires_at < $1 OR (revoked_at IS NOT NULL AND revoked_at < $1);",
    [before],
  );
  return rowCount;
}
