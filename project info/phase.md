# phases.md
# ABB Plant 3 Security System — Development Phases

**Version:** 1.0  
**Status:** Initial working plan  
**Project:** Conversion of the existing Student Barcode Gate Verification System into an ABB Plant 3 Security System

## 1. Objective

Develop the ABB Plant 3 Security System by adapting the existing project, preserving working features, and implementing the required security workflows in controlled phases.

The project must use the existing React, TypeScript, and Supabase stack unless a change is explicitly approved.

Antigravity must inspect the existing codebase before implementation. Do not assume that a feature works just because it appears in the README or interface.

## 2. Mandatory Development Rules

Before starting any phase:

1. Read `PRD.md`, `Architecture.md`, `rules.md`, and `memory.md` when available.
2. Inspect the existing source code, database schema, authentication, storage, and Supabase RLS policies.
3. Identify completed, partially working, broken, and missing features.
4. Reuse suitable components and existing business logic.
5. Back up relevant code and data before risky changes.
6. Avoid unnecessary dependencies, rewrites, and database migrations.
7. Make changes in small, testable increments.
8. Run relevant tests after each significant change.
9. Keep documentation aligned with the actual implementation.
10. Stop and explain the problem before making destructive or major architectural changes.

Do not attempt to implement every feature in a single large change.

---

## Phase 1 — Existing Project Inspection and Safety

### Goal

Understand the current application and prepare it for safe modification.

### Tasks

- Inspect the repository structure and existing application entry points.
- Identify the React and TypeScript setup.
- Inspect existing Supabase tables, relationships, authentication, storage buckets, and RLS policies.
- Review the current dashboard, scanner, person management, visitor passes, attendance, reports, incidents, announcements, gate management, settings, and offline scanning.
- Test the existing workflows where possible.
- Identify broken, duplicated, unused, and incomplete code.
- Review environment variables and confirm that privileged secrets are not exposed in frontend code.
- Create a backup or version-control checkpoint.
- Document existing database tables and their current usage.
- Prepare a feature assessment with the status of each existing feature.

### Deliverables

- Existing project assessment
- Current database and feature inventory
- List of risks and missing functionality
- Backup or version-control checkpoint
- Recommended implementation order

### Acceptance criteria

- The current project structure is understood.
- Working features have been identified.
- Critical risks are documented.
- No unnecessary rewrite or destructive migration has occurred.

**Do not proceed with risky database changes until the current schema and data have been reviewed.**

---

## Phase 2 — ABB Branding and Application Foundation

### Goal

Convert the existing interface to a professional ABB Plant 3 security application while preserving working functionality.

### Tasks

- Replace college and student-project branding with approved ABB branding.
- Use an approved ABB logo asset; do not recreate or invent the official logo.
- Establish a consistent red, white, and neutral corporate design.
- Update application title, navigation labels, page titles, and relevant text.
- Review desktop, tablet, and mobile layouts.
- Keep forms and scanning screens usable on gate computers.
- Improve loading, empty, success, warning, and error states.
- Preserve existing routing and useful shared components.
- Restrict the visible application scope to ABB Plant 3.
- Avoid creating Plant 1 and Plant 2 screens at this stage.

### Deliverables

- Updated application branding
- Consistent navigation and layouts
- Responsive pages
- Reusable design components

### Acceptance criteria

- No unintended college branding remains in the active application.
- Existing routes and useful workflows still function.
- The interface clearly identifies the Plant 3 scope.
- Branding assets are legitimate and approved for use.

---

## Phase 3 — Authentication, Roles, and Permissions

### Goal

Ensure that each user can perform only the operations authorized for their role.

### Tasks

- Review existing authentication before changing it.
- Preserve existing sign-in functionality if secure and suitable.
- Establish administrator and security-operator roles.
- Add a separate canteen role if the existing architecture supports it and the feature is required.
- Define permitted actions for each role.
- Protect administrative pages and sensitive actions.
- Review and implement Supabase RLS policies.
- Enforce permissions in database or trusted server-side operations, not only in the UI.
- Prevent users from changing their own roles or elevating their permissions.
- Record relevant user and permission changes in the audit history.

