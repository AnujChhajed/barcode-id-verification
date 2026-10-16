export async function listContractors(pool) {
  const { rows } = await pool.query(
    "SELECT id, company_name, contact_person, contact_phone, contact_email, is_active FROM contractors ORDER BY company_name ASC;",
  );
  return rows.map((r) => ({
    id: r.id,
    companyName: r.company_name,
    contactPerson: r.contact_person,
    contactPhone: r.contact_phone,
    contactEmail: r.contact_email,
    isActive: r.is_active,
  }));
}

export async function findContractorById(pool, id) {
  const { rows } = await pool.query("SELECT * FROM contractors WHERE id = $1;", [id]);
  return rows[0] || null;
}

export async function insertContractor(pool, contractor) {
  const { rows } = await pool.query(
    `INSERT INTO contractors (company_name, contact_person, contact_phone, contact_email, is_active)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id;`,
    [
      contractor.companyName,
      contractor.contactPerson || null,
      contractor.contactPhone || null,
      contractor.contactEmail || null,
      contractor.isActive ?? true,
    ],
  );
  return rows[0].id;
}
