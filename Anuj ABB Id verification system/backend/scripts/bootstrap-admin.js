import readline from "node:readline";
import { hashPassword } from "../src/auth/password.js";
import { config } from "../src/config.js";
import { openDatabase } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrate.js";
import { writeAudit } from "../src/lib/audit.js";
import { newId } from "../src/lib/ids.js";
import { nowIso } from "../src/lib/time.js";

/**
 * One-time bootstrap of the first administrator.
 *
 * The password is never accepted from a migration and never written to the
 * audit log. Provide it through the environment (ABB_ADMIN_*) or type it at a
 * hidden prompt. Refuses to run if an administrator already exists.
 */

const USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,64}$/;
const MIN_PASSWORD_LENGTH = 12;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function askVisible(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function askHidden(question) {
  if (!process.stdin.isTTY) {
    return Promise.reject(
      new Error("Cannot prompt for a hidden password without a TTY. Set ABB_ADMIN_PASSWORD instead."),
    );
  }
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    stdin.resume();
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    let value = "";

    function cleanup() {
      stdin.removeListener("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
    }

    function onData(chunk) {
      for (const character of chunk) {
        if (character === "\r" || character === "\n" || character === "\u0004") {
          cleanup();
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (character === "\u0003") {
          cleanup();
          process.stdout.write("\n");
          process.exit(130);
        }
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        if (character >= " ") value += character;
      }
    }

    stdin.on("data", onData);
  });
}

async function collectInput() {
  const useEnv = Boolean(process.env.ABB_ADMIN_USERNAME && process.env.ABB_ADMIN_PASSWORD);

  const username = process.env.ABB_ADMIN_USERNAME || (await askVisible("Administrator username: "));
  const fullName = process.env.ABB_ADMIN_FULL_NAME || (await askVisible("Full name: "));
  const email = process.env.ABB_ADMIN_EMAIL || "";
  const password = process.env.ABB_ADMIN_PASSWORD || (await askHidden("Password (hidden): "));
  const confirm = useEnv ? password : await askHidden("Confirm password: ");

  return { username, fullName, email, password, confirm };
}

const input = await collectInput();

if (!USERNAME_PATTERN.test(input.username)) {
  fail("Username must be 3-64 characters using letters, digits, dot, underscore or hyphen.");
}
if (!input.fullName) fail("Full name is required.");
if (input.password.length < MIN_PASSWORD_LENGTH) {
  fail(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
}
if (input.password !== input.confirm) fail("Passwords do not match.");

const db = openDatabase();
try {
  runMigrations(db);

  const existingAdmin = db
    .prepare("SELECT id FROM users WHERE role = 'administrator' LIMIT 1")
    .get();
  if (existingAdmin) {
    fail("An administrator already exists. Use the API to add further users; refusing to bootstrap.");
  }

  const taken = db.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE").get(input.username);
  if (taken) fail("That username is already taken.");

  const id = newId();
  const timestamp = nowIso();
  db.prepare(
    `INSERT INTO users
       (id, username, email, full_name, password_hash, role, is_active, created_at, updated_at, last_login_at)
     VALUES (?, ?, ?, ?, ?, 'administrator', 1, ?, ?, NULL)`,
  ).run(
    id,
    input.username,
    input.email || null,
    input.fullName,
    hashPassword(input.password),
    timestamp,
    timestamp,
  );

  writeAudit(db, {
    actorUserId: id,
    action: "user.bootstrap",
    entityType: "user",
    entityId: id,
    newValue: { username: input.username, role: "administrator", via: "bootstrap-admin" },
  });

  process.stdout.write(
    `Administrator created: ${input.username}\ndatabase: ${config.dbPath}\n` +
      `Next: npm start   (then sign in from the frontend)\n`,
  );
} finally {
  db.close();
}
