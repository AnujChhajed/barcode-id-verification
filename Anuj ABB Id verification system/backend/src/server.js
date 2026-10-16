import { createApp } from "./app.js";
import { config } from "./config.js";
import { openDatabase, closeDatabase } from "./db/connection.js";
import { pendingMigrations, runMigrations } from "./db/migrate.js";
import { logger } from "./lib/logger.js";

async function startServer() {
  const db = openDatabase();

  if (config.isProduction) {
    const pending = await pendingMigrations(db);
    if (pending.length > 0) {
      logger.warn("pending migrations — run `npm run migrate` before serving traffic", { pending });
    }
  } else {
    try {
      await runMigrations(db);
    } catch (err) {
      logger.warn(
        "Auto-migration on startup paused (database may need creation or manual migration first): " +
          err.message,
      );
    }
  }

  const app = createApp({ db });

  const server = app.listen(config.port, config.host, () => {
    logger.info("backend listening", {
      host: config.host,
      port: config.port,
      nodeEnv: config.nodeEnv,
      routes: app.locals.routeInventory.length,
    });
  });

  let shuttingDown = false;

  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("shutting down", { signal });
    server.close(async () => {
      try {
        await closeDatabase();
      } catch {
        // Pool closed
      }
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 10_000).unref();
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

startServer().catch((err) => {
  logger.error("Failed to start server: " + err.message);
  process.exit(1);
});
