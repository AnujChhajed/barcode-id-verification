import { evaluateCredential } from "../domain/credential-validity.js";

function formatDateKey(val) {
  if (!val) return "";
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, "0");
    const d = String(val.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(val).slice(0, 10);
}

export function toCredentialView(row, { personStatus, today } = {}) {
  if (!row) return null;
  const validFrom = formatDateKey(row.valid_from);
  const validTo = formatDateKey(row.valid_to);

  let isValid = undefined;
  let reasonCode = undefined;
  let reasonText = undefined;

  if (personStatus && today) {
    const evaluation = evaluateCredential(
      { status: row.status, valid_from: validFrom, valid_to: validTo },
      personStatus,
      today,
    );
    isValid = evaluation.valid;
    reasonCode = evaluation.code;
    reasonText = evaluation.text;
  }

  return {
    id: row.card_number || row.id,
    personId: row.person_id,
    kind: row.kind,
    validFrom,
    validTo,
    status: row.status,
    issuedAt: row.issued_at ? new Date(row.issued_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    isValid,
    reasonCode,
    reasonText,
  };
}

export async function findCredentialById(pool, idOrCode) {
  // Query by card_number (the barcode/QR opaque token) or by UUID id
  const { rows } = await pool.query(
    `SELECT * FROM id_cards 
     WHERE card_number = $1 OR (id::text = $1)
     LIMIT 1;`,
    [idOrCode],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  r.valid_from = formatDateKey(r.valid_from);
  r.valid_to = formatDateKey(r.valid_to);
  return r;
}

export async function findActiveCredentialOfKind(pool, personId, kind) {
  const { rows } = await pool.query(
    `SELECT * FROM id_cards 
     WHERE person_id = $1 AND kind = $2 AND status = 'active'
     ORDER BY valid_to DESC
     LIMIT 1;`,
    [personId, kind],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  r.valid_from = formatDateKey(r.valid_from);
  r.valid_to = formatDateKey(r.valid_to);
  return r;
}

export async function insertCredential(pool, credential, actorId = null) {
  const cardNumber = credential.cardNumber || credential.id || `ABB-${Date.now()}`;
  const { rows } = await pool.query(
    `INSERT INTO id_cards (card_number, person_id, kind, valid_from, valid_to, status, issued_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *;`,
    [
      cardNumber,
      credential.personId,
      credential.kind,
      credential.validFrom,
      credential.validTo,
      credential.status || "active",
      actorId,
    ],
  );
  return rows[0];
}

export async function updateCredentialValidity(pool, idOrCode, { validFrom, validTo }, actorId = null) {
  const { rows } = await pool.query(
    `UPDATE id_cards
     SET valid_from = $2, valid_to = $3, updated_at = NOW()
     WHERE card_number = $1 OR id::text = $1
     RETURNING *;`,
    [idOrCode, validFrom, validTo],
  );
  return rows[0] || null;
}

export async function setCredentialStatus(pool, idOrCode, status, actorId = null) {
  const { rows } = await pool.query(
    `UPDATE id_cards
     SET status = $2, updated_at = NOW()
     WHERE card_number = $1 OR id::text = $1
     RETURNING *;`,
    [idOrCode, status],
  );
  return rows[0] || null;
}

export async function listCredentialsForPerson(pool, personId) {
  const { rows } = await pool.query(
    "SELECT * FROM id_cards WHERE person_id = $1 ORDER BY issued_at DESC;",
    [personId],
  );
  return rows.map((r) => {
    r.valid_from = formatDateKey(r.valid_from);
    r.valid_to = formatDateKey(r.valid_to);
    return r;
  });
}
