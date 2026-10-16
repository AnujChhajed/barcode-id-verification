import readline from "node:readline";
import { hashPassword } from "../src/auth/password.js";
import { openDatabase, closeDatabase } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrate.js";
import { countAdministrators, insertUser } from "../src/data/users.js";
import { writeAudit } from "../src/lib/audit.js";

/**
 * One-time bootstrap of the first administrator account.
 *
 * Prompts privately for username and password (or accepts ABB_ADMIN_USERNAME and
 * ABB_ADMIN_PASSWORD from the environment). Passwords are never logged or stored
 * in plaintext. Refuses to run if an administrator already exists.
 */

const USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,64}$/;
const MIN_PASSWORD_LENGTH = 12;

function fail(message) {
  process.stderr.write(`Error: ${message}\n`);
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
          process.exit(1);
        }
        if (character === "\b" || character === "\u007f") {
          if (value.length > 0) value = value.slice(0, -1);
        } else {
          value += character;
        }
      }
    }

    stdin.on("data", onData);
  });
}

async function main() {
  const pool = openDatabase();
  try {
    // Ensure migrations have been applied first
    await runMigrations(pool);

    const adminCount = await countAdministrators(pool);
    if (adminCount > 0) {
      fail(
        "An active administrator account already exists. Use the user management screen to add more.",
      );
    }

    let username = (process.env.ABB_ADMIN_USERNAME || "").trim();
    if (!username) {
      username = await askVisible("Choose an administrator username (letters, digits, dot, hyphen): ");
    }
    if (!USERNAME_PATTERN.test(username)) {
      fail("Username must be 3-64 characters and contain only letters, digits, '.', '-' or '_'.");
    }

    let password = process.env.ABB_ADMIN_PASSWORD || "";
    if (!password) {
      password = await askHidden("Choose an administrator password (min 12 characters): ");
      const confirmation = await askHidden("Confirm password: ");
      if (password !== confirmation) {
        fail("Passwords do not match.");
      }
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      fail(`Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`);
    }

    const created = await insertUser(pool, {
      username,
      fullName: "System Administrator",
      role: "administrator",
      passwordHash: hashPassword(password),
      isActive: true,
    });

    await writeAudit(pool, {
      actorUserId: created.id,
      action: "bootstrap.admin",
      entityType: "user",
      entityId: created.id,
      newValue: { username, role: "administrator" },
    });

    process.stdout.write(`Administrator "${username}" created successfully (ID: ${created.id}).\n`);
  } catch (error) {
    fail(`Bootstrap failed: ${error.message}`);
  } finally {
    await closeDatabase();
  }
}

main();
