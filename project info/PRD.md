# PRD.md
# ABB Plant 3 Security Gate Verification & ID Management System

**Document type:** Product Requirements Document (PRD)  
**Project:** Existing Student Barcode Gate Verification System → ABB Plant 3 Security System  
**Version:** 1.0  
**Status:** Initial requirements baseline  
**Primary scope:** ABB Plant 3 only

---

## 1. Purpose

Convert the existing college Student Barcode Gate Verification System into a professional security gate verification and ID/pass management system for **ABB Pvt. Ltd., Plant 3**.

The application is intended primarily for:
- Contract and temporary workers
- Internship students
- Visitors

This is **not** a full permanent-employee HR management system.

## 2. Critical implementation instruction

The project already exists. Before changing code, the developer/AI agent must:

1. Inspect the complete repository, README, current screens, routes, components, database schema, Supabase setup, and existing functionality.
2. Identify which features work, which are incomplete, and which can be reused.
3. Back up the project and make database/schema changes carefully.
4. Adapt the existing application incrementally. **Do not rebuild from scratch or replace the current stack without a documented reason and approval.**
5. Keep Supabase for the current version. A local/on-premises database can be evaluated later if ABB requires it.
6. Report conflicts between the current implementation and this PRD before making major architectural or destructive changes.

## 3. Product goals

- Verify whether a worker, intern, or visitor is authorized to enter Plant 3.
- Issue and manage ID cards and visitor passes with a barcode or QR code.
- Record entry and exit activity accurately.
- Automatically enforce ID/pass validity and expiry.
- Show security staff clear approval or rejection results.
- Support canteen eligibility checks and prevent duplicate daily usage.
- Provide dashboards, reports, incident records, and audit history.
- Protect personal information and restrict actions by user role.
- Preserve useful existing functionality, including offline scanning where feasible.

## 4. Scope

### 4.1 Included in version 1

- ABB branding and professional responsive interface
- Plant 3 configuration and gate configuration
- Contract/temporary worker registration and records
- Internship student registration and records
- Visitor registration and pass management
- Photo capture/upload where permitted by policy
- ID/pass creation with barcode or QR code
- Print/PDF output
- Gate scanning and manual lookup
- Entry/exit tracking and currently-inside view
- Expiry dashboard, reminders, renewals, suspensions, and terminations
- Canteen scan and one-use-per-day rule
- Role-based access
- Incident/watchlist and announcement features, where already available and appropriate
- Dashboards, reports, CSV/PDF exports
- Audit logs, error handling, and operational logging
- Existing offline-scanning support, if it can be preserved safely
- Supabase database, authentication, and storage, subject to security review

### 4.2 Not included in version 1

- Operational workflows or dedicated screens for Plant 1 or Plant 2
- Full HR/payroll/performance management for permanent ABB employees
- A full rewrite of the existing application
- Migration away from Supabase unless specifically approved
- New features that are not required for Plant 3 security operations

The data model should allow additional plants to be introduced later without implementing their workflows now.

## 5. User roles and permissions

### 5.1 Administrator

Administrators may, according to assigned permissions:
- Create and update worker, intern, and visitor records
- Issue, renew, suspend, or terminate IDs and passes
- Configure Plant 3 gates and system settings
- Manage users and roles
- Review dashboards, reports, incidents, and audit logs
- Correct records when authorized, with a reason recorded
- Review email delivery failures and expiry reminders

### 5.2 Security staff / gate operator

Security staff may:
- Scan barcodes/QR codes or search by an approved identifier
- View the information necessary to verify identity and access
- Record entry and exit
- See a clear approval or rejection reason
- Record incidents or refer a record to an administrator
- Access only the screens and data needed for their duties

Security staff must not be able to silently change validity, permissions, or audit history unless separately authorized.

### 5.3 Canteen operator

Where a separate canteen role is used, the operator may:
- Scan a person's code
- See whether the person is eligible to use the canteen
- See whether the daily allowance/use has already been recorded
- Record a successful canteen use
- View only the canteen information and reports needed for the role

### 5.4 Access-control requirement

Enforce permissions in the backend/database as well as in the UI. Hiding a button is not sufficient authorization.

## 6. Person categories and required data

