import { hashPassword } from "../auth/password.js";
import { findUserByUsername, insertUser, listUsers } from "../data/users.js";
import { writeAudit } from "../lib/audit.js";
import { conflict } from "../lib/errors.js";
import { createUserSchema } from "../validation/schemas.js";

const ADMINISTRATOR_ONLY = ["administrator"];

export function registerUserRoutes({ registrar, db }) {
  registrar.defineRoute({
    method: "GET",
    path: "/api/users",
    access: ADMINISTRATOR_ONLY,
    handler: async (req, res) => {
      const users = await listUsers(db);
      res.json({ users });
    },
  });

  registrar.defineRoute({
    method: "POST",
    path: "/api/users",
    access: ADMINISTRATOR_ONLY,
    body: createUserSchema,
    handler: async (req, res, next) => {
      const { username, fullName, role, password, email } = req.body;

      const taken = await findUserByUsername(db, username);
      if (taken) return next(conflict("That username is already taken."));

      let createdUser;
      try {
        createdUser = await insertUser(db, {
          username,
          email,
          fullName,
          passwordHash: hashPassword(password),
          role,
          isActive: true,
        });
      } catch (error) {
        if (error.code === "23505") {
          return next(conflict("That username is already taken."));
        }
        throw error;
      }

      await writeAudit(db, {
        actorUserId: req.user.id,
        action: "user.create",
        entityType: "user",
        entityId: createdUser.id,
        newValue: { username, fullName, role },
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
      });

      res.status(201).json({ user: createdUser });
    },
  });
}