### Deliverables

- Role and permission model
- Protected application routes and operations
- Tested database access policies
- Documented authorization rules

### Acceptance criteria

- Unauthorized users cannot perform restricted operations by calling the backend directly.
- Security operators cannot silently change access authorization.
- Administrative actions require the correct role.
- Existing authentication and data access still work as expected.

---

## Phase 4 — People and Authorization Records

### Goal

Support contract/temporary workers, internship students, and visitors.

### Tasks

- Review the existing student and visitor data models.
- Reuse suitable existing tables and forms where practical.
- Add or adapt person categories.
- Support worker IDs, internship IDs, and visitor pass references.
- Capture only required personal information.
- Support photo uploads when required by policy.
- Add contractor/company details where applicable.
- Add institution details for internship students.
- Support validity dates and record statuses.
- Associate authorization records with Plant 3.
- Enforce unique identifiers using database constraints.
- Add validation for required fields and date ranges.
- Support create, view, edit, activate, suspend, renew, and terminate operations according to role permissions.
- Preserve historical access events when person records change.

### Deliverables

- Worker management
- Internship management
- Visitor registration and pass management
- Validity and status controls
- Database constraints and validation

### Acceptance criteria

- Authorized users can create and manage all required categories.
- Duplicate IDs are prevented.
- Invalid date ranges are rejected.
- Inactive and expired records cannot be treated as authorized.
- Existing data is preserved or migrated safely.

---

## Phase 5 — Barcode/QR Credentials and Printing

### Goal

Generate and manage scannable identification credentials.

### Tasks

- Inspect the existing barcode generator and scanner implementation.
- Reuse working barcode or QR functionality.
- Associate each credential with a unique, non-sensitive identifier.
- Ensure the code does not expose unnecessary personal information.
- Create a professional ID/pass layout using approved branding.
- Include relevant details such as name, category, ID, photo where applicable, and validity dates.
- Support printing and PDF export where the existing implementation permits it.
- Define safe behavior when photo loading, PDF generation, or printing fails.
- Revoke or replace old credentials when required.

### Deliverables

- Worker and intern credential templates
- Visitor pass template
- Barcode/QR generation
- Printing and PDF export

### Acceptance criteria

- Generated codes resolve to the correct database record.
- A code alone never grants access.
- Printed credentials display the correct identity and validity information.
- Revoked or replaced credentials cannot continue authorizing access.

---

## Phase 6 — Gate Verification and Entry/Exit Tracking

### Goal

Implement reliable gate decisions and access-event tracking.

### Tasks

- Support the existing USB/Bluetooth scanner workflow where possible.
- Preserve manual ID search.
- Support camera-based QR scanning if compatible with the current application and hardware.
- Require an authorized gate selection or assignment.
- Verify identity, record status, validity, plant assignment, and applicable permissions.
- Display APPROVED, REJECTED, or UNABLE TO VERIFY outcomes.
- Display a clear, safe reason for rejected or unverified results.
- Record successful entries and exits separately.
- Record relevant rejected and unverified attempts.
- Prevent accidental duplicate scans and invalid event sequences.
- Build the current-inside view from valid access events.
- Add missing-exit reporting and access-history search.
- Provide an authorized correction workflow with a reason and audit trail.
- Handle concurrent scans safely.

### Deliverables

- Gate scanning interface
- Verification decision logic
- Entry/exit event history
- Current-inside list
- Rejection and missing-exit reporting

### Acceptance criteria

- Valid credentials receive the correct decision.
- Expired, suspended, invalid, and wrong-plant credentials are rejected.
- Database failures never produce false approvals.
- Entry/exit state remains consistent under repeated and concurrent scans.
- Corrections are authorized and audited.

---

