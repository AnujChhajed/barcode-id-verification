export function toPersonView(row) {
  if (!row) return null;
  return {
    id: row.id,
    category: row.category,
    fullName: row.full_name,
    phone: row.phone || null,
    hasPhoto: Boolean(row.photo_path),
    plantId: "plant-p3",
    status: row.status,
    workerRef: row.worker_ref || null,
    contractorCompany: row.contractor_company || null,
    contractorId: row.contractor_id || null,
    institutionName: row.institution_name || null,
    courseProgramme: row.course_programme || null,
    purposeOfVisit: row.purpose_of_visit || null,
    personToMeet: row.person_to_meet || null,
    employeeEmail: row.host_employee_email || null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

export function toVerificationView(row) {
  if (!row) return null;
  return {
    id: row.id,
    category: row.category,
    fullName: row.full_name,
    status: row.status,
    hasPhoto: Boolean(row.photo_path),
    workerRef: row.worker_ref || null,
    contractorCompany: row.contractor_company || null,
    institutionName: row.institution_name || null,
  };
}

export async function findPersonById(pool, id) {
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id))) {
    return null;
  }
  const { rows } = await pool.query(
    `SELECT p.*, COALESCE(c.company_name, p.contractor_company) AS resolved_company
     FROM persons p
     LEFT JOIN contractors c ON c.id = p.contractor_id
     WHERE p.id = $1;`,
    [id],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  if (r.resolved_company) r.contractor_company = r.resolved_company;
  return r;
}

export async function findLikelyDuplicate(pool, person) {
  if (person.category === "worker" && person.workerRef) {
    const { rows } = await pool.query(
      "SELECT * FROM persons WHERE worker_ref = $1 AND status <> 'terminated' LIMIT 1;",
      [person.workerRef],
    );
    if (rows.length > 0) return rows[0];
  }
  if (person.phone) {
    const { rows } = await pool.query(
      "SELECT * FROM persons WHERE phone = $1 AND LOWER(full_name) = LOWER($2) AND status <> 'terminated' LIMIT 1;",
      [person.phone, person.fullName],
    );
    if (rows.length > 0) return rows[0];
  }
  return null;
}

export async function insertPerson(pool, person, actorId = null) {
  const { rows } = await pool.query(
    `INSERT INTO persons (
       category, full_name, phone, email, photo_path, status,
       worker_ref, contractor_company, contractor_id,
       institution_name, course_programme,
       purpose_of_visit, person_to_meet, host_employee_email,
       created_by
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     RETURNING *;`,
    [
      person.category,
      person.fullName,
      person.phone || null,
      person.email || null,
      person.photoPath || null,
      person.status || "active",
      person.workerRef || null,
      person.contractorCompany || null,
      person.contractorId || null,
      person.institutionName || null,
      person.courseProgramme || null,
      person.purposeOfVisit || null,
      person.personToMeet || null,
      person.employeeEmail || null,
      actorId,
    ],
  );
  return toPersonView(rows[0]);
}

export async function updatePerson(pool, id, patch) {
  const fields = [];
  const values = [id];
  let idx = 2;

  if (patch.category !== undefined) {
    fields.push(`category = $${idx++}`);
    values.push(patch.category);
  }
  if (patch.fullName !== undefined) {
    fields.push(`full_name = $${idx++}`);
    values.push(patch.fullName);
  }
  if (patch.phone !== undefined) {
    fields.push(`phone = $${idx++}`);
    values.push(patch.phone || null);
  }
  if (patch.photoPath !== undefined) {
    fields.push(`photo_path = $${idx++}`);
    values.push(patch.photoPath || null);
  }
  if (patch.workerRef !== undefined) {
    fields.push(`worker_ref = $${idx++}`);
    values.push(patch.workerRef || null);
  }
  if (patch.contractorCompany !== undefined) {
    fields.push(`contractor_company = $${idx++}`);
    values.push(patch.contractorCompany || null);
  }
  if (patch.institutionName !== undefined) {
    fields.push(`institution_name = $${idx++}`);
    values.push(patch.institutionName || null);
  }
  if (patch.purposeOfVisit !== undefined) {
    fields.push(`purpose_of_visit = $${idx++}`);
    values.push(patch.purposeOfVisit || null);
  }
  if (patch.personToMeet !== undefined) {
    fields.push(`person_to_meet = $${idx++}`);
    values.push(patch.personToMeet || null);
  }
  if (patch.employeeEmail !== undefined) {
    fields.push(`host_employee_email = $${idx++}`);
    values.push(patch.employeeEmail || null);
  }

  if (fields.length === 0) return findPersonById(pool, id);

  fields.push("updated_at = NOW()");
  const sql = `UPDATE persons SET ${fields.join(", ")} WHERE id = $1 RETURNING *;`;
  const { rows } = await pool.query(sql, values);
  return rows[0] ? toPersonView(rows[0]) : null;
}

export async function setPersonStatus(pool, id, status) {
  const { rows } = await pool.query(
    "UPDATE persons SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING *;",
    [id, status],
  );
  return rows[0] ? toPersonView(rows[0]) : null;
}

export async function searchPeople(pool, query, limit = 20) {
  const q = `%${query.trim()}%`;
  const { rows } = await pool.query(
    `SELECT p.*, COALESCE(c.company_name, p.contractor_company) AS resolved_company
     FROM persons p
     LEFT JOIN contractors c ON c.id = p.contractor_id
     WHERE p.full_name ILIKE $1 OR p.worker_ref ILIKE $1 OR p.phone ILIKE $1
     ORDER BY p.full_name ASC
     LIMIT $2;`,
    [q, limit],
  );
  return rows.map(toVerificationView);
}

export async function listPeople(pool, { category, status, q, limit = 50, offset = 0 } = {}) {
  const conditions = [];
  const values = [];
  let idx = 1;

  if (category) {
    conditions.push(`category = $${idx++}`);
    values.push(category);
  }
  if (status) {
    conditions.push(`status = $${idx++}`);
    values.push(status);
  }
  if (q && q.trim()) {
    conditions.push(`(full_name ILIKE $${idx} OR worker_ref ILIKE $${idx} OR phone ILIKE $${idx})`);
    values.push(`%${q.trim()}%`);
    idx++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const countSql = `SELECT COUNT(*)::int AS total FROM persons ${whereClause};`;
  const { rows: countRows } = await pool.query(countSql, values);
  const total = countRows[0].total;

  values.push(limit);
  const limitParam = `$${idx++}`;
  values.push(offset);
  const offsetParam = `$${idx++}`;

  const querySql = `
    SELECT p.*, COALESCE(c.company_name, p.contractor_company) AS resolved_company
    FROM persons p
    LEFT JOIN contractors c ON c.id = p.contractor_id
    ${whereClause}
    ORDER BY p.created_at DESC
    LIMIT ${limitParam} OFFSET ${offsetParam};
  `;
  const { rows } = await pool.query(querySql, values);
  return { people: rows.map(toPersonView), total, limit, offset };
}

export async function countPeople(pool, filters = {}) {
  const res = await listPeople(pool, { ...filters, limit: 1, offset: 0 });
  return res.total;
}
