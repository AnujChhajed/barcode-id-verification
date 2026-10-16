import cookieParser from "cookie-parser";
import express from "express";
import { createAuthorize, PUBLIC } from "./auth/middleware.js";
import { createRateLimiter } from "./auth/rate-limit.js";
import { config } from "./config.js";
import { createCors } from "./http/cors.js";
import { errorHandler, notFoundHandler } from "./http/error-handler.js";
import { createRouteRegistrar } from "./http/route.js";
import { registerAuthRoutes } from "./routes/auth.routes.js";
import { registerCredentialRoutes } from "./routes/credentials.routes.js";
import { registerGateRoutes } from "./routes/gate.routes.js";
import { registerHealthRoutes } from "./routes/health.routes.js";
import { registerPeopleRoutes } from "./routes/people.routes.js";
import { registerSettingsRoutes } from "./routes/settings.routes.js";
import { registerUserRoutes } from "./routes/users.routes.js";

/**
 * The complete set of unauthenticated routes. Anything public that is not
 * listed here makes the application refuse to start, so "public" can never
 * be widened by accident.
 */
const PUBLIC_ROUTE_ALLOWLIST = new Set(["GET /api/health", "POST /api/auth/login"]);

function assertPublicRoutes(inventory) {
  const declared = new Set(
    inventory
      .filter((route) => route.access === PUBLIC)
      .map((route) => `${route.method} ${route.path}`),
  );
  for (const route of declared) {
    if (!PUBLIC_ROUTE_ALLOWLIST.has(route)) {
      throw new Error(`Public route ${route} is missing from the explicit public allowlist`);
    }
  }
  for (const route of PUBLIC_ROUTE_ALLOWLIST) {
    if (!declared.has(route)) {
      throw new Error(`Public allowlist entry ${route} does not match a registered public route`);
    }
  }
}

export function createApp({
  db,
  sessionTimeoutMinutes = config.sessionTimeoutMinutes,
  rateLimit = config.loginRateLimit,
  corsOrigins = config.corsOrigins,
} = {}) {
  const app = express();
  app.disable("x-powered-by");
  if (config.trustProxy) app.set("trust proxy", true);

  // Order matters: CORS first (so even a rejected preflight gets the right
  // headers), then JSON parsing and cookie parsing — all infrastructure only.
  app.use(createCors({ origins: corsOrigins }));
  app.use(express.json({ limit: "256kb" }));
  app.use(cookieParser());

  const authorize = createAuthorize({ db });
  const rateLimiter = createRateLimiter(rateLimit);
  const router = express.Router();
  const registrar = createRouteRegistrar({ router, authorize });

  const context = { db, registrar, rateLimiter, sessionTimeoutMinutes };
  registerHealthRoutes(context);
  registerAuthRoutes(context);
  registerUserRoutes(context);
  registerSettingsRoutes(context);
  registerPeopleRoutes(context);
  registerCredentialRoutes(context);
  registerGateRoutes(context);

  assertPublicRoutes(registrar.inventory);

  app.use(router);
  app.use(notFoundHandler);
  app.use(errorHandler);

  app.locals.routeInventory = registrar.inventory;
  return app;
}
