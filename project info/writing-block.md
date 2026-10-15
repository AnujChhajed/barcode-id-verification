# rules.md
# ABB Plant 3 Security System — Business Rules

**Document purpose:** Define the initial business rules, validations, calculations, permissions, and security decisions for the ABB Plant 3 Security System.

**Version:** 1.0  
**Status:** Initial working baseline — subject to revision  
**Application scope:** ABB Plant 3 only

---

## 1. General Rules

1. The system must be adapted from the existing Student Barcode Gate Verification System wherever practical. Do not rebuild working features unnecessarily.
2. The initial release must support ABB Plant 3 only.
3. The system must manage contract/temporary workers, internship students, and visitors. It is not intended to replace ABB's permanent employee HR system.
4. React, TypeScript, and Supabase must remain the existing technology stack unless a change is explicitly approved.
5. All dates and timestamps must be handled consistently. Store timestamps in a standard timezone-aware format and display them in the configured local timezone.
6. Access decisions must use current authoritative database records whenever connectivity is available.
7. Missing data, failed requests, expired credentials, or uncertain verification must never result in automatic approval.
8. Business rules must be implemented in the appropriate application and database layers. Important rules must not depend only on frontend validation.
9. Keep the design extensible for additional plants in the future, but do not add Plant 1 or Plant 2 workflows to the initial release.
10. Where an ABB policy is not yet confirmed, use the defaults in this document and keep important settings configurable.

## 2. Person Categories

The system must support these categories:

### 2.1 Contract/Temporary Worker

- Every worker must have a unique worker ID.
- A worker record should include full name, category, photo if required by policy, contractor/company, contact information if required, validity dates, status, and plant assignment.
- Contractor/company details must be recorded when applicable.
- A worker must have an active and valid authorization before gate access is approved.
- Expired, suspended, terminated, or unapproved workers must be rejected.

### 2.2 Internship Student

- Every intern must have a unique internship ID.
- A record should include full name, institution, photo if required by policy, contact information if required, internship validity dates, status, and plant assignment.
- Internship access must not continue beyond the approved validity period unless an authorized user extends it.
- An intern must not be treated as an authorized worker merely because a record exists.

### 2.3 Visitor

- Each visitor registration or visit pass must have a unique reference.
- Record the visitor's name, purpose of visit, visit date or validity period, host/contact person where applicable, and other minimum required details.
- Visitor passes must be limited to their approved validity period.
- A visitor must not be approved outside the permitted date or time, if time restrictions are configured.
- A reusable visitor record must not automatically make a new visit valid. A new visit or pass must be registered when required.

## 3. Record Status Rules

Use clear, consistent statuses. Suggested statuses are:

- **Pending:** Waiting for required approval or activation.
- **Active:** Approved and currently eligible, subject to validity and access checks.
- **Suspended:** Temporarily blocked.
- **Expired:** Validity period has ended.
- **Terminated:** Authorization has been permanently ended.
- **Rejected:** Registration or authorization was not approved.

Rules:

1. A record must not become Active until required fields and approvals are complete.
2. A status of Active alone does not guarantee gate approval. Plant assignment, validity, pass permissions, and other applicable checks must also pass.
3. Suspended, Terminated, Rejected, and Expired records must not be approved for entry.
4. Expiry must be enforced even if a scheduled notification or email fails.
5. Status changes must record the acting user, timestamp, previous status, new status, and reason where applicable.
6. Users must not be allowed to reactivate terminated records without the appropriate authorization.
7. The system may display an expired status automatically when the validity date has passed, even if a scheduled status-update job has not run.

## 4. Unique ID and Barcode/QR Rules

1. Every worker, intern, visitor pass, and other scannable credential must have a unique identifier within the appropriate scope.
2. The system must prevent duplicate IDs using database constraints, not only frontend checks.
3. IDs must not be silently reassigned to a different person after termination or expiry.
4. A barcode or QR code should contain only an opaque identifier or secure reference, not sensitive personal information.
5. Scanning a code must retrieve and validate the associated current record.
6. A valid-looking barcode must never be treated as proof of authorization by itself.
7. Missing, malformed, unknown, duplicated, or unreadable codes must return a safe failure result.
8. If a credential is replaced or revoked, the old credential must no longer authorize access.