Collect only information necessary for security operations and approved company policy. Fields not required for the workflow should remain optional.

### 6.1 Contract / temporary worker

Minimum suggested fields:
- Full name
- Unique worker ID
- Photo, if required by policy
- Phone number, if required
- Contractor/company name, where applicable
- Work start date
- Work end date or ID validity end date
- Plant assignment (Plant 3 in version 1)
- Status: active, suspended, terminated, or expired

### 6.2 Internship student

Minimum suggested fields:
- Full name
- Unique intern ID
- Photo, if required by policy
- Phone number, if required
- Institution/college
- Internship start date
- Internship end date or ID validity end date
- Plant assignment (Plant 3 in version 1)
- Status: active, suspended, terminated, or expired

### 6.3 Visitor

Minimum suggested fields:
- Full name
- Phone number, subject to company policy
- Visit purpose
- Person/department to meet
- Employee email or contact reference, if needed
- Visit date and pass validity
- Photo, if required by policy
- Plant assignment (Plant 3 in version 1)
- Status: valid, suspended, used/checked out, or expired as appropriate

Avoid collecting sensitive or unnecessary personal data. Define retention and deletion requirements with ABB policy before production use.

## 7. ID cards and visitor passes

The system must:
- Generate a professional, compact portrait-style ID/pass layout.
- Display approved ABB branding, person's photo where applicable, name, category, unique identifier, barcode/QR code, issue date, and validity dates.
- Support print and PDF output.
- Make validity/status easy to read.
- Encode only a secure, non-confidential identifier in the barcode/QR code; do not place personal or sensitive information directly in the code.
- Ensure that a copied or scanned code is validated against the current database status. Possessing a code alone must not grant entry.
- Avoid college branding and other references from the previous system.
- Use the approved ABB logo and branding assets supplied or approved by ABB; do not invent an official logo asset.

## 8. Gate verification workflow

1. The operator selects or opens the correct Plant 3 gate.
2. The operator scans a barcode/QR code using a compatible USB/Bluetooth scanner, uses the camera if supported, or searches manually.
3. The system finds the record and checks current status, validity dates, category, Plant 3 assignment, and relevant permissions.
4. The system displays the person's photo and the minimum details needed for verification.
5. The system displays a clear result:
   - **Approved** when all required checks pass.
   - **Rejected** when any required check fails.
   - **Unable to verify** when the system cannot safely establish the current status.
6. The system records the result, timestamp, gate, operator, record reference, and rejection reason where applicable.
7. A scan alone must never be treated as authorization without validation.

Typical rejection reasons include unknown ID, expired validity, suspended/terminated status, wrong plant, invalid visit date, or an access restriction.

## 9. Entry and exit tracking

The system must:
- Record entry and exit events separately.
- Show who is currently inside Plant 3 based on recorded events.
- Show records with an entry but no matching exit.
- Allow authorized users to search history by person, identifier, date range, gate, and result.
- Prevent or flag duplicate scans and invalid entry/exit sequences.
- Require authorized correction of mistakes, including a reason and an audit record.
- Make clear that “currently inside” is derived from recorded events and may be inaccurate if a person exits without being scanned.

## 10. Validity, expiry, and renewal

For worker IDs, internship IDs, and visitor passes, the system must:
- Store explicit start and end validity dates/times as appropriate.
- Reject entry after expiry or before validity begins.
- Display upcoming and expired records on the dashboard.
- Support configurable advance reminders and expiry emails.
- Tell the recipient how to contact the responsible administrator to request an extension, without implying that an extension is automatic.
- Allow an authorized administrator to renew, suspend, or terminate a record.
- Record who changed the validity/status, when it changed, and the reason.
- Automatically treat a record as expired once its validity ends; no manual action should be needed to enforce expiry at the gate.
- Preserve relevant historical records instead of erasing the audit trail.
- Show email delivery failures to administrators and support retry or follow-up.
- Use a reliable scheduled process for reminders; do not rely only on a browser being open.

The exact reminder schedule, time zone, email wording, and retention period must be configurable or confirmed with ABB.

## 11. Canteen verification

