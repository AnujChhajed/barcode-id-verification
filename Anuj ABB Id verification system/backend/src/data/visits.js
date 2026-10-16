export async function insertVisit(pool, visit, actorId = null) {
  const { rows } = await pool.query(
    `INSERT INTO visits (
       person_id, host_name, host_email, host_department,
       purpose_of_visit, expected_arrival, expected_departure,
       approval_status, approved_by, approved_at, badge_id, notes
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *;`,
    [
      visit.personId,
      visit.hostName,
      visit.hostEmail || null,
      visit.hostDepartment || null,
      visit.purposeOfVisit,
      visit.expectedArrival || new Date().toISOString(),
      visit.expectedDeparture || null,
      visit.approvalStatus || "approved",
      visit.approvalStatus === "approved" ? actorId : null,
      visit.approvalStatus === "approved" ? new Date().toISOString() : null,
      visit.badgeId || null,
      visit.notes || null,
    ],
  );
  return rows[0];
}

export async function findVisitById(pool, id) {
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id))) {
    return null;
  }
  const { rows } = await pool.query(
    `SELECT v.*, p.full_name AS visitor_name, p.phone AS visitor_phone
     FROM visits v
     JOIN persons p ON p.id = v.person_id
     WHERE v.id = $1;`,
    [id],
  );
  return rows[0] || null;
}

export async function listVisits(pool, { status, limit = 50, offset = 0 } = {}) {
  const conditions = [];
  const values = [];
  let idx = 1;

  if (status) {
    conditions.push(`v.approval_status = $${idx++}`);
    values.push(status);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const countSql = `SELECT COUNT(*)::int AS total FROM visits v ${whereClause};`;
  const { rows: countRows } = await pool.query(countSql, values);
  const total = countRows[0].total;

  values.push(limit);
  const limitParam = `$${idx++}`;
  values.push(offset);
  const offsetParam = `$${idx++}`;

  const querySql = `
    SELECT v.*, p.full_name AS visitor_name, p.phone AS visitor_phone
    FROM visits v
    JOIN persons p ON p.id = v.person_id
    ${whereClause}
    ORDER BY v.expected_arrival DESC
    LIMIT ${limitParam} OFFSET ${offsetParam};
  `;
  const { rows } = await pool.query(querySql, values);
  return { visits: rows, total, limit, offset };
}
