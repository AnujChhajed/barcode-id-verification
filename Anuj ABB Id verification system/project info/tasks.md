# tasks.md — Development Checklist and Progress Tracker

## How to use this checklist

- Treat every unchecked item as **not started** until code, requirements or test evidence confirms it.
- Never mark a task complete because it appears in a plan or because an AI session claims it was done.
- Work on one task at a time. Inspect the current implementation before editing.
- Record blockers and decisions needing approval. Do not invent business rules.
- Update this file at the end of each session, and keep `WORKLOG.md` and `NEXT-SESSION.md` aligned.

**Current verified status (2026-10-16):** the Sagar shell is seeded into the project root and verified
(installs, builds, lints with 135 pre-existing problems). A local Node + SQLite backend now exists in
`backend\`: migrations apply idempotently, the test suite runs **92 tests / 20 suites / 92 pass / 0 fail**,
and the authentication, authorization, people, credential and gate endpoints are implemented. No Git
repository exists yet (deferred by user request). Phases 0–3 and **Phase 5 are complete on the backend**;
Phase 4 is complete for the **backend API** with the frontend adaptation still outstanding. Determine this
again from the filesystem rather than trusting this line.

---

## Phase 0 — Inspection and recovery — **COMPLETE**

- [x] Identify the active project root and confirm why it is correct.
  *Verified: `Anuj ABB Id verification system\` is the chosen root; it contains only `project info\` and `abb-logo.png`.*
- [x] Inspect the workspace folders; do not merge the Anuj and Sagar folders automatically.
  *Verified: they are not to be merged. The Sagar checkout is the read-only reuse source.*
- [x] Locate the requirements source and confirm its exact path and extension.
  *Verified: a DOCX at `local database\barcode-id-verification\project info\requirement pdf for friend.docx`.*
- [x] Establish which existing code is reusable and which is not.
  *Verified: the Sagar checkout (commit `b655ebb`) holds the reusable shell. `local database\` is abandoned.*
- [x] Confirm the styling requires no porting.
  *Verified: `src/styles.css` and all 45 `src/components/ui/*` components are byte-identical between the Sagar checkout and the abandoned project.*
- [x] Check Git availability in the project root.
  *Verified: no Git repository exists in the project root yet.*
- [x] Record verified facts, locked decisions and open questions in `memory.md`.
- [x] Reconcile `PRD.md`, `Architecture.md`, `rules.md`, `phases.md` and `tasks.md` with those facts.
- [x] Read the requirements DOCX in full and note every explicit requirement.
  *Done 2026-10-16: read end to end. Scope is Plant 3 only, one gate; three person categories;
     canteen verification is in scope; expiry reminders via a scheduler.*
- [x] Confirm no user work was overwritten during inspection.
  *Verified: no files were modified or deleted other than the project-info documents being reconciled.*

**Exit criteria:** met. (Phase 0 fully complete as of 2026-10-16.)

---

## Phase 1 — Baseline, seeding and safety — **COMPLETE (Git deferred)**

- [ ] Initialise Git in the project root and commit the documents as a checkpoint.
  *Deferred by user request (2026-10-16) to project completion, to avoid churn during building.*
- [x] **Obtain approval**, then seed the application shell from the Sagar checkout (commit `b655ebb`),
      excluding `.git`, `node_modules`, `dist`, `.env*` and the college-only documents.
  *Done 2026-10-16 via robocopy (exit 3 = success). Also copied `abb-logo.png` into `public/`.*
- [x] Confirm the app installs with the repository's own instructions.
  *Verified: `npm install` exit 0 — 588 packages in ~10 min. App starts: `npm run dev` listened on port
     8080 and `GET /` returned HTTP 200 with SSR HTML.*
- [x] Run the existing build, lint and type-check; record commands and actual results.
  *Verified: `npm run build` ✓ built in 1m 31s (process exit 1 only from a sandbox block on wrangler's
     log file). `npm run lint` FAIL 135 problems (124 errors, 11 warnings). No type-check script exists in
     `package.json`.*
- [x] Record pre-existing failures so they are not mistaken for new ones.
  *Recorded in `WORKLOG.md`: UTF-16 `take_screenshots.cjs`, 35 npm audit vulnerabilities,
     `@zxing/library` engine mismatch, and the `no-explicit-any` / `no-empty` shell lint errors.*
- [x] Confirm no `.env` file is tracked and no secret is committed or exposed in frontend code.
  *Verified: `.env*` was excluded during the copy; no `.env` exists in the project root; `.gitignore`
     lists `.env`. (No Git repo yet, so "tracked" is not yet applicable.)*
- [x] Create `WORKLOG.md` and `NEXT-SESSION.md` in the project root.
  *Done 2026-10-16.*
- [x] Move the requirements DOCX into `project info\`.
  *Done 2026-10-16 — copied (not moved) to keep the original reference copy intact.*

**Exit criteria:** baseline recorded, existing failures distinguished, a rollback point exists.

---

## Phase 2 — Requirements, data model and permission matrix — **COMPLETE**

- [x] Compare the requirements DOCX against `PRD.md` and correct unsupported assumptions.
  *Verified 2026-10-16: the DOCX was read end to end in Phase 0. A grep of `PRD.md` finds no left-over
     Supabase or college-domain wording, and it states Plant 3 only with exactly one gate.*
- [x] Confirm Plant 3 is the only site in scope and that exactly one gate exists.
  *Confirmed: `0002_seed_plant3.sql` seeds exactly one plant (`P3`) and one gate (`gate-p3-main`,
     "Plant 3 - Main Gate").* 
- [x] Confirm per-category required vs optional fields.
  *Done: worker requires `workerRef`; intern requires `institutionName`; visitor requires
     `purposeOfVisit` and `personToMeet`. Encoded as database CHECK constraints in `0001_init.sql` and
     mirrored by `missingCategoryFields()` in `backend\src\validation\schemas.js`.*
- [x] Confirm the expiry boundary, reminder schedule, canteen limit and entry/exit recording method — or
      record them as open.
  *User confirmed: expiry lasts **through the end of the calendar day** (`valid_to` inclusive); canteen is
     **once per person per local day**. Still open: reminder schedule/wording, and whether an approved scan
     auto-records entry/exit or the operator chooses direction.*
- [ ] **Confirm the deployment topology:** one laptop, or one server whose database file gate laptops
      reach over the network. Never a shared network folder.
  *Still open — the user is confirming this with the mentor. Blocks Phase 11, not Phase 4/5.*
- [x] Design the ABB schema (people, credentials, gate events, gates, canteen records, users, roles,
      audit log, notification log, settings, schema_migrations) as versioned portable SQL migrations.
  *Done: `backend\migrations\0001_init.sql` (14 tables, 19 indexes) and `0002_seed_plant3.sql`.
     Portable conventions documented at the top of 0001 — opaque TEXT ids, ISO-8601 UTC timestamps,
     `YYYY-MM-DD` date-only validity, INTEGER 0/1 booleans, no triggers or SQLite-only syntax.*
- [x] Write the permission matrix: roles against actions, and the endpoints each role may call.
  *Done: `project info\PERMISSION-MATRIX.md` — 2 roles, a 30-row action matrix, the endpoint list and
     7 non-negotiable enforcement rules.*
- [x] Present the schema and permission matrix for approval before creating or applying any migration.
  *Approved by the user on 2026-10-16 ("You decide, just build").*

**Exit criteria:** met. The data model and permission matrix are approved and marked with the unresolved
policies (deployment topology, reminder schedule, entry/exit direction) called out explicitly.

---

## Phase 3 — Backend foundation *(blocks all feature work)* — **COMPLETE**

- [x] Create the backend API service and its configuration.
  *Done: `backend\` (Express 5, ESM, Node ≥ 22). `src\config.js`, `src\app.js`, `src\server.js`,
     `scripts\migrate.js`, `scripts\bootstrap-admin.js`, `.env.example`.*
- [x] Implement authentication: vetted password hashing, server-side sessions with expiry and
      revocation, login rate limiting.
  *Done: `src\auth\password.js` (Node scrypt, `scrypt$N$r$p$salt$hash`), `src\auth\sessions.js`
     (only a SHA-256 hash of the token is stored), `src\auth\rate-limit.js` (fixed window, 5 attempts
     per 15 minutes).*
- [x] Implement centralized role-based authorization middleware; default deny; no hand-written per-route
      permission checks.
  *Done: `src\auth\middleware.js` + `src\http\route.js`. A route cannot be registered without a valid
     `PUBLIC` / `AUTHENTICATED` / `[roles]` declaration; `assertPublicRoutes` in `src\app.js` makes the
     process refuse to start if the public surface widens beyond `GET /api/health` and `POST /api/auth/login`.*
- [x] Implement server-side request validation shared with the frontend via `zod`.
  *Done: `src\validation\schemas.js` — plain zod objects with no Express or database imports. Body, query
     and path parameters are all validated by the registrar before the handler runs.*
- [x] Implement one consistent error shape that never leaks internals.
  *Done: `src\lib\errors.js` + `src\http\error-handler.js`. Only `AppError` messages are exposed; anything
     else becomes a generic 500 with the stack included only outside production.*
- [x] Implement the audit-log writer and the diagnostic logger, kept separate.
  *Done: `src\lib\audit.js` writes to the `audit_log` table; `src\lib\logger.js` writes JSON lines to the
     process log and redacts password/token/secret/authorization/cookie/api-key fields.*
- [x] Enable SQLite WAL mode, foreign keys, and a `schema_migrations` table.
  *Done: `src\db\connection.js` sets `journal_mode = WAL`, `foreign_keys = ON`, `busy_timeout = 5000`,
     `synchronous = NORMAL`, `trusted_schema = OFF`; `src\db\migrate.js` applies each file once, in a
     transaction, recorded in `schema_migrations`.*
- [x] Make the explicit public-endpoint list short and documented.
  *Done: two entries, asserted at boot (see above).*
- [x] **Write negative tests proving a security-operator account is denied administrator endpoints.**
  *Done: `backend\tests\security.test.js` — in a suite named for exactly this rule, a `security_staff`
     session is denied `GET /api/users`, `POST /api/users` and `PUT /api/settings`, and the test also
     asserts that no row was written.*
- [x] Confirm no secret of any kind reaches the browser.
  *Verified: `/api/users` selects an explicit column list that excludes `password_hash`; tests assert the
     response body never contains `scrypt$`; the session cookie is HttpOnly and SameSite=Strict; personal
     photo paths are collapsed to a `hasPhoto` boolean.*

**Exit criteria:** met. Verified evidence:
- `npm run migrate` → `discovered: 2 / pending: 0 / 0 applied, 2 already current` (idempotent).
- `npm test` → `# tests 66 / # suites 14 / # pass 66 / # fail 0` (the 19 Phase-3 tests all still pass).
- `npm start` + probes → `GET /api/health` 200; `GET /api/users` → 401; `GET /api/nope` → 404.

---

## Phase 4 — People and credential management — **backend COMPLETE, frontend outstanding**

- [x] Implement or verify create, view, update and approved deactivation workflows per category.
  *Done: `GET/POST /api/people`, `GET/PATCH /api/people/:id`, `POST /api/people/:id/status`,
     `GET /api/people/:id/credentials` (`backend\src\routes\people.routes.js`).*
- [x] Validate required fields and formats on the server.
  *Done: per-category required fields are re-checked on create **and** after a PATCH is merged onto the
     stored record, because a category change can invalidate a previously complete record.*
- [x] Prevent accidental duplicate records.
  *Done: a same category + name + phone record is rejected with 409; `workerRef` is additionally protected
     by the `ux_people_worker_ref` unique index, with the constraint violation mapped to a 409.*
- [x] Implement credential issuance, validity, renewal, suspension and revocation with reason and
      approver recording.
  *Done: `POST /api/credentials`, `POST /api/credentials/:id/validity`, `POST /api/credentials/:id/status`
     (`backend\src\routes\credentials.routes.js`). Every action writes `audit_log` with actor, before/after
     values and the stated reason. Only one live credential of each kind per person may exist.*
- [x] Ensure barcode/QR payloads carry an opaque identifier only.
  *Verified: the credential `id` is a random UUID used as the payload; a test asserts the credential
     response contains no holder name.*
- [ ] Adapt the existing ID-card and visitor-pass components; verify print and PDF output.
  *NOT STARTED — this is frontend work (`src\lib\idcard.ts`, `src\routes\_authenticated\students.*`).*
- [x] Enforce role permissions on reading and changing personal information.
  *Done: the register, profile, creation, editing, status changes and all credential lifecycle actions are
     administrator-only. Security staff can only call `GET /api/people/search`, which returns an
     identification view with no phone, email or visit details. Tests assert both the 403s and that the
     underlying rows were not written and were not read.*
- [x] Test valid, missing, malformed, duplicate, expired and revoked records.
  *Done: `backend\tests\people.test.js` and `backend\tests\credentials.test.js` — 47 tests covering valid,
     missing-field, malformed-date, unknown-id, duplicate, suspended, terminated, expired and
     not-yet-valid cases, plus direct unit tests of the fail-closed validity rule.*

**Exit criteria:** partially met. Authorized users can manage the required records and ineligible
credentials can no longer be treated as valid (proven by `credentials.test.js`). Outstanding: the
ID-card/visitor-pass components and their print/PDF output have not been adapted yet.

---

## Phase 5 — Gate verification and event tracking — **backend COMPLETE**

- [x] Inspect the existing scanning and verification flow before modifying it.
  *Verified: the Sagar shell scans client-side and decides in the browser; that whole path is unusable
     here, so verification was rebuilt server-side. `gate_events` already existed in `0001_init.sql`.*
- [x] Verify scanning resolves the correct record and evaluates current authoritative status.
  *Done: `POST /api/gate/verify` (`backend\src\routes\gate.routes.js`) looks the code up in `credentials`
     and re-reads the holder's **current** `people.status` on every scan, then runs the single shared rule
     `evaluateCredential()` from `backend\src\domain\credential-validity.js` against today's Plant-3 date.
     Nothing is cached and no client value participates in the decision.*
- [x] Show distinct **APPROVED**, **REJECTED** (with reason) and **UNABLE TO VERIFY** outcomes.
  *Done: every response carries `result` (`approved` / `rejected` / `unable_to_verify`), `reasonCode` and a
     human `reasonText`. The mapping is the pure function `gateResultFor()`, unit-testable in isolation.*
- [x] Ensure backend/network failures never produce an approval.
  *Done twice over: (a) a failed authoritative lookup becomes `indeterminate` → UNABLE TO VERIFY; (b) an
     approval whose event row could **not be written** is downgraded to UNABLE TO VERIFY, because the guard
     must never wave someone in on the strength of an entry that does not exist. Both are forced in tests
     (`tests\gate.test.js`, "gate — fail closed under backend failure") and each asserts that no approved
     row was written.*
- [x] Record entry and exit events only after the write succeeds; keep events append-only.
  *Done: `backend\src\data\gate-events.js` contains no UPDATE and no DELETE at all. Every scan — approved,
     rejected or unverifiable — writes one row (`recorded` in the response reports the outcome honestly).*
- [x] Handle repeated scans, retries and concurrent requests without duplicate events.
  *Done: a repeated approval of the same credential, gate and direction inside `scan.duplicate_window_seconds`
     (provisional 5 s, read from settings) is collapsed onto the existing row and reported as
     `duplicate: true`; the check and the insert run inside one transaction, and the partial unique index
     `ux_gate_events_dedup` is the database-level backstop. Tested with a 6-way concurrent burst, which
     produces exactly one event row.*
- [x] Derive current-inside status; flag entries without an exit.
  *Done: `GET /api/inside` returns everyone whose latest approved event is an entry, using a portable
     `ROW_NUMBER()` window statement. An entry that was not closed on the same plant day is reported with
     `missingExit: true` rather than being dropped or assumed absent.*
- [x] Prevent unauthorized editing or deletion of gate logs.
  *Done structurally: there is no route that can edit or delete a gate event, the data layer issues no
     UPDATE/DELETE, and every gate route declares its access explicitly (`POST /api/gate/verify`,
     `GET /api/gate/events`, `GET /api/inside` are administrator + security staff; anonymous callers get 401).*
- [x] Test valid, denied, repeated, malformed, expired, revoked and forced-failure scans.
  *Done: `backend\tests\gate.test.js` — 26 tests. Valid, unknown code, expired, not-yet-valid, suspended
     card, terminated card, suspended holder, terminated holder, unreadable stored date, repeated scan,
     opposite direction, concurrent burst, duplicate-window boundary, rejected scans, both forced failures,
     history filtering, and the inside list including a never-closed entry.*

**Exit criteria:** met on the backend. Verified evidence:
- `npm test` → `# tests 92 / # suites 20 / # pass 92 / # fail 0`.
- `npm run migrate` → `discovered: 2 / pending: 0 / 0 applied, 2 already current` (still idempotent).
- No path through `POST /api/gate/verify` returns APPROVED without a successful authoritative check and a
  successful write; the two tests that break the lookup and the insert both observe UNABLE TO VERIFY.

**Deliberately not done in this phase (recorded, not silently dropped):**
- `POST /api/gate/events` (recording an offline/queued scan) is **deferred to Phase 9**. Until offline mode
  exists there is no scenario it serves that `POST /api/gate/verify` does not already cover, and adding a
  client-supplied timestamp path now would widen the surface for no benefit.
- `POST /api/gate/events/:id/correction` is **deferred**. The table has no `correction_of` link column, and
  adding one is a schema migration plus an admin tool. It belongs with the audit/reporting work of Phase 8.
- The frontend gate screen still has to be built/adapted (Phase 4's outstanding half plus this phase's UI).

---

## Phase 6 — Expiry, renewal and reminders

- [ ] Confirm the reminder interval, recipient source and wording.
- [ ] Enforce expiry at every verification, independently of reminders.
- [ ] Implement the scheduler inside the always-on backend process.
- [ ] Send the pre-expiry reminder and the on-expiry notification.
- [ ] Record delivery attempts and failures; surface failures to administrators.
- [ ] Implement extend / suspend / terminate with a new expiry date, reason, approver and time.
- [ ] Keep expired records; never delete them.
- [ ] Test that email failure does not change credential validity.

**Exit criteria:** reminders work on the approved schedule; expiry holds even when email fails.

---

## Phase 7 — Canteen verification *(confirmed in scope)*

- [ ] Build the canteen screen using the existing scanning components.
- [ ] Check eligibility and same-day usage; allow the first eligible entry.
- [ ] Reject a second same-day entry with a clear message.
- [ ] Enforce one successful entry per person per local day with a unique constraint and a transaction.
- [ ] Save the successful entry's date and time; record rejected attempts.
- [ ] Add canteen usage reports.
- [ ] Test the constraint under simultaneous requests, not just the client message.

**Exit criteria:** a second same-day entry is reliably rejected, including concurrently.

---

## Phase 8 — Dashboard, reports and auditability

- [ ] Confirm and document the definition of every dashboard figure.
- [ ] Adapt the dashboard to the confirmed figures using authorized data only.
- [ ] Implement the required reports with CSV/PDF export restricted by role.
- [ ] Ensure reports reconcile with the underlying event data.
- [ ] Confirm audit-log access and retention.
- [ ] Test date ranges, time zone, filters, permissions, empty results and large result sets.

**Exit criteria:** reports match their definitions; sensitive data is not exposed; corrections are auditable.

---

## Phase 9 — Offline scanning *(blocked pending an approved policy)*

- [ ] Obtain an approved offline policy: cached records, maximum data age, recording of offline scans,
      conflict reconciliation on sync, and the operator procedure when validity cannot be checked.
- [ ] Implement only to that policy.
- [ ] Verify stale cached data cannot yield APPROVED.

**Exit criteria:** an approved policy exists and is followed.

---

## Phase 10 — Testing and security review

- [ ] Run the available unit, integration and end-to-end tests.
- [ ] Test every role against the permission matrix, including denials.
- [ ] Test invalid input, expired/revoked/suspended records, duplicate scans, concurrent requests and
      backend failures.
- [ ] Search the frontend, repository, logs and build output for secrets.
- [ ] Review personal-data exposure in screens, exports, logs and barcode payloads.
- [ ] Verify every test exercises the **real** implementation, not a re-implementation of the rules.
- [ ] Check loading, empty, error and success states.
- [ ] Run the production build and resolve regressions introduced by project changes.
- [ ] Record tests that could not be run, and why.

**Exit criteria:** results documented; known issues and remaining risks explicit.

---

## Phase 11 — Deployment readiness

- [ ] Confirm hosting, topology and environment configuration.
- [ ] Confirm HTTPS for any networked deployment.
- [ ] Confirm and **test** database backup and restore.
- [ ] Confirm the migration order and rollback plan.
- [ ] Confirm database-file filesystem permissions and whether encryption at rest is required.
- [ ] Confirm monitoring and error reporting.
- [ ] Prepare deployment and smoke-test steps.
- [ ] **Obtain explicit approval before any deployment or production data change.**
- [ ] After an approved deployment, verify the core workflows and record the result.

**Exit criteria:** deployment reviewed, authorized and verified in the intended environment.

---

## Every-session checklist

**Before work:**
- [ ] Read `memory.md`, `PRD.md`, `Architecture.md`, `rules.md`, `phases.md` and this file.
- [ ] Inspect the workspace and Git status.
- [ ] Read `NEXT-SESSION.md` and the latest `WORKLOG.md`, if present.
- [ ] State the single next task, the expected files, and the acceptance criteria.

**After work:**
- [ ] Summarise exactly what changed and which files were touched.
- [ ] Record the commands and tests run, with their actual results.
- [ ] Note blockers, unresolved questions and risks.
- [ ] Update checkboxes only where verification supports it.
- [ ] Update `WORKLOG.md` and `NEXT-SESSION.md`.
- [ ] State the recommended next task without claiming unverified completion.

---

## Approval required before these actions

- Deleting or overwriting project files or substantial user work
- Resetting or replacing a repository, or combining the Anuj and Sagar projects
- Destructive database commands, data deletion, or migrations against real data
- Changing access or security policy
- Redesigning the architecture, or replacing the inherited stack
- Copying the shell codebase into the project root
- Deploying, or modifying production data

Ask first, explain the impact, and provide a safe plan.

---

## Immediate next task

**Two options, in order of value:**

1. **Phase 4, frontend half — adapt the ID-card and visitor-pass components** (`src\lib\idcard.ts`,
   `src\routes\_authenticated\students.*`) to the ABB credential model and to the new
   `/api/people` / `/api/credentials` endpoints, and verify print and PDF output. This finishes Phase 4.
   It is also the prerequisite for the gate screen, because both need a frontend that can talk to the
   backend at all (CORS + `credentials: "include"`, see `NEXT-SESSION.md`).
2. **Phase 6 — expiry, renewal and reminders.** Its expiry half is already enforced at every verification
   by Phase 5; what remains is the reminder schedule (needs the user's answer) and the scheduler.

Do not begin the frontend redirect away from the Supabase files (`src\integrations\supabase\*`,
`src\lib\auth-context.tsx`) without deciding the session/cookie flow in the browser, and do not start the
Phase 6 scheduler until the reminder schedule and the deployment topology (both open questions above) are
answered.

Phases 0–3 and 5 are complete on the backend, and Phase 4 is complete on the backend (Git init deliberately
deferred to project completion).
