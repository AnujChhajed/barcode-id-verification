import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";

/**
 * Robust, transactional PostgreSQL migration runner.
 *
 * Each `.sql` file in `migrations/` is executed exactly once, in alphanumeric order,
 * within an isolated transaction, and tracked in the `schema_migrations` table.
 */

export function migrationFiles(dir = config.migrationsDir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

export async function ensureMigrationTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     VARCHAR(100) PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

export async function appliedMigrations(pool) {
  await ensureMigrationTable(pool);
  const { rows } = await pool.query("SELECT version FROM schema_migrations ORDER BY version ASC;");
  return new Set(rows.map((row) => row.version));
}

export async function pendingMigrations(pool, dir = config.migrationsDir) {
  const applied = await appliedMigrations(pool);
  return migrationFiles(dir).filter((file) => !applied.has(path.basename(file, ".sql")));
}

export async function runMigrations(pool, { dir = config.migrationsDir } = {}) {
  await ensureMigrationTable(pool);
  const applied = await appliedMigrations(pool);
  const results = [];

  for (const file of migrationFiles(dir)) {
    const version = path.basename(file, ".sql");
    if (applied.has(version)) {
      results.push({ version, status: "skipped" });
      continue;
    }

    const filePath = path.join(dir, file);
    const sql = fs.readFileSync(filePath, "utf8");

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (version, applied_at) VALUES ($1, NOW()) ON CONFLICT (version) DO NOTHING;",
        [version],
      );
      await client.query("COMMIT");
      results.push({ version, status: "applied" });
      logger.info("migration applied", { version });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      logger.error("migration failed", { version, error: error.message });
      throw new Error(`Migration ${version} failed: ${error.message}`);
    } finally {
      client.release();
    }
  }

  return results;
}