The canteen screen must:
- Scan the same approved ID/pass code or another approved identifier.
- Verify that the person is eligible for canteen use.
- Allow no more than one successful canteen use per person per calendar day, unless ABB explicitly defines another allowance.
- Record the person, date, time, and result.
- Reject duplicate use and clearly explain the reason.
- Prevent near-simultaneous duplicate scans from both being accepted; enforce this rule safely in the backend/database, not only in the UI.
- Provide daily and date-range reports.

The applicable time zone and definition of “day” must be confirmed with ABB before production.

## 12. Dashboard and reporting

### 12.1 Dashboard indicators

Show useful Plant 3 operational information, such as:
- Active contract/temporary workers
- Active internship students
- Visitor passes valid today
- Daily entries and exits
- People currently inside, based on recorded events
- Rejected scans and common rejection reasons
- Upcoming expiries and expired IDs/passes
- Recent gate activity
- Incidents requiring review
- Email reminder failures, where available

### 12.2 Reports

Provide appropriate filters and CSV/PDF export for:
- Daily gate activity
- Entry and exit history
- Currently-inside and missing-exit records
- Worker and internship records
- Visitor activity
- Upcoming/expired IDs and passes
- Canteen usage and rejected duplicate attempts
- Incidents and watchlist events, subject to permissions
- Rejected and unable-to-verify scans
- Audit events, restricted to authorized users

Reports must respect role permissions and avoid exposing unnecessary personal information.

## 13. Incidents, watchlist, and announcements

Preserve existing incident, watchlist, and announcement capabilities if they are present and useful. Adapt them for company security use.

- Access to watchlist information must be restricted to authorized roles.
- A watchlist match should trigger a clear review/rejection workflow based on approved company policy; do not make unsupported assumptions about the legal or operational meaning of a match.
- Incident records should include relevant time, location/gate, category, description, reporter, status, and follow-up where required.
- Announcements should be manageable by authorized users and displayed only where relevant.
- Every consequential status change should be auditable.

## 14. Plant 3 boundary and future extensibility

- All version 1 operational screens, reports, gates, and records must be scoped to ABB Plant 3.
- Configure Plant 3 and its gates explicitly.
- Each relevant record and event must be associated with the appropriate plant/gate.
- Users must not accidentally see or operate Plant 1 or Plant 2 records in version 1.
- Design the schema so more plants can be added later through configuration and planned development.
- Do not build Plant 1/2 workflows, dashboards, or screens now.

## 15. Offline and connectivity behavior

Preserve the existing offline-scanning feature if feasible and safe.

If offline mode is retained:
- Show an obvious online/offline indicator.
- Cache only the minimum data needed for the approved offline use case.
- Record event time, gate, operator where available, and synchronization status.
- Sync events after reconnection.
- Detect and resolve duplicate/conflicting events according to documented rules.
- Clearly identify offline or pending-sync events in the UI and reports.
- Define an ABB-approved fail-safe policy for cases where the latest status cannot be checked. The application must not silently present an unverified record as fully approved.
- Ensure that synchronization failures are visible and recoverable.

If safe offline verification cannot be implemented with the existing design, document the limitation and propose an approved alternative rather than weakening access control.

## 16. Security, privacy, and auditability

Minimum requirements:
- Authentication for protected screens and operations.
- Role-based authorization enforced by backend/database policies.
- Backend validation for all important inputs and state changes.
- Secure handling of Supabase keys and credentials; privileged secrets must never be exposed in frontend code.
- HTTPS in deployed environments.
- Secure photo/file storage with access controls.
- Session handling and timeout appropriate to the security environment.
- Rate limiting or abuse protection where appropriate.
- Dependency and configuration review before production.
- Backups and a documented recovery approach.
- Restricted access to audit and technical logs.
- Avoid logging passwords, secrets, or unnecessary personal data.

Audit log events should include, as appropriate:
- Record creation and updates
- ID/pass issuance and renewal
- Suspension and termination
- Entry/exit approvals and rejections
- Authorized manual corrections
- User/role changes
- Gate and system-setting changes
- Failed login or other security-relevant events

Audit entries should record timestamp, actor, action, relevant record reference, and reason/details where appropriate. Ordinary users must not be able to silently edit or delete audit history.

Production deployment, data residency, retention, backup, and access policies must be reviewed with ABB before go-live.

## 17. Error handling and reliability