## 5. Gate Verification Rules

### 5.1 Required Checks

For each gate verification, the system must check:

1. Whether the scanned or searched credential exists.
2. Whether the record is approved and active.
3. Whether the person or pass is within its validity period.
4. Whether the credential is authorized for ABB Plant 3.
5. Whether the person or pass is permitted for the requested access.
6. Whether the credential has been suspended, revoked, or otherwise blocked.
7. Whether any additional configured access restrictions apply.

### 5.2 Decision Outcomes

Each verification must produce one of these outcomes:

- **APPROVED:** All mandatory checks passed.
- **REJECTED:** A known rule prevents access.
- **UNABLE TO VERIFY:** The system could not safely determine authorization, for example because of a database or network failure.

Examples of rejection reasons include:

- Unknown ID
- Expired authorization
- Suspended or terminated record
- Invalid pass date
- Wrong plant
- Incomplete approval
- Access not permitted

The interface should display a short reason that helps the security operator take the correct next step without exposing unnecessary personal information.

### 5.3 Gate Operation

1. The security operator must select or be assigned to an authorized Plant 3 gate.
2. Every scan must be associated with a gate and an authenticated operator.
3. Manual ID search must follow the same verification rules as barcode scanning.
4. Repeated scans must not create duplicate entry events accidentally.
5. A failed verification must not create a successful entry event.
6. The operator must not be able to override a rejection unless a specific, authorized exception workflow is implemented and audited.
7. If the database is unavailable, the system must show an explicit verification failure or approved offline-mode decision. It must never silently treat the credential as approved.

## 6. Entry and Exit Rules

1. Entry and exit must be recorded as separate events.
2. Each event must include person/pass reference, event type, timestamp, gate, operator, verification result, and scan source.
3. The current-inside list must be calculated from valid, recorded entry and exit events.
4. An entry should not be recorded as a new successful entry if the person is already marked as inside, unless an authorized correction or configured exception applies.
5. An exit should not be treated as a valid exit when no corresponding open entry exists, unless an authorized correction is performed.
6. Invalid event sequences must be flagged for review instead of silently changing attendance data.
7. Security users must be able to search recent access history according to their permissions.
8. Missing exits must be visible in a report or dashboard.
9. Corrections to entry/exit records must require an authorized role and a reason.
10. Corrections must preserve the original event and create an audit record. The system must not silently erase access history.
11. Reports must distinguish recorded facts from calculated current-inside status.
12. The system must use database-safe operations to prevent concurrent scans from producing inconsistent entry/exit states.

## 7. Validity and Expiry Rules

1. Worker and intern validity must be based on approved start and end dates.
2. Visitor pass validity must be based on the approved visit date or date/time range.
3. The start of validity is inclusive and the end of validity is inclusive according to the configured business timezone. If exact times are used, the pass expires at its defined end time.
4. If only dates are stored, a pass remains valid through the end of its end date in the configured local timezone.
5. Missing mandatory validity dates must prevent activation.
6. An expired credential must be rejected regardless of whether an expiry reminder was sent.
7. Authorized administrators may renew or extend a credential after the required checks.
8. A renewal must record the old validity, new validity, acting user, timestamp, and reason.
9. A renewal must not erase prior access history.
10. Suspension and termination must take effect for subsequent verification decisions as soon as the authoritative system recognizes the change.

### 7.1 Expiry Notifications

Use configurable advance reminders. The initial default may be **7 days before expiry**, with an additional reminder on the expiry date if appropriate.

- Display upcoming expirations on the dashboard.
- Display expired credentials separately from upcoming expirations.
- Record notification attempts and delivery failures.
- Do not rely on email delivery to enforce expiry.
- If email is unavailable, the dashboard must still show the expiry.
- Avoid sending duplicate reminders unnecessarily.
- Use a reliable scheduled server-side process for notifications and routine expiry maintenance.

