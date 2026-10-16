# NEXT-SESSION.md — resume from here

> Read this first, then `WORKLOG.md` (latest entry) and `project info\HANDOVER-PROMPT.md`.
> Update this file at the end of every session.

---

## Current state (2026-10-16)

**Project root:** `c:\Users\ADMIN\Downloads\ABB Security gate\ABB ID verification using supabase\Anuj ABB Id verification system\`

**Folder layout:** the frontend shell (TanStack Start) is in the project root (`src\`, `public\`, configs).
The backend API is in `backend\`. There is **no** `frontend\` folder — the earlier note about empty junk
`backend\` / `frontend\` folders is obsolete.

**Phase status**

| Phase | Status |
|---|---|
| Phase 0 — Inspection & recovery | **COMPLETE** |
| Phase 1 — Baseline, seeding & safety | **COMPLETE** (Git init deferred by user to project completion) |
| Phase 2 — Schema + permission matrix | **COMPLETE** — approved by the user |
| Phase 3 — Backend foundation | **COMPLETE** — 66 tests pass, migrations idempotent |
| Phase 4 — People & credential management | **Backend COMPLETE**; ID-card / visitor-pass frontend NOT started |
| Phase 5 — Gate verification & event tracking | **Backend COMPLETE** (92 tests pass); gate screen NOT started |
| Phases 6–12 | Not started |

**What exists now:** the shell (verified: installs, builds, lints with 135 pre-existing problems) plus a
working backend in `backend\`:

- `migrations\0001_init.sql` (14 tables, 19 indexes, portable SQL) and `0002_seed_plant3.sql`.
- Express 5 API with scrypt password hashing, server-side sessions (only the token hash is stored),
  a login rate limiter, central default-deny authorization, zod validation, one error shape, an audit-log
  writer and a redacting diagnostic logger.
- Endpoints: `GET /api/health` (public), `POST /api/auth/login` (public), `POST /api/auth/logout`,
  `GET /api/auth/me`, `GET|POST /api/users`, `GET|PUT /api/settings`, and the Phase 4 people/credential
  set — `GET /api/people/search`, `GET|POST /api/people`, `GET|PATCH /api/people/:id`,
  `POST /api/people/:id/status`, `GET /api/people/:id/credentials`, `POST /api/credentials`,
  `POST /api/credentials/:id/validity`, `POST /api/credentials/:id/status`, and the Phase 5 gate
  set — `POST /api/gate/verify`, `GET /api/gate/events`, `GET /api/inside`.
- Exactly **two** public routes, asserted at boot; the process refuses to start if that set widens.
- `src\domain\credential-validity.js` — the pure, fail-closed decision rule, plus `gateResultFor()` which
  maps a verdict onto APPROVED / REJECTED / UNABLE TO VERIFY. It is the only place a verdict becomes an
  outcome.
- `src\data\gate-events.js` — append-only `gate_events` access (no UPDATE, no DELETE). `listInsidePeople`
  uses `ROW_NUMBER()` for PostgreSQL portability.

No Git repository exists. No production data exists; the only database file is the development one at
`backend\data\abb-plant3.db`. No user has been created in it yet — run `npm run bootstrap-admin` when
needed.

**Verified commands (see WORKLOG for details):**
- `backend`: `npm run migrate` → `discovered: 2 / pending: 0 / 0 applied, 2 already current` (idempotent)
- `backend`: `npm test` → `# tests 92 / # suites 20 / # pass 92 / # fail 0`
- root: `npm install` → exit 0 (588 packages); `npm run build` → ✓ built in 1m 31s (process exit 1 only
  from a sandbox block on wrangler's log file); `npm run lint` → FAIL 135 problems, all pre-existing

---

## Locked decisions (do not re-open)

1. Database = **SQLite**, accessed only by the backend. No RLS — **all** authorization is backend code.
2. Build in the project root `Anuj ABB Id verification system\`; backend code in `backend\`.
3. Reuse the shell; replace the college domain with the ABB domain. Keep the ABB red/white UI.
4. **Backend code lives in `backend\`, not `server\`** (the user created the `backend\` / `frontend\`
   split themselves). All SQL lives behind a data-access layer in `backend\src\data\`.
5. Schema = versioned **portable** SQL migrations (no SQLite-only constructs), so PostgreSQL stays possible.
6. Scope = **ABB Plant 3 only**, exactly **one** gate (`"Plant 3 - Main Gate"`).
7. **Canteen = separate app with its own DB**, but it **must not** keep a copy of people/credentials —
   it verifies eligibility against the main backend and **fails closed** (UNABLE TO VERIFY ≠ approved).
8. Canteen screen shows a **minimal** view first (photo, name, category, eligibility, today's canteen
   in-time) with the full profile **expandable**. "in-time" here means **canteen entry time**. One entry
   per person per local day.
9. **Git init is deferred** to project completion (user request).
10. UI stays the existing professional shadcn/ABB theme; new screens match it.
11. **Credentials are never deleted.** Expired, suspended and terminated passes stay on record; every
    lifecycle action writes `audit_log` with actor, before/after values and a reason.
12. **`valid_to` is inclusive** — a credential is valid **through** the end of that calendar day.
13. **Fail closed everywhere.** Missing record, unreadable date, unknown status, network error or stale
    offline data yields UNABLE TO VERIFY, never APPROVED. Implemented in
    `backend\src\domain\credential-validity.js`.

---

## Open questions (do NOT invent answers — ask the user)

1. Mandatory vs optional fields beyond the per-category minimum already enforced (phone, contractor
   company, email).
2. Exact permission matrix — two rows in `PERMISSION-MATRIX.md` are still marked `*` (security-staff read
   scope for incidents, reports and settings).
3. ~~Expiry boundary~~ — **answered:** end of the calendar day, `valid_to` inclusive.
4. Reminder schedule, recipient address source, email wording.
5. Duplicate-scan detection window/behaviour (`scan.duplicate_window_seconds` = 5 s is provisional).
6. Whether an approved scan auto-records entry/exit or the operator chooses direction.
7. Offline verification policy: permitted? what freshness limit?
8. ~~Canteen limit~~ — **answered:** once per person per local day.
9. Approved ABB branding assets; card dimensions; ID issuance approval process.
10. Data retention/privacy/deletion rules; data residency.
11. **Deployment topology:** SQLite on one gate laptop, or a central machine gate laptops reach over the
    network? How many concurrent machines? Still open — the user is asking the mentor. Blocks Phase 11.
12. Backup schedule/location; encryption at rest required?
13. Who administers the server machine; install/update process.
14. Can reminders use an ABB SMTP server; who owns the credentials?
15. Whether to add a `ux_credentials_one_active_per_kind` partial unique index so "one live credential per
    kind per person" is database-enforced instead of application-enforced.

---

## Next task — finish Phase 4 (frontend), then the gate screen

**Phase 5 (backend) is done.** `POST /api/gate/verify` returns APPROVED / REJECTED (with a reason) /
UNABLE TO VERIFY; every scan — including rejected ones — writes an append-only `gate_events` row; a
duplicate tap inside `scan.duplicate_window_seconds` collapses onto the existing row; a 6-way concurrent
burst produces exactly one row (partial unique index `ux_gate_events_dedup`); and a failure anywhere in the
lookup or the write returns / downgrades to UNABLE TO VERIFY. Nothing can reach APPROVED without a
successful authoritative check **and** a written event row. Covered by 26 new tests.

**Phase 6's expiry half is already enforced** at every verification by Phase 5. What remains in Phase 6 is
the reminder schedule, which is unanswered (open question 4). **Do not start the Phase 6 scheduler yet.**

**Next task — redirect the frontend off Supabase, then finish Phase 4's frontend half.** The frontend still
cannot talk to the backend: there is no CORS and the session cookie is HttpOnly + `SameSite=Strict`, so
browser calls need `credentials: "include"`. Order:

1. Decide the browser session/cookie + CSRF flow (blocked on knowing the deployment origin — open
   question 11; a dev-only permissive CORS is acceptable to unblock meanwhile).
2. Redirect `src\integrations\supabase\*` and `src\lib\auth-context.tsx` to the local backend.
3. Adapt the ID-card and visitor-pass components (`src\lib\idcard.ts`, `src\routes\_authenticated\students.*`,
   `visitors.tsx`) to the ABB credential model and the `/api/people` / `/api/credentials` endpoints; verify
   print and PDF output. This finishes Phase 4.
4. Build the gate screen against `POST /api/gate/verify` / `GET /api/gate/events` / `GET /api/inside`.

Do not start Phase 6+ before the deployment topology (open question 11) is answered.

---

## Deliberately not built in Phase 5 (recorded, not silently dropped)

- `POST /api/gate/events` (offline/queued scans) → **Phase 9**. No scenario it serves until offline mode
  exists, and a client-supplied timestamp would widen the attack surface for nothing.
- `POST /api/gate/events/:id/correction` → **Phase 8**. `gate_events` has no `correction_of` column, so this
  needs a schema migration plus an administrator tool.

---

## Loose ends to resolve

- **The frontend cannot call the backend yet** — and this is now the blocking item for the next task. Two
  gaps, both needed before any screen works against the API: (a) no CORS configuration on the backend, and
  the dev frontend runs on a different origin (`localhost:8080` vs `localhost:4000`); (b) the session cookie
  is `HttpOnly` + `SameSite=Strict` (`backend\src\routes\auth.routes.js`), so browser calls need
  `credentials: "include"`. Decide whether a CSRF token is also required once the actual deployment origin
  is known.
- **The gate screen does not exist yet.** The endpoints are live and tested, but there is no UI that calls
  `POST /api/gate/verify`.
- Supabase files (`src/integrations/supabase/*`, `src/lib/auth-context.tsx`) must be redirected to the local
  backend — this is part of the same work.
- `take_screenshots.cjs` is UTF-16 and breaks `npm run format` / adds a lint parse error — decide whether to
  convert to UTF-8, ignore, or delete (it is a dev-only script).
- `users.routes.js` and `settings.routes.js` still build SQL inline, while the Phase 4/5 routes go through
  `src\data\`. Move them onto the data layer when either is next touched.
- "One live credential per kind per person" is application-enforced only (see open question 15).
- `scan.duplicate_window_seconds` = 5 s is provisional (open question 5); it is read through
  `readIntegerSetting`, so changing the seeded value is enough — no code change.
- **Entry/exit direction must be stated by the caller** — `POST /api/gate/verify` requires `direction` and
  deliberately has no default, because guessing would invent a business rule (open question 6).
- `35 npm audit vulnerabilities` — review before deployment.
- `@zxing/library@0.23.0` wants Node ≥ 24 (we have 22.16) — confirm this is acceptable or pin/upgrade.
