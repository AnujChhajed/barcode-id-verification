-- ==============================================================================
-- ABB Plant 3 Security & Gate Management System — Complete Master Setup & Seed
-- File: supabase/schema.sql
--
-- Instructions:
--   Run this entire script in your Supabase Project SQL Editor (Project: gxhhvgqujolqpxxmxtto)
--   It will:
--     1. Ensure all required ENUM types exist.
--     2. Ensure all tables, columns, foreign keys, and unique indexes exist.
--     3. Create authoritative security RPCs (verify_gate_access, check_student_card).
--     4. Configure Row Level Security (RLS) with immutable append-only access_logs.
--     5. Create 'public.personnel' convenience view.
--     6. Purge legacy college student mock data.
--     7. Seed real ABB Plant 3 industrial data:
--        - Facility: ABB Plant 3 & Plant 3 Main Gate
--        - 8 Contract Workers (ABB Power Grids, Siemens, L&T, Schneider, Apex, Thermax)
--        - 4 Engineering Interns (NIT, COEP, VJTI)
--        - 3 Registered Visitors (Audit Inspector, Client QA, Logistics Delivery)
--        - 2 Active Security Watchlist Records
--        - Realistic shift entry/exit access logs for today
--        - Canteen meal claims for today
--        - Plant safety incidents and shift briefing announcements
-- ==============================================================================

-- ── 1. Enums ──────────────────────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from pg_type where typname = 'access_decision' and typnamespace = 'public'::regnamespace) then
    create type public.access_decision as enum ('allowed', 'denied', 'unknown');
  end if;
  if not exists (select 1 from pg_type where typname = 'app_role' and typnamespace = 'public'::regnamespace) then
    create type public.app_role as enum ('admin', 'gate');
  end if;
  if not exists (select 1 from pg_type where typname = 'scan_direction' and typnamespace = 'public'::regnamespace) then
    create type public.scan_direction as enum ('in', 'out');
  end if;
  if not exists (select 1 from pg_type where typname = 'student_status' and typnamespace = 'public'::regnamespace) then
    create type public.student_status as enum ('active', 'suspended', 'graduated');
  end if;
  if not exists (select 1 from pg_type where typname = 'person_category' and typnamespace = 'public'::regnamespace) then
    create type public.person_category as enum ('worker', 'intern', 'visitor');
  end if;
end
$$;

-- ── 2. Core Tables ────────────────────────────────────────────────────────────

-- Profiles (Staff / Operators linked to Supabase Auth)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- User Roles
create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

