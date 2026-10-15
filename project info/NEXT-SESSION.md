# NEXT-SESSION — Quick-Start Continuity Guide

> [!IMPORTANT]
> If Antigravity account limits are reached or a new session is started, **read this file first**. It provides the exact recovery point and immediate instructions to continue without starting over or guessing.

---

## 1. Ground Rules & Project Invariants

1. **Project:** ABB Plant 3 Security and Gate Verification System (conversion of existing college gate system).
2. **Scope:** **ABB Plant 3 ONLY**. Exactly **one physical gate** (`"Plant 3 - Main Gate"`). Extensible multi-plant schema, but single-gate operator experience.
3. **No Rewrites:** Preserve the existing React 19 + TypeScript + Vite 7 + TanStack Start (SSR) + TanStack Router + Tailwind CSS v4 + Supabase PostgreSQL codebase. Do not delete existing features.
4. **No Destructive Operations:** Do not reset Git, delete files, or drop database tables.
5. **Authoritative Backend:** Gate access decisions must execute through the PostgreSQL RPC `verify_gate_access`.
6. **Immutable Audit:** `access_logs` is append-only.
7. **Optional Photographs:** Cards and verification views must render gracefully with clean initials avatars when photos are omitted.

---

## 2. Current Status Checklist

| Phase | Description | Status |
|---|---|---|
| **Phase 1** | Inspection & Safety Baseline | **COMPLETED** |
| **Phase 2** | ABB Branding & Application Foundation | **COMPLETED** |
| **Phase 3** | Database Schema & Backend Verification Hardening | **COMPLETED** |
| **Phase 4** | People & Pass Records Management (Workers, Interns, Visitors) | **COMPLETED** |
| **Phase 5** | Barcode/QR Credentials & Portrait ID Generation | **COMPLETED** |
| **Phase 6** | Gate Verification & Entry/Exit Tracking | **COMPLETED** (Tasks 6.1, 6.2, 6.3 verified) |
| **Phase 7** | Canteen Verification Module | **COMPLETED** (Tasks 7.1, 7.2, 7.3 verified) |
| **Phase 8** | Credential Expiry & Administrative Renewals | **COMPLETED** (Tasks 8.1, 8.2 verified) |
| **Phase 9** | Industrial Security Reports & Data Export | **COMPLETED** (Tasks 9.1, 9.2, 9.3 verified) |
| **Phase 10** | Security Hardening, Offline Polish & Verification | **COMPLETED** (Tasks 10.1, 10.2, 10.3 verified) |
| **Phase 11** | Deployment Readiness & Handover | **NEXT IMMEDIATE PHASE (Task 11.1 next)** |

---

## 3. Instructions for the Incoming Agent

When you start your session:
1. **Do NOT start from scratch.** This is an active project with Phases 1 to 10 completed and verified.
2. Check Git status with `git status -s` to confirm all existing uncommitted files are present.
3. Verify the working branch is `feature/abb-frontend-theme`.
4. Run `npm test` and `npm run build` to verify the baseline (18 of 18 tests pass, 0 build errors).
5. Read `project info/resume-status.md` and `project info/checklist.md` for full context.
6. Proceed with **Phase 11: Deployment Readiness & Handover** (Task 11.1 Environment & Secret Audit, Task 11.2 Operator & Admin Documentation).

---

## 4. Immediate Next Task (Starting Point)

### Phase 11: Deployment Readiness & Handover

1. **Task 11.1: Environment & Secret Audit**
   - Verify `.env`, `.env.example`, and `.env.local` configuration variables.
   - Ensure no secret service role keys are exposed in client-side bundles or repository files.
2. **Task 11.2: Operator & Admin Documentation**
   - Provide a concise, professional quick-start operator guide for Plant 3 security guards covering:
     - Gate verification workflow with rapid barcode gun scanning.
     - Audio chime / buzzer decision indicators (Green / Red / Amber).
     - Offline turnstile mode and queue sync operations.
     - Evacuation roster 1-click export.
     - Canteen meal service scanning and duplicate claim handling.
     - Pass renewal workflows.---

## 5. Environment & Tooling Notes

- **Shell:** Windows PowerShell. When referencing files with `$` in commands (e.g. `students.$id.tsx`), always wrap in single quotes `'src/routes/_authenticated/students.$id.tsx'` to prevent variable expansion.
- **Supabase Project ID:** `gxhhvgqujolqpxxmxtto`.
- **Database Migrations:** SQL files exist in `supabase/migrations/` and `supabase/schema.sql`. They are non-destructive and can be executed via the Supabase Dashboard SQL Editor if needed.

