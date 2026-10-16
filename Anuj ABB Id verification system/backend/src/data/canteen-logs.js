export async function findRecentApprovedMeal(pool, personId, mealDate) {
  const { rows } = await pool.query(
    `SELECT * FROM canteen_logs 
     WHERE person_id = $1 AND meal_date = $2 AND result = 'approved'
     LIMIT 1;`,
    [personId, mealDate],
  );
  return rows[0] || null;
}

export async function insertCanteenLog(pool, log) {
  let cardId = null;
  if (log.credentialId) {
    const { rows: cardRows } = await pool.query(
      "SELECT id FROM id_cards WHERE id::text = $1 OR card_number = $1 LIMIT 1;",
      [log.credentialId],
    );
    if (cardRows.length > 0) cardId = cardRows[0].id;
  }

  const { rows } = await pool.query(
    `INSERT INTO canteen_logs (
       card_id, person_id, meal_date, meal_session, result,
       reason_code, reason_text, occurred_at, operator_id
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id;`,
    [
      cardId,
      log.personId || null,
      log.mealDate,
      log.mealSession || "lunch",
      log.result,
      log.reasonCode || null,
      log.reasonText || null,
      log.occurredAt || new Date().toISOString(),
      log.operatorUserId || null,
    ],
  );
  return rows[0].id;
}

export async function listCanteenLogs(pool, { date, personId, limit = 50, offset = 0 } = {}) {
  const conditions = [];
  const values = [];
  let idx = 1;

  if (date) {
    conditions.push(`cl.meal_date = $${idx++}`);
    values.push(date);
  }
  if (personId) {
    conditions.push(`cl.person_id = $${idx++}`);
    values.push(personId);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const countSql = `SELECT COUNT(*)::int AS total FROM canteen_logs cl ${whereClause};`;
  const { rows: countRows } = await pool.query(countSql, values);
  const total = countRows[0].total;

  values.push(limit);
  const limitParam = `$${idx++}`;
  values.push(offset);
  const offsetParam = `$${idx++}`;

  const querySql = `
    SELECT
      cl.*,
      p.full_name AS person_name,
      p.category AS person_category,
      p.photo_path
    FROM canteen_logs cl
    LEFT JOIN persons p ON p.id = cl.person_id
    ${whereClause}
    ORDER BY cl.occurred_at DESC
    LIMIT ${limitParam} OFFSET ${offsetParam};
  `;
  const { rows } = await pool.query(querySql, values);
  return { logs: rows, total, limit, offset };
}