-- Plants
create table if not exists public.plants (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Gates
create table if not exists public.gates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  location text,
  plant_id uuid references public.plants(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Personnel / Students
create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  admission_number text not null unique, -- Employee / Badge ID (e.g. ABB-W-1049)
  barcode text not null unique,          -- Scannable barcode / QR code
  full_name text not null,
  category public.person_category not null default 'worker',
  company_name text,                     -- Vendor / Contractor company
  institution text,                      -- College / University for interns
  plant_id uuid references public.plants(id) on delete set null,
  status public.student_status not null default 'active',
  photo_url text,
  valid_from timestamptz default now(),
  expires_at timestamptz,
  suspended_until timestamptz,
  suspension_reason text,
  parent_phone text,                     -- Emergency Contact
  parent_email text,                     -- Supervisor / Host Email
  notes text,
  is_visitor boolean not null default false,
  -- Legacy columns with defaults for zero-breakage
  programme text not null default '',
  nta_level text not null default '',
  year_of_study integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Ensure all extended columns exist if tables were previously created under legacy schemas:
-- 1. Plants
alter table public.plants add column if not exists code text;
alter table public.plants add column if not exists name text;
alter table public.plants add column if not exists description text;
alter table public.plants add column if not exists is_active boolean not null default true;

-- 2. Gates
alter table public.gates add column if not exists location text;
alter table public.gates add column if not exists plant_id uuid references public.plants(id) on delete set null;
alter table public.gates add column if not exists is_active boolean not null default true;

-- 3. Students / Personnel
alter table public.students add column if not exists category public.person_category not null default 'worker';
alter table public.students add column if not exists company_name text;
alter table public.students add column if not exists institution text;
alter table public.students add column if not exists plant_id uuid references public.plants(id) on delete set null;
alter table public.students add column if not exists valid_from timestamptz default now();
alter table public.students add column if not exists expires_at timestamptz;
alter table public.students add column if not exists suspended_until timestamptz;
alter table public.students add column if not exists suspension_reason text;
alter table public.students add column if not exists is_visitor boolean not null default false;
alter table public.students add column if not exists parent_phone text;
alter table public.students add column if not exists parent_email text;
alter table public.students add column if not exists photo_url text;
alter table public.students add column if not exists notes text;
alter table public.students add column if not exists programme text not null default '';
alter table public.students add column if not exists nta_level text not null default '';
alter table public.students add column if not exists year_of_study integer not null default 1;

-- 4. Access Logs
alter table public.access_logs add column if not exists student_id uuid references public.students(id) on delete set null;
alter table public.access_logs add column if not exists gate_id uuid references public.gates(id) on delete set null;
alter table public.access_logs add column if not exists scanned_by uuid references public.profiles(id) on delete set null;
alter table public.access_logs add column if not exists reason text;
alter table public.access_logs add column if not exists direction public.scan_direction;
alter table public.access_logs add column if not exists overridden boolean default false;
alter table public.access_logs add column if not exists operator_note text;
alter table public.access_logs add column if not exists scanned_at timestamptz not null default now();

-- 5. Canteen Logs
alter table public.canteen_logs add column if not exists student_id uuid references public.students(id) on delete set null;
alter table public.canteen_logs add column if not exists scanned_code text;
alter table public.canteen_logs add column if not exists meal_type text not null default 'lunch';
alter table public.canteen_logs add column if not exists log_date date not null default current_date;
alter table public.canteen_logs add column if not exists decision text not null default 'allowed';
alter table public.canteen_logs add column if not exists reason text;
alter table public.canteen_logs add column if not exists scanned_by uuid references public.profiles(id) on delete set null;
alter table public.canteen_logs add column if not exists plant_id uuid references public.plants(id) on delete set null;

-- 6. Watchlist
alter table public.watchlist add column if not exists id_number text;
alter table public.watchlist add column if not exists barcode text;
alter table public.watchlist add column if not exists alert_level text not null default 'high';
alter table public.watchlist add column if not exists reason text not null default 'Security alert';
alter table public.watchlist add column if not exists description text;
alter table public.watchlist add column if not exists photo_url text;
alter table public.watchlist add column if not exists is_active boolean not null default true;
alter table public.watchlist add column if not exists expires_at timestamptz;
alter table public.watchlist add column if not exists added_by uuid references public.profiles(id) on delete set null;

-- 7. Incidents
alter table public.incidents add column if not exists title text;
alter table public.incidents add column if not exists description text;
alter table public.incidents add column if not exists severity text not null default 'medium';
alter table public.incidents add column if not exists status text not null default 'open';
alter table public.incidents add column if not exists reported_by uuid references public.profiles(id) on delete set null;
alter table public.incidents add column if not exists gate_id uuid references public.gates(id) on delete set null;

-- 8. Appointments
alter table public.appointments add column if not exists visitor_name text;
alter table public.appointments add column if not exists visitor_phone text;
alter table public.appointments add column if not exists visitor_id_number text;
alter table public.appointments add column if not exists host_name text;
alter table public.appointments add column if not exists department text;
alter table public.appointments add column if not exists purpose text;
alter table public.appointments add column if not exists expected_arrival timestamptz;
alter table public.appointments add column if not exists status text not null default 'pending';

-- 9. Announcements
alter table public.announcements add column if not exists title text;
alter table public.announcements add column if not exists body text;
alter table public.announcements add column if not exists priority text not null default 'normal';
alter table public.announcements add column if not exists is_active boolean not null default true;
alter table public.announcements add column if not exists created_by uuid references public.profiles(id) on delete set null;

-- Access Logs (Append-Only Gate Event Audit Trail)
create table if not exists public.access_logs (
  id uuid primary key default gen_random_uuid(),
  scanned_code text not null,
  student_id uuid references public.students(id) on delete set null,
  gate_id uuid references public.gates(id) on delete set null,
  scanned_by uuid references public.profiles(id) on delete set null,
  decision public.access_decision not null,
  reason text,
  direction public.scan_direction,
  overridden boolean default false,
  operator_note text,
  scanned_at timestamptz not null default now()
);

-- Canteen Logs (Cafeteria Meal Verification with Daily Duplicate Prevention)
create table if not exists public.canteen_logs (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.students(id) on delete set null,
  scanned_code text not null,
  meal_type text not null check (meal_type in ('breakfast', 'lunch', 'dinner', 'night_snack')),
  log_date date not null default current_date,
  decision text not null default 'allowed',
  reason text,
  scanned_by uuid references public.profiles(id) on delete set null,
  plant_id uuid references public.plants(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists uq_canteen_daily_meal
  on public.canteen_logs (student_id, log_date, meal_type)
  where (decision = 'allowed');

-- Watchlist (Active Security Alerts)
create table if not exists public.watchlist (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  id_number text,
  barcode text,
  alert_level text not null default 'high' check (alert_level in ('low', 'medium', 'high', 'critical')),
  reason text not null,
  description text,
  photo_url text,
  is_active boolean not null default true,
  expires_at timestamptz,
  added_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Incidents
create table if not exists public.incidents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null,
  severity text not null default 'medium' check (severity in ('low', 'medium', 'high', 'critical')),
  status text not null default 'open' check (status in ('open', 'investigating', 'resolved', 'closed')),
  reported_by uuid references public.profiles(id) on delete set null,
  gate_id uuid references public.gates(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Appointments (Pre-registered Plant Visitors)
create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  visitor_name text not null,
  visitor_phone text,
  visitor_id_number text,
  host_name text not null,
  department text,
  purpose text not null,
  expected_arrival timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'checked_in', 'cancelled', 'completed')),
  created_at timestamptz not null default now()
);

-- Announcements (Shift Safety Briefings & Notices)
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'urgent')),
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Announcement Reads
create table if not exists public.announcement_reads (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (announcement_id, user_id)
);

-- ── 3. Convenience Views ──────────────────────────────────────────────────────

-- Safely drop existing view if exists
drop view if exists public.personnel cascade;

-- 'personnel' view aliasing 'students'
create or replace view public.personnel as
select
  id,
  admission_number as badge_number,
  barcode,
  full_name,
  category,
  company_name,
  institution,
  plant_id,
  status,
  valid_from,
  expires_at,
  suspended_until,
  suspension_reason,
  photo_url,
  parent_phone as emergency_phone,
  parent_email as supervisor_email,
  notes,
  is_visitor,
  created_at,
  updated_at
from public.students;

-- ── 4. Authoritative Verification RPCs ────────────────────────────────────────

-- Drop previous function signatures with CASCADE to avoid 42P13 return type conflicts
drop function if exists public.check_student_card(text) cascade;
drop function if exists public.check_student_card cascade;
drop function if exists public.verify_gate_access(text, uuid, public.scan_direction, text) cascade;
drop function if exists public.verify_gate_access(text, uuid, public.scan_direction, uuid) cascade;
drop function if exists public.verify_gate_access(text, uuid, text, uuid) cascade;
drop function if exists public.verify_gate_access cascade;
drop function if exists public.has_role(public.app_role) cascade;
drop function if exists public.has_role cascade;
drop function if exists public.is_admin() cascade;
drop function if exists public.is_admin cascade;
drop function if exists public.is_staff() cascade;
drop function if exists public.is_staff cascade;

-- Role helper functions
create or replace function public.has_role(p_role public.app_role)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = p_role
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
as $$
  select coalesce(public.has_role('admin'), false);
$$;

create or replace function public.is_staff()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role in ('admin', 'gate')
  );
