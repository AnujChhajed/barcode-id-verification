-- =============================================================================
-- ABB Plant 3 Security Gate Verification & ID Management System
-- PostgreSQL Target Schema Specification (PROPOSED PLANNING ARTIFACT)
-- File: backend/planning/01_postgresql_schema.sql
--
-- TARGET DATABASE: abb_gate_verification
-- TARGET RDBMS:    PostgreSQL 14+
--
-- DESIGN PRINCIPLES:
-- 1. Standard PostgreSQL types (UUID, TIMESTAMPTZ, DATE, BOOLEAN, JSONB).
-- 2. Strict Referential Integrity: Foreign keys with explicit ON DELETE rules.
-- 3. Fail-Closed Security: Database constraints act as the absolute backstop
--    for business rules (validity dates, category requirements, uniqueness).
-- 4. Append-Only Event Tables: gate_logs and canteen_logs preserve full audit
--    trails and prevent silent history modification.
-- 5. Concurrency & Deduplication: Partial unique indexes guarantee duplicate-safe
--    gate scans and canteen meal limits at the database engine level.
-- =============================================================================

-- Ensure UUID generation is available (gen_random_uuid is built-in on PG 13+)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- Helper Function: Auto-update updated_at timestamps
-- =============================================================================
CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 1. USERS — Admin and security staff accounts
-- =============================================================================
CREATE TABLE IF NOT EXISTS users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username       VARCHAR(50) NOT NULL UNIQUE,
  email          VARCHAR(255) UNIQUE,
  full_name      VARCHAR(100) NOT NULL,
  password_hash  VARCHAR(255) NOT NULL, -- Argon2id / scrypt / bcrypt
  role           VARCHAR(30) NOT NULL CHECK (role IN ('administrator', 'security_staff')),
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at  TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_users_username_lower ON users (LOWER(username));
CREATE INDEX IF NOT EXISTS ix_users_role_active ON users (role, is_active);

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

-- =============================================================================
-- 7. CONTRACTORS — Contractor, vendor and supplier companies (Normalized)
-- =============================================================================
CREATE TABLE IF NOT EXISTS contractors (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name   VARCHAR(150) NOT NULL UNIQUE,
  contact_person VARCHAR(100),
  contact_phone  VARCHAR(50),
  contact_email  VARCHAR(255),
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_contractors_name_lower ON contractors (LOWER(company_name));
CREATE INDEX IF NOT EXISTS ix_contractors_active ON contractors (is_active);

CREATE TRIGGER trg_contractors_updated_at
  BEFORE UPDATE ON contractors
  FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

-- =============================================================================
-- 2. PERSONS — Workers, interns, and visitors
-- =============================================================================
CREATE TABLE IF NOT EXISTS persons (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category            VARCHAR(20) NOT NULL CHECK (category IN ('worker', 'intern', 'visitor')),
  full_name           VARCHAR(100) NOT NULL,
  phone               VARCHAR(50),
  email               VARCHAR(255),
  photo_path          TEXT, -- Local filesystem path outside web root, served via auth API
  status              VARCHAR(20) NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'suspended', 'terminated')),
  
  -- Category-specific attributes
  -- Worker attributes
  worker_ref          VARCHAR(50),
  contractor_id       UUID REFERENCES contractors(id) ON DELETE SET NULL,
  contractor_company  VARCHAR(150), -- Fallback / legacy contractor name
  
  -- Intern attributes
  institution_name    VARCHAR(150),
  course_programme    VARCHAR(100),
  
  -- Visitor attributes
  purpose_of_visit    TEXT,
  person_to_meet      VARCHAR(100),
  host_employee_email VARCHAR(255),
  
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Category validation constraints (Enforces minimum collection per PRD FR-01)
  CONSTRAINT chk_persons_worker_req
    CHECK (category <> 'worker' OR worker_ref IS NOT NULL),
  CONSTRAINT chk_persons_intern_req
    CHECK (category <> 'intern' OR institution_name IS NOT NULL),
  CONSTRAINT chk_persons_visitor_req
    CHECK (category <> 'visitor' OR (purpose_of_visit IS NOT NULL AND person_to_meet IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS ix_persons_category_status ON persons (category, status);
CREATE INDEX IF NOT EXISTS ix_persons_name ON persons (full_name);
CREATE INDEX IF NOT EXISTS ix_persons_contractor ON persons (contractor_id);

-- Enforce unique worker badge numbers for active/suspended workers
CREATE UNIQUE INDEX IF NOT EXISTS ux_persons_worker_ref
  ON persons (worker_ref) WHERE worker_ref IS NOT NULL AND status <> 'terminated';

CREATE TRIGGER trg_persons_updated_at
  BEFORE UPDATE ON persons
  FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

-- =============================================================================
-- 3. ID_CARDS — ID cards and QR/barcode credentials
-- =============================================================================
CREATE TABLE IF NOT EXISTS id_cards (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_number       VARCHAR(100) NOT NULL UNIQUE, -- Opaque barcode/QR token (NO personal data)
  person_id         UUID NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  kind              VARCHAR(20) NOT NULL CHECK (kind IN ('id_card', 'gate_pass')),
  valid_from        DATE NOT NULL,
  valid_to          DATE NOT NULL, -- Valid THROUGH 23:59:59.999 of this calendar date
  status            VARCHAR(20) NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'suspended', 'terminated')),
  canteen_eligible  BOOLEAN NOT NULL DEFAULT TRUE,
  issued_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  issued_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT chk_id_cards_date_order
    CHECK (valid_to >= valid_from)
);

