# ABB Plant 3 Security System — Master Checklist & Phase Progress

**Project:** Conversion of Student Barcode Gate Verification System to ABB Plant 3 Security System  
**Tracking File:** `project info/checklist.md`  
**Last Updated:** October 15, 2026  
**Status Legend:**  
- `[x]` Completed and verified  
- `[/]` In progress  
- `[ ]` Pending  

---

## Phase 1: Existing Project Inspection, Safety & Baseline
- [x] **Task 1.1: Discovery & Documentation Analysis**
  - [x] Locate and read `PRD.md`, `Architecture.md`, `rules.md` (in `writing-block.md`), `phases.md` (in `phase.md`), and `memory.md`.
  - [x] Extract and read friend requirements document (`requirement pdf for friend.docx`).
  - [x] Perform codebase inspection (package dependencies, Vite config, TanStack Router routes, Supabase schema).
  - [x] Identify conflicts, overlaps, and physical constraints (e.g., Plant 3 single gate rule).
  - [x] Perform clean build verification (`npm run build` client + SSR).
  - [x] Generate comprehensive report: `project info/initial-assessment.md`.
- [x] **Task 1.2: Project Master Checklist**
  - [x] Create `project info/checklist.md` for clear tracking of all phases.
- [x] **Task 1.3: Session Continuity & Account Switch Memory**
  - [x] Update `project info/memory.md` with complete handover instructions and session state.
- [x] **Task 1.4: Version Control Safety Checkpoint**
  - [x] Create git safety tag/checkpoint commit before beginning code modifications.

---

## Phase 2: ABB Branding & Application Foundation
- [x] **Task 2.1: Root Branding & Meta Tags**
  - [x] Replace ATC references in `src/routes/__root.tsx` (title, description, author).
  - [x] Update browser window title and PWA meta tags to "ABB Plant 3 Security System".
  - [x] Verify `AbbLogo.tsx` usage and header layout consistency.
- [x] **Task 2.2: Localization & Terminology Update**
  - [x] Update `src/locales/en.json` and `src/locales/sw.json` to replace college terminology (students -> workers/interns, programmes -> contractor companies/departments, admission number -> worker/intern ID).
  - [x] Remove ATC campus references from login and landing screens.
- [x] **Task 2.3: Layout & Navigation Plant 3 Scoping**
  - [x] Update `_authenticated.tsx` sidebar with Plant 3 badge/label.
  - [x] Add route guard redirecting non-admin operators attempting to access `/dashboard` directly.

---

## Phase 3: Database Schema & Backend Verification Hardening
- [x] **Task 3.1: Non-Destructive SQL Migration Script**
  - [x] Create `plants` table and seed `'Plant 3'`.
  - [x] Add `plant_id` to `gates` table and seed `'Plant 3 - Main Gate'`.
  - [x] Add `category` (`'worker'`, `'intern'`, `'visitor'`), `company_name`, `institution`, and `plant_id` to `students` table.
  - [x] Create `canteen_logs` table with composite unique index `(person_id, log_date)` for atomic duplicate prevention.
- [x] **Task 3.2: Authoritative Access Verification RPC**
  - [x] Create PostgreSQL function `verify_gate_access(p_code, p_gate_id, p_direction)`.
  - [x] Implement server-side validation of existence, status, Plant 3 assignment, validity dates, and active watchlist.
  - [x] Atomically record attempt into `access_logs` within the RPC.
- [x] **Task 3.3: RLS Policy Hardening**
  - [x] Make `access_logs` append-only (revoke `UPDATE` and `DELETE` for staff and operators).
  - [x] Revoke anonymous execute permissions on `check_student_card`.

---

## Phase 4: People & Pass Records Management
- [x] **Task 4.1: Contract / Temporary Worker Management**
  - [x] Registration form: Full name, Worker ID, Contractor Company, Validity Start/End, Plant 3, Optional Photo.
  - [x] Status controls: Active, Suspended, Terminated, Expired.
- [x] **Task 4.2: Internship Student Management**
  - [x] Registration form: Full name, Intern ID, College/Institution, Validity Start/End, Plant 3, Optional Photo.
  - [x] Status controls and validity boundary enforcement (mandatory start/end dates, institution validation, supervisor contact).
  - [x] Bulk import auto-mapping for interns and contractors with CSV template.
