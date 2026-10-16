import { hashPassword } from "../auth/password.js";
import { writeAudit } from "../lib/audit.js";
import { conflict } from "../lib/errors.js";
import { newId } from "../lib/ids.js";
import { nowIso } from "../lib/time.js";
import { createUserSchema } from "../validation/schemas.js";

/** Administrator-only. Security staff must never reach these routes. */
const ADMINISTRATOR_ONLY = ["administrator"];

const USER_COLUMNS = "id, username, email, full_name, role, is_active, created_at, last_login_at";

function toUserView(row) {
  return {
    id: row.id,
    username: row.username,
    email: row.email ?? null,
    fullName: row.full_name,
    role: row.role,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at ?? null,
  };
}

export function registerUserRoutes({ registrar, db }) {
  registrar.defineRoute({
    method: "GET",
    path: "/api/users",
    access: ADMINISTRATOR_ONLY,
    handler: (req, res) => {
      // Explicit column list: the password hash can never leave the database.
      const rows = db
        .prepare(`SELECT ${USER_COLUMNS} FROM users ORDER BY username COLLATE NOCASE`)
        .all();
      res.json({ users: rows.map(toUserView) });
    },
  });

  registrar.defineRoute({
    method: "POST",
    path: "/api/users",
    access: ADMINISTRATOR_ONLY,
    body: createUserSchema,
    handler: (req, res, next) => {
      const { username, fullName, role, password, email } = req.body;

      const taken = db
        .prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE")
        .get(username);
      if (taken) return next(conflict("That username is already taken."));

      const id = newId();
      const timestamp = nowIso();
      try {
        db.prepare(
          `INSERT INTO users
             (id, username, email, full_name, password_hash, role, is_active, created_at, updated_at, last_login_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, NULL)`,
        ).run(id, username, email ?? null, fullName, hashPassword(password), role, timestamp, timestamp);
      } catch (error) {
        if (String(error?.code ?? "").startsWith("SQLITE_CONSTRAINT")) {
          return next(conflict("That username is already taken."));
        }
        throw error;
      }

      writeAudit(db, {
        actorUserId: req.user.id,
        action: "user.create",
        entityType: "user",
        entityId: id,
        newValue: { username, fullName, role },
      });

      const created = db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).get(id);
      res.status(201).json({ user: toUserView(created) });
    },
  });
}