The application must handle failures involving:
- Network or Supabase connectivity
- Invalid, missing, or malformed scan input
- Unknown IDs and duplicate records
- Photo/file upload
- PDF generation or printing
- Email delivery
- Offline synchronization
- Permission denial
- Database operations and incomplete submissions

Expected behavior:
- Show users a clear, actionable message.
- Do not expose stack traces, database internals, secrets, or sensitive technical details on screen.
- Record useful technical details in protected logs.
- Provide safe retry where appropriate.
- Prevent duplicate submissions and partial/inconsistent state where possible.
- Never grant entry because an error occurred.
- Distinguish “rejected” from “unable to verify.”
- Make important failures visible to administrators.

## 18. User interface and branding

- Remove college-specific text, logos, terminology, and styling.
- Use approved ABB branding and a professional red/white visual direction, subject to approved brand assets.
- Provide a clean, readable interface suitable for security staff working quickly.
- Make approval, rejection, expiry, and offline states easy to distinguish without relying on color alone.
- Support common desktop and tablet layouts and responsive smaller screens where required.
- Keep registration forms short and organized by person category.
- Provide accessible labels, validation messages, and confirmation for consequential actions.
- Do not redesign unrelated working features without a clear requirement.

## 19. Existing features to inspect and preserve

Inspect the existing repository before deciding what to retain. The current project may include:
- Dashboard
- Barcode scanning and manual search
- Person/student management
- Visitor passes
- Attendance and reports
- Incident management
- Announcements
- Gate management
- Settings
- Offline scanning
- PDF generation

Reuse and adapt working components where appropriate. Do not assume a feature works just because it appears in the README; verify its implementation and behavior.

## 20. Acceptance criteria

The first release is acceptable only when the following can be demonstrated:

1. The application is clearly branded for ABB and contains no unintended college branding.
2. The application operates for Plant 3 only.
3. Authorized users can create, find, update, and deactivate worker, intern, and visitor records.
4. IDs/passes contain the approved identifier code and correct validity information and can be printed or saved as PDF.
5. A valid record is approved only after current status and relevant rules are checked.
6. Unknown, expired, suspended, terminated, wrong-plant, or otherwise invalid records are rejected with a useful reason.
7. Gate events record the required timestamp, gate, operator, result, and record reference.
8. Entry/exit history and the currently-inside view behave consistently with recorded events.
9. Expired records are rejected even if no reminder email has been sent.
10. Expiry reminders and email failures are observable and testable.
11. Canteen usage enforces the one-use-per-day rule, including concurrent duplicate attempts.
12. Role permissions are enforced beyond the frontend.
13. Reports filter correctly, respect permissions, and export correctly.
14. Important actions and corrections are auditable.
15. Network, scan, upload, email, and sync failures do not grant unauthorized entry or silently lose important events.
16. Any retained offline mode clearly reports verification limitations and synchronization state.
17. Automated or documented tests cover core access decisions and business rules.
18. Existing useful functionality has been checked for regressions.
19. Supabase policies, secrets, storage access, and deployment configuration have been reviewed before production.
20. Known limitations, setup steps, environment variables, migration steps, and test instructions are documented.

## 21. Open decisions requiring ABB confirmation

Do not silently invent company policy. Record and confirm:
- Approved ABB logo and brand assets
- Exact Plant 3 gate names and gate configuration
- Required personal fields and photo policy for each category
- Validity and renewal approval process
- Reminder timing and email recipients/templates
- Time zone and definition of a calendar day for canteen use
- Offline access policy when the latest record status is unavailable
- Watchlist process and authorized access
- Data retention and deletion rules
- Hosting, data residency, backup, and recovery requirements
- Required report formats and recipients
- Production approval and security review process

## 22. Instructions to Antigravity

Use this PRD as the product-level requirement baseline.

Before implementing:
1. Inspect the existing project and summarize its current structure and working features.
2. Identify gaps between the current application and this PRD.
3. Propose a small, incremental implementation plan.
4. Back up the project and identify any database migrations before applying them.
5. Ask for clarification before destructive changes, major rewrites, or assumptions about ABB policy.

Implement in small, testable steps. Keep the existing React/TypeScript and Supabase approach unless repository inspection identifies a concrete issue and a change is approved. Do not claim a feature is complete until it has been implemented and tested.
