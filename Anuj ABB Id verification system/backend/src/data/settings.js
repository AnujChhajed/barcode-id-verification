import { dateKeyInZone } from "../lib/time.js";

export const DEFAULT_SITE_TIMEZONE = "Asia/Kolkata";

export async function readSetting(pool, key, fallback = null) {
  const { rows } = await pool.query("SELECT value FROM settings WHERE key = $1;", [key]);
  return rows.length > 0 ? rows[0].value : fallback;
}

export async function readIntegerSetting(pool, key, fallback, bounds = {}) {
  const raw = await readSetting(pool, key);
  if (raw === null || raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed)) return fallback;
  if (bounds.min !== undefined && parsed < bounds.min) return fallback;
  if (bounds.max !== undefined && parsed > bounds.max) return fallback;
  return parsed;
}

export async function siteTimezone(pool) {
  return (await readSetting(pool, "site.timezone")) || DEFAULT_SITE_TIMEZONE;
}

export async function siteToday(pool) {
  const zone = await siteTimezone(pool);
  return dateKeyInZone(new Date(), zone);
}

export async function listSettings(pool) {
  const { rows } = await pool.query(
    "SELECT key, value, description, updated_at FROM settings ORDER BY key ASC;",
  );
  return rows.map((r) => ({
    key: r.key,
    value: r.value,
    description: r.description,
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : new Date().toISOString(),
  }));
}

export async function updateSetting(pool, key, value, updatedBy = null) {
  const { rows } = await pool.query(
    `INSERT INTO settings (key, value, updated_at, updated_by)
     VALUES ($1, $2, NOW(), $3)
     ON CONFLICT (key) DO UPDATE
     SET value = EXCLUDED.value, updated_at = NOW(), updated_by = EXCLUDED.updated_by
     RETURNING key, value, updated_at;`,
    [key, value, updatedBy],
  );
  const r = rows[0];
  return {
    key: r.key,
    value: r.value,
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}
