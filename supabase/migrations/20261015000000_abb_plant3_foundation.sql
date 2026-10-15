-- ==============================================================================
-- ABB Plant 3 Security System — Foundation Schema Migration
-- Migration: 20261015000000_abb_plant3_foundation.sql
-- Description:
--   1. Adds person_category enum ('worker', 'intern', 'visitor').
--   2. Creates plants table and seeds 'ABB Plant 3'.
--   3. Adds plant_id to gates table and seeds 'Plant 3 - Main Gate'.
--   4. Extends students table with category, company_name, institution, plant_id, valid_from.
--   5. Creates canteen_logs table with atomic duplicate meal prevention index.
--   6. Configures Row Level Security (RLS) for all new structures.
-- Safe & Non-Destructive: Preserves all existing tables, columns, and data.
-- ==============================================================================

-- 1. Create person_category enum if not exists
do $$
begin
  if not exists (select 1 from pg_type where typname = 'person_category' and typnamespace = 'public'::regnamespace) then
    create type public.person_category as enum ('worker', 'intern', 'visitor');
  end if;
end
$$;

-- 2. Create plants table
create table if not exists public.plants (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Seed Plant 3
insert into public.plants (code, name, description, is_active)
values (
  'plant-3',
  'ABB Plant 3',
  'ABB Plant 3 Production & Engineering Facility',
  true
)
on conflict (code) do update
set name = excluded.name,
    description = excluded.description,
    is_active = excluded.is_active;

-- 3. Add plant_id to gates table
alter table public.gates
  add column if not exists plant_id uuid references public.plants(id) on delete set null;

-- Seed 'Plant 3 - Main Gate'
do $$
declare
  v_plant_id uuid;
begin
  select id into v_plant_id from public.plants where code = 'plant-3' limit 1;
  if v_plant_id is not null then
    if not exists (select 1 from public.gates where name = 'Plant 3 - Main Gate') then
      insert into public.gates (name, location, plant_id, is_active)
      values ('Plant 3 - Main Gate', 'Plant 3 Main Security Gate', v_plant_id, true);
    else
      update public.gates
      set plant_id = v_plant_id,
          location = coalesce(location, 'Plant 3 Main Security Gate'),
          is_active = true
      where name = 'Plant 3 - Main Gate';
    end if;
  end if;
end
$$;

-- 4. Extend students table (Workers, Interns & Visitors)
alter table public.students
  add column if not exists category public.person_category default 'worker',
  add column if not exists company_name text,
  add column if not exists institution text,
  add column if not exists plant_id uuid references public.plants(id) on delete set null,
  add column if not exists valid_from timestamptz default now();

-- Backfill existing records safely
do $$
declare
  v_plant_id uuid;
begin
  select id into v_plant_id from public.plants where code = 'plant-3' limit 1;

  -- Map existing visitors to 'visitor', others default to 'worker'
  update public.students
  set category = case
    when is_visitor = true then 'visitor'::public.person_category
    else 'worker'::public.person_category
  end
  where category is null;

  -- Default existing records to Plant 3
  if v_plant_id is not null then
    update public.students
    set plant_id = v_plant_id
    where plant_id is null;
  end if;
end
$$;

-- Index for category and plant_id
create index if not exists students_category_idx on public.students (category);
create index if not exists students_plant_id_idx on public.students (plant_id);
create index if not exists gates_plant_id_idx on public.gates (plant_id);

-- 5. Create canteen_logs table
create table if not exists public.canteen_logs (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.students(id) on delete set null,
  scanned_code text not null,
  meal_type text not null default 'lunch',
  log_date date not null default current_date,
  scanned_by uuid references public.profiles(id) on delete set null,
  plant_id uuid references public.plants(id) on delete set null,
  decision public.access_decision not null default 'allowed',
  reason text,
  created_at timestamptz not null default now()
);

-- Partial unique index: Exactly 1 allowed meal claim per person, date, and meal type
create unique index if not exists canteen_logs_unique_meal_per_day
  on public.canteen_logs (student_id, log_date, meal_type)
  where decision = 'allowed';

create index if not exists canteen_logs_log_date_idx on public.canteen_logs (log_date desc);
create index if not exists canteen_logs_scanned_code_idx on public.canteen_logs (scanned_code);
create index if not exists canteen_logs_plant_id_idx on public.canteen_logs (plant_id);

-- 6. Enable and configure Row Level Security (RLS)

alter table public.plants enable row level security;
alter table public.canteen_logs enable row level security;

-- Plants policies
drop policy if exists "Staff can read plants" on public.plants;
create policy "Staff can read plants" on public.plants
  for select to authenticated using (public.is_staff());

drop policy if exists "Admins manage plants" on public.plants;
create policy "Admins manage plants" on public.plants
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Canteen logs policies
drop policy if exists "Staff can read canteen logs" on public.canteen_logs;
create policy "Staff can read canteen logs" on public.canteen_logs
  for select to authenticated using (public.is_staff());

drop policy if exists "Staff can record canteen logs" on public.canteen_logs;
create policy "Staff can record canteen logs" on public.canteen_logs
  for insert to authenticated
  with check (public.is_staff() and (scanned_by is null or scanned_by = auth.uid() or public.is_admin()));

-- Grants
grant select on table public.plants to authenticated;
grant insert, update, delete on table public.plants to authenticated;
grant select, insert on table public.canteen_logs to authenticated;
grant update, delete on table public.canteen_logs to authenticated;
