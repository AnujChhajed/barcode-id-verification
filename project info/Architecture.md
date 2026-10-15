# Architecture.md
# ABB Plant 3 Security Gate Verification & ID Management System

**Document type:** Software architecture and implementation guidance  
**Version:** 1.0  
**Status:** Proposed architecture to be checked against the existing repository  
**Primary scope:** ABB Plant 3 only

---

## 1. Purpose

This document describes how to adapt the existing Student Barcode Gate Verification System into the ABB Plant 3 Security Gate Verification & ID Management System.

This is a **target architecture, not permission to rewrite the project**. The actual repository is the source of truth for what already exists. Antigravity must inspect the codebase first, map the current implementation to this document, and reuse working components where reasonable.

## 2. Non-negotiable architecture decisions

1. **Inspect before changing:** Review the repository, README, package files, routes, components, Supabase schema, policies, functions, storage, and current workflows.
2. **Preserve the existing stack:** The project is known to use React, TypeScript, and Supabase. Retain these unless inspection reveals a concrete blocker and the change is approved.
3. **Keep Supabase for this version:** Do not replace it with a local database in this phase. Local/on-premises deployment may be evaluated later with ABB.
4. **Incremental changes:** Prefer small, reversible changes and migrations over broad rewrites.
5. **Plant 3 only:** Support Plant 3 operationally. Make plant references extensible in the data model, but do not build Plant 1/2 workflows now.
6. **Backend is authoritative:** The frontend must not be the only place where access rules, permissions, validity, or duplicate-use restrictions are enforced.
7. **Fail safely:** A network, database, scanner, or validation error must never silently approve entry.
8. **No secret leakage:** Privileged Supabase keys or other secrets must never be shipped in frontend code.

## 3. First task: repository discovery

Before implementation, produce a short discovery report containing:

- Current folder and module structure
- Current frontend framework, package manager, and build/test commands
- Existing routes/pages and their purpose
- Existing barcode/QR scanner integrations
- Current person/visitor/attendance data model
- Current Supabase tables, migrations, RLS policies, storage buckets, and Edge Functions, if any
- Authentication and role/permission implementation
- Existing email, PDF, reporting, and offline behavior
- Features that are working, incomplete, duplicated, or unused
- Risks, missing environment variables, and database migration concerns
- Proposed mapping from current modules to the target modules below

Do not claim that a feature works without checking its implementation or testing it.

## 4. Logical system overview

The target logical flow is:

```text
React + TypeScript UI
    |
    | authenticated requests
    v
Supabase Auth -------------------- user identity/session
    |
    v
Supabase database + Row Level Security
    |       |        |
    |       |        +---- audit/event records
    |       +------------- validity and access decisions
    +--------------------- people, plants, gates, visits, canteen
    |
    +---- Supabase Storage (protected photos and permitted files)
    |
    +---- approved server-side scheduled process / Edge Function
              |
              +---- expiry reminders and email delivery status
```

This is a logical view, not a requirement to add new services if the existing project already provides the same capability safely. Prefer existing supported infrastructure when possible.

## 5. Suggested application modules

Map these responsibilities onto the existing code rather than blindly creating duplicate modules.

### 5.1 Authentication and authorization
- Sign-in and session handling
- User profile and assigned role
- Permission-aware navigation and actions
- Backend/database authorization checks
- Session expiry and safe sign-out

### 5.2 Dashboard
- Plant 3 summary metrics
- Recent gate events
- People currently inside based on recorded entry/exit events
- Upcoming/expired records
- Rejected or unverified scans
- Incidents and operational warnings

### 5.3 People and pass management
- Contract/temporary workers
- Internship students
- Visitors and visitor passes
- Search, filtering, record details, status updates
- Validity and renewal history
- Photo handling where approved

### 5.4 ID/pass generation
- Consistent card/pass template
- Barcode or QR generation
- Print/PDF output
- Secure, non-sensitive identifier in the code
- Correct validity and status information

### 5.5 Gate verification
- Plant 3 gate selection/configuration
- USB/Bluetooth scanner input where compatible
- Camera scan if supported by the existing platform
- Manual lookup fallback
- Server/database-backed verification
- Clear approved/rejected/unable-to-verify result
- Gate event creation and audit record

