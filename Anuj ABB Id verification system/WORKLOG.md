# WORKLOG — ABB Plant 3 Security Gate Verification & ID Management System

Chronological record of what was actually done, with the exact commands run and their real results.
Newest entries at the bottom. Never record a success that was not verified.

Legend: **VERIFIED** = confirmed by running the command and reading the output. **UNVERIFIED** = not yet proven.

---

## 2026-10-16 — Session: seed the shell + establish the baseline

### Context

- Active project root: `Anuj ABB Id verification system\` (it now contains the shell plus the planning docs).
- Read `project info\HANDOVER-PROMPT.md` in full and the approved requirements document
  (`requirement pdf for friend.docx`) end to end. Phase 0 is now fully complete.
- Locked decisions (from the handover): SQLite behind a local backend (per the mentor), reuse the Sagar
  shell, replace the college domain with the ABB domain, keep the existing professional ABB red/white UI.
- User decisions recorded this session: canteen is a **separate app with its own DB**, but it must
  **never keep its own copy of people/credentials** — it verifies eligibility against the main backend
  (fail closed). Git init is **deferred** to project completion.

### Task 1 — Seed the baseline shell (**user approved**) — VERIFIED

Copied the Sagar checkout's application code into the new project root.

- Source: `..\Sagar Barcode id verfication Project\barcode-student-verification\` (commit `b655ebb`, read-only).
- Excluded: `.git`, `node_modules`, `dist`, `.env*`, and the college-only documents
  (`SRS_Barcode_Student_Verification_System.docx`, `ATC_Barcode_System_Data_Analysis.xlsx`,
  `PostgreSQL_vs_MySQL_Justification.pdf`).
- Command: `robocopy <src> <dst> /E /XD .git node_modules dist /XF .env ".env*" <college docs> ...`
- Result: **robocopy exit code 3** = success (files copied; destination already contained `project info/`
  and `abb-logo.png`, which robocopy reports as "extra").
- Follow-up: copied `abb-logo.png` into `public\abb-logo.png`, because `src/components/AbbLogo.tsx`
  references `/abb-logo.png`. Without this the logo would 404.

### Task 2 — Establish the baseline — VERIFIED

| Command | Result |
|---|---|
| `node -v` / `npm -v` | `v22.16.0` / `10.9.2` |
| `npm install` | **exit 0** — "added 588 packages, audited 589 packages in 10m". Warnings: `EBADENGINE` for `@zxing/library@0.23.0` (requires Node ≥ 24; we have 22.16) and `35 vulnerabilities (2 low, 6 moderate, 21 high, 6 critical)` |
| `npm run dev` | **VERIFIED running** — listened on port `8080`; `GET http://localhost:8080/` returned **HTTP 200** with SSR HTML (`<!DOCTYPE html>…`). Server stopped after the check. |
| `npm run build` | **✓ built in 1m 31s**, `dist/` produced. Process exit code was `1` **only** because the Trae sandbox blocked wrangler from writing its log to `%APPDATA%\xdg.config\.wrangler\logs\`. The build itself succeeded. |
| `npm run lint` (before fix) | **FAIL** — 16238 problems (16227 errors, 11 warnings); 16103 auto-fixable |
| `npm run lint` (after fix) | **FAIL** — 135 problems (124 errors, 11 warnings) |

### Fix applied — normalise line endings (user approved "do what is best")

Every file in the source checkout uses **CRLF**; `.prettierrc` implies `endOfLine: "lf"`, so prettier
flagged `Delete ␍` on nearly every line. Verified this is **pre-existing** (the Sagar source is CRLF too:
`vite.config.ts` = 30 CRLF / 0 LF), not caused by the copy.

- Added `project info` to `.prettierignore` so the planning documents are not reformatted.
- Ran `npm run format` (`prettier --write .`). Prettier exited `2` solely because
  `take_screenshots.cjs` is **UTF-16 encoded** (first bytes `00 00 00 00`) and cannot be parsed as UTF-8.
- After the run, `npm run lint` dropped from 16238 → 135 problems, confirming the CRLF noise is gone.

### Pre-existing issues — NOT introduced by this session

1. `take_screenshots.cjs` is UTF-16 and unparseable → the one remaining eslint "Parsing error" and the
   cause of prettier's exit code 2. It is a dev-only screenshot helper, not part of the app.
2. `35 vulnerabilities` reported by `npm audit` (2 low, 6 moderate, 21 high, 6 critical).
3. `@zxing/library@0.23.0` declares `node >= 24`; we run Node 22.16.
4. Remaining lint errors are shell code-quality issues: mostly `@typescript-eslint/no-explicit-any`,
   `no-empty` blocks in `src/lib/idcard.ts`, and `react-refresh/only-export-components` warnings.

### Notes / risks

- Empty leftover directories `backend\` and `frontend\` exist in the project root (created 2026-10-15,
  before this session, by the abandoned generic plan). They are empty. The backend will live in `server/`
  per the locked plan, so these two are junk — **awaiting permission to delete**.
- Files copied: the full `src/` shell, `supabase/` (to be replaced later), configs, `package.json`, etc.
- The Supabase integration (`src/integrations/supabase/*`, `src/lib/auth-context.tsx`) is present but is
  **not** part of the target architecture; it will be redirected to the local backend API.

### Next recommended task

Phase 2 — design the ABB Plant 3 schema (portable SQL migrations) and the role/permission matrix, and
present both for approval **before** any database is created.

---

## 2026-10-16 — Session: schema, backend foundation, and people/credential management

### Context

The user delegated the remaining design decisions ("You decide, just build"), so Phases 2, 3 and the
backend half of Phase 4 were built and verified in sequence. No production data was created; the only
database file on disk is the development one at `backend\data\abb-plant3.db`.

**Architecture change that must be recorded:** the backend was built in `backend\` (not `server\`), because
the user had already created the `frontend\` / `backend\` folder split for organisation. The frontend shell
itself still lives in the project root (`src\`, `public\`); there is no separate `frontend\` folder.

### Task 1 — Phase 2: schema and permission matrix — VERIFIED

- `backend\migrations\0001_init.sql` — 14 tables, 19 indexes, portable conventions documented at the top
  (opaque TEXT ids, ISO-8601 UTC timestamps, `YYYY-MM-DD` date-only validity, INTEGER 0/1 booleans, no
  triggers, no SQLite-only syntax). `gate_events` and `canteen_events` are append-only by convention and
  the data-access layer never issues UPDATE/DELETE against them.
- `backend\migrations\0002_seed_plant3.sql` — seeds exactly one plant (`plant-p3` / `P3`), one gate
  (`gate-p3-main` / "Plant 3 - Main Gate") and 5 settings. **No user rows** are seeded.
- `project info\PERMISSION-MATRIX.md` — 2 roles, a 30-row action matrix, the endpoint list, and 7
  non-negotiable enforcement rules. Two rows remain marked `*` pending ABB confirmation.
- Approval granted by the user the same day.

### Task 2 — Phase 3: backend foundation — VERIFIED

Built `backend\` — Express 5, ESM, Node ≥ 22, `better-sqlite3`, `zod`, `cookie-parser`.

- `src\config.js`, `src\app.js`, `src\server.js` (graceful SIGINT/SIGTERM shutdown), `scripts\migrate.js`,
  `scripts\bootstrap-admin.js` (refuses to run if an administrator already exists; never logs the password),
  `.env.example`, `.gitignore`.
- `src\auth\` — scrypt password hashing (`src\auth\password.js`), server-side sessions storing only a
  SHA-256 hash of the token (`src\auth\sessions.js`), a fixed-window login rate limiter
  (`src\auth\rate-limit.js`), and the central authorization middleware (`src\auth\middleware.js`).
- `src\http\route.js` — declarative route registration. A route **cannot be registered** without a valid
  `PUBLIC` / `AUTHENTICATED` / `[roles]` access declaration, and the authorization middleware is always the
  first guard. `src\app.js` additionally asserts the public surface against an explicit two-entry allowlist
  and refuses to boot if it widens.
- `src\lib\` — `errors.js` (AppError + one consistent error shape), `audit.js` (business audit trail),
  `logger.js` (JSON-lines diagnostics with secret redaction), `ids.js`, `time.js`.
- `src\db\` — WAL, `foreign_keys = ON`, `busy_timeout`, `synchronous = NORMAL`, `trusted_schema = OFF`, and
  a forward-only migration runner recorded in `schema_migrations`.

Verification (run in that session):

| Command | Result |
|---|---|
| `npm install` | “added 70 packages … found 0 vulnerabilities” |
| `npm run migrate` (first run) | `discovered: 2 / pending: 2 / 2 applied, 0 already current` |
| `npm run migrate` (second run) | `discovered: 2 / pending: 0 / 0 applied, 2 already current` |
| `npm test` | `# tests 19 / # suites 5 / # pass 19 / # fail 0` |
| `npm start` + probes | `GET /api/health` → 200; `GET /api/users` → 401 `UNAUTHORIZED`; `GET /api/nope` → 404 `NOT_FOUND`; `POST /api/auth/login {}` → 400 with per-field details |
| `npm run bootstrap-admin` (throwaway temp DB) | first run created the administrator; second run refused |

Two bugs were found and fixed while building: `node --test tests` fails on Node 22 (a bare directory is not
accepted) → changed to `node --test`; and `scripts\migrate.js` imported `../config.js` instead of
`../src/config.js`. `zod` was re-installed at `^3.24.2` so the schemas stay shareable with the frontend,
which is on v3.

### Task 3 — Phase 4: people and credential management (backend) — VERIFIED

New files: `src\data\people.js`, `src\data\credentials.js`, `src\data\settings.js`,
`src\domain\credential-validity.js`, `src\routes\people.routes.js`, `src\routes\credentials.routes.js`,
`tests\people.test.js`, `tests\credentials.test.js`.
Edited: `src\validation\schemas.js`, `src\http\route.js` (path-parameter validation), `src\app.js`.

Endpoints (all administrator-only except the search):

| Endpoint | Access |
|---|---|
| `GET /api/people/search` | administrator, security_staff — identification fields only |
| `GET /api/people` | administrator — register with filters and a total |
| `POST /api/people` | administrator |
| `GET /api/people/:id` | administrator — profile plus derived credential validity |
| `PATCH /api/people/:id` | administrator |
| `POST /api/people/:id/status` | administrator — suspend / terminate / reactivate, reason required |
| `GET /api/people/:id/credentials` | administrator |
| `POST /api/credentials` | administrator — issue |
| `POST /api/credentials/:id/validity` | administrator — renew / extend, reason required |
| `POST /api/credentials/:id/status` | administrator — suspend / terminate / reactivate, reason required |

Design points that matter:

- `src\domain\credential-validity.js` is a pure function with **no** database, clock or request access.
  It is the single place that answers "may this credential be used today?", and it fails closed: a missing
  credential, an unreadable date, an unknown status or a malformed timestamp all return
  `valid: false` with a stable reason code (`not_found`, `indeterminate`, `not_yet_valid`, `expired`,
  `suspended`, `terminated`, `person_suspended`, `person_terminated`). The holder's status is checked
  before the credential's own, so suspending a person takes effect immediately.
- `valid_to` is inclusive — the credential is valid **through** that calendar day, matching the user's
  answer of "end of that calendar day".
- Per-category required fields are validated twice: on create, and again after a PATCH is merged onto the
  stored record, because a category change can invalidate a record that was previously complete. The
  database CHECK constraints in `0001_init.sql` are the backstop.
- Every credential lifecycle action writes `audit_log` with the actor, before/after values and the stated
  reason. Credentials are never deleted.
- Personal photo paths are never disclosed: the API returns `hasPhoto` only.

Verification (this session):

| Command | Result |
|---|---|
| `npm test` | `# tests 66 / # suites 14 / # pass 66 / # fail 0` (was 19 tests / 5 suites; +47 tests) |
| `npm run migrate` | `discovered: 2 / pending: 0 / 0 applied, 2 already current` (still idempotent) |

The 47 new tests cover: anonymous 401s on every new endpoint; **security staff denied** listing the
register, reading a profile, creating, editing, suspending and every credential action — with assertions
that no row was written and no row was read; security staff *allowed* the search, which is proven to omit
phone, email and visit details; missing per-category fields; unknown categories and unknown fields; bad
phone numbers and emails; duplicate name+category+phone; duplicate `worker_ref`; invalid and impossible
dates; a reversed validity window; unknown person and unknown credential 404s; issuing; the one-live-
credential-per-kind rule; a credential for a suspended person; renewing a terminated credential being
refused; suspend making a credential invalid immediately; reactivation; expired and not-yet-valid
credentials; terminating the holder invalidating their credential; and direct unit tests of the
fail-closed validity rule (including malformed inputs and the inclusive end date).

### Open items carried forward

1. **Deployment topology** — one laptop, or one server the gate laptops reach over the network? The user
   is confirming with the mentor. Blocks Phase 11. Never a shared network folder.
2. Two `*`-marked rows in `PERMISSION-MATRIX.md` (exact security-staff read scope for incidents, reports
   and settings) still need ABB confirmation.
3. `scan.duplicate_window_seconds` is provisional (5 s).
4. "One live credential per kind per person" is enforced in application code, not by a partial unique
   index. A `ux_credentials_one_active_per_kind` index would make it database-enforced; that is a change
   to the approved schema, so it needs approval first.
5. The frontend still talks to Supabase (`src\integrations\supabase\*`, `src\lib\auth-context.tsx`) and
   must be redirected to this backend.
6. The ID-card / visitor-pass components and their print/PDF output are not adapted yet (the remaining
   half of Phase 4).
7. Pre-existing and unchanged: the UTF-16 `take_screenshots.cjs`, 35 npm audit vulnerabilities, and
   `@zxing/library@0.23.0` declaring Node ≥ 24 while we run 22.16.

### Next recommended task

Finish Phase 4 by adapting the ID-card / visitor-pass frontend to these endpoints, or start Phase 5
(`POST /api/gate/verify`) on the backend — `credential-validity.js` already implements the decision rule it
needs.

---

## 2026-10-16 — Session: Phase 5, gate verification and event tracking (backend) — VERIFIED

### Context

- Continued directly from the previous entry: Phase 5 was the natural next step because the decision rule
  (`backend\src\domain\credential-validity.js`) and the append-only `gate_events` table already existed but
  nothing called them.
- No new migration was needed: `gate_events`, its three indexes and the partial unique index
  `ux_gate_events_dedup` were already created by `0001_init.sql`.

### Task 1 — Gate verification, scan recording and the inside list — VERIFIED

**New file `backend\src\data\gate-events.js`** — all SQL for `gate_events`, deliberately with no UPDATE and
no DELETE (the table is append-only). Exports `toGateEventView`, `insertGateEvent`,
`findRecentApprovedScan` (the duplicate window), `listGateEvents`, `countGateEvents` and
`listInsidePeople`. The inside query uses a `ROW_NUMBER()` window statement rather than a correlated
sub-select so it stays portable to PostgreSQL.

**New file `backend\src\routes\gate.routes.js`** — three routes, each with an explicit access declaration:

| Route | Access | Purpose |
|---|---|---|
| `POST /api/gate/verify` | administrator, security_staff | run the authoritative check and record the scan |
| `GET /api/gate/events` | administrator, security_staff | read the append-only history, with filters |
| `GET /api/inside` | administrator, security_staff | who is currently on site, and which entries were never closed |

How the scan works: the code is looked up in `credentials`, the holder's **current** `people.status` is read
on every scan, and `evaluateCredential()` decides against today's Plant-3 date. Nothing is cached and no
client value influences the verdict. The gate is resolved from the seeded row (`P3-MAIN`) rather than
accepted from the request, and the timestamp comes from the server clock.

**Outcome mapping (new, in `credential-validity.js`)** — `gateResultFor()` is the only place that turns a
verdict into what the gate displays:

- `valid` → **APPROVED**
- `not_found`, `expired`, `not_yet_valid`, `suspended`, `terminated`, `person_suspended`,
  `person_terminated` → **REJECTED** (the check ran and the answer is "no")
- `indeterminate` → **UNABLE TO VERIFY** (the check could not be carried out)

This distinction is deliberate: an unknown barcode is a completed check whose answer is "no", so it is a
rejection; only a check that could not run is "unable to verify". `not_found` is listed as an example
`reason_code` alongside `expired` and `suspended` in the schema, which is consistent with that reading.
Both outcomes deny entry, so the fail-closed property is unaffected.

**Fail closed, twice over.** (a) If the authoritative lookup throws, the verdict becomes `indeterminate` →
UNABLE TO VERIFY. (b) If an approval cannot be **written** to `gate_events`, it is downgraded to UNABLE TO
VERIFY, because telling a guard "APPROVED" for an entry that was never recorded would defeat the entire
point of the audit trail. The response reports the truth via `recorded`.

**Duplicate and concurrency handling.** A repeated approval of the same credential, gate and direction
inside `scan.duplicate_window_seconds` (provisional 5 s, read from `settings`) is collapsed onto the row
that already exists and returned as `duplicate: true`. The duplicate check and the insert run inside a
single `db.transaction`, and the partial unique index `ux_gate_events_dedup` remains the database-level
backstop.

**Two supporting changes:**

- `backend\src\data\settings.js` gained `mainGateId()` (resolves `P3-MAIN`, throws if missing) and
  `readIntegerSetting()` (a bad setting value cannot widen the duplicate window).
- `backend\src\lib\time.js`: `toIso()` no longer strips milliseconds. This was a **real bug found by a
  failing test**, not a cosmetic change — see below.

### Bug found and fixed — same-second events ordered arbitrarily

The first test run failed on one assertion: after scanning an entry and then an exit, the person was still
listed as inside. Cause: `toIso()` truncated timestamps to whole seconds, so the entry and the exit were
written with **identical** `occurred_at` **and** `created_at`, and `ORDER BY occurred_at DESC, created_at
DESC` then had nothing left to break the tie. "Who is on site" was therefore non-deterministic for any two
scans in the same second. Fixed by keeping fixed-width milliseconds, which makes string order identical to
chronological order everywhere. Only one place stripped them (`toIso`), and every other comparison in the
codebase already used `Date.parse`, so the change is contained.

### Task 2 — Tests — VERIFIED

New file `backend\tests\gate.test.js` (26 tests) booting the real Express app against a migrated temporary
database. Coverage: anonymous 401s on all three routes; security staff allowed to scan, read and see the
inside list; missing/blank code; unknown direction; an extra `result` field supplied by the client being
refused; approved scan with the event row verified column by column; the gate response proven to carry
identification only (no phone, email or visit details); unknown code; expired; not-yet-valid; suspended
card; terminated card; suspended holder; terminated holder; a credential with an unreadable stored date;
repeated scan collapsing; the opposite direction not collapsing; a 6-way concurrent burst producing exactly
one row; the duplicate window boundary exercised through the real data function; rejected scans never
collapsing into an approval; both forced backend failures (lookup and insert) returning UNABLE TO VERIFY
with no approved row written; history filtering; and the inside list, including an entry from a previous
plant day reported with `missingExit: true`.

| Command | Result |
|---|---|
| `npm test` | **`# tests 92 / # suites 20 / # pass 92 / # fail 0`** (was 66 tests / 14 suites; +26 tests) |
| `npm run migrate` | `discovered: 2 / pending: 0 / 0 applied, 2 already current` (still idempotent) |

### Deliberately deferred (recorded, not silently dropped)

- `POST /api/gate/events` for offline/queued scans → **Phase 9**. Until offline mode exists it serves no
  scenario that `POST /api/gate/verify` does not already cover, and a client-supplied timestamp path would
  widen the attack surface for no benefit.
- `POST /api/gate/events/:id/correction` → **Phase 8**. `gate_events` has no `correction_of` column, so the
  endpoint needs a schema migration plus an admin tool; that belongs with the audit/reporting work.
- The frontend gate screen is not built (it needs the frontend redirected off Supabase first).

### Open items carried forward

1. **Deployment topology** — one laptop, or one server the gate laptops reach over the network? The user
   is confirming with the mentor. Blocks Phase 11.
2. Two `*`-marked rows in `PERMISSION-MATRIX.md` still need ABB confirmation.
3. `scan.duplicate_window_seconds` is provisional (5 s).
4. Whether an approved scan should auto-decide entry vs exit, or the operator states it. Currently the
   operator/kiosk must state `direction`, with no default, because guessing would invent a business rule.
5. "One live credential per kind per person" is enforced in application code, not by a partial unique
   index — changing that alters the approved schema, so it needs approval first.
6. The frontend still talks to Supabase and must be redirected to this backend. There is still **no CORS**
   on the backend.
7. The ID-card / visitor-pass components and their print/PDF output are not adapted yet (Phase 4's
   remaining half).
8. Pre-existing and unchanged: the UTF-16 `take_screenshots.cjs`, 35 npm audit vulnerabilities, and
   `@zxing/library@0.23.0` declaring Node ≥ 24 while we run 22.16.

### Next recommended task

Adapt the frontend to this backend — first the Supabase redirect (CORS + `credentials: "include"`), then the
ID-card / visitor-pass components and the gate screen. The backend now has the API the gate screen needs.
