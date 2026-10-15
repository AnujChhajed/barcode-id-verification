# memory.md
# ABB Plant 3 Security System — Project Memory

**Version:** 1.0  
**Status:** Initial working baseline  
**Project type:** Existing application conversion and enhancement  
**Primary objective:** Convert the existing college Student Barcode Gate Verification System into a professional ABB Plant 3 Security System.

---

## 1. Project Overview

The project began as a college Student Barcode Gate Verification System.

The goal is to adapt the existing application for company security operations at ABB Plant 3. The application will primarily manage:

- Contract and temporary workers
- Internship students
- Visitors and visitor passes
- Gate verification
- Entry and exit records
- Credential validity and renewal
- Canteen verification, if required
- Operational dashboards and reports
- Incidents and other useful existing supporting features

This is an enhancement and conversion project, not a complete rebuild.

**The first release is limited to ABB Plant 3.** Other plants may be considered in the future, but they must not be introduced into the current user workflows.

## 2. Existing Technology Stack

The project is understood to use:

- Frontend: React
- Language: TypeScript
- Backend and database services: Supabase

These details come from the existing project context and must be verified against the actual repository before making changes.

### Technology rules

1. Keep the existing React, TypeScript, and Supabase stack.
2. Do not replace the framework or backend without a strong technical reason and explicit approval.
3. Reuse working components, services, hooks, routes, and database structures wherever appropriate.
4. Inspect the existing database schema before adding or changing tables.
5. Preserve existing data.
6. Review authentication, storage, and Row Level Security (RLS) policies before changing security-sensitive features.
7. Never expose the Supabase service-role key or privileged credentials in frontend code.
8. Do not introduce unnecessary libraries or services.

The current project implementation is the source of truth. Never assume a feature, dependency, table, or configuration exists without checking.

## 3. Core Project Decisions

These decisions should remain stable unless the project owner explicitly changes them.

### Scope

- Initial deployment scope: ABB Plant 3 only.
- Main use cases: company gate security and temporary authorization management.
- Permanent employee HR management is not the purpose of this project.
- Additional plants may be considered later.
- Avoid unnecessary complexity in the first version.

### Existing application

- Preserve useful existing functionality.
- Do not rebuild working features merely to make the code look different.
- Do not delete existing data or tables without understanding their dependencies.
- Do not remove useful features without explaining the impact and receiving approval for a major change.

### User experience

- Use professional, consistent ABB-style branding with approved assets.
- Remove college-related labels and branding from the active company application.
- Use red, white, and neutral colors consistently, subject to approved brand guidance.
- Keep the application responsive and usable on gate computers.
- Make scan results obvious and easy to understand.
- Provide clear loading, success, rejection, warning, and error states.
- Keep forms as short as practical while collecting all required information.

### Security

- Backend authorization is mandatory.
- Database policies must protect sensitive records.
- Important access decisions must use current authoritative records when online.
- A failed verification must never be presented as a successful verification.
- Sensitive actions and corrections must be auditable.

## 4. Main Business Entities

The application will manage the following concepts, adapted to the existing database design.

### Person

Represents a worker, intern, or other registered individual. Store only information needed for approved operations.

### Authorization or Pass

Represents permission to access the plant or a specific approved activity during a defined period.

### Gate

Represents a configured access point within Plant 3.

### Access Event

Represents an entry, exit, rejection, or verification attempt as defined by the implementation.

### Canteen Transaction

Represents an eligibility check and canteen usage record, if the canteen feature is enabled.

### Application User and Role

Represents a person operating the application and the permissions they have.

### Audit Event

Represents a traceable record of an important administrative or security-related action.

These are conceptual entities, not instructions to create a new table for each item. First inspect the existing schema and reuse or extend it where suitable.

## 5. Main Workflows to Preserve or Implement

### Person registration

Authorized users register workers, interns, and visitors using appropriate forms. The system validates required fields, unique IDs, validity periods, and status.

### Credential generation

The system generates a barcode or QR code linked to a unique identifier. The code must not contain unnecessary personal information.

### Gate verification

An operator scans a code or searches manually. The system checks the authoritative record, validity, status, Plant 3 assignment, and applicable permissions.

Possible results:

- APPROVED
- REJECTED
- UNABLE TO VERIFY

### Entry and exit

Successful access events are recorded separately. The current-inside view is calculated from recorded events. Invalid sequences and missing exits must be visible for review.

### Expiry and renewal

Expired credentials are rejected. Authorized users can renew or change status according to configured rules, with audit history.

### Canteen

If enabled, the initial default is one successful use per person per calendar day. This limit must be configurable and safely enforced against concurrent scans.

### Reporting

Dashboards and reports should reflect actual records and defined calculations. Access to reports must follow user permissions.

## 6. Existing Features That Must Be Inspected

The current project may already contain some or all of these features. Their actual status must be verified:

- Dashboard and statistics
- Barcode scanning
- Manual ID search
- Student/person management
- Visitor registration and passes
- Attendance and entry/exit records
- Reports and exports
- Incident management
- Announcements
- Gate management
- Settings
- Offline scanning
- PDF generation
- Authentication and user management

