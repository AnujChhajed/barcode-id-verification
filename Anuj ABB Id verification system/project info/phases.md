# Development Phases

## ABB ID Verification and Gate Security System — Plant 3

**Status:** Proposed sequence, adjusted to the verified workspace facts and the locked SQLite decision in
`memory.md`. Read that file first.

---

## Purpose

Divides the work into small, reviewable phases so the existing application shell can be adapted safely,
working features preserved, and the project resumable after an AI-session or account change.

---

## Ground rules

- Inspect before editing. Never assume a feature exists because a document says so.
- One small task at a time; report actual results.
- Do not discard uncommitted changes, delete features, or modify the Sagar reference folder.
- Do not apply migrations, modify production data, or deploy without explicit approval.
- Keep the inherited stack unless a change is justified and approved.
- Update `tasks.md`, `WORKLOG.md` and `NEXT-SESSION.md` after each task.

---

## Phase 0 — Inspection and recovery *(complete)*

### Tasks
- [x] Identify the true active project root and distinguish it from reference and abandoned folders.
- [x] Locate and identify the requirements document (a DOCX, despite the "pdf" in its name).
- [x] Establish which existing code is reusable and which is not.
- [x] Confirm the styling is already correct and requires no porting.
- [x] Record verified facts, locked decisions and open questions in `memory.md`.
- [x] Reconcile `PRD.md`, `Architecture.md`, `rules.md`, `phases.md` and `tasks.md` with those facts.

### Completion criteria
- Verified facts and decisions documented. **Met.**
- No application code or database changed during inspection. **Met.**

---

## Phase 1 — Baseline, seeding and safety

### Tasks
- Initialise Git in the new project root and commit the documents as a checkpoint.
- **Obtain approval**, then seed the application shell from the Sagar checkout (commit `b655ebb`),
  excluding `.git`, `node_modules`, `dist`, `.env*` and the college-only documents.
- Confirm the app installs, starts, builds and lints. Record every command and its actual result.
- Record pre-existing failures so they are not mistaken for new ones introduced later.
- Confirm secrets handling; never print or commit secret values.
- Confirm no `.env` file is tracked.

### Completion criteria
- Baseline commands and results documented.
- Existing failures distinguished from new ones.
- A rollback point exists before any risky change.

### Approval required
Copying the shell codebase; any decision to remove shell features.

---

## Phase 2 — Requirements, data model and permission matrix

### Tasks
- Compare the requirements DOCX against this documentation; correct any unsupported assumption.
- Confirm per-category fields, the expiry boundary, the reminder schedule, the canteen limit and the
  entry/exit recording method — or record them as open.
- **Confirm the deployment topology: one laptop, or one server holding the database file that gate
  laptops reach over the network. Never a shared network folder.**
- Design the ABB schema as versioned, portable SQL migrations: people, credentials, gate events,
  gates, canteen records, users, roles, audit log, notification log, settings.
- Write the **permission matrix**: every role against every action, and the backend endpoints each role
  may call.
- Present the schema and the permission matrix for approval.

### Completion criteria
- Data model and permission matrix approved.
- Migration plan includes compatibility and data-preservation checks.
- Unresolved policies remain explicitly marked as pending.

### Approval required
The schema design and the permission matrix, before any migration is created or applied.

---

## Phase 3 — Backend foundation *(must precede all feature work)*

### Tasks
- Create the backend API service and its configuration.
- Implement authentication: password hashing with a vetted library, server-side sessions with expiry and
  revocation, login rate limiting.
- Implement centralized role-based authorization middleware. Default deny. **No route checks permissions
  by hand.**
- Implement request validation with `zod`, shared with the frontend but re-validated on the server.
- Implement one consistent error response shape that never leaks internals.
- Implement the audit-log writer and the diagnostic logger, kept separate.
- Enable SQLite in WAL mode, foreign keys on, and a `schema_migrations` table.
- **Write negative tests asserting that a security-operator account is denied administrator endpoints.**

### Completion criteria
- Every endpoint requires authentication unless deliberately public, and the public list is explicit.
- Role checks are centralized and covered by negative tests.
- No secret reaches the browser.
- The database is created by migrations only.

### Approval required
Choice of backend framework, session strategy and hashing library.

---

## Phase 4 — People and credential management

### Tasks
- Adapt the existing record forms for the three categories; collect only required fields.
- Validate input; prevent accidental duplicates.
- Implement credential issuance, validity, renewal, suspension and revocation with the required reason
  and approver recording.
- Ensure barcode/QR payloads carry only an opaque identifier.
- Adapt the existing ID-card and visitor-pass components; keep print and PDF output working.
- Enforce role permissions on reading and changing personal information.

### Completion criteria
- Authorized users can manage the required record types; invalid data is rejected safely.
- Credential lifecycle actions are permission-controlled and auditable.
- Existing ID generation still works.

---

## Phase 5 — Gate verification and event tracking

### Tasks
- Adapt scanning and manual search to the ABB credential model.
- Verify existence, active status, validity, suspension/revocation and Plant 3 permission against
  authoritative backend data on every scan.