## 8. Renewal Rules

1. Renewal requests may be submitted by authorized administrative users or through an approved request workflow.
2. Renewal must not automatically approve a suspended or terminated person.
3. Required information and approval must be complete before a renewed authorization becomes active.
4. The renewed validity must follow the approved dates; it must not be extended indefinitely by default.
5. A renewal must generate an audit entry.
6. The old barcode may remain usable only if the credential has not been revoked and the approved implementation permits it. If a credential is replaced, the old one must be invalidated.
7. The system should show who renewed a record and when.

## 9. Canteen Rules

### 9.1 Default Eligibility

1. Canteen scanning must verify the person's identity, status, validity, and configured canteen eligibility.
2. Only eligible and active records may receive an approved canteen transaction.
3. The canteen function must use the current authoritative record whenever connectivity is available.

### 9.2 Default Daily Limit

For the initial implementation, use **one successful canteen use per person per calendar day**.

This is a working default and must be configurable because ABB may later specify meal-based limits or multiple permitted uses.

1. The date must be calculated using the configured local business timezone.
2. A successful transaction must store the person reference, timestamp, date key, result, and operator or canteen terminal.
3. A second scan on the same day must be rejected as a duplicate unless an authorized exception is introduced.
4. A rejected scan must not consume the person's daily allowance.
5. The system must prevent simultaneous scans from creating two successful transactions for the same person and date.
6. A failed network request must not be reported as successful.
7. Any approved manual exception must record the acting user, reason, timestamp, and original transaction reference if applicable.
8. Canteen records must be reportable by date, person category, and transaction result, subject to permissions.

## 10. User Roles and Permissions

### 10.1 Administrator

May, subject to assigned authorization:

- Manage worker, intern, and visitor records.
- Create, update, approve, suspend, renew, and terminate records.
- Manage gates, categories, configurable business rules, and application settings.
- Manage users and role assignments.
- View reports, audit history, incidents, and system health.
- Perform authorized corrections with reasons.

### 10.2 Security Operator

May:

- Scan barcodes or QR codes.
- Search IDs manually.
- View the minimum information needed for access decisions.
- Record valid entry and exit events.
- View recent gate activity and relevant access history.
- Report incidents according to assigned permissions.

Must not, by default:

- Create or approve their own access authorization.
- Change a person's validity dates or status.
- Delete access history.
- Change roles or security settings.
- Override a rejection without explicit authorization.

### 10.3 Canteen Operator

If a separate canteen role is enabled, may:

- Scan credentials for canteen eligibility.
- Record canteen transactions.
- View the transaction result and limited information needed for service.
- View permitted canteen reports.

Must not, by default:

- Change worker, intern, or visitor authorization.
- Modify gate access events.
- Change daily limits or system-wide security settings.
- Delete canteen history.

### 10.4 Permission Enforcement

1. The interface must hide or disable unauthorized actions.
2. The backend and database must independently enforce permissions.
3. Supabase Row Level Security (RLS) policies must protect sensitive records.
4. A frontend role check alone is not sufficient security.
5. Users must not be able to assign themselves additional privileges.
6. All role and permission changes must be audited.
7. Accounts must use authenticated access; shared generic accounts should be avoided where practical.

## 11. Data Validation Rules

1. Required fields must be validated before submission.
2. IDs must be normalized consistently to avoid accidental duplicates caused by whitespace or letter case.
3. Names and text fields must be trimmed and length-limited.
4. Phone numbers must be validated where provided, but only collected when necessary.
5. Start dates must not be later than end dates.
6. Visitor dates must follow the approved visit policy.
7. Uploaded photos must meet configured file type and size restrictions.
8. File uploads must be validated server-side where possible and stored in protected storage.
9. User-provided text must be handled safely to prevent injection and rendering issues.
10. Invalid input must produce a clear message and must not partially create inconsistent records.
11. Database constraints must protect unique identifiers and other critical invariants.
12. Personal information must be collected only when required for the system's approved purpose.

