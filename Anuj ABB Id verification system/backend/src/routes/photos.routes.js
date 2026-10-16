import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { findPersonById } from "../data/persons.js";
import { notFound } from "../lib/errors.js";

const GATE_ROLES = ["administrator", "security_staff"];

export function registerPhotoRoutes({ registrar, db }) {
  registrar.defineRoute({
    method: "GET",
    path: "/api/photos/:id",
    access: GATE_ROLES,
    handler: async (req, res, next) => {
      const person = await findPersonById(db, req.params.id);
      if (!person || !person.photo_path) {
        return next(notFound("No photo on record."));
      }

      // Prevent directory traversal
      const safeBasename = path.basename(person.photo_path);
      const fullPath = path.resolve(config.uploadsDir, "photos", safeBasename);

      if (!fullPath.startsWith(path.resolve(config.uploadsDir))) {
        return next(notFound("Invalid photo path."));
      }

      if (!fs.existsSync(fullPath)) {
        return next(notFound("Photo file not found on server."));
      }

      res.sendFile(fullPath);
    },
  });
}