- Show clearly distinguishable **APPROVED**, **REJECTED** (with reason) and **UNABLE TO VERIFY**.
- Record entry and exit events only after the write succeeds; make events append-only.
- Handle repeated scans, retries and concurrent requests without duplicate events.
- Derive current-inside status; flag missing exits.
- Make all backend failures fail closed.
- Write tests: valid, expired, revoked, suspended, unknown, malformed, repeated, plus a forced backend
  failure that must return UNABLE TO VERIFY.

### Completion criteria
- Valid credentials pass; unknown, expired, suspended, revoked and unauthorized credentials do not.
- Unverifiable requests never approve.
- No test path can produce APPROVED without a successful authoritative check.

---

## Phase 6 — Expiry, renewal and reminders

### Tasks
- Confirm the reminder interval, recipient source and wording.
- Implement the scheduler inside the always-on backend process.
- Send the pre-expiry reminder and the on-expiry notification.
- Record every attempt and delivery status; surface failures to administrators.
- Ensure expiry is enforced even when email fails.
- Implement the extend / suspend / terminate flow with the new expiry date, reason, approver and time.
- Never delete expired records.

### Completion criteria
- Reminders are sent on the approved schedule and delivery failures are visible.
- Revoking email access does not affect gate outcomes.
- Renewal and revocation work and are audited.

---

## Phase 7 — Canteen verification

Canteen tracking is **[Confirmed]** in scope by the requirements document.

### Tasks
- Build the canteen screen using the existing scanning components.
- Check eligibility and same-day usage; allow the first eligible entry; reject a second with a clear
  message.
- Enforce one successful entry per person per local day with a database unique constraint and a
  transaction, so simultaneous scans cannot create duplicates.
- Save date and time; record rejected attempts.
- Add canteen usage reports.

### Completion criteria
- A second same-day entry is rejected reliably, including under simultaneous requests.
- Tests cover the constraint, not just the client message.

**[Pending]** The exact limit boundary, time zone, and whether exceptions are allowed.

---

## Phase 8 — Dashboard, reports and auditability

### Tasks
- Confirm the definition of every dashboard figure.
- Adapt the existing dashboard to the confirmed figures using authorized data only.
- Implement the required reports with CSV/PDF export, restricted by role.
- Ensure dashboard figures and reports are derived from the same event data.
- Confirm audit-log access and retention.

### Completion criteria
- Reports match their documented definitions and reconcile with the underlying events.
- Sensitive data is not exposed to unauthorized roles.
- Privileged changes and corrections are auditable.

---

## Phase 9 — Offline scanning *(blocked until policy approved)*

### Tasks
- Obtain an approved offline policy: which records are cached, the maximum data age, how offline scans
  are recorded, how conflicts are reconciled on sync, and the operator's procedure when validity cannot
  be checked.
- Implement only to that policy. Offline data must never produce APPROVED when current status cannot be
  established.

### Completion criteria
- The policy exists and is followed.
- Stale cached data cannot yield APPROVED.

---

## Phase 10 — Testing and security review

### Tasks
- Run lint, type-check, build, unit, integration and end-to-end tests available in the repository.
- Test every role against the permission matrix, including denials.
- Test valid, expired, revoked, suspended, unknown and malformed credentials.
- Test backend failures, duplicate scans, concurrent requests and canteen limits.
- Test reminder failure not affecting validity.
- Run regression tests over the retained shell features.
- Search the frontend, repository, logs and build output for secrets.
- Review personal-data exposure in screens, exports, logs and barcode payloads.
- Fix release blockers; document remaining limitations.

### Completion criteria
- Required tests pass, or failures are documented and accepted by the owner.
- No unsupported claim of production readiness is made.

---

## Phase 11 — Deployment readiness

### Tasks
- Confirm hosting, topology, environment configuration and HTTPS.
- Confirm and **test** database backup and restore.
- Review migration order and the rollback plan.
- Confirm filesystem permissions on the database file and whether encryption at rest is required.
- Confirm monitoring and error reporting.
- Confirm approved ABB branding and operator instructions.
- Obtain stakeholder approval.

### Completion criteria
- Deployment checklist approved; a restore has actually been demonstrated.
- Production deployment occurs only with explicit authorization.

---

## Phase 12 — Post-deployment follow-up

### Tasks
- Monitor errors and operational feedback.
- Review failed verifications and notification-delivery failures.
- Fix defects through controlled, tested changes.
- Keep documentation and tasks current.
- Plan other plants separately; do not expand beyond Plant 3 without approval.

---

## Task execution protocol

For every implementation task:

1. State the task and the expected outcome.
2. List the exact files and database objects expected to change.
3. Identify risks and any approval needed.
4. Make only the approved change.
5. Run the relevant checks and report exact results.
6. Update `tasks.md`, and `memory.md` when durable context changes; update `WORKLOG.md` and
   `NEXT-SESSION.md`.
7. Stop and wait for approval before the next task.

## Current status

Phase 0 is complete. Phases 1–12 are not started. No application code exists in the project root yet.
Do not mark a phase complete on the basis of this plan alone.