## 12. Audit Rules

The system must maintain audit history for security-relevant operations, including:

- Record creation and updates
- Status changes
- Renewals and validity changes
- Credential replacement or revocation
- Entry and exit decisions
- Manual corrections
- Canteen transactions and authorized exceptions
- User creation and role changes
- Configuration changes
- Incident and watchlist changes, where enabled
- Failed or suspicious authorization attempts

Each applicable audit record should contain:

- Actor or system process
- Action
- Affected record reference
- Timestamp
- Outcome
- Reason, where required
- Relevant previous and new values, where appropriate

Audit records must not be editable or deletable by ordinary users. Avoid copying unnecessary personal data, passwords, tokens, or secrets into logs. Retention periods must be configurable or finalized according to ABB policy.

## 13. Incident and Watchlist Rules

If existing incident or watchlist features are functional and suitable, preserve them after review.

1. Only authorized users may create or modify incident records.
2. Each incident should include a category, description, timestamp, reporting user, status, and relevant references where appropriate.
3. Incident information must be visible only to users with a legitimate operational need.
4. A watchlist match must not rely solely on a person's name if that can cause false matches.
5. Any watchlist-based rejection must follow ABB-approved policy and provide a safe reason to the operator.
6. Changes to watchlist records must be audited.
7. Do not introduce automated high-impact decisions based on unverified incident information.

## 14. Offline Scanning Rules

Preserve the existing offline scanning feature if it is functional and can be secured.

1. The application must clearly show whether it is online or offline.
2. Offline mode must never pretend to have verified current server data.
3. If approved by ABB, the application may use a limited, securely cached dataset with a defined freshness period.
4. Cached data must be minimized and protected.
5. Each offline event must include a unique event ID, event timestamp, gate, operator, scan source, verification basis, and synchronization status.
6. Synchronization must be idempotent so that retrying an event does not create duplicate transactions.
7. Conflicts must be flagged for review rather than silently overwritten.
8. The interface must distinguish verified-online, verified-under-approved-offline-policy, and unable-to-verify outcomes.
9. Whether offline access should fail closed or use a controlled offline authorization policy must be confirmed with ABB before production.
10. Until that policy is approved, the safe default is **UNABLE TO VERIFY**, not automatic approval.

## 15. Dashboard and Report Rules

The dashboard should display, where supported by reliable data:

- Active workers
- Active internship students
- Current visitor passes
- Today's entries and exits
- People currently marked inside
- Missing exits
- Upcoming and expired authorizations
- Rejected and unverified scans
- Recent gate activity
- Canteen usage
- Incidents requiring attention

Reports should support relevant filters such as date range, person category, gate, status, and result.

1. Dashboard counts must be derived from database records and clearly defined rules.
2. The current-inside count must follow the entry/exit rules in this document.
3. Reports must respect role permissions.
4. Exported reports must include only fields the requesting user is allowed to see.
5. CSV and PDF exports must handle personal data safely.
6. Export failures must be visible and must not be reported as successful.
7. The application must not silently change historical events to make reports appear consistent.

## 16. Error Handling Rules

The system must handle:

- Database and network failures
- Unknown or invalid barcode/QR codes
- Camera or scanner failures
- Duplicate scans
- Invalid form data
- Failed uploads
- PDF or printing failures
- Email delivery failures
- Offline synchronization failures
- Unauthorized actions
- Concurrent record updates

For every error:

1. Show a clear message that tells the user what happened and what to do next.
2. Do not show secrets, database credentials, access tokens, or raw stack traces.
3. Do not show an approval result when verification has failed.
4. Prevent accidental duplicate writes when retrying.
5. Preserve already confirmed records and events.
6. Record relevant technical diagnostics securely.
7. Make recovery and retry behavior explicit.

## 17. Security and Privacy Rules

