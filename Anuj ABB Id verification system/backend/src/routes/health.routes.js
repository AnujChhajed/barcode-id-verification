import { PUBLIC } from "../auth/middleware.js";
import { nowIso } from "../lib/time.js";

export function registerHealthRoutes({ registrar, db }) {
  registrar.defineRoute({
    method: "GET",
    path: "/api/health",
    access: PUBLIC,
    handler: async (req, res) => {
      let database = "ready";
      try {
        await db.query("SELECT 1 AS ok;");
      } catch {
        database = "unavailable";
      }
      // Deliberately returns no credentials, counts, paths or versions.
      res.json({
        status: database === "ready" ? "ok" : "degraded",
        database,
        time: nowIso(),
      });
    },
  });
}