### 5.6 Entry/exit tracking
- Entry and exit event capture
- Current-inside calculation/query
- Missing-exit report
- Duplicate/sequence validation
- Authorized correction workflow

### 5.7 Canteen
- Eligibility check
- One successful use per person per calendar day, subject to confirmed ABB policy
- Backend/database duplicate protection
- Result history and reports

### 5.8 Expiry and notifications
- Validity status calculation
- Upcoming/expired dashboard lists
- Scheduled reminders
- Email delivery tracking and failure visibility
- Renewal, suspension, and termination history

### 5.9 Reports
- Gate activity, entry/exit, workers/interns, visitors
- Current-inside/missing-exit
- Expiry, canteen, incidents, and rejections
- CSV/PDF exports
- Role-filtered access

### 5.10 Incidents, watchlist, announcements, and settings
Retain and adapt existing features when useful. Restrict sensitive features by role and log consequential changes.

## 6. Data model guidance

The actual schema must be compared with the existing database before proposing migrations. The entities below describe logical responsibilities, not mandatory exact table names.

### 6.1 Plants
Represents a company plant/site.
- Stable identifier
- Name/code
- Active/configuration status

Version 1 should contain/configure Plant 3 for operations. The structure should allow future plants.

### 6.2 Gates
Represents a gate associated with a plant.
- Stable identifier
- Plant reference
- Gate name/code
- Active status

Every gate event should reference the configured gate when possible.

### 6.3 People / access holders
Represents a worker, intern, or visitor, with a clear category.
- Stable internal ID
- Unique business identifier as appropriate
- Category
- Name and approved contact/organization fields
- Photo reference, if applicable
- Status
- Plant assignment
- Created/updated metadata

Do not duplicate person data unnecessarily across separate tables if the existing schema can support a safe common model. Category-specific fields may be separated where that makes validation clearer.

### 6.4 Passes / validity records
Represents an issued ID/pass and its validity lifecycle.
- Stable pass identifier
- Person reference
- Secure code/token reference
- Issue/start/end dates
- Status
- Issuer and issuance timestamp
- Renewal/suspension/termination history or references

A renewed pass should not erase history needed for auditability.

### 6.5 Gate events
Represents a scan or gate decision.
- Event identifier
- Person/pass reference when known
- Plant and gate reference
- Event type (entry, exit, or verification attempt)
- Timestamp
- Operator/user reference when available
- Decision (approved, rejected, unable to verify)
- Reason code/details
- Source (scanner, manual lookup, offline sync, etc.)
- Synchronization status if offline mode exists

Unknown-code attempts should still be recordable without inventing a person record.

### 6.6 Canteen events
- Event identifier
- Person/pass reference
- Timestamp and effective business date
- Result
- Operator/source as appropriate
- Idempotency or duplicate-protection mechanism

The database must enforce the daily-use restriction atomically. A frontend-only check is insufficient.

### 6.7 Audit events
- Timestamp
- Actor
- Action
- Affected entity/reference
- Reason/details as appropriate
- Result/context needed for review

Restrict modification/deletion of audit history.

### 6.8 Supporting entities
Depending on existing design and needs:
- User profiles and role assignments
- Incidents
- Watchlist entries
- Announcements
- Notification delivery attempts
- System settings
- Offline synchronization batches/events

Do not add every suggested entity automatically. Confirm current schema and requirements first.

## 7. Data integrity and database design

- Use stable primary keys and appropriate foreign keys.
- Add database constraints and indexes for frequently used lookups and unique identifiers.
- Define uniqueness rules carefully; for example, person IDs and pass codes must not collide within their intended scope.
- Use database transactions or equivalent atomic operations for multi-step operations where partial success would be unsafe.
- Protect against simultaneous duplicate canteen scans.
- Avoid destructive schema changes that could lose existing records.
- Use version-controlled, reviewable database migrations where supported.
- Test migrations against a backup or non-production environment first.
- Use consistent timestamps and define the business time zone with ABB.
- Do not assume the client clock is authoritative for security-critical time decisions.

## 8. Access verification design

A verification request should conceptually perform these checks:

