-- =============================================================================
-- ABB Plant 3 — Migration 0002: Reference Seed Data
-- =============================================================================
--
-- Seeds default system settings and known contractor companies for Plant 3.
-- NOTE: No user accounts are seeded here. The first administrator is created
-- securely via the interactive bootstrap tool (`npm run bootstrap-admin`),
-- guaranteeing passwords are never written into SQL files or migration logs.
-- =============================================================================

-- Default system settings
INSERT INTO settings (key, value, description, updated_at)
VALUES
  ('site.timezone',                  'Asia/Kolkata', 'Primary operating timezone for Plant 3', NOW()),
  ('expiry.reminder_days',           '7',            'Days before badge expiry to trigger warning', NOW()),
  ('canteen.entries_per_person_day', '1',            'Allowed canteen meal entries per person per calendar day', NOW()),
  ('session.timeout_minutes',        '30',           'Inactivity timeout for security staff sessions', NOW()),
  ('scan.duplicate_window_seconds',  '5',            'Rapid scan burst collapse window in seconds', NOW())
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value, description = EXCLUDED.description, updated_at = NOW();

-- Common contractor and vendor companies for ABB Plant 3
INSERT INTO contractors (company_name, contact_person, contact_phone, contact_email, is_active, created_at, updated_at)
VALUES
  ('ABB Power Grids',      'Plant Facility Team', '+91 20 6600 0000', 'facilities.plant3@in.abb.com', TRUE, NOW(), NOW()),
  ('Larsen & Toubro Ltd',  'Site Supervisor',     '+91 22 6752 5656', 'contractors@larsentoubro.com', TRUE, NOW(), NOW()),
  ('Siemens Energy',       'Service Coordinator', '+91 22 3967 7000', 'support.in@siemens-energy.com', TRUE, NOW(), NOW()),
  ('Schneider Electric',   'Vendor Manager',      '+91 1800 103 0011', 'vendor.in@se.com', TRUE, NOW(), NOW())
ON CONFLICT (company_name) DO NOTHING;
