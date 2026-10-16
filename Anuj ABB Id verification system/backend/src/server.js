import { createApp } from "./app.js";
import { config } from "./config.js";
import { openDatabase } from "./db/connection.js";
import { pendingMigrations, runMigrations } from "./db/migrate.js";
import { logger } from "./lib/logger.js";

const db = openDatabase();

if (config.isProduction) {
  // Production never migrates itself: a human runs `npm run migrate` first.
  const pending = pendingMigrations(db);
  if (pending.length > 0) {
    logger.warn("pending migrations — run `npm run migrate` before serving traffic", { pending });
  }
} else {
  runMigrations(db);
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
  server.close(() => {
    try {
      db.close();
    } catch {
      // Already closed — nothing to do.
    }
    process.exit(0);
  });
  // Never hang forever waiting for lingering connections.
  setTimeout(() => process.exit(0), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
