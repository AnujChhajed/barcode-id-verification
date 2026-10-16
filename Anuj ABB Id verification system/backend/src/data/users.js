export function toUserView(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : null,
  };
}

export async function findUserById(pool, id) {
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id))) {
    return null;
  }
  const { rows } = await pool.query(
    "SELECT id, username, email, full_name, role, is_active, created_at, last_login_at FROM users WHERE id = $1;",
    [id],
  );
  return rows[0] || null;
}

export async function findUserByUsername(pool, username) {
  const { rows } = await pool.query(
    "SELECT * FROM users WHERE LOWER(username) = LOWER($1);",
    [username],
  );
  return rows[0] || null;
}

export async function countUsers(pool) {
  const { rows } = await pool.query("SELECT COUNT(*)::int AS count FROM users;");
  return rows[0].count;
}

export async function countAdministrators(pool) {
  const { rows } = await pool.query(
    "SELECT COUNT(*)::int AS count FROM users WHERE role = 'administrator' AND is_active = TRUE;",
  );
  return rows[0].count;
}

export async function listUsers(pool) {
  const { rows } = await pool.query(
    "SELECT id, username, email, full_name, role, is_active, created_at, last_login_at FROM users ORDER BY created_at ASC;",
  );
  return rows.map(toUserView);
}

export async function insertUser(pool, user) {
  const { rows } = await pool.query(
    `INSERT INTO users (username, email, full_name, password_hash, role, is_active)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, username, email, full_name, role, is_active, created_at, last_login_at;`,
    [
      user.username,
      user.email || null,
      user.fullName,
      user.passwordHash,
      user.role,
      user.isActive ?? true,
    ],
  );
  return toUserView(rows[0]);
}

export async function updateLastLogin(pool, id) {
  await pool.query("UPDATE users SET last_login_at = NOW() WHERE id = $1;", [id]);
}