$$;

create or replace function public.verify_gate_access(
  p_scanned_code text,
  p_gate_id uuid default null,
  p_direction public.scan_direction default null,
  p_operator_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student record;
  v_wl record;
  v_decision public.access_decision := 'denied';
  v_reason text := null;
  v_gate_plant_id uuid := null;
  v_log_id uuid;
  v_clean_code text;
  v_now timestamptz := now();
begin
  v_clean_code := trim(p_scanned_code);

  if p_gate_id is not null then
    select plant_id into v_gate_plant_id from public.gates where id = p_gate_id;
  end if;

  -- 1. Check Watchlist FIRST
  select * into v_wl
  from public.watchlist
  where is_active = true
    and (expires_at is null or expires_at >= v_now)
    and (
      (barcode is not null and lower(trim(barcode)) = lower(v_clean_code))
      or (id_number is not null and lower(trim(id_number)) = lower(v_clean_code))
    )
  limit 1;

  if v_wl.id is not null then
    v_decision := 'denied';
    v_reason := 'WATCHLIST ALERT [' || upper(v_wl.alert_level) || ']: ' || v_wl.reason;

    insert into public.access_logs (
      scanned_code, gate_id, scanned_by, decision, reason, direction, scanned_at, operator_note
    ) values (
      v_clean_code, p_gate_id, p_operator_id, v_decision, v_reason, p_direction, v_now,
      '[WATCHLIST BLOCK] Matched alert record: ' || v_wl.full_name
    ) returning id into v_log_id;

    return jsonb_build_object(
      'decision', v_decision,
      'reason', v_reason,
      'log_id', v_log_id,
      'watchlist_hit', jsonb_build_object(
        'id', v_wl.id,
        'full_name', v_wl.full_name,
        'alert_level', v_wl.alert_level,
        'reason', v_wl.reason,
        'description', v_wl.description,
        'photo_url', v_wl.photo_url
      )
    );
  end if;

  -- 2. Lookup Personnel
  select * into v_student
  from public.students
  where lower(trim(barcode)) = lower(v_clean_code)
     or lower(trim(admission_number)) = lower(v_clean_code)
  limit 1;

  if v_student.id is null then
    v_decision := 'unknown';
    v_reason := 'Credential not recognized in Plant 3 security records';

    insert into public.access_logs (
      scanned_code, gate_id, scanned_by, decision, reason, direction, scanned_at
    ) values (
      v_clean_code, p_gate_id, p_operator_id, v_decision, v_reason, p_direction, v_now
    ) returning id into v_log_id;

    return jsonb_build_object(
      'decision', v_decision,
      'reason', v_reason,
      'log_id', v_log_id,
      'person', null
    );
  end if;

  -- 3. Plant Assignment Check
  if v_gate_plant_id is not null and v_student.plant_id is not null and v_student.plant_id <> v_gate_plant_id then
    v_decision := 'denied';
    v_reason := 'Plant Access Mismatch: Person not authorized for Plant 3 Main Gate';

  -- 4. Suspension Check
  elsif v_student.status = 'suspended' then
    if v_student.suspended_until is not null and v_student.suspended_until < v_now then
      v_decision := 'allowed';
      v_reason := null;
    else
      v_decision := 'denied';
      v_reason := coalesce('Suspended: ' || v_student.suspension_reason, 'Access suspended by Plant Administration');
      if v_student.suspended_until is not null then
        v_reason := v_reason || ' (until ' || to_char(v_student.suspended_until, 'YYYY-MM-DD HH24:MI') || ')';
      end if;
    end if;

  -- 5. Status Check
  elsif v_student.status <> 'active' then
    v_decision := 'denied';
    v_reason := 'Inactive credential status: ' || v_student.status;

  -- 6. Validity Date Check
  elsif v_student.valid_from is not null and v_student.valid_from > v_now then
    v_decision := 'denied';
    v_reason := 'Credential validity period has not started (starts ' || to_char(v_student.valid_from, 'YYYY-MM-DD') || ')';

  -- 7. Expiry Check
  elsif v_student.expires_at is not null and v_student.expires_at < v_now then
    v_decision := 'denied';
    v_reason := 'Pass expired on ' || to_char(v_student.expires_at, 'YYYY-MM-DD');

  -- 8. Access Approved
  else
    v_decision := 'allowed';
    v_reason := null;
  end if;

  -- Log decision atomically
  insert into public.access_logs (
    scanned_code, student_id, gate_id, scanned_by, decision, reason, direction, scanned_at
  ) values (
    v_clean_code, v_student.id, p_gate_id, p_operator_id, v_decision, v_reason, p_direction, v_now
  ) returning id into v_log_id;

  return jsonb_build_object(
    'decision', v_decision,
    'reason', v_reason,
    'log_id', v_log_id,
    'person', jsonb_build_object(
      'id', v_student.id,
      'full_name', v_student.full_name,
      'admission_number', v_student.admission_number,
      'barcode', v_student.barcode,
      'category', v_student.category,
      'company_name', v_student.company_name,
      'institution', v_student.institution,
      'status', v_student.status,
      'photo_url', v_student.photo_url,
      'valid_from', v_student.valid_from,
      'expires_at', v_student.expires_at,
      'is_visitor', v_student.is_visitor
    )
  );
end;
$$;

drop function if exists public.check_student_card(text) cascade;
drop function if exists public.check_student_card cascade;

create or replace function public.check_student_card(p_code text)
returns setof public.students
language sql
security definer
set search_path = public
as $$
  select *
  from public.students
  where lower(trim(barcode)) = lower(trim(p_code))
     or lower(trim(admission_number)) = lower(trim(p_code))
  limit 1;
$$;

-- ── 5. Row Level Security (RLS) Policies ──────────────────────────────────────

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.plants enable row level security;
alter table public.gates enable row level security;
alter table public.students enable row level security;
alter table public.access_logs enable row level security;
alter table public.canteen_logs enable row level security;
alter table public.watchlist enable row level security;
alter table public.incidents enable row level security;
alter table public.appointments enable row level security;
alter table public.announcements enable row level security;
alter table public.announcement_reads enable row level security;

-- IMMUTABLE access_logs: Strictly Revoke UPDATE and DELETE
revoke update, delete on public.access_logs from public, anon, authenticated;

-- Allow authenticated users to view & insert
do $$
begin
  drop policy if exists "Authenticated users can select profiles" on public.profiles;
  create policy "Authenticated users can select profiles" on public.profiles for select to authenticated using (true);

  drop policy if exists "Authenticated users can read plants" on public.plants;
  create policy "Authenticated users can read plants" on public.plants for select to authenticated using (true);

  drop policy if exists "Authenticated users can read gates" on public.gates;
  create policy "Authenticated users can read gates" on public.gates for select to authenticated using (true);

  drop policy if exists "Authenticated users can view personnel" on public.students;
  create policy "Authenticated users can view personnel" on public.students for select to authenticated using (true);

  drop policy if exists "Authenticated users can insert personnel" on public.students;
  create policy "Authenticated users can insert personnel" on public.students for insert to authenticated with check (true);

  drop policy if exists "Authenticated users can update personnel" on public.students;
  create policy "Authenticated users can update personnel" on public.students for update to authenticated using (true);

  drop policy if exists "Authenticated users can read access_logs" on public.access_logs;
  create policy "Authenticated users can read access_logs" on public.access_logs for select to authenticated using (true);

  drop policy if exists "Authenticated users can insert access_logs" on public.access_logs;
  create policy "Authenticated users can insert access_logs" on public.access_logs for insert to authenticated with check (true);

  drop policy if exists "Authenticated users can read canteen_logs" on public.canteen_logs;
  create policy "Authenticated users can read canteen_logs" on public.canteen_logs for select to authenticated using (true);

  drop policy if exists "Authenticated users can insert canteen_logs" on public.canteen_logs;
  create policy "Authenticated users can insert canteen_logs" on public.canteen_logs for insert to authenticated with check (true);

  drop policy if exists "Authenticated users can read watchlist" on public.watchlist;
  create policy "Authenticated users can read watchlist" on public.watchlist for select to authenticated using (true);

  drop policy if exists "Authenticated users can read incidents" on public.incidents;
  create policy "Authenticated users can read incidents" on public.incidents for select to authenticated using (true);

  drop policy if exists "Authenticated users can read appointments" on public.appointments;
  create policy "Authenticated users can read appointments" on public.appointments for select to authenticated using (true);

  drop policy if exists "Authenticated users can read announcements" on public.announcements;
  create policy "Authenticated users can read announcements" on public.announcements for select to authenticated using (true);
end
$$;

-- ── 6. Purge Legacy Student Mock Data ─────────────────────────────────────────

-- Clean out old ATC / student records safely
delete from public.canteen_logs where scanned_code ilike 'ATC%' or scanned_code ilike 'DCS%' or scanned_code ilike 'STU%';
delete from public.access_logs where scanned_code ilike 'ATC%' or scanned_code ilike 'DCS%' or scanned_code ilike 'STU%';
delete from public.students where admission_number ilike 'ATC%' or admission_number ilike 'DCS%' or admission_number ilike 'STU%' or programme ilike '%Computer Science%';

-- ── 7. Seed Real ABB Plant 3 Data ─────────────────────────────────────────────

-- 7.1 Seed Facility & Gate
insert into public.plants (code, name, description, is_active)
values ('plant-3', 'ABB Plant 3', 'ABB Plant 3 — Medium & High Voltage Switchgear Manufacturing Facility', true)
on conflict (code) do update
set name = excluded.name, description = excluded.description;

do $$
declare
  v_plant_id uuid;
begin
  select id into v_plant_id from public.plants where code = 'plant-3' limit 1;

  if not exists (select 1 from public.gates where name = 'Plant 3 - Main Gate') then
    insert into public.gates (name, location, plant_id, is_active)
    values ('Plant 3 - Main Gate', 'Main Security Gatehouse — North Perimeter', v_plant_id, true);
  else
    update public.gates
    set plant_id = v_plant_id, location = 'Main Security Gatehouse — North Perimeter', is_active = true
    where name = 'Plant 3 - Main Gate';
  end if;
end
$$;

-- 7.2 Seed Contract Workers, Engineering Interns, and Visitors
do $$
declare
  v_plant_id uuid;
begin
  select id into v_plant_id from public.plants where code = 'plant-3' limit 1;

  -- 1. Contract Workers (Industrial Contractors)
  insert into public.students (admission_number, barcode, full_name, category, company_name, plant_id, status, valid_from, expires_at, notes)
  values
    ('ABB-W-1049', 'ABB1049', 'Rajesh Sharma', 'worker', 'ABB Power Grids', v_plant_id, 'active', now() - interval '3 months', now() + interval '9 months', 'Senior Switchgear Commissioning Engineer'),
    ('ABB-W-2051', 'ABB2051', 'Vikram Patel', 'worker', 'Siemens Energy & Automation', v_plant_id, 'active', now() - interval '1 month', now() + interval '5 months', 'High-Voltage Cable Termination Specialist'),
    ('ABB-W-3042', 'ABB3042', 'Amit Deshmukh', 'worker', 'L&T Electrical & Automation', v_plant_id, 'active', now() - interval '2 months', now() + interval '10 months', 'Transformer Testing & Diagnostics Tech'),
    ('ABB-W-4108', 'ABB4108', 'Sanjay Nair', 'worker', 'Schneider Electric Services', v_plant_id, 'active', now() - interval '15 days', now() + interval '75 days', 'Industrial Automation PLC Programmer'),
    ('ABB-W-5021', 'ABB5021', 'Pradeep Kumar', 'worker', 'Apex Industrial Maintenance', v_plant_id, 'active', now() - interval '5 days', now() + interval '55 days', 'Mechanical Substation Erector'),
    ('ABB-W-6088', 'ABB6088', 'Manoj Tiwari', 'worker', 'Thermax Instrumentation', v_plant_id, 'active', now() - interval '20 days', now() + interval '160 days', 'Electrical Calibration Technician'),
    ('ABB-W-7014', 'ABB7014', 'Dinesh Yadav', 'worker', 'Apex Industrial Maintenance', v_plant_id, 'suspended', now() - interval '2 months', now() + interval '4 months', 'Safety violation: Unclipped safety harness on Switchgear Gantry B'),
    ('ABB-W-8005', 'ABB8005', 'Harish Verma', 'worker', 'Apex Industrial Maintenance', v_plant_id, 'active', now() - interval '7 months', now() - interval '14 days', 'Pass expired 14 days ago — requires renewal')
  on conflict (admission_number) do update
  set full_name = excluded.full_name,
      barcode = excluded.barcode,
      category = excluded.category,
      company_name = excluded.company_name,
      plant_id = excluded.plant_id,
      status = excluded.status,
      valid_from = excluded.valid_from,
      expires_at = excluded.expires_at,
      notes = excluded.notes;

  -- 2. Engineering Interns
  insert into public.students (admission_number, barcode, full_name, category, institution, plant_id, status, valid_from, expires_at, notes)
  values
    ('ABB-INT-0101', 'ABBINT0101', 'Ananya Sen', 'intern', 'National Institute of Technology', v_plant_id, 'active', now() - interval '1 month', now() + interval '5 months', 'Power Electronics Trainee'),
    ('ABB-INT-0102', 'ABBINT0102', 'Rohan Kulkarni', 'intern', 'COEP Technological University', v_plant_id, 'active', now() - interval '1 month', now() + interval '5 months', 'Substation Automation Intern'),
    ('ABB-INT-0103', 'ABBINT0103', 'Sneha Patil', 'intern', 'VJTI College of Engineering', v_plant_id, 'active', now() - interval '2 weeks', now() + interval '4 months', 'Protection & Relay Testing Intern'),
    ('ABB-INT-0104', 'ABBINT0104', 'Karan Joshi', 'intern', 'National Institute of Technology', v_plant_id, 'active', now() - interval '2 weeks', now() + interval '4 months', 'Robotics & Drives Trainee')
  on conflict (admission_number) do update
  set full_name = excluded.full_name,
      barcode = excluded.barcode,
      category = excluded.category,
      institution = excluded.institution,
      plant_id = excluded.plant_id,
      status = excluded.status,
      valid_from = excluded.valid_from,
      expires_at = excluded.expires_at,
      notes = excluded.notes;

  -- 3. Visitors
  insert into public.students (admission_number, barcode, full_name, category, is_visitor, company_name, plant_id, status, valid_from, expires_at, notes)
  values
    ('ABB-VIS-901', 'ABBVIS901', 'David Miller', 'visitor', true, 'ABB Global EHS Audit Team', v_plant_id, 'active', now() - interval '2 hours', now() + interval '8 hours', 'Lead Factory Safety Auditor'),
    ('ABB-VIS-902', 'ABBVIS902', 'Sunita Rao', 'visitor', true, 'Tata Power Transmission', v_plant_id, 'active', now() - interval '1 hour', now() + interval '6 hours', 'Client Technical QA Representative'),
    ('ABB-VIS-903', 'ABBVIS903', 'Ramesh Jadhav', 'visitor', true, 'Mahindra Logistics', v_plant_id, 'active', now() - interval '3 hours', now() + interval '3 hours', 'Heavy Equipment Inward Delivery Driver')
  on conflict (admission_number) do update
  set full_name = excluded.full_name,
      barcode = excluded.barcode,
      category = excluded.category,
      is_visitor = excluded.is_visitor,
      company_name = excluded.company_name,
      plant_id = excluded.plant_id,
      status = excluded.status,
      valid_from = excluded.valid_from,
      expires_at = excluded.expires_at,
      notes = excluded.notes;
end
$$;

-- 7.3 Seed Watchlist
insert into public.watchlist (full_name, id_number, barcode, alert_level, reason, description, is_active)
values
  ('Sunil Gokhale', 'W-BLOCKED-01', 'SUNILGOKHALE', 'critical', 'Attempted unauthorized egress with plant electrical copper stock; access barred by Plant Security', 'Former Apex sub-contractor; do not admit under any circumstances', true),
  ('Naresh Shinde', 'W-BLOCKED-02', 'NARESHSHINDE', 'high', 'Severe safety incident: Gate barrier tailgating and reckless driving in internal transit lane', 'Logistics delivery driver barred pending safety committee inquiry', true)
on conflict do nothing;

-- 7.4 Seed Announcements
insert into public.announcements (title, body, priority, is_active)
values
  ('Mandatory Arc-Flash PPE in Switchgear Testing Bay 4', 'All personnel entering Bay 4 must wear Category 4 arc-flash suits during primary injection testing from 09:00 to 17:00.', 'urgent', true),
  ('Plant 3 Annual Energy & Safety Inspection Scheduled for Thursday', 'All contractor leads must ensure daily hot work permits and gantry safety logs are up to date before 08:00.', 'normal', true)
on conflict do nothing;

-- 7.5 Seed Appointments
insert into public.appointments (visitor_name, visitor_phone, visitor_id_number, host_name, department, purpose, expected_arrival, status)
values
  ('Kavita Mehta', '+91 98201 12345', 'DL-MH04-2019-0012', 'Venkatesh Rao', 'Engineering & Design', 'Factory Acceptance Test (FAT) for 33kV GIS Switchboard', now() + interval '2 hours', 'pending'),
  ('Deepak Chawla', '+91 98900 67890', 'PAN-ABCDE1234F', 'Suresh Nair', 'Maintenance & Facilities', 'High-Voltage Transformer Oil Filtration Inspection', now() + interval '4 hours', 'pending')
on conflict do nothing;

-- 7.6 Seed Canteen Meal Claims for Today
do $$
declare
  v_rajesh uuid;
  v_ananya uuid;
  v_vikram uuid;
  v_gate_id uuid;
  v_plant_id uuid;
begin
  select id into v_plant_id from public.plants where code = 'plant-3' limit 1;
  select id into v_gate_id from public.gates where name = 'Plant 3 - Main Gate' limit 1;
  select id into v_rajesh from public.students where admission_number = 'ABB-W-1049' limit 1;
  select id into v_ananya from public.students where admission_number = 'ABB-INT-0101' limit 1;
  select id into v_vikram from public.students where admission_number = 'ABB-W-2051' limit 1;

  if v_rajesh is not null then
    insert into public.canteen_logs (student_id, scanned_code, meal_type, log_date, decision, plant_id)
    values
      (v_rajesh, 'ABB1049', 'breakfast', current_date, 'allowed', v_plant_id),
      (v_rajesh, 'ABB1049', 'lunch', current_date, 'allowed', v_plant_id)
    on conflict do nothing;
  end if;

  if v_ananya is not null then
    insert into public.canteen_logs (student_id, scanned_code, meal_type, log_date, decision, plant_id)
    values
      (v_ananya, 'ABBINT0101', 'lunch', current_date, 'allowed', v_plant_id)
    on conflict do nothing;
  end if;

  if v_vikram is not null then
    insert into public.canteen_logs (student_id, scanned_code, meal_type, log_date, decision, plant_id)
    values
      (v_vikram, 'ABB2051', 'breakfast', current_date, 'allowed', v_plant_id)
    on conflict do nothing;
  end if;

  -- 7.7 Seed Access Logs for Today (Shift Movements)
  if v_rajesh is not null and v_gate_id is not null then
    insert into public.access_logs (scanned_code, student_id, gate_id, decision, direction, scanned_at, operator_note)
    values
      ('ABB1049', v_rajesh, v_gate_id, 'allowed', 'in', now() - interval '6 hours', 'Shift Entry: Morning Switchgear Bay 4'),
      ('ABB1049', v_rajesh, v_gate_id, 'allowed', 'out', now() - interval '2 hours', 'Temporary Egress: Lunch turnaround'),
      ('ABB1049', v_rajesh, v_gate_id, 'allowed', 'in', now() - interval '1 hour', 'Shift Re-entry');
  end if;

  if v_ananya is not null and v_gate_id is not null then
    insert into public.access_logs (scanned_code, student_id, gate_id, decision, direction, scanned_at, operator_note)
    values
      ('ABBINT0101', v_ananya, v_gate_id, 'allowed', 'in', now() - interval '5 hours', 'Intern Shift Entry: Power Electronics Lab');
  end if;

  if v_gate_id is not null then
    insert into public.access_logs (scanned_code, gate_id, decision, reason, direction, scanned_at, operator_note)
    values
      ('ABB8005', v_gate_id, 'denied', 'Pass expired on ' || to_char(now() - interval '14 days', 'YYYY-MM-DD'), 'in', now() - interval '4 hours', 'Turnstile Block: Expired contractor pass');
  end if;
end
$$;

-- Complete setup notification
select 'ABB Plant 3 Database Schema & Seed Setup Completed Successfully' as status;