1. Normalize and validate the scanned identifier.
2. Find the associated pass/person without exposing unnecessary data.
3. Confirm that the record exists.
4. Confirm the record is assigned to Plant 3 and the selected gate is valid for the operation.
5. Confirm that the person/pass is not suspended or terminated.
6. Confirm the current time is within the allowed validity window.
7. Apply category-specific rules and any approved access restrictions.
8. Return a structured result: approved, rejected, or unable to verify, with a safe reason code.
9. Record the attempt/event with actor, gate, time, source, and outcome.

Implement the authoritative checks in a trusted server/database layer appropriate to the existing Supabase architecture. The UI should present the returned decision and must not invent its own approval.

## 9. Supabase guidance

Inspect and preserve the existing Supabase project configuration.

### Authentication
- Use Supabase Auth or the existing authentication implementation if correctly integrated.
- Do not treat a user-supplied role value in the browser as proof of permission.
- Confirm role assignment and authorization server-side/database-side.

### Row Level Security (RLS)
- Review every table exposed through the Supabase client.
- Enable and test RLS where appropriate.
- Write least-privilege policies for administrators, security staff, canteen staff, and other roles.
- Test both permitted and denied operations.
- Ensure sensitive records, audit logs, and watchlist data are not broadly readable.

### Keys and secrets
- Frontend code may use only the intended public/anon key under correct RLS policies.
- Never expose service-role keys, SMTP credentials, or other privileged secrets in the frontend or source control.
- Use protected environment variables and server-side secrets for privileged operations.

### Storage
- Use protected storage for photos and documents.
- Apply storage access policies consistent with the user's role.
- Avoid permanent public links for personal photos unless ABB explicitly approves that model.
- Validate upload type/size and handle upload failures.

### Server-side functions and scheduled jobs
Use existing Supabase Edge Functions or another approved server-side mechanism if appropriate for privileged actions, email delivery, or scheduled expiry reminders. Verify that schedules are reliable, authenticated, observable, and safe to retry. Do not rely on a user's browser remaining open.

### Backups and environments
- Identify the existing backup and recovery options.
- Keep development/test and production configuration separate where possible.
- Document required environment variables without publishing their secret values.
- Review production hosting, data residency, retention, and recovery with ABB.

## 10. Frontend architecture guidance

- Retain the existing React/TypeScript organization and conventions where reasonable.
- Reuse existing components, routes, hooks, services, and design patterns after inspection.
- Keep UI components separate from data access and business-rule logic where the existing project permits.
- Use shared validation and typed result structures for important workflows.
- Show loading, empty, success, error, offline, and unable-to-verify states.
- Prevent repeated form submissions and accidental duplicate actions.
- Do not put sensitive access logic only in frontend components.
- Keep registration forms short and category-specific.
- Use approved ABB assets and consistent design tokens/styles.
- Avoid adding a new framework or large dependency unless it solves a demonstrated need.

## 11. Scanner and barcode/QR design

- First identify the current scanner integration and hardware assumptions.
- Many USB/Bluetooth scanners act as keyboard input; verify the actual device and browser behavior.
- Keep manual search as a controlled fallback.
- Camera scanning is optional and depends on existing support, browser permissions, and device compatibility.
- Use an opaque/random token or non-sensitive identifier in the barcode/QR code.
- Validate the code against the current authoritative record.
- Handle empty, malformed, unknown, repeated, and rapid inputs safely.
- Do not treat the barcode/QR itself as a credential that proves current validity.

## 12. Offline design, if retained

Offline behavior requires an explicit design decision after inspecting the current implementation.

- Identify what data is cached, how long it remains valid, and how it is protected.
- Cache only the minimum necessary information.
- Display a persistent offline indicator and distinguish locally recorded events from server-verified decisions.
- Record event time, gate, operator where available, and sync state.
- Use stable event IDs/idempotency keys to reduce duplicate uploads.
- Define how conflicting or out-of-order events are handled.
- Retry sync safely and expose persistent failures.
- Do not imply current verification if status cannot be refreshed.
- Have ABB approve the fail-safe behavior before production use.

If the existing offline feature cannot meet these requirements safely, document the gap and propose options rather than silently removing or weakening security.

## 13. Email and expiry scheduling

