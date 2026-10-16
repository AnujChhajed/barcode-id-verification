import { config } from "../src/config.js";
import { openDatabase, closeDatabase } from "../src/db/connection.js";
import { migrationFiles, pendingMigrations, runMigrations } from "../src/db/migrate.js";

function resolveMigrationUrl() {
  const rawUrl = process.env.MIGRATION_DATABASE_URL || config.migrationDatabaseUrl || config.databaseUrl;
  if (!rawUrl || typeof rawUrl !== "string" || !rawUrl.trim()) {
    throw new Error("Migration connection URL is missing. Set MIGRATION_DATABASE_URL or DATABASE_URL.");
  }
  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch (err) {
    throw new Error(`Invalid migration connection URL format: ${err.message}`);
  }
  if (!parsed.protocol.startsWith("postgres")) {
    throw new Error(`Invalid protocol "${parsed.protocol}" in migration URL; must be postgresql:// or postgres://`);
  }
  const dbName = parsed.pathname.replace(/^\//, "");
  if (!dbName) {
    throw new Error("Migration connection URL does not specify a target database name.");
  }
  return rawUrl.trim();
}

async function main() {
  let pool;
  try {
    const migrationUrl = resolveMigrationUrl();
    pool = openDatabase(migrationUrl);

    // Validate connection and selected database before migrations execute
    const { rows } = await pool.query("SELECT current_database() AS db_name, current_user AS role_name;");
    const currentDb = rows[0]?.db_name;
    const currentUser = rows[0]?.role_name;

    if (!currentDb) {
      throw new Error("Failed to verify target database on PostgreSQL connection.");
    }

    const expectedDb = new URL(migrationUrl).pathname.replace(/^\//, "");
    if (currentDb !== expectedDb) {
      throw new Error(`Target database mismatch: connected to "${currentDb}", but migration URL expected "${expectedDb}".`);
    }

    const before = await pendingMigrations(pool);
    const results = await runMigrations(pool);
    const applied = results.filter((row) => row.status === "applied");

    const maskedUrl = migrationUrl.replace(/:[^:@]+@/, ":****@");
    process.stdout.write(`database   : ${currentDb} (user: ${currentUser})\n`);
    process.stdout.write(`endpoint   : ${maskedUrl}\n`);
    process.stdout.write(`discovered : ${migrationFiles().length}\n`);
    process.stdout.write(`pending    : ${before.length}\n`);
    for (const row of applied) {
      process.stdout.write(`  applied ${row.version}\n`);
    }
    process.stdout.write(`result     : ${applied.length} applied, ${results.length - applied.length} already current\n`);
  } catch (error) {
    process.stderr.write(`Migration failed: ${error.message}\n`);
    process.exit(1);
  } finally {
    await closeDatabase();
  }
}

main();

