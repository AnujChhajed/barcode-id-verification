import pg from "pg";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";

const { Pool } = pg;

let activePool = null;
let activeConnectionString = null;

/**
 * Creates an isolated PostgreSQL connection pool for the given connection string.
 */
export function createPool(databaseUrl) {
  if (!databaseUrl || typeof databaseUrl !== "string" || !databaseUrl.trim()) {
    throw new Error("Cannot initialize PostgreSQL pool: connection URL is not configured. Set DATABASE_URL in environment.");
  }
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 15,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  pool.on("error", (err) => {
    logger.error("Unexpected error on idle PostgreSQL client", { error: err.message });
  });

  // Provide transaction helper
  pool.withTransaction = async function (callback) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  };

  return pool;
}

/**
 * Creates or retrieves the shared PostgreSQL connection pool.
 *
 * Configured with standard timeouts and connection bounds suitable for
 * gate terminal usage on industrial laptops or servers.
 */
export function openDatabase(databaseUrl = config.databaseUrl) {
  if (activePool && activeConnectionString === databaseUrl) {
    return activePool;
  }
  if (activePool) {
    activePool.end().catch(() => {});
    activePool = null;
    activeConnectionString = null;
  }

  const pool = createPool(databaseUrl);
  activePool = pool;
  activeConnectionString = databaseUrl;
  return pool;
}

export function closeDatabase() {
  if (activePool) {
    const pool = activePool;
    activePool = null;
    activeConnectionString = null;
    return pool.end();
  }
  return Promise.resolve();
}
