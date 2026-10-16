import { createApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { createPool } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrate.js";
import { newId } from "../src/lib/ids.js";
import { nowIso } from "../src/lib/time.js";
import { config } from "../src/config.js";

export function getTestDatabaseUrl(databaseUrl) {
  if (databaseUrl) return databaseUrl;
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  if (config.databaseUrl && config.databaseUrl.includes("/abb_gate_test")) {
    return config.databaseUrl;
  }
  if (config.databaseUrl && config.databaseUrl.includes("/abb_gate_verification")) {
    return config.databaseUrl.replace(/\/abb_gate_verification(\?.*)?$/, "/abb_gate_test$1");
  }
  throw new Error(
    "TEST_DATABASE_URL is not configured and DATABASE_URL does not point to abb_gate_verification or abb_gate_test.",
  );
}

export function getTestAdminDatabaseUrl(adminDatabaseUrl) {
  if (adminDatabaseUrl) return adminDatabaseUrl;
  if (process.env.TEST_ADMIN_DATABASE_URL) return process.env.TEST_ADMIN_DATABASE_URL;
  if (process.env.MIGRATION_DATABASE_URL && !process.env.MIGRATION_DATABASE_URL.includes("abb_app")) {
    return process.env.MIGRATION_DATABASE_URL.replace(/\/abb_gate_verification(\?.*)?$/, "/abb_gate_test$1");
  }
  const host = process.env.PGHOST || "localhost";
  const port = process.env.PGPORT || "5432";
  let password = process.env.PGPASSWORD;
  if (!password && config.databaseUrl) {
    try {
      const parsed = new URL(config.databaseUrl);
      if (parsed.password) {
        password = decodeURIComponent(parsed.password);
      }
    } catch {
      // Ignore URL parse error
    }
  }
  const auth = password ? `postgres:${encodeURIComponent(password)}@` : "postgres@";
  return `postgresql://${auth}${host}:${port}/abb_gate_test`;
}

function assertTestDatabaseUrl(url, label) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (err) {
    throw new Error(`SAFETY CHECK FAILED: Invalid ${label}: ${err.message}`);
  }
  const targetDbName = parsed.pathname.replace(/^\//, "");
  if (targetDbName === "abb_gate_verification") {
    throw new Error(
      `SAFETY CHECK FAILED: ${label} is strictly forbidden from running against the working database "${targetDbName}". ` +
      `Tests must target "abb_gate_test". Please set TEST_DATABASE_URL or verify configuration.`,
    );
  }
  if (targetDbName !== "abb_gate_test") {
    throw new Error(
      `SAFETY CHECK FAILED: ${label} expected "abb_gate_test", but configured with "${targetDbName}".`,
    );
  }
}

export async function ensureTestPermissions(adminDb) {
  const { rows } = await adminDb.query("SELECT current_database();");
  if (rows[0]?.current_database !== "abb_gate_test") {
    throw new Error("SAFETY REFUSAL: Cannot configure permissions on non-test database!");
  }

  await adminDb.query(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner WHERE c.relname = 'persons' AND r.rolname = 'abb_app') THEN
        ALTER TABLE public.schema_migrations OWNER TO postgres;
        ALTER TABLE public.contractors        OWNER TO postgres;
        ALTER TABLE public.id_cards           OWNER TO postgres;
        ALTER TABLE public.persons            OWNER TO postgres;
        ALTER TABLE public.gate_logs          OWNER TO postgres;
        ALTER TABLE public.canteen_logs       OWNER TO postgres;
        ALTER TABLE public.visits             OWNER TO postgres;
        ALTER TABLE public.audit_logs         OWNER TO postgres;
        ALTER TABLE public.sessions           OWNER TO postgres;
        ALTER TABLE public.users              OWNER TO postgres;
        ALTER TABLE public.settings           OWNER TO postgres;
        ALTER VIEW  public.v_people_inside    OWNER TO postgres;
        ALTER FUNCTION public.trigger_set_timestamp() OWNER TO postgres;
      END IF;
    END
    $$;

    REVOKE CREATE ON SCHEMA public FROM abb_app;
    REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM abb_app;
    REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM abb_app;

    GRANT SELECT, INSERT, UPDATE ON TABLE
      public.persons,
      public.id_cards,
      public.visits,
      public.contractors,
      public.users,
      public.settings
    TO abb_app;

    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      public.sessions
    TO abb_app;

    GRANT SELECT, INSERT ON TABLE
      public.gate_logs,
      public.canteen_logs,
      public.audit_logs
    TO abb_app;

    GRANT SELECT ON TABLE
      public.v_people_inside,
      public.schema_migrations
    TO abb_app;

    GRANT EXECUTE ON FUNCTION public.trigger_set_timestamp() TO abb_app;
  `);
}

export async function resetTestDatabase(adminDb) {
  const { rows } = await adminDb.query("SELECT current_database();");
  const dbName = rows[0]?.current_database;
  if (dbName !== "abb_gate_test") {
    throw new Error(
      `SAFETY REFUSAL: Cannot reset database "${dbName}". Reset is ONLY permitted on "abb_gate_test"!`,
    );
  }

  await adminDb.query(`
    TRUNCATE TABLE
      gate_logs,
      canteen_logs,
      visits,
      id_cards,
      audit_logs,
      persons,
      sessions,
      users
    CASCADE;

    INSERT INTO settings (key, value, description, updated_at)
    VALUES
      ('site.timezone',                  'Asia/Kolkata', 'Primary operating timezone for Plant 3', NOW()),
      ('expiry.reminder_days',           '7',            'Days before badge expiry to trigger warning', NOW()),
      ('canteen.entries_per_person_day', '1',            'Allowed canteen meal entries per person per calendar day', NOW()),
      ('session.timeout_minutes',        '30',           'Inactivity timeout for security staff sessions', NOW()),
      ('scan.duplicate_window_seconds',  '5',            'Rapid scan burst collapse window in seconds', NOW())
    ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value, description = EXCLUDED.description, updated_at = NOW();

    INSERT INTO contractors (company_name, contact_person, contact_phone, contact_email, is_active, created_at, updated_at)
    VALUES
      ('ABB Power Grids',      'Plant Facility Team', '+91 20 6600 0000', 'facilities.plant3@in.abb.com', TRUE, NOW(), NOW()),
      ('Larsen & Toubro Ltd',  'Site Supervisor',     '+91 22 6752 5656', 'contractors@larsentoubro.com', TRUE, NOW(), NOW()),
      ('Siemens Energy',       'Service Coordinator', '+91 22 3967 7000', 'support.in@siemens-energy.com', TRUE, NOW(), NOW()),
      ('Schneider Electric',   'Vendor Manager',      '+91 1800 103 0011', 'vendor.in@se.com', TRUE, NOW(), NOW())
    ON CONFLICT (company_name) DO NOTHING;
  `);
}

/** Fresh database pool, migrated and wrapped in an Express app, strictly targeting abb_gate_test. */
export async function createTestContext({ rateLimit, corsOrigins, databaseUrl, adminDatabaseUrl } = {}) {
  const runtimeDbUrl = getTestDatabaseUrl(databaseUrl);
  const adminDbUrl = getTestAdminDatabaseUrl(adminDatabaseUrl);

  // Safety Check 1: connection string validation
  assertTestDatabaseUrl(runtimeDbUrl, "Runtime test URL");
  assertTestDatabaseUrl(adminDbUrl, "Admin test URL");

  // Privileged test pool: migrations, permission checks, and truncate resets
  const adminDb = createPool(adminDbUrl);
  const { rows: adminRows } = await adminDb.query("SELECT current_database();");
  const actualAdminDb = adminRows[0]?.current_database;
  if (actualAdminDb !== "abb_gate_test") {
    await adminDb.end().catch(() => {});
    throw new Error(
      `SAFETY CHECK FAILED: Admin pool connected to "${actualAdminDb}". Tests must NEVER run on the working database!`,
    );
  }

  await runMigrations(adminDb);
  await ensureTestPermissions(adminDb);
  await resetTestDatabase(adminDb);

  // Runtime test pool: least-privilege abb_app pool passed to Express application
  const appDb = createPool(runtimeDbUrl);
  const { rows: appRows } = await appDb.query("SELECT current_database();");
  const actualAppDb = appRows[0]?.current_database;
  if (actualAppDb !== "abb_gate_test") {
    await appDb.end().catch(() => {});
    await adminDb.end().catch(() => {});
    throw new Error(
      `SAFETY CHECK FAILED: Runtime pool connected to "${actualAppDb}". Tests must NEVER run on the working database!`,
    );
  }

  const app = createApp({ db: appDb, rateLimit, corsOrigins });
  return {
    db: appDb,
    adminDb,
    app,
    async cleanup() {
      await Promise.all([
        appDb.end().catch(() => {}),
        adminDb.end().catch(() => {}),
      ]);
    },
  };
}

export async function seedUser(db, { username, password, role, fullName = "Test User", email = null }) {
  const id = newId();
  const timestamp = nowIso();
  const hash = hashPassword(password);
  await db.query(
    `INSERT INTO users
       (id, username, email, full_name, password_hash, role, is_active, created_at, updated_at, last_login_at)
     VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7, $8, NULL)
     ON CONFLICT (username) DO UPDATE
     SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, is_active = TRUE;`,
    [id, username, email, fullName, hash, role, timestamp, timestamp],
  );
  return id;
}

export async function startServer(app) {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function safeJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractSessionCookie(response) {
  const cookies = response.headers.getSetCookie?.() ?? [];
  const session = cookies.find((value) => value.startsWith("abb_session="));
  return session ? session.split(";")[0] : null;
}

export async function request(baseUrl, method, path, { body, cookie, origin } = {}) {
  const verb = method.toUpperCase();
  const payload = body !== undefined && verb !== "GET" && verb !== "HEAD" ? JSON.stringify(body) : undefined;
  const response = await fetch(`${baseUrl}${path}`, {
    method: verb,
    headers: {
      ...(payload ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      ...(origin ? { origin } : {}),
    },
    body: payload,
  });
  return { res: response, json: await safeJson(response) };
}

export const postJson = (baseUrl, path, body, cookie) =>
  request(baseUrl, "POST", path, { body: body ?? {}, cookie });

export async function login(baseUrl, username, password) {
  const { res, json } = await request(baseUrl, "POST", "/api/auth/login", {
    body: { username, password },
  });
  return { res, json, cookie: extractSessionCookie(res) };
}
