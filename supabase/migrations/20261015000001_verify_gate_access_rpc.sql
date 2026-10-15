-- ==============================================================================
-- ABB Plant 3 Security System — Authoritative Access Verification RPC
-- Migration: 20261015000001_verify_gate_access_rpc.sql
-- Description:
--   Creates the PostgreSQL function public.verify_gate_access().
--   Shifts all access decision logic (lockdown, status, validity dates,
--   Plant 3 assignment, and active watchlist check) to the database backend.
--   Atomically inserts an immutable record into public.access_logs.
-- Safe & Non-Destructive: Purely additive function.
-- ==============================================================================

create or replace function public.verify_gate_access(
  p_code text,
  p_gate_id uuid default null,
  p_direction public.scan_direction default 'in',
  p_operator_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_cleaned_code text := trim(p_code);
  v_gate_id uuid := p_gate_id;
  v_gate_plant_id uuid;
  v_plant_3_id uuid;
  v_person record;
  v_watchlist record;
  v_decision public.access_decision := 'unknown';
  v_reason text := null;
  v_log_id uuid;
  v_lockdown_setting record;
  v_is_lockdown boolean := false;
  v_person_json jsonb := null;
  v_watchlist_json jsonb := null;
begin
  -- 1. Security Check: Operator must be authenticated staff
  if auth.uid() is null or not public.is_staff() then
    return jsonb_build_object(
      'success', false,
      'decision', 'denied',
      'reason', 'Unauthorized operator',
      'scanned_code', v_cleaned_code
    );
  end if;

  if v_cleaned_code is null or v_cleaned_code = '' then
    return jsonb_build_object(
      'success', false,
      'decision', 'unknown',
      'reason', 'Empty code provided',
      'scanned_code', ''
    );
  end if;

  -- 2. Resolve Plant 3 ID
  select id into v_plant_3_id
  from public.plants
  where code = 'plant-3'
  limit 1;

  -- 3. Resolve Gate & Gate Plant
  if v_gate_id is not null then
    select plant_id into v_gate_plant_id
    from public.gates
    where id = v_gate_id;
  else
    -- Default to Plant 3 - Main Gate if no gate specified
    select id, plant_id into v_gate_id, v_gate_plant_id
    from public.gates
    where name = 'Plant 3 - Main Gate'
    limit 1;

    -- Fallback to any active gate
    if v_gate_id is null then
      select id, plant_id into v_gate_id, v_gate_plant_id
      from public.gates
      where is_active = true
      order by created_at asc
      limit 1;
    end if;
  end if;

  -- 4. Check Lockdown Status in Settings
  select value into v_lockdown_setting
  from public.settings
  where key = 'lockdown_active';

  if v_lockdown_setting.value is not null then
    if (v_lockdown_setting.value = 'true'::jsonb or v_lockdown_setting.value = '"true"'::jsonb) then
      v_is_lockdown := true;
    end if;
  end if;

  if v_is_lockdown then
    v_decision := 'denied';
    v_reason := 'Emergency lockdown — access suspended';

    insert into public.access_logs (
      scanned_code, student_id, gate_id, scanned_by, decision, reason, direction, operator_note, scanned_at
    ) values (
      v_cleaned_code, null, v_gate_id, auth.uid(), v_decision, v_reason, p_direction, p_operator_note, now()
    ) returning id into v_log_id;

    return jsonb_build_object(
      'success', true,
      'decision', v_decision,
      'reason', v_reason,
      'log_id', v_log_id,
      'scanned_code', v_cleaned_code,
      'direction', p_direction,
      'gate_id', v_gate_id,
      'scanned_at', now(),
      'person', null,
      'watchlist_hit', null
    );
  end if;

  -- 5. Person Lookup (Worker, Intern, or Visitor)
  select
    id,
    admission_number,
    barcode,
    full_name,
    category,
    company_name,
    institution,
    programme,
    status,
    photo_url,
    plant_id,
    valid_from,
    expires_at,
    suspended_until,
    suspension_reason,
    is_visitor
  into v_person
  from public.students
  where barcode = v_cleaned_code or admission_number = v_cleaned_code
  limit 1;

  -- 6. Check Active Watchlist
  select
    id,
    alert_level,
    full_name,
    reason,
    description,
    photo_url
  into v_watchlist
  from public.watchlist
  where is_active = true
    and (expires_at is null or expires_at > now())
    and (
      barcode = v_cleaned_code
      or id_number = v_cleaned_code
      or (v_person.id is not null and (barcode = v_person.barcode or id_number = v_person.admission_number))
    )
  order by
    case alert_level
      when 'detain' then 1
      when 'deny' then 2
      when 'warning' then 3
      else 4
    end asc
  limit 1;

  if v_watchlist.id is not null then
    v_watchlist_json := jsonb_build_object(
      'alert_level', v_watchlist.alert_level,
      'full_name', v_watchlist.full_name,
      'reason', v_watchlist.reason,
      'description', v_watchlist.description,
      'photo_url', v_watchlist.photo_url
    );
  end if;

  -- 7. Determine Access Decision
  if v_person.id is null then
    v_decision := 'unknown';
    v_reason := 'No matching worker, intern, or visitor record found';
  elsif v_watchlist.id is not null and v_watchlist.alert_level in ('deny', 'detain') then
    v_decision := 'denied';
    v_reason := 'WATCHLIST (' || upper(v_watchlist.alert_level) || '): ' || v_watchlist.reason;
  elsif v_person.plant_id is not null and v_gate_plant_id is not null and v_person.plant_id != v_gate_plant_id then
    v_decision := 'denied';
    v_reason := 'Person assigned to another plant (access denied for this gate)';
  elsif v_person.status = 'suspended' then
    if v_person.suspended_until is not null and v_person.suspended_until <= now() then
      v_decision := 'allowed';
      v_reason := null;
    else
      v_decision := 'denied';
      v_reason := coalesce('Suspended: ' || v_person.suspension_reason, 'Person is suspended');
      if v_person.suspended_until is not null then
        v_reason := v_reason || ' · until ' || to_char(v_person.suspended_until, 'YYYY-MM-DD');
      end if;
    end if;
  elsif v_person.status != 'active' then
    v_decision := 'denied';
    v_reason := 'Status is ' || v_person.status::text;
  elsif v_person.valid_from is not null and v_person.valid_from > now() then
    v_decision := 'denied';
    v_reason := 'Pass not yet valid until ' || to_char(v_person.valid_from, 'YYYY-MM-DD');
  elsif v_person.expires_at is not null and v_person.expires_at < now() then
    v_decision := 'denied';
    v_reason := 'Pass expired on ' || to_char(v_person.expires_at, 'YYYY-MM-DD');
  else
    v_decision := 'allowed';
    v_reason := null;
  end if;

  -- 8. Build Person JSON Payload
  if v_person.id is not null then
    v_person_json := jsonb_build_object(
      'id', v_person.id,
      'admission_number', v_person.admission_number,
      'barcode', v_person.barcode,
      'full_name', v_person.full_name,
      'category', v_person.category,
      'company_name', v_person.company_name,
      'institution', v_person.institution,
      'status', v_person.status,
      'photo_url', v_person.photo_url,
      'plant_id', v_person.plant_id,
      'valid_from', v_person.valid_from,
      'expires_at', v_person.expires_at,
      'is_visitor', v_person.is_visitor
    );
  end if;

  -- 9. Atomically Record into Access Logs
  insert into public.access_logs (
    scanned_code,
    student_id,
    gate_id,
    scanned_by,
    decision,
    reason,
    direction,
    operator_note,
    scanned_at
  ) values (
    v_cleaned_code,
    v_person.id,
    v_gate_id,
    auth.uid(),
    v_decision,
    v_reason,
    p_direction,
    p_operator_note,
    now()
  ) returning id into v_log_id;

  -- 10. Return Authoritative Result
  return jsonb_build_object(
    'success', true,
    'decision', v_decision,
    'reason', v_reason,
    'log_id', v_log_id,
    'scanned_code', v_cleaned_code,
    'direction', p_direction,
    'gate_id', v_gate_id,
    'scanned_at', now(),
    'person', v_person_json,
    'watchlist_hit', v_watchlist_json
  );
end;
$$;

-- Security & Permissions
revoke all on function public.verify_gate_access(text, uuid, public.scan_direction, text) from public, anon;
grant execute on function public.verify_gate_access(text, uuid, public.scan_direction, text) to authenticated;