- [x] **Task 4.3: Visitor Pass Management Refactoring**
  - [x] Adapt visitor registration to capture visit date, host/department, purpose, contact info, and preset duration pills.
  - [x] Integrate with `appointments` table for 1-click check-in and pass issuance for pre-registered visits.
  - [x] Scoped passes to ABB Plant 3 with instant pass revocation capability.

---

## Phase 5: Barcode/QR Credentials & Portrait ID Generation
- [x] **Task 5.1: ID Card Layout Redesign**
  - [x] Refactor `src/lib/idcard.ts` from college green to ABB corporate red/white theme.
  - [x] Implement compact portrait ID card format (CR80 portrait: 54mm × 85.6mm).
  - [x] Display ABB logo, person's category badge, photo (or initials fallback), ID, barcode (Code 128), and validity dates.
- [x] **Task 5.2: Visitor Pass Layout Redesign**
  - [x] Modernize A6 visitor pass with ABB branding and clear validity dates.
- [x] **Task 5.3: Bulk ID Printing & PDF Export**
  - [x] Support bulk printing on A4 sheets (9 cards per sheet, 3×3 grid with dashed cut lines) without college branding.

---

## Phase 6: Gate Verification & Entry/Exit Tracking
- [x] **Task 6.1: Single Gate Plant 3 Workflow**
  - [x] Pre-select and lock `"Plant 3 - Main Gate"` on the verification screen.
  - [x] Call the authoritative database RPC `verify_gate_access`.
- [x] **Task 6.2: High-Visibility Decision Banners**
  - [x] Display high-contrast **APPROVED (Green)**, **REJECTED (Red)**, or **UNABLE TO VERIFY (Amber)** states.
  - [x] Display person's photo, category, company/institution, and explicit rejection reason.
- [x] **Task 6.3: Entry/Exit Tracking & 24h Occupancy Fix**
  - [x] Refactor `src/routes/_authenticated/inside.tsx` to handle night shifts and rolling 36h entry records.
  - [x] Add category filter: Workers, Interns, Visitors currently inside.

---

## Phase 7: Canteen Verification Module
- [x] **Task 7.1: Canteen Scan Screen**
  - [x] Create `/canteen` route with high-contrast scan interface.
  - [x] Scan worker, intern, or visitor pass.
- [x] **Task 7.2: Daily Duplicate Prevention Enforcement**
  - [x] Check eligibility and execute atomic insert into `canteen_logs`.
  - [x] Reject second daily scan with prominent warning and prior scan timestamp.
- [x] **Task 7.3: Canteen Reports**
  - [x] Filterable daily and date-range meal reports with CSV export.

---

## Phase 8: Expiry Enforcement & Administrative Renewals
- [x] **Task 8.1: Expiry Enforcement**
  - [x] Enforce automated rejection on gate verification when end date has passed.
  - [x] Display upcoming expiries (7-day window) and expired passes on the dashboard.
- [x] **Task 8.2: Renewal & Extension Workflow**
  - [x] Create administrative extension modal with mandatory justification and audit trail.
  - [x] Record previous and new validity dates, approver, and timestamp.

---

## Phase 9: Industrial Security Reports & Data Export
- [x] **Task 9.1: Gate Activity & Audit Reports**
  - [x] Replace academic attendance in `reports.tsx` with daily gate traffic, rejections, and missing exit reports.
- [x] **Task 9.2: Contractor & Visitor Reports**
  - [x] Active contractor rosters by company, intern rosters by institution, visitor logs.
- [x] **Task 9.3: CSV & PDF Export Hardening**
  - [x] Ensure role-filtered exports with formula injection safeguards.

---

## Phase 10: Security Hardening, Offline Polish & Verification
- [x] **Task 10.1: Public Route Removal / Lockdown**
  - [x] Remove or gate public `/check` route.
- [x] **Task 10.2: Offline Cache & Sync Hardening**
  - [x] Update IndexedDB store to include active watchlist and distinguish offline scans.
- [x] **Task 10.3: Regression & Automated Testing**
  - [x] Execute comprehensive test suite on verification, canteen, and reporting.

---

## Phase 11: Deployment Readiness & Handover
- [ ] **Task 11.1: Environment & Secret Audit**
  - [ ] Verify `.env` / `.env.local` variables; ensure no service role keys are exposed.
- [ ] **Task 11.2: Operator & Admin Documentation**
  - [ ] Provide quick-start operator guide for Plant 3 security guards.