For each feature, record whether it is:

- Working
- Partially working
- Broken
- Missing
- Not required
- Requires security review

Do not infer implementation quality from the interface, README, or filenames alone.

## 7. Important Security Principles

1. A barcode or QR code is a lookup reference, not proof of authorization.
2. A record must be checked for status, validity, plant assignment, and applicable access permissions.
3. Unknown credentials must be rejected.
4. Suspended, terminated, and expired credentials must not be approved.
5. If the system cannot verify a credential, show UNABLE TO VERIFY.
6. Offline authorization must follow an approved policy. Until ABB approves one, do not silently approve unverified credentials.
7. Frontend checks do not replace database or server-side authorization.
8. Do not expose personal information unnecessarily.
9. Protect uploaded photos and exported reports.
10. Preserve access history and audit records.
11. Administrative corrections require authorization and a reason.
12. Never store secrets in source code, logs, or browser-visible configuration.

## 8. Default Business Rules

Use the current `rules.md` as the detailed business-rule reference.

Key initial defaults include:

- Plant 3 only.
- Unique identifiers for credentials.
- Explicit approval, rejection, and unable-to-verify outcomes.
- Separate entry and exit events.
- Validity checks on every authorization decision.
- Configurable expiry reminders, initially seven days before expiry.
- One successful canteen use per person per local calendar day, if the canteen feature is enabled.
- Role-based access for administrators, security operators, and optionally canteen operators.
- Audit history for important security and administrative changes.
- Safe handling of network failures, scanner errors, duplicate scans, and synchronization conflicts.

These are initial implementation defaults, not confirmation of every ABB policy. Keep configurable rules configurable and document unresolved decisions.

## 9. Development Method

Work incrementally.

For each task:

1. Understand the requested outcome.
2. Inspect the relevant existing code and database structures.
3. Identify reusable components and dependencies.
4. Describe important risks before a major or destructive change.
5. Implement the smallest safe change.
6. Run relevant tests.
7. Check for regressions in existing features.
8. Review permissions and failure behavior.
9. Update documentation and record limitations.
10. Continue to the next task only after the current change is sufficiently verified.

Do not attempt to rewrite the whole application in one step.

### Before database changes

- Inspect existing tables and relationships.
- Identify foreign keys, policies, triggers, and dependent application code.
- Back up relevant data.
- Use reviewed migrations where practical.
- Avoid dropping or renaming existing structures without a clear migration plan.
- Test changes in a suitable non-production environment first.

### When something fails

- Identify the actual error.
- Investigate its root cause.
- Prefer repairing existing functionality over replacing it.
- Avoid temporary shortcuts that weaken access control.
- Explain any unresolved issue clearly.
- Update the relevant project documents if the design or business rules change.

## 10. Project Documentation

The project uses five reference documents.

### `PRD.md`

Defines what the application must do, its users, main workflows, requirements, and acceptance criteria.

### `Architecture.md`

Defines the technical structure, components, data flow, security boundaries, and architectural recommendations.

### `rules.md`

Defines business rules, validation, access decisions, validity calculations, roles, audit behavior, and configurable defaults.

### `phases.md`

Defines the staged development plan, deliverables, acceptance criteria, testing, and deployment sequence.

### `memory.md`

Preserves the overall project context, important decisions, development principles, and instructions for future sessions.

When a requirement conflicts with a document, do not silently guess. Identify the conflict, explain the consequences, and ask for clarification when the decision materially affects security, data integrity, cost, or architecture.

## 11. Instructions for Future Antigravity Sessions

At the beginning of a new session:

1. Read this file and the other available project documents.
2. Inspect the actual repository state.
3. Review recent changes and unfinished tasks.
4. Check whether earlier work is implemented and tested rather than assuming it succeeded.
5. Continue from the current codebase instead of starting over.
6. Keep Plant 3 as the only active plant scope.
7. Preserve working features and existing data.
8. Maintain the current technology stack unless an approved change is necessary.
9. Follow the current business rules and security principles.
10. Record important new decisions and update the relevant documents.

Do not repeatedly ask for information that is already documented and remains valid. Ask focused questions only when a necessary decision cannot be safely inferred.

## 12. Decisions That May Change Later

The project is expected to evolve as the actual workflow is tested.

Possible future changes include:

- Additional plants
- Different canteen limits
- Additional approval steps
- More detailed gate permissions
- Revised visitor workflows
- Different expiry reminders
- Offline authorization rules
- New reporting requirements
- Changes to hosting or database deployment
- Additional roles and integrations

Do not implement future features prematurely. Keep the design extensible without complicating the initial release.

When a real issue appears, document the problem, propose a solution, and update the relevant project documents after the change is agreed upon.

## 13. Definition of Project Success

The initial system should be considered successful when:

- Existing useful application functionality is preserved.
- Workers, interns, and visitors can be managed appropriately.
- Credentials can be generated and verified.
- Gate decisions are reliable and understandable.
- Entry and exit records remain consistent.
- Expiry and renewal are enforced correctly.
- Canteen usage is protected against duplicate transactions if enabled.
- Permissions are enforced in the backend.
- Important changes and decisions are auditable.
- Reports provide accurate operational information.
- Errors and connectivity failures do not create false approvals.
- The application is tested, documented, and ready for controlled Plant 3 evaluation.

## 14. Final Instruction

Treat the existing repository as the starting point and the actual source of truth for implementation.

Use `PRD.md`, `Architecture.md`, `rules.md`, and `phases.md` together with this file. Build a secure, maintainable ABB Plant 3 Security System by improving the existing application incrementally.

Keep the initial scope focused. Preserve working features. Protect existing data. Avoid unapproved policy assumptions. Test changes. Document limitations. Update this memory whenever an important project decision changes.

**The objective is not merely to change the application's branding. The objective is to make the existing application reliably support the approved security workflows of ABB Plant 3.**

---

## 15. Active Session State & Continuity Handoff (For New Sessions or Account Switch)

> [!IMPORTANT]
> If a problem happens or you are switching Gmail / IDE accounts, **read this section first**. It contains everything needed to resume immediately without losing context.

### 15.1 Repository & Branch State
- **Workspace:** `c:\Users\ADMIN\Downloads\ABB Security gate\barcode-student-verification`
- **Current Git Branch:** `feature/abb-frontend-theme`
- **Origin Repo:** `https://github.com/sagarkale8177/barcode-student-verification.git`
- **Supabase Project ID:** `gxhhvgqujolqpxxmxtto` (configured in `.env.local`, `supabase/config.toml`, and `vite.config.ts`)
- **Build Status:** Verified passing with `npm run build` (client + SSR build).
- **Completed Phases & Tasks:**
  - Phase 1 (Inspection & Safety Baseline): Tasks 1.1 - 1.4 completed.
  - Phase 2 (ABB Branding & Application Foundation): Tasks 2.1 - 2.3 completed.
  - Phase 3 (Database Schema & Backend Hardening):
    - Task 3.1 (Foundation Migration SQL & Type Sync) completed.
    - Task 3.2 (Authoritative Access Verification RPC `verify_gate_access`) completed.
    - Task 3.3 (RLS Policy Hardening & Audit Immutability) completed.
  - Phase 5 (Barcode/QR Credentials & Portrait ID Generation):
    - Task 5.1 (ID Card Layout Redesign in ABB Portrait Format) completed.
    - Task 5.2 (Visitor Pass Layout Redesign with ABB Branding) completed.
    - Task 5.3 (Bulk ID Printing & 9-up A4 Layout) completed.
- **Current Active Task:** Phase 6, Task 6.1: Single Gate Plant 3 Workflow in Gate Verification UI (`src/routes/_authenticated/verify.tsx`).

### 15.2 Key Document Map
1. `project info/PRD.md`: Core product requirements.
2. `project info/Architecture.md`: System design and logical modules.
3. `project info/writing-block.md`: Business rules (internally titled `# rules.md`).
4. `project info/phase.md`: 12-phase development roadmap (internally titled `# phases.md`).
5. `project info/requirement pdf for friend.docx`: Additional practical friend requirements.
6. `project info/initial-assessment.md`: Comprehensive Phase 1 discovery, feature inventory, risk analysis, and requirements comparison.
7. `project info/checklist.md`: Living master checklist tracking all completed and pending tasks.
8. `project info/resume-status.md`: Comprehensive session recovery and state-of-the-union status report.

### 15.3 Core Non-Negotiable Ground Rules
1. **Scope:** ABB Plant 3 ONLY.
2. **Physical Gate Constraint:** Plant 3 has **exactly one physical gate** (`***** there is only one gate in pant 3 *********`). Auto-select `"Plant 3 - Main Gate"`.
3. **Photo Policy:** Photograph upload is **optional**. ID cards and screens must render gracefully with or without a photo (initials avatar fallback).
4. **Authoritative Backend:** Gate verification must not run in frontend client code. It must execute via the PostgreSQL function `verify_gate_access`.
5. **No Rewrites:** Adapt the existing React + TanStack Router + Supabase codebase incrementally. Do not rewrite from scratch.
6. **No Data Deletion:** Do not drop existing tables. Extend `students` with `category`, `company_name`, `institution`, and `plant_id`.
7. **Immutable Logs:** `access_logs` must be append-only.

### 15.4 Instructions for Resuming in a New Session
When starting from a new prompt or account:
1. Review `project info/checklist.md` to see which tasks are marked `[x]` and which is next `[ ]`.
2. Review `git status` to verify the working tree.
3. Propose the next specific, smallest safe task to the user before editing code:
   - Exactly which files/tables will be modified
   - The purpose of each change
   - Any risks to existing functionality or data
   - The tests that will be run
4. Implement only that approved task, run tests, update `project info/checklist.md` and this file, and request approval before moving to the next task.