- Store validity in a consistent format and define the Plant 3 business time zone.
- Calculate upcoming/expired state using trusted server/database time.
- Use a reliable scheduled server-side process for reminders.
- Prevent repeated sends for the same reminder window unless intentionally retried.
- Record recipient, notification type, relevant record, attempt time, and delivery/error status without logging unnecessary personal data.
- Make failures visible to administrators and support safe retries.
- Keep renewal approval separate from sending a reminder.
- Expiry enforcement must work even when email delivery fails.

## 14. Reports and exports

- Apply role permissions to both report queries and export endpoints/actions.
- Filter by Plant 3 in version 1.
- Use bounded date ranges and pagination for large datasets.
- Avoid exposing unnecessary personal data.
- Handle PDF/CSV generation failures with clear messages.
- Ensure exported results match the active filters and permissions.
- Protect against formula injection or unsafe spreadsheet values in CSV exports where relevant.

## 15. Logging and observability

Maintain a distinction between:
- **Business audit trail:** user actions and security decisions that require accountability.
- **Technical logs:** errors and operational details needed for troubleshooting.

Both must be protected. Do not log secrets or unnecessary personal information. Include enough context to investigate a failure without exposing confidential data to ordinary users.

Important operations should produce observable success/failure outcomes, especially gate decisions, renewals, role changes, canteen use, email delivery, and offline synchronization.

## 16. Testing strategy

At minimum, test:
- Authentication and role boundaries
- Record creation and required-field validation
- Identifier uniqueness
- Pass issuance and PDF/print output
- Valid, unknown, expired, suspended, terminated, and wrong-plant scans
- Entry/exit event sequences and duplicate scans
- Concurrent duplicate canteen attempts
- Expiry boundaries and reminder scheduling
- RLS policies and unauthorized reads/writes
- File upload/storage access
- Email failures and retries
- CSV/PDF report filters and permissions
- Network errors and partial failures
- Offline queue, synchronization, retries, and conflicts if offline mode remains
- Regression of existing useful functionality
- Database migration and recovery process

Use the testing tools already present in the repository where possible. Document any manual tests that cannot be automated.

## 17. Deployment and configuration

Before production:
- Confirm the intended hosting and Supabase environments with ABB.
- Review production environment variables and secret handling.
- Confirm database migrations and rollback/recovery steps.
- Review RLS, storage policies, authentication, and privileged server-side functions.
- Confirm approved logo/assets and email configuration.
- Confirm backup, monitoring, incident response, and recovery arrangements.
- Run the build and relevant tests.
- Document setup, deployment, known limitations, and operational support steps.

Do not assume that a prototype configuration is approved for production use.

## 18. Recommended implementation approach

1. Discover and document the current implementation.
2. Map current tables, pages, and services to required functionality.
3. Resolve data-model and security gaps before large UI changes.
4. Implement and test core person/pass records and validity.
5. Implement trusted gate verification and event history.
6. Implement expiry notifications and canteen duplicate protection.
7. Adapt reports, incidents, audit logs, and offline behavior.
8. Complete security review, regression testing, documentation, and deployment checks.

See `phases.md` for the planned development sequence.

## 19. Architecture decision record

| Decision | Current direction | Notes |
|---|---|---|
| Frontend | Retain React + TypeScript | Confirm exact structure during repository inspection |
| Backend/data | Retain Supabase for now | Do not migrate to local DB in this version |
| Scope | Plant 3 only | Future plants supported by data design, not active workflows |
| Implementation | Incremental adaptation | No rewrite without approval |
| Authorization | Backend/database enforced | UI visibility alone is insufficient |
| Offline mode | Preserve if safely feasible | Must not silently approve stale/unverified status |
| Branding | Approved ABB assets | Confirm exact brand assets with company |
| Production hosting | To be confirmed | Requires ABB review |

## 20. Instructions to Antigravity

Treat this file as architecture guidance, not a reason to overwrite existing implementation blindly.

Before coding:
1. Read `PRD.md`, this file, and the existing project documentation.
2. Inspect the repository and report the current architecture.
3. Identify existing components and database structures that can be reused.
4. List proposed schema changes and security implications.
5. Work in small steps and run relevant tests after each change.
6. Ask before destructive changes, major dependency/framework changes, or unresolved ABB policy decisions.
7. Update documentation to reflect the architecture that is actually implemented.

Do not claim security, offline reliability, or production readiness without appropriate verification and tests.
