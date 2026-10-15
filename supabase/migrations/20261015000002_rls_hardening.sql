-- ==============================================================================
-- ABB Plant 3 Security System — RLS Hardening & Audit Immutability
-- Migration: 20261015000002_rls_hardening.sql
-- Description:
--   1. Hardens public.access_logs to be strictly immutable (append-only).
--      Drops all UPDATE and DELETE policies so logs cannot be modified or deleted.
--      Revokes UPDATE and DELETE privileges on public.access_logs from authenticated.
--   2. Revokes anonymous EXECUTE permission on check_student_card.
--      Only authenticated users (staff, admins, operators) can query credentials.
-- Safe & Non-Destructive: Preserves all existing logs and table data.
-- ==============================================================================

-- 1. Immutable Audit Logs (Append-Only)
drop policy if exists "Admins can update access logs" on public.access_logs;
drop policy if exists "Staff can update access logs" on public.access_logs;
drop policy if exists "Admins can delete access logs" on public.access_logs;

-- Revoke update and delete table privileges from authenticated role
revoke update, delete on table public.access_logs from authenticated;

-- Ensure read and insert policies remain active and explicit
drop policy if exists "Staff can read access logs" on public.access_logs;
create policy "Staff can read access logs" on public.access_logs
  for select to authenticated using (public.is_staff());

drop policy if exists "Staff can record access logs" on public.access_logs;
create policy "Staff can record access logs" on public.access_logs
  for insert to authenticated
  with check (public.is_staff() and (scanned_by is null or scanned_by = auth.uid() or public.is_admin()));

-- 2. Revoke anonymous access on check_student_card
revoke all on function public.check_student_card(text) from public, anon;
grant execute on function public.check_student_card(text) to authenticated;