1. Never expose the Supabase service-role key or other privileged secrets in frontend code.
2. Use environment variables and appropriate secret management.
3. Enforce authentication and authorization for protected operations.
4. Apply and test Supabase RLS policies for sensitive tables.
5. Restrict access to photos, reports, and personal information.
6. Do not place sensitive personal data directly in barcodes or QR codes.
7. Do not collect fields without an operational or policy requirement.
8. Do not hard-delete important access history through ordinary workflows.
9. Back up the database before schema migrations or risky changes.
10. Keep development and production configuration separate.
11. Review hosting, backups, data residency, retention, and access policies with ABB before production use.
12. Use approved ABB branding assets; do not invent an official logo or imply unapproved corporate endorsement.

## 18. Technical Implementation Rules

1. Inspect the existing repository before changing code.
2. Verify which existing features work and which are incomplete.
3. Reuse working components, database structures, and workflows where suitable.
4. Review the current database schema, authentication, storage, and RLS before implementing new functionality.
5. Make schema changes incrementally and provide migration scripts.
6. Preserve existing data and take a backup before risky migrations.
7. Enforce critical business rules in database constraints, transactions, or secure server-side operations as appropriate.
8. Use transactions or equivalent safe database operations for operations such as canteen limits and entry/exit state changes.
9. Do not rely on the client device clock alone for authoritative event timestamps when a trusted server timestamp is available.
10. Keep secrets out of source control and browser bundles.
11. Add tests for business rules, authorization, expiry, duplicate scans, and error paths.
12. Document any rule that could not be implemented safely with the existing architecture.
13. Do not remove a working feature without understanding its dependencies and obtaining approval for a major change.

## 19. Initial Acceptance Criteria

The initial system can be considered ready for controlled testing when:

- Authorized users can create and manage worker, intern, and visitor records.
- Unique IDs are enforced.
- Credentials can be generated and printed or exported where supported.
- Gate verification returns clear approved, rejected, or unable-to-verify outcomes.
- Expired, suspended, invalid, and wrong-plant credentials are rejected.
- Entry and exit events are recorded and current-inside status is calculated consistently.
- Canteen transactions follow the configured daily limit and prevent duplicate successful uses.
- User permissions are enforced beyond the frontend.
- Important changes and access decisions are auditable.
- Reports and exports respect permissions.
- Network and scanner failures do not produce false approvals.
- Automated tests and a manual test checklist cover the critical business rules.
- Remaining limitations are documented before production approval.

## 20. Rules to Confirm Later With ABB

The system should work with the defaults above, but the following decisions must be confirmed before production or whenever ABB clarifies its requirements:

1. Whether a photo is mandatory for each person category.
2. Required identification fields for workers, interns, and visitors.
3. Who can approve new registrations and renewals.
4. Whether visitor passes need host approval.
5. Exact validity dates and time restrictions.
6. Whether multiple entry/exit events per day are permitted.
7. How to handle missing exits and exceptional access.
8. Whether the canteen limit is once per day or based on meal periods.
9. Whether offline gate approval is permitted.
10. Required expiry reminder intervals and notification channels.
11. Incident and watchlist policy.
12. Audit and personal-data retention periods.
13. Production hosting, backup, and data residency requirements.
14. Required reporting formats and access permissions.
15. ABB-approved branding assets and ID card design.

Until these decisions are confirmed, keep the relevant rules configurable where practical and document any assumptions.

---

## Final Instruction for Antigravity

Read this document together with `PRD.md`, `Architecture.md`, `phases.md`, and `memory.md` when those documents are available.

Treat these rules as the initial working baseline for ABB Plant 3. Inspect the existing project first, preserve working functionality, and implement changes incrementally. Do not invent unapproved ABB policies or remove existing features without review. If a rule conflicts with the current implementation, explain the conflict and propose a safe change before making a destructive modification.

Update this document when a real implementation issue, confirmed ABB policy, or tested workflow requires a change. Keep the document aligned with the actual code and database behavior.