## Phase 7 — Expiry, Renewal, and Notifications

### Goal

Ensure authorizations remain valid only for their approved periods.

### Tasks

- Implement date and time validation.
- Enforce expiry during verification.
- Add upcoming-expiry and expired-record dashboard sections.
- Add authorized renewal and extension workflows.
- Record previous and new validity periods.
- Add configurable advance reminders.
- Implement scheduled server-side notification processing where required.
- Record email delivery failures.
- Ensure expiry enforcement does not depend on email delivery.
- Test timezone and end-of-day behavior.

### Deliverables

- Expiry enforcement
- Renewal workflow
- Upcoming/expired reports
- Notification processing and failure visibility

### Acceptance criteria

- Expired records cannot pass verification.
- Renewals require appropriate permissions.
- Every validity change is auditable.
- Failed reminders do not weaken access restrictions.
- Boundary-date tests behave consistently.

---

## Phase 8 — Canteen Verification

### Goal

Provide a secure canteen scanning workflow if required for the initial release.

### Tasks

- Add or adapt the canteen scan screen.
- Verify person status, validity, and canteen eligibility.
- Implement the initial configurable limit of one successful use per person per calendar day.
- Calculate the day using the configured business timezone.
- Reject duplicate successful transactions.
- Enforce the limit safely in the database.
- Ensure failed or rejected transactions do not consume the allowance.
- Record operator, time, result, and relevant references.
- Add an authorized exception process only if approved.
- Provide canteen usage reports.

### Deliverables

- Canteen verification screen
- Duplicate-use protection
- Transaction history
- Canteen reporting

### Acceptance criteria

- Eligible people can complete a valid transaction.
- Duplicate daily transactions are rejected under concurrent scanning.
- Failed transactions do not count as successful usage.
- Exceptions and corrections are audited.

---

## Phase 9 — Dashboard, Reports, and Existing Supporting Features

### Goal

Provide useful operational visibility without compromising access controls.

### Tasks

- Update dashboard statistics using verified database queries.
- Display active workers and interns.
- Display current visitor passes.
- Display entry/exit activity and people currently inside.
- Display rejected and unverified attempts.
- Display upcoming and expired authorizations.
- Add relevant gate, person, visitor, canteen, and incident reports.
- Support date, category, gate, and status filters where relevant.
- Preserve useful incident, watchlist, announcement, and gate-management features after reviewing their implementation.
- Restrict sensitive reports according to role.
- Validate CSV and PDF exports.
- Avoid exposing unnecessary personal information in exported files.

### Deliverables

- Operational dashboard
- Filterable reports
- Export workflows
- Preserved or improved supporting features

### Acceptance criteria

- Dashboard values match the underlying records.
- Reports follow role permissions.
- Exports contain accurate data.
- Supporting features continue working after integration.

---

## Phase 10 — Offline Scanning and Recovery

### Goal

Preserve or improve offline support without introducing unsafe access decisions.

### Tasks

- Assess whether existing offline scanning is reliable and secure.
- Display a visible online/offline status.
- Define what information may be cached and for how long.
- Use the approved ABB offline authorization policy.
- Until approval is provided, show UNABLE TO VERIFY when current authorization cannot be safely checked.
- Record offline events with unique IDs and synchronization status.
- Implement safe, repeatable synchronization.
- Prevent duplicate events during retries.
- Detect conflicting records and flag them for review.
- Protect cached personal information.
- Test reconnecting after long network interruptions.

### Deliverables

- Documented offline behavior
- Offline status indicators
- Safe synchronization and retry logic
- Conflict reporting

### Acceptance criteria

- Offline status is visible.
- Unverified credentials are not silently approved.
- Synchronization does not duplicate events.
- Conflicts are not silently overwritten.
- Cached information is protected and minimized.

---

## Phase 11 — Testing and Security Review

### Goal

Verify that the system behaves reliably before controlled deployment.

### Tasks

