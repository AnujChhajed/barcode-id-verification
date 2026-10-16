import { listSettings, readSetting, updateSetting } from "../data/settings.js";
import { writeAudit } from "../lib/audit.js";
import { updateSettingSchema } from "../validation/schemas.js";

/**
 * Security staff may READ settings, but only the keys the gate screen needs.
 * Everything else is administrator-only.
 */
const GATE_READABLE_KEYS = new Set([
  "site.timezone",
  "session.timeout_minutes",
  "scan.duplicate_window_seconds",
]);

export function registerSettingsRoutes({ registrar, db }) {
  registrar.defineRoute({
    method: "GET",
    path: "/api/settings",
    access: ["administrator", "security_staff"],
    handler: async (req, res) => {
      const rows = await listSettings(db);
      const visible =
        req.user.role === "administrator"
          ? rows
          : rows.filter((row) => GATE_READABLE_KEYS.has(row.key));

      res.json({ settings: visible });
    },
  });

  registrar.defineRoute({
    method: "PUT",
    path: "/api/settings",
    access: ["administrator"],
    body: updateSettingSchema,
    handler: async (req, res) => {
      const { key, value } = req.body;
      const previousValue = await readSetting(db, key);

      const updated = await updateSetting(db, key, value, req.user.id);

      await writeAudit(db, {
        actorUserId: req.user.id,
        action: "setting.update",
        entityType: "setting",
        entityId: key,
        oldValue: previousValue ? { value: previousValue } : null,
        newValue: { value },
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
      });

      res.json({ setting: updated });
    },
  });
}
