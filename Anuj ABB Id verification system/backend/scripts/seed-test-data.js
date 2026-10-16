import { config } from "../src/config.js";
import { createPool } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrate.js";
import { hashPassword } from "../src/auth/password.js";

/**
 * Repeatable, idempotent seed script strictly for `abb_gate_test`.
 * Refuses to run against `abb_gate_verification` (production).
 */

function resolveTestUrls() {
  const rawUrl = process.env.TEST_DATABASE_URL ||
    (config.databaseUrl ? config.databaseUrl.replace(/\/abb_gate_verification(\?.*)?$/, "/abb_gate_test$1") : null);

  if (!rawUrl) {
    throw new Error("TEST_DATABASE_URL is not configured and DATABASE_URL is missing.");
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (err) {
    throw new Error(`Invalid test database URL: ${err.message}`);
  }

  const dbName = parsed.pathname.replace(/^\//, "");
  if (dbName === "abb_gate_verification") {
    throw new Error(
      "FATAL SAFETY REFUSAL: seed-test-data is strictly prohibited from running against production database 'abb_gate_verification'!"
    );
  }
  if (dbName !== "abb_gate_test") {
    throw new Error(`seed-test-data is only permitted on 'abb_gate_test', but received '${dbName}'.`);
  }

  // Admin URL for truncate/seeding
  let adminUrl = process.env.TEST_ADMIN_DATABASE_URL;
  if (!adminUrl) {
    const adminParsed = new URL(rawUrl);
    adminParsed.username = "postgres";
    if (process.env.PGPASSWORD) {
      adminParsed.password = process.env.PGPASSWORD;
    }
    adminUrl = adminParsed.toString();
  }

  return { testUrl: rawUrl, adminUrl };
}

export async function seedTestData() {
  const { testUrl, adminUrl } = resolveTestUrls();
  const pool = createPool(adminUrl);

  try {
    const { rows: dbCheck } = await pool.query("SELECT current_database() AS db_name;");
    if (dbCheck[0]?.db_name !== "abb_gate_test") {
      throw new Error(`Safety failure: connected to unexpected database "${dbCheck[0]?.db_name}"`);
    }

    process.stdout.write("Ensuring migrations on abb_gate_test...\n");
    await runMigrations(pool);

    process.stdout.write("Cleaning previous test data...\n");
    await pool.query(`
      TRUNCATE TABLE
        gate_logs,
        canteen_logs,
        visits,
        id_cards,
        audit_logs,
        persons,
        sessions,
        users,
        contractors,
        settings
      CASCADE;
    `);

    process.stdout.write("Seeding settings...\n");
    await pool.query(`
      INSERT INTO settings (key, value, description, updated_at)
      VALUES
        ('site.timezone',                  'Asia/Kolkata', 'Primary operating timezone for Plant 3', NOW()),
        ('expiry.reminder_days',           '7',            'Days before badge expiry to trigger warning', NOW()),
        ('canteen.entries_per_person_day', '1',            'Allowed canteen meal entries per person per calendar day', NOW()),
        ('session.timeout_minutes',        '30',           'Inactivity timeout for security staff sessions', NOW()),
        ('scan.duplicate_window_seconds',  '5',            'Rapid scan burst collapse window in seconds', NOW())
      ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value, description = EXCLUDED.description, updated_at = NOW();
    `);

    process.stdout.write("Seeding users (Administrator & Security Staff)...\n");
    const testPassword = process.env.TEST_USER_PASSWORD || "TestPassword123!";
    const adminHash = hashPassword(testPassword);
    const securityHash = hashPassword(testPassword);

    const { rows: userRows } = await pool.query(`
      INSERT INTO users (username, full_name, email, role, password_hash, is_active)
      VALUES
        ('admin.test',    'Anuj Chhajed (Admin)',       'anuj.admin@test.abb.com',  'administrator',  $1, TRUE),
        ('gate.operator', 'Ramesh Kumar (Security)',    'ramesh.guard@test.abb.com', 'security_staff', $2, TRUE)
      ON CONFLICT (username) DO UPDATE
      SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, is_active = TRUE
      RETURNING id, username, role;
    `, [adminHash, securityHash]);

    const adminUser = userRows.find((u) => u.username === "admin.test");
    const securityUser = userRows.find((u) => u.username === "gate.operator");

    process.stdout.write("Seeding contractors...\n");
    const { rows: contractorRows } = await pool.query(`
      INSERT INTO contractors (company_name, contact_person, contact_phone, contact_email, is_active)
      VALUES
        ('ABB Power Grids',           'Facility Supervisor',  '+91 20 6600 0001', 'facility.plant3@in.abb.com', TRUE),
        ('Larsen & Toubro Ltd',       'Site Engineer',        '+91 22 6752 5601', 'site.supervisor@lt.com',     TRUE),
        ('Siemens Energy',            'Service Coordinator',  '+91 22 3967 7001', 'support.service@siemens.com', TRUE),
        ('Schneider Electric',        'Vendor Manager',       '+91 1800 103 001', 'vendor.desk@se.com',         TRUE),
        ('Apex Industrial Facilities','Contract Manager',     '+91 20 2712 3456', 'contracts@apexindustrial.in',TRUE)
      RETURNING id, company_name;
    `);

    const ltContractor = contractorRows.find((c) => c.company_name === "Larsen & Toubro Ltd");
    const abbContractor = contractorRows.find((c) => c.company_name === "ABB Power Grids");
    const siemensContractor = contractorRows.find((c) => c.company_name === "Siemens Energy");
    const schneiderContractor = contractorRows.find((c) => c.company_name === "Schneider Electric");

    process.stdout.write("Seeding persons (Workers, Interns, Visitors)...\n");
    const { rows: personRows } = await pool.query(`
      INSERT INTO persons (
        category, full_name, phone, email, status,
        worker_ref, contractor_id, contractor_company,
        institution_name, course_programme,
        purpose_of_visit, person_to_meet, host_employee_email,
        created_by
      )
      VALUES
        -- Active Contract Workers
        ('worker', 'Rajesh Sharma', '+91 98230 11111', 'rajesh.sharma@worker.test', 'active',
         'WRK-1001', $1, 'Larsen & Toubro Ltd', NULL, NULL, NULL, NULL, NULL, $5),
        ('worker', 'Sunita Patil',  '+91 98230 22222', 'sunita.patil@worker.test',  'active',
         'WRK-1002', $2, 'ABB Power Grids', NULL, NULL, NULL, NULL, NULL, $5),
        ('worker', 'Vikram Singh',  '+91 98230 33333', 'vikram.singh@worker.test',  'active',
         'WRK-1003', $3, 'Siemens Energy', NULL, NULL, NULL, NULL, NULL, $5),
        ('worker', 'Dinesh Gupta',  '+91 98230 55555', 'dinesh.gupta@worker.test',  'active',
         'WRK-1005', $1, 'Larsen & Toubro Ltd', NULL, NULL, NULL, NULL, NULL, $5),
        -- Suspended Worker (for safety constraint testing)
        ('worker', 'Amit Verma',    '+91 98230 44444', 'amit.verma@worker.test',    'suspended',
         'WRK-1004', $4, 'Schneider Electric', NULL, NULL, NULL, NULL, NULL, $5),

        -- Active Interns
        ('intern', 'Priya Desai',   '+91 97650 11111', 'priya.desai@student.test',  'active',
         NULL, NULL, NULL, 'Pune Institute of Computer Technology (PICT)', 'B.E. Robotics & AI', NULL, NULL, NULL, $5),
        ('intern', 'Rahul Nair',    '+91 97650 22222', 'rahul.nair@student.test',   'active',
         NULL, NULL, NULL, 'College of Engineering Pune (COEP)', 'B.Tech Electrical Eng', NULL, NULL, NULL, $5),
        ('intern', 'Ananya Iyer',   '+91 97650 33333', 'ananya.iyer@student.test',  'active',
         NULL, NULL, NULL, 'MIT World Peace University', 'M.Tech Automation', NULL, NULL, NULL, $5),

        -- Visitors
        ('visitor', 'Dr. Arvind Joshi', '+91 99220 11111', 'arvind.joshi@consultant.test', 'active',
         NULL, NULL, NULL, NULL, NULL, 'Annual Quality & Environmental Audit', 'Plant Facility Team', 'facility.plant3@in.abb.com', $5),
        ('visitor', 'Sneha Kulkarni',   '+91 99220 22222', 'sneha.k@vendor-service.test',  'active',
         NULL, NULL, NULL, NULL, NULL, 'Switchgear Calibration Consultation', 'Anuj Chhajed', 'anuj.admin@test.abb.com', $5),
        ('visitor', 'Marcus Vance',     '+91 99220 33333', 'marcus.vance@abb-global.test', 'active',
         NULL, NULL, NULL, NULL, NULL, 'Global EHS Compliance Walkthrough', 'Plant Manager', 'manager.plant3@in.abb.com', $5)
      RETURNING id, full_name, category, status, worker_ref;
    `, [ltContractor.id, abbContractor.id, siemensContractor.id, schneiderContractor.id, adminUser.id]);

    const rajesh = personRows.find((p) => p.worker_ref === "WRK-1001");
    const sunita = personRows.find((p) => p.worker_ref === "WRK-1002");
    const vikram = personRows.find((p) => p.worker_ref === "WRK-1003");
    const amit = personRows.find((p) => p.worker_ref === "WRK-1004");
    const dinesh = personRows.find((p) => p.worker_ref === "WRK-1005");
    const priya = personRows.find((p) => p.full_name === "Priya Desai");
    const rahul = personRows.find((p) => p.full_name === "Rahul Nair");
    const ananya = personRows.find((p) => p.full_name === "Ananya Iyer");
    const arvind = personRows.find((p) => p.full_name === "Dr. Arvind Joshi");
    const sneha = personRows.find((p) => p.full_name === "Sneha Kulkarni");
    const marcus = personRows.find((p) => p.full_name === "Marcus Vance");

    process.stdout.write("Seeding credentials / ID cards (Valid, Expired, Suspended, Terminated)...\n");
    const { rows: cardRows } = await pool.query(`
      INSERT INTO id_cards (
        card_number, person_id, kind, valid_from, valid_to, status, canteen_eligible, issued_by
      )
      VALUES
        -- 1. Valid active worker card
        ('ABB-WKR-1001', $1,  'id_card',   '2026-01-01', '2026-12-31', 'active',    TRUE,  $11),
        -- 2. Valid active worker card
        ('ABB-WKR-1002', $2,  'id_card',   '2026-01-01', '2026-12-31', 'active',    TRUE,  $11),
        -- 3. Expired worker card (valid_to is in 2025)
        ('ABB-WKR-1003', $3,  'id_card',   '2025-01-01', '2025-12-31', 'active',    TRUE,  $11),
        -- 4. Active card for a suspended person
        ('ABB-WKR-1004', $4,  'id_card',   '2026-01-01', '2026-12-31', 'active',    TRUE,  $11),
        -- 5. Suspended worker card
        ('ABB-WKR-1005', $5,  'id_card',   '2026-01-01', '2026-12-31', 'suspended', FALSE, $11),

        -- 6. Valid intern card
        ('ABB-INT-2001', $6,  'id_card',   '2026-06-01', '2026-12-31', 'active',    TRUE,  $11),
        -- 7. Valid intern card
        ('ABB-INT-2002', $7,  'id_card',   '2026-06-01', '2026-12-31', 'active',    TRUE,  $11),
        -- 8. Terminated intern card
        ('ABB-REV-9999', $8,  'id_card',   '2026-01-01', '2026-12-31', 'terminated',FALSE, $11),

        -- 9. Valid visitor day-pass
        ('ABB-VIS-3001', $9,  'gate_pass', '2026-10-16', '2026-10-17', 'active',    FALSE, $11),
        -- 10. Expired visitor pass
        ('ABB-VIS-3002', $10, 'gate_pass', '2026-10-01', '2026-10-05', 'active',    FALSE, $11)
      RETURNING id, card_number, person_id, status;
    `, [
      rajesh.id, sunita.id, vikram.id, amit.id, dinesh.id,
      priya.id, rahul.id, ananya.id, arvind.id, sneha.id,
      adminUser.id,
    ]);

    const cardRajesh = cardRows.find((c) => c.card_number === "ABB-WKR-1001");
    const cardSunita = cardRows.find((c) => c.card_number === "ABB-WKR-1002");
    const cardVikram = cardRows.find((c) => c.card_number === "ABB-WKR-1003");
    const cardAmit = cardRows.find((c) => c.card_number === "ABB-WKR-1004");
    const cardDinesh = cardRows.find((c) => c.card_number === "ABB-WKR-1005");
    const cardPriya = cardRows.find((c) => c.card_number === "ABB-INT-2001");
    const cardArvind = cardRows.find((c) => c.card_number === "ABB-VIS-3001");
    const cardSneha = cardRows.find((c) => c.card_number === "ABB-VIS-3002");

    process.stdout.write("Seeding visits...\n");
    await pool.query(`
      INSERT INTO visits (
        person_id, host_name, host_email, host_department,
        purpose_of_visit, expected_arrival, expected_departure,
        approval_status, approved_by, approved_at, badge_id
      )
      VALUES
        ($1, 'Plant Facility Team', 'facility.plant3@in.abb.com', 'Operations',
         'Annual Quality & Environmental Audit', '2026-10-16 09:00:00+05:30', '2026-10-17 17:00:00+05:30',
         'approved', $4, NOW(), $2),
        ($3, 'Anuj Chhajed', 'anuj.admin@test.abb.com', 'Plant Administration',
         'Switchgear Calibration Consultation', '2026-10-02 10:00:00+05:30', '2026-10-02 16:00:00+05:30',
         'completed', $4, NOW(), $5),
        ($6, 'Plant Manager', 'manager.plant3@in.abb.com', 'Executive Office',
         'Global EHS Compliance Walkthrough', '2026-10-18 10:30:00+05:30', '2026-10-18 15:30:00+05:30',
         'pending', NULL, NULL, NULL);
    `, [arvind.id, cardArvind.id, sneha.id, adminUser.id, cardSneha.id, marcus.id]);

    process.stdout.write("Seeding gate logs (including currently inside people)...\n");
    await pool.query(`
      INSERT INTO gate_logs (
        card_id, person_id, gate_name, direction, result, reason_code, reason_text,
        scanned_code, occurred_at, operator_id
      )
      VALUES
        -- 1. Rajesh entered Plant 3 at 08:15 today (Approved, currently INSIDE)
        ($1, $2, 'Plant 3 - Main Gate', 'entry', 'approved', 'VERIFIED_OK', 'Valid contract worker ID',
         'ABB-WKR-1001', '2026-10-16 08:15:00+05:30', $9),

        -- 2. Sunita entered at 08:30 and exited at 12:45 (Both approved, currently OUTSIDE)
        ($3, $4, 'Plant 3 - Main Gate', 'entry', 'approved', 'VERIFIED_OK', 'Valid contract worker ID',
         'ABB-WKR-1002', '2026-10-16 08:30:00+05:30', $9),
        ($3, $4, 'Plant 3 - Main Gate', 'exit',  'approved', 'VERIFIED_OK', 'Valid contract worker ID',
         'ABB-WKR-1002', '2026-10-16 12:45:00+05:30', $9),

        -- 3. Priya Desai entered at 09:00 today (Approved, currently INSIDE)
        ($5, $6, 'Plant 3 - Main Gate', 'entry', 'approved', 'VERIFIED_OK', 'Valid intern badge',
         'ABB-INT-2001', '2026-10-16 09:00:00+05:30', $9),

        -- 4. Dr. Arvind Joshi entered at 09:15 today (Approved, currently INSIDE)
        ($7, $8, 'Plant 3 - Main Gate', 'entry', 'approved', 'VERIFIED_OK', 'Approved visitor day-pass',
         'ABB-VIS-3001', '2026-10-16 09:15:00+05:30', $9),

        -- 5. Vikram Singh scan rejected at 09:20 (Expired card)
        ($10, $11, 'Plant 3 - Main Gate', 'entry', 'rejected', 'CREDENTIAL_EXPIRED', 'Credential expired on 2025-12-31',
         'ABB-WKR-1003', '2026-10-16 09:20:00+05:30', $9),

        -- 6. Amit Verma scan rejected at 09:25 (Person suspended)
        ($12, $13, 'Plant 3 - Main Gate', 'entry', 'rejected', 'PERSON_SUSPENDED', 'Person record is suspended',
         'ABB-WKR-1004', '2026-10-16 09:25:00+05:30', $9),

        -- 7. Unrecognised code scanned at 09:30
        (NULL, NULL, 'Plant 3 - Main Gate', 'entry', 'unable_to_verify', 'CODE_NOT_FOUND', 'No credential matching barcode',
         'UNKNOWN-999-XYZ', '2026-10-16 09:30:00+05:30', $9);
    `, [
      cardRajesh.id, rajesh.id,
      cardSunita.id, sunita.id,
      cardPriya.id, priya.id,
      cardArvind.id, arvind.id,
      securityUser.id,
      cardVikram.id, vikram.id,
      cardAmit.id, amit.id,
    ]);

    process.stdout.write("Seeding canteen logs...\n");
    await pool.query(`
      INSERT INTO canteen_logs (
        card_id, person_id, meal_date, meal_session, result, reason_code, reason_text, occurred_at, operator_id
      )
      VALUES
        -- Rajesh claimed lunch today (Approved)
        ($1, $2, '2026-10-16', 'lunch', 'approved', 'MEAL_GRANTED', 'Meal eligibility confirmed', '2026-10-16 13:00:00+05:30', $5),
        -- Priya claimed lunch today (Approved)
        ($3, $4, '2026-10-16', 'lunch', 'approved', 'MEAL_GRANTED', 'Meal eligibility confirmed', '2026-10-16 13:15:00+05:30', $5);
    `, [cardRajesh.id, rajesh.id, cardPriya.id, priya.id, securityUser.id]);

    process.stdout.write("Seeding audit logs...\n");
    await pool.query(`
      INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, reason, occurred_at)
      VALUES
        ($1, 'user.create',      'user',       $2, 'Bootstrap administrator account', NOW() - INTERVAL '2 days'),
        ($1, 'user.create',      'user',       $3, 'Provision security staff account', NOW() - INTERVAL '2 days'),
        ($1, 'contractor.create','contractor', $4, 'Register vendor L&T', NOW() - INTERVAL '1 day'),
        ($1, 'person.suspend',   'person',     $5, 'Pending EHS refresher certification', NOW() - INTERVAL '4 hours');
    `, [adminUser.id, adminUser.id, securityUser.id, ltContractor.id, amit.id]);

    // Summary counts
    const tables = [
      "users", "contractors", "persons", "id_cards", "visits",
      "gate_logs", "canteen_logs", "audit_logs", "settings"
    ];

    const counts = {};
    for (const t of tables) {
      const res = await pool.query(`SELECT COUNT(*)::int AS cnt FROM ${t};`);
      counts[t] = res.rows[0].cnt;
    }

    const { rows: insideRows } = await pool.query("SELECT COUNT(*)::int AS cnt FROM v_people_inside;");
    counts["v_people_inside"] = insideRows[0].cnt;

    process.stdout.write("\n============================================================\n");
    process.stdout.write("  SEED COMPLETED SUCCESSFULLY ON abb_gate_test\n");
    process.stdout.write("============================================================\n");
    for (const [k, v] of Object.entries(counts)) {
      process.stdout.write(`  ${k.padEnd(20)} : ${v}\n`);
    }
    process.stdout.write("============================================================\n");
    process.stdout.write("  Test Admin:     username: 'admin.test',    password: '" + testPassword + "'\n");
    process.stdout.write("  Test Security:  username: 'gate.operator', password: '" + testPassword + "'\n");
    process.stdout.write("============================================================\n\n");

  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.endsWith("seed-test-data.js")) {
  seedTestData().catch((err) => {
    process.stderr.write(`Seeding failed: ${err.message}\n`);
    process.exit(1);
  });
}
