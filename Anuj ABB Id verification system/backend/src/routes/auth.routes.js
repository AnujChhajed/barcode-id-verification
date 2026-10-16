import { AUTHENTICATED, PUBLIC } from "../auth/middleware.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { createSession, revokeSession } from "../auth/sessions.js";
import { config } from "../config.js";
import { writeAudit } from "../lib/audit.js";
import { tooManyRequests, unauthorized } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { nowIso } from "../lib/time.js";
import { loginSchema } from "../validation/schemas.js";

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "strict",
  secure: config.sessionCookieSecure,
  path: "/",
};

/**
 * A throwaway hash verified when the username does not exist, so a missing
 * account and a wrong password cost the same time — no username enumeration.
 */
const ABSENT_USER_HASH = hashPassword("absent-user-placeholder");

function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    role: row.role,
    email: row.email ?? null,
  };
}

export function registerAuthRoutes({ registrar, db, rateLimiter, sessionTimeoutMinutes }) {
  const selectUserByUsername = db.prepare("SELECT * FROM users WHERE username = ?");

  registrar.defineRoute({
    method: "POST",
    path: "/api/auth/login",
    access: PUBLIC,
    body: loginSchema,
    handler: (req, res, next) => {
      const { username, password } = req.body;
      const rateKey = `login:${username.toLowerCase()}:${req.ip ?? "unknown"}`;

      if (!rateLimiter.check(rateKey).allowed) {
        logger.warn("login rate limited", { username });
        return next(tooManyRequests());
      }

      const user = selectUserByUsername.get(username);
      const passwordOk = verifyPassword(password, user ? user.password_hash : ABSENT_USER_HASH);

      if (!user || !passwordOk || !user.is_active) {
        logger.warn("login failed", { username });
        return next(unauthorized("Invalid username or password."));
      }

      rateLimiter.reset(rateKey);

      const session = createSession(db, { userId: user.id, timeoutMinutes: sessionTimeoutMinutes });
      db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(nowIso(), user.id);
      writeAudit(db, {
        actorUserId: user.id,
        action: "auth.login",
        entityType: "user",
        entityId: user.id,
      });

      res.cookie(config.sessionCookieName, session.token, {
        ...COOKIE_OPTIONS,
        expires: new Date(session.expiresAt),
      });
      logger.info("login succeeded", { userId: user.id, role: user.role });
      res.json({ user: publicUser(user), expiresAt: session.expiresAt });
    },
  });

  registrar.defineRoute({
    method: "POST",
    path: "/api/auth/logout",
    access: AUTHENTICATED,
    handler: (req, res) => {
      if (req.sessionId) revokeSession(db, req.sessionId);
      writeAudit(db, {
        actorUserId: req.user.id,
        action: "auth.logout",
        entityType: "user",
        entityId: req.user.id,
      });
      res.clearCookie(config.sessionCookieName, COOKIE_OPTIONS);
      res.json({ ok: true });
    },
  });

  registrar.defineRoute({
    method: "GET",
    path: "/api/auth/me",
    access: AUTHENTICATED,
    handler: (req, res) => {
      res.json({ user: req.user });
    },
  });
}