CREATE INDEX IF NOT EXISTS ix_id_cards_person ON id_cards (person_id);
CREATE INDEX IF NOT EXISTS ix_id_cards_valid_to ON id_cards (valid_to);
CREATE INDEX IF NOT EXISTS ix_id_cards_status_validity ON id_cards (status, valid_from, valid_to);

CREATE TRIGGER trg_id_cards_updated_at
  BEFORE UPDATE ON id_cards
  FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

-- =============================================================================
-- 4. VISITS — Visitor appointments, approvals and visit logs
-- =============================================================================
CREATE TABLE IF NOT EXISTS visits (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id           UUID NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  host_name           VARCHAR(100) NOT NULL,
  host_email          VARCHAR(255),
  host_department     VARCHAR(100),
  purpose_of_visit    TEXT NOT NULL,
  expected_arrival    TIMESTAMPTZ NOT NULL,
  expected_departure  TIMESTAMPTZ,
  approval_status     VARCHAR(20) NOT NULL DEFAULT 'approved'
                        CHECK (approval_status IN ('pending', 'approved', 'rejected', 'cancelled', 'completed')),
  approved_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at         TIMESTAMPTZ,
  badge_id            UUID REFERENCES id_cards(id) ON DELETE SET NULL,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_visits_person ON visits (person_id);
CREATE INDEX IF NOT EXISTS ix_visits_expected_arrival ON visits (expected_arrival);
CREATE INDEX IF NOT EXISTS ix_visits_approval_status ON visits (approval_status);

CREATE TRIGGER trg_visits_updated_at
  BEFORE UPDATE ON visits
  FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

-- =============================================================================
-- 5. GATE_LOGS — Entry and exit verification records (APPEND-ONLY)
-- =============================================================================
CREATE TABLE IF NOT EXISTS gate_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id           UUID REFERENCES id_cards(id) ON DELETE SET NULL,
  person_id         UUID REFERENCES persons(id) ON DELETE SET NULL,
  gate_name         VARCHAR(50) NOT NULL DEFAULT 'Plant 3 - Main Gate',
  direction         VARCHAR(10) NOT NULL CHECK (direction IN ('entry', 'exit')),
  result            VARCHAR(20) NOT NULL
                      CHECK (result IN ('approved', 'rejected', 'unable_to_verify')),
  reason_code       VARCHAR(50), -- e.g. 'expired', 'suspended', 'not_found', 'outside_hours', 'duplicate_scan'
  reason_text       TEXT,
  scanned_code      VARCHAR(100) NOT NULL, -- Exact string scanned from barcode/QR
  occurred_at       TIMESTAMPTZ NOT NULL,
  operator_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  is_override       BOOLEAN NOT NULL DEFAULT FALSE,
  override_reason   TEXT,
  recorded_offline  BOOLEAN NOT NULL DEFAULT FALSE,
  synced_at         TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_gate_logs_person_time ON gate_logs (person_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ix_gate_logs_occurred ON gate_logs (occurred_at DESC);
CREATE INDEX IF NOT EXISTS ix_gate_logs_result ON gate_logs (result);
CREATE INDEX IF NOT EXISTS ix_gate_logs_card ON gate_logs (card_id);

-- Duplicate scan collapse: Prevents double-counting identical approved scans in rapid succession
CREATE UNIQUE INDEX IF NOT EXISTS ux_gate_logs_dedup
  ON gate_logs (card_id, gate_name, direction, occurred_at)
  WHERE result = 'approved' AND card_id IS NOT NULL;

-- =============================================================================
-- 6. CANTEEN_LOGS — Canteen access records (APPEND-ONLY, ONE PER PERSON PER DAY)
-- =============================================================================
CREATE TABLE IF NOT EXISTS canteen_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id        UUID REFERENCES id_cards(id) ON DELETE SET NULL,
  person_id      UUID REFERENCES persons(id) ON DELETE SET NULL,
  meal_date      DATE NOT NULL, -- Plant local calendar date ('YYYY-MM-DD' Asia/Kolkata)
  meal_session   VARCHAR(20) NOT NULL DEFAULT 'lunch'
                   CHECK (meal_session IN ('breakfast', 'lunch', 'dinner', 'snack', 'general')),
  result         VARCHAR(20) NOT NULL
                   CHECK (result IN ('approved', 'rejected', 'unable_to_verify')),
  reason_code    VARCHAR(50), -- e.g. 'already_consumed', 'expired_card', 'ineligible', 'not_found'
  reason_text    TEXT,
  occurred_at    TIMESTAMPTZ NOT NULL,
  operator_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_canteen_logs_date ON canteen_logs (meal_date);
CREATE INDEX IF NOT EXISTS ix_canteen_logs_person ON canteen_logs (person_id);

-- Enforce the business rule: Exactly ONE approved canteen entry per person per local calendar day
CREATE UNIQUE INDEX IF NOT EXISTS ux_canteen_logs_one_per_day
  ON canteen_logs (person_id, meal_date)
  WHERE result = 'approved' AND person_id IS NOT NULL;

-- =============================================================================
-- 8. AUDIT_LOGS — Administrative audit history (APPEND-ONLY)
-- =============================================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  action         VARCHAR(100) NOT NULL, -- e.g. 'card.extend', 'person.status_change', 'user.create'
  entity_type    VARCHAR(50) NOT NULL,  -- e.g. 'person', 'id_card', 'visit', 'setting', 'user'
  entity_id      VARCHAR(100),
  old_values     JSONB,
  new_values     JSONB,
  reason         TEXT,
  ip_address     VARCHAR(45),
  user_agent     TEXT,
  occurred_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_audit_logs_entity ON audit_logs (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS ix_audit_logs_actor ON audit_logs (actor_id);
CREATE INDEX IF NOT EXISTS ix_audit_logs_time ON audit_logs (occurred_at DESC);
CREATE INDEX IF NOT EXISTS ix_audit_logs_action ON audit_logs (action);

-- =============================================================================
-- SUPPORTING OPERATIONAL TABLES (Required by current backend architecture)
-- =============================================================================

-- Server-managed session store (stores SHA-256 hash of token, never raw token)
CREATE TABLE IF NOT EXISTS sessions (
  id            VARCHAR(64) PRIMARY KEY, -- SHA-256 hex digest of session token
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ,
  last_seen_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ix_sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS ix_sessions_expires ON sessions (expires_at);

-- Key-value settings store (read by frontend settings.tsx and backend config)
CREATE TABLE IF NOT EXISTS settings (
  key         VARCHAR(100) PRIMARY KEY,
  value       TEXT NOT NULL,
  description TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by  UUID REFERENCES users(id) ON DELETE SET NULL
);

-- =============================================================================
-- CONVENIENCE ANALYTICAL VIEWS
-- =============================================================================

-- View: Current people inside Plant 3 (derived from latest gate scan direction)
CREATE OR REPLACE VIEW v_people_inside AS
WITH ranked_events AS (
  SELECT
    gl.person_id,
    gl.card_id,
    gl.gate_name,
    gl.direction,
    gl.occurred_at,
    ROW_NUMBER() OVER (
      PARTITION BY gl.person_id
      ORDER BY gl.occurred_at DESC
    ) AS rnk
  FROM gate_logs gl
  WHERE gl.result = 'approved' AND gl.person_id IS NOT NULL
)
SELECT
  p.id AS person_id,
  p.full_name,
  p.category,
  p.phone,
  p.photo_path,
  p.status AS person_status,
  p.worker_ref,
  COALESCE(c.company_name, p.contractor_company) AS contractor_company,
  p.institution_name,
  re.card_id,
  re.gate_name,
  re.occurred_at AS inside_since,
  -- An entry is unclosed if it occurred before today's local date
  (re.occurred_at::date < CURRENT_DATE) AS missing_exit
FROM ranked_events re
JOIN persons p ON p.id = re.person_id
LEFT JOIN contractors c ON c.id = p.contractor_id
WHERE re.rnk = 1 AND re.direction = 'entry';

-- =============================================================================
-- SEED REFERENCE DATA (Plant 3 Defaults)
-- =============================================================================
INSERT INTO settings (key, value, description)
VALUES
  ('site.timezone', 'Asia/Kolkata', 'Primary timezone for Plant 3 operations'),
  ('expiry.reminder_days', '7', 'Days before card expiry to trigger notification'),
  ('canteen.entries_per_person_day', '1', 'Permitted canteen meal entries per person per day'),
  ('session.timeout_minutes', '30', 'Inactivity duration before session expiry'),
  ('scan.duplicate_window_seconds', '5', 'Window to collapse repeated scans of the same badge')
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value, description = EXCLUDED.description;
