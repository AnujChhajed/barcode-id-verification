export function toGateEventView(row) {
  if (!row) return null;
  return {
    id: row.id,
    credentialId: row.card_number || row.card_id || null,
    personId: row.person_id || null,
    personName: row.person_name || null,
    personCategory: row.person_category || null,
    gateId: row.gate_name || "Plant 3 - Main Gate",
    direction: row.direction,
    result: row.result,
    reasonCode: row.reason_code || null,
    reasonText: row.reason_text || null,
    occurredAt: row.occurred_at ? new Date(row.occurred_at).toISOString() : new Date().toISOString(),
    operatorUserId: row.operator_id || null,
    recordedOffline: Boolean(row.recorded_offline),
    syncedAt: row.synced_at ? new Date(row.synced_at).toISOString() : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
  };
}

export async function findRecentApprovedScan(pool, { credentialId, gateId, direction, since }) {
  const { rows } = await pool.query(
    `SELECT gl.* 
     FROM gate_logs gl
     LEFT JOIN id_cards ic ON ic.id = gl.card_id
     WHERE (gl.card_id::text = $1 OR ic.card_number = $1 OR gl.scanned_code = $1)
       AND gl.direction = $2
       AND gl.result = 'approved'
       AND gl.occurred_at >= $3::timestamptz
     ORDER BY gl.occurred_at DESC
     LIMIT 1;`,
    [credentialId, direction, since],
  );
  return rows[0] || null;
}

export async function insertGateEvent(pool, scan) {
  let cardId = null;
  if (scan.credentialId) {
    const { rows: cardRows } = await pool.query(
      "SELECT id FROM id_cards WHERE id::text = $1 OR card_number = $1 LIMIT 1;",
      [scan.credentialId],
    );
    if (cardRows.length > 0) cardId = cardRows[0].id;
  }

  const { rows } = await pool.query(
    `INSERT INTO gate_logs (
       card_id, person_id, gate_name, direction, result,
       reason_code, reason_text, scanned_code, occurred_at,
       operator_id, is_override, override_reason, recorded_offline, synced_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING id;`,
    [
      cardId,
      scan.personId || null,
      scan.gateId || "Plant 3 - Main Gate",
      scan.direction,
      scan.result,
      scan.reasonCode || null,
      scan.reasonText || null,
      scan.scannedCode || scan.credentialId || "UNKNOWN",
      scan.occurredAt || new Date().toISOString(),
      scan.operatorUserId || null,
      Boolean(scan.isOverride),
      scan.overrideReason || null,
      Boolean(scan.recordedOffline),
      scan.syncedAt || null,
    ],
  );
  return rows[0].id;
}

export async function listGateEvents(pool, filters = {}) {
  const conditions = [];
  const values = [];
  let idx = 1;

  if (filters.personId) {
    conditions.push(`gl.person_id = $${idx++}`);
    values.push(filters.personId);
  }
  if (filters.result) {
    conditions.push(`gl.result = $${idx++}`);
    values.push(filters.result);
  }
  if (filters.direction) {
    conditions.push(`gl.direction = $${idx++}`);
    values.push(filters.direction);
  }
  if (filters.from) {
    conditions.push(`gl.occurred_at >= $${idx++}::timestamptz`);
    values.push(filters.from);
  }
  if (filters.to) {
    conditions.push(`gl.occurred_at <= $${idx++}::timestamptz`);
    values.push(filters.to);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const countSql = `SELECT COUNT(*)::int AS total FROM gate_logs gl ${whereClause};`;
  const { rows: countRows } = await pool.query(countSql, values);
  const total = countRows[0].total;

  const limit = Math.min(filters.limit || 50, 200);
  const offset = filters.offset || 0;

  values.push(limit);
  const limitParam = `$${idx++}`;
  values.push(offset);
  const offsetParam = `$${idx++}`;

  const querySql = `
    SELECT
      gl.*,
      p.full_name AS person_name,
      p.category AS person_category,
      ic.card_number
    FROM gate_logs gl
    LEFT JOIN persons p ON p.id = gl.person_id
    LEFT JOIN id_cards ic ON ic.id = gl.card_id
    ${whereClause}
    ORDER BY gl.occurred_at DESC
    LIMIT ${limitParam} OFFSET ${offsetParam};
  `;
  const { rows } = await pool.query(querySql, values);
  return { events: rows.map(toGateEventView), total, limit, offset };
}

export async function countGateEvents(pool, filters = {}) {
  const res = await listGateEvents(pool, { ...filters, limit: 1, offset: 0 });
  return res.total;
}

export async function listInsidePeople(pool) {
  const { rows } = await pool.query("SELECT * FROM v_people_inside;");
  return rows.map((r) => ({
    person: {
      id: r.person_id,
      category: r.category,
      fullName: r.full_name,
      status: r.person_status,
      hasPhoto: Boolean(r.photo_path),
      workerRef: r.worker_ref || null,
      contractorCompany: r.contractor_company || null,
      institutionName: r.institution_name || null,
    },
    credentialId: r.card_id,
    gateId: r.gate_name,
    since: new Date(r.inside_since).toISOString(),
    missingExit: Boolean(r.missing_exit),
  }));
}
