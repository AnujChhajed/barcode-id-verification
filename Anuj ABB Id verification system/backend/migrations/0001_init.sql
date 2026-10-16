-- =============================================================================
-- ABB Plant 3 — Security Gate Verification & ID Management System
-- Migration 0001: Initial PostgreSQL Schema (Portable & Self-Contained)
-- =============================================================================
--
-- Target Database: abb_gate_verification
-- Target Engine:   PostgreSQL 14+
--
-- CORE 8 TABLES:
--   1. users        — Admin and security staff accounts (RBAC)
--   2. contractors  — Vendor and contractor companies
--   3. persons      — Workers, interns, and visitors
--   4. id_cards     — Physical & digital badge credentials (opaque token payload)
--   5. visits       — Visitor appointments, host approvals & gate passes
--   6. gate_logs    — Append-only audit of all gate scans (entry/exit)
--   7. canteen_logs — Append-only meal verification (one per person per day)
--   8. audit_logs   — Append-only administrative and security audit trail
--
-- SUPPORTING OPERATIONAL TABLES:
--   - sessions      — Server-managed session store (stores SHA-256 token hash)
--   - settings      — Dynamic system configuration
--
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Migration tracking table
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     VARCHAR(100) PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Helper trigger function to maintain updated_at
CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 1. USERS — Administrator and Security Staff Accounts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username       VARCHAR(50) NOT NULL UNIQUE,
  email          VARCHAR(255) UNIQUE,
  full_name      VARCHAR(100) NOT NULL,
  password_hash  VARCHAR(255) NOT NULL, -- scrypt / Argon2id / bcrypt
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

-- ---------------------------------------------------------------------------
-- 2. CONTRACTORS — Vendor and labor supply companies (Normalized)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 3. PERSONS — Central Registry (Workers, Interns, Visitors)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS persons (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category            VARCHAR(20) NOT NULL CHECK (category IN ('worker', 'intern', 'visitor')),
  full_name           VARCHAR(100) NOT NULL,
  phone               VARCHAR(50),
  email               VARCHAR(255),
  photo_path          TEXT, -- Local path outside web root, served via auth API
  status              VARCHAR(20) NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'suspended', 'terminated')),
  
  -- Worker attributes
  worker_ref          VARCHAR(50),
  contractor_id       UUID REFERENCES contractors(id) ON DELETE SET NULL,
  contractor_company  VARCHAR(150),
  
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

  -- Category check constraints (Enforces minimum collection per PRD FR-01)
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

CREATE UNIQUE INDEX IF NOT EXISTS ux_persons_worker_ref
  ON persons (worker_ref) WHERE worker_ref IS NOT NULL AND status <> 'terminated';

CREATE TRIGGER trg_persons_updated_at
  BEFORE UPDATE ON persons
  FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

-- ---------------------------------------------------------------------------
-- 4. ID_CARDS — Physical / Digital Badge Credentials
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 5. VISITS — Visitor Appointments & Gate Passes
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 6. GATE_LOGS — Append-Only Ledger of All Gate Scans
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gate_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id           UUID REFERENCES id_cards(id) ON DELETE SET NULL,
  person_id         UUID REFERENCES persons(id) ON DELETE SET NULL,
  gate_name         VARCHAR(50) NOT NULL DEFAULT 'Plant 3 - Main Gate',
  direction         VARCHAR(10) NOT NULL CHECK (direction IN ('entry', 'exit')),
  result            VARCHAR(20) NOT NULL
                      CHECK (result IN ('approved', 'rejected', 'unable_to_verify')),
  reason_code       VARCHAR(50),
  reason_text       TEXT,
  scanned_code      VARCHAR(100) NOT NULL, -- Raw string read by scanner
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

-- Duplicate scan suppression: prevents rapid duplicate records within the scan window
CREATE UNIQUE INDEX IF NOT EXISTS ux_gate_logs_dedup
  ON gate_logs (card_id, gate_name, direction, occurred_at)
  WHERE result = 'approved' AND card_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 7. CANTEEN_LOGS — Append-Only Meal Verification
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS canteen_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id        UUID REFERENCES id_cards(id) ON DELETE SET NULL,
  person_id      UUID REFERENCES persons(id) ON DELETE SET NULL,
  meal_date      DATE NOT NULL, -- Plant local calendar date ('YYYY-MM-DD' Asia/Kolkata)
  meal_session   VARCHAR(20) NOT NULL DEFAULT 'lunch'
                   CHECK (meal_session IN ('breakfast', 'lunch', 'dinner', 'snack', 'general')),
  result         VARCHAR(20) NOT NULL
                   CHECK (result IN ('approved', 'rejected', 'unable_to_verify')),
  reason_code    VARCHAR(50),
  reason_text    TEXT,
  occurred_at    TIMESTAMPTZ NOT NULL,
  operator_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_canteen_logs_date ON canteen_logs (meal_date);
CREATE INDEX IF NOT EXISTS ix_canteen_logs_person ON canteen_logs (person_id);

-- Enforce exactly one approved meal per person per local day at the DB level
CREATE UNIQUE INDEX IF NOT EXISTS ux_canteen_logs_one_per_day
  ON canteen_logs (person_id, meal_date)
  WHERE result = 'approved' AND person_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 8. AUDIT_LOGS — Append-Only Administrative & Security Change Log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  action         VARCHAR(100) NOT NULL, -- e.g. 'card.extend', 'person.status_change'
  entity_type    VARCHAR(50) NOT NULL,  -- e.g. 'person', 'id_card', 'visit', 'setting'
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

-- ---------------------------------------------------------------------------
-- SUPPORTING OPERATIONAL TABLES
-- ---------------------------------------------------------------------------

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

-- Key-value settings store
CREATE TABLE IF NOT EXISTS settings (
  key         VARCHAR(100) PRIMARY KEY,
  value       TEXT NOT NULL,
  description TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by  UUID REFERENCES users(id) ON DELETE SET NULL
);

-- ---------------------------------------------------------------------------
-- ANALYTICAL VIEW: People Currently Inside Plant 3
-- ---------------------------------------------------------------------------
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
  (re.occurred_at::date < CURRENT_DATE) AS missing_exit
FROM ranked_events re
JOIN persons p ON p.id = re.person_id
LEFT JOIN contractors c ON c.id = p.contractor_id
WHERE re.rnk = 1 AND re.direction = 'entry';