- Test every person category and role.
- Test valid, expired, suspended, terminated, and unknown credentials.
- Test duplicate IDs and duplicate scans.
- Test entry without exit and exit without entry.
- Test timezone and validity boundaries.
- Test canteen daily-limit enforcement.
- Test concurrent requests and retries.
- Test backend permissions and RLS policies.
- Test network loss, scanner failure, upload failure, PDF failure, and email failure.
- Test offline synchronization if enabled.
- Test responsive layouts and printing.
- Check that secrets and unnecessary personal information are not exposed.
- Fix critical and high-priority defects.
- Document remaining issues and limitations.

### Deliverables

- Automated test results
- Manual testing checklist
- Security review notes
- Defect list and resolution status
- Known limitations

### Acceptance criteria

- Critical access-control tests pass.
- Important business rules are covered by tests.
- No known critical defect remains unresolved before production approval.
- Remaining limitations are documented and accepted by the appropriate stakeholders.

---

## Phase 12 — Deployment and Handover

### Goal

Prepare the approved application for controlled use at ABB Plant 3.

### Tasks

- Confirm the production environment and hosting approach.
- Confirm production Supabase configuration and access policies.
- Verify backups and a recovery procedure.
- Apply reviewed database migrations.
- Configure environment variables securely.
- Create authorized user accounts and role assignments.
- Verify approved ABB branding assets.
- Test the deployed application with approved test records.
- Validate scanning hardware and printing at the intended gates.
- Document deployment and rollback steps.
- Provide a short operator guide and administrator guide.
- Record outstanding policy decisions and known limitations.

### Deliverables

- Deployed application
- Verified configuration
- Backup and recovery instructions
- Operator and administrator documentation
- Deployment checklist and known-issues list

### Acceptance criteria

- The application passes deployment smoke tests.
- Access control and core gate verification work in the target environment.
- Backup and recovery steps are documented.
- The responsible ABB stakeholders approve production use.

---

## 3. Recommended Implementation Order

Follow this order unless the existing project assessment reveals a strong reason to adjust it:

1. Inspect and back up the existing project.
2. Update branding and the application foundation.
3. Secure authentication and permissions.
4. Implement people and authorization records.
5. Verify barcode/QR generation and printing.
6. Implement gate verification and entry/exit tracking.
7. Implement expiry and renewal.
8. Implement canteen verification.
9. Complete dashboard, reports, and supporting features.
10. Review offline scanning.
11. Test, fix defects, and review security.
12. Deploy and document the system.

Do not skip the initial inspection phase. The exact implementation order may be adjusted to reuse existing working features safely.

## 4. Definition of Done for Every Phase

A phase is complete only when:

- Its tasks have been implemented or explicitly marked out of scope.
- Relevant automated or manual tests have been performed.
- Existing working functionality has been checked for regressions.
- Database changes are documented.
- Permissions and failure behavior have been reviewed.
- No unresolved critical defect is being hidden.
- Documentation reflects the actual implementation.
- The next phase can proceed without depending on undocumented assumptions.

## 5. Handling Problems and Changes

If a phase encounters a problem:

1. Identify the exact cause.
2. Check whether an existing feature can be reused or repaired.
3. Explain the impact on data, security, and other features.
4. Propose the smallest safe fix.
5. Back up data before risky schema changes.
6. Implement and test the fix.
7. Update the relevant project document if the rule, design, or plan changes.

If the current architecture cannot safely support a requirement, document the limitation and propose alternatives instead of implementing an insecure shortcut.

## 6. Final Instructions for Antigravity

Work incrementally and inspect the actual code before deciding what to build. Keep the current React, TypeScript, and Supabase architecture unless a change is justified and approved. Preserve useful existing features, prioritize reliable gate verification and authorization, and keep the initial scope limited to ABB Plant 3.

The phases are a practical development plan, not a requirement to rewrite the application. Adapt the plan based on the repository assessment, test results, and confirmed ABB requirements. Update this document as implementation progresses.