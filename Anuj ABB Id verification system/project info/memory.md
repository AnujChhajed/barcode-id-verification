# memory.md — Persistent Project Context

**Last verified:** 2026-10-16
**Read this file first.** It contains the established facts, locked decisions, and safe working
instructions. Do not contradict it based on older notes.

---

## 1. Project identity

- **Project:** ABB ID Verification and Gate Security System — Plant 3.
- **Purpose:** Build a secure ID issuance and gate verification system for ABB Plant 3.
- **Scope:** Plant 3 only. Do not build Plant 1 or Plant 2 screens. Design the data model so more
  plants can be added later, but expose only Plant 3 in the UI.
- **Approach:** Reuse the existing application shell (UI, scanning, ID printing, PDF/CSV, offline
  queue, i18n) and build a new ABB domain, backend and database on top of it. Do not rebuild the
  interface, and do not reuse the abandoned backend.

---

## 2. Verified workspace facts

These were established by direct inspection on 2026-10-16. Treat them as fact.

| Folder | What it actually is | Use |
|---|---|---|
| `Anuj ABB Id verification system\` | **The new project root.** Contains only `project info\` and `abb-logo.png`. **No application code, no `backend\`, no `frontend\`.** | Build here |
| `Sagar Barcode id verfication Project\barcode-student-verification\` | **The original college application.** A Git checkout at commit `b655ebb`, branch `feature/abb-frontend-theme`. Contains the complete, working UI shell. | Read-only source to copy from. **Do not modify.** |
| `local database\barcode-id-verification\` | A later, **abandoned** attempt. Replacement Node + SQLite backend with no authorization on its API, and a test suite that never executed the real logic. | **Do not use as a base.** |

- The Sagar checkout and the abandoned project **share the same Git history**. The Sagar checkout *is*
  the "existing college system" the requirements refer to. It is not a separate reference project.
- **The UI is already correct.** `src/styles.css` and all 45 `src/components/ui/*` shadcn/ui components
  are byte-identical between the two. No CSS porting or design work is required.
- **The requirements document is a DOCX, not a PDF:** `local database\barcode-id-verification\project info\requirement pdf for friend.docx`.
- Older documents claimed a `backend/` and `frontend/` exist in the Anuj folder. **They do not.** Those
  claims were wrong and are corrected in this file.

### Stale values — do not trust

Git remote `github.com/sagarkale8177/barcode-student-verification`; branch `feature/abb-frontend-theme`;
Supabase project id `gxhhvgqujolqpxxmxtto`; any workspace path recorded in the abandoned project's
`memory.md`; any claim that Supabase is the current runtime dependency of the new project.

---

## 3. Locked decisions

| Decision | Reason |
|---|---|
| **Database = SQLite, server-side only** | Confirmed by the user's mentor/sir. This **deliberately overrides the requirements document §14**, which says to retain Supabase — see `rules.md` §18. The earlier Supabase recommendation was withdrawn. |
| **Build in `Anuj ABB Id verification system\`** | The user's chosen clean root. |
| **Reuse the shell, replace the domain** | Keeps the working UI. Replaces the college data model. |
| **No MongoDB** | This is a relational problem with joins, constraints and an append-only audit trail. |
| **Supabase is not used at runtime** | Its integration files exist in the shell but are to be removed once the local API exists. |
| **All SQL behind one data-access layer** | Keeps the backend replaceable. |
| **Schema as versioned, portable SQL migrations** | Plain SQL, explicit types, no SQLite-only constructs, so a later move to PostgreSQL is mechanical. |

### The consequence that must never be forgotten

**SQLite has no Row Level Security and no built-in authentication.** The database enforces nothing.
Every authorization decision must be implemented and tested in the backend. An endpoint that returns
people or gate logs without an authentication and role check is a critical defect. This was precisely
the abandoned project's failure: its API served all data with no auth, and its tests passed anyway.

---

## 4. Technology stack

**Inherited from the shell (keep):** React 19.2, TypeScript 5.8, Vite 7.3, TanStack Start + TanStack
Router + TanStack Query, Tailwind CSS v4, shadcn/ui (`new-york`, base colour `slate`, CSS variables),
`lucide-react`, `react-i18next`, `@zxing/browser`, `@zxing/library`, `@ericblade/quagga2`, `jsbarcode`,
`qrcode`, `jspdf`, `papaparse`, `idb`, `recharts`, `zod`, `sonner`.

**To be built:** the backend API service, SQLite database and migrations, authentication and sessions,
role-based authorization middleware, server-side validation, the audit-log writer, photo storage
handling, and the expiry-reminder scheduler with SMTP delivery.

**To be removed:** `@supabase/supabase-js` and `src/integrations/supabase/`, once every caller has been
redirected to the local API. Do not remove them before the replacements exist and work.

The college `README` listed these tables: `students`, `access_logs`, `gates`, `settings`, `incidents`,
`announcements`, `watchlist`, `notifications`. That listing is unverified and the model is college-shaped;
the ABB schema is to be designed fresh (see `Architecture.md` §5).

---

## 5. Users and key concepts

- Contract and temporary workers
- Internship students
- Visitors

The system does not replace ABB's HR system for permanent employees.

**A barcode or QR code is a lookup key, not authorization.** Possession of a code must never be treated
as permission to enter. Every scan is resolved against current authoritative data and the applicable
rules before an outcome is shown.

---

## 6. Security principles

- Unknown, expired, revoked, suspended or ineligible credentials must never be approved.
- If authorization cannot be reliably established (network failure, missing record, stale offline data,
  server error), show **UNABLE TO VERIFY**. A technical failure must never become APPROVED.
- Enforce permissions in the backend. Hiding a button is not authorization.
- Never expose secrets to the frontend: no database path, database password, SMTP password or API key in
  browser code, `VITE_*` variables, logs or the repository.
- Do not encode personal information in the barcode/QR payload; use an opaque identifier.
- Validity is enforced at verification time, independently of email reminders.
- Duplicate prevention and canteen limits are enforced by database constraints and transactions, not by
  client checks.
- Keep business audit history separate from diagnostic logs. Never log passwords, tokens or keys.
- Back up the database file on a schedule, test a restore, and protect it at rest.

---

## 7. Open questions — do not invent answers

Required fields per category and who may create/update each record; the exact permission matrix; the
expiry boundary (end of day vs exact time); reminder schedule and recipient source; duplicate-scan
window and behaviour; whether a scan records entry/exit automatically or the operator chooses;
offline verification policy and freshness limit; canteen limit and exceptions; branding assets, card
layout and issuance approval; retention and privacy rules; **deployment topology — does the SQLite file
live on one gate laptop or on a central machine that gate laptops reach over the network, and how many
machines use the app at once**; backup and encryption requirements; who administers the server machine;
whether an ABB SMTP server and credentials are available.

Never treat an open question as a settled business rule. Ask when the decision affects safety,
security, privacy or architecture.

---

## 8. Required AI working behaviour

**At the start of every session:**
1. Read this file, then `tasks.md`, `NEXT-SESSION.md` and the latest `WORKLOG.md`.
2. Inspect the workspace and current Git status; check for unfinished work.
3. Summarise the verified state, the unknowns, and the single next task.
4. Do not restart the project because the session or account changed.

**While implementing:**
- Inspect the actual code before editing. Never assume a feature exists because a document says so.
- One task at a time: state the change, the exact files, the risks, then implement, test, and report the
  real result.
- Preserve working features, existing data and uncommitted work.
- Do not modify the Sagar reference folder. Do not copy anything from `local database\`.
- Do not delete files, reset repositories, run destructive commands, apply migrations, modify production
  data, or deploy without explicit approval.
- Run the relevant checks after a change and report exactly what ran. **Never claim a test passed or a
  feature works unless it was actually verified.**
- Never report success when the operation failed; fail closed and say so.

---

## 9. Documentation set

| File | Role |
|---|---|
| `PRD.md` | What the system must do |
| `Architecture.md` | How it is structured and built |
| `rules.md` | Business and security rules, confirmed vs pending |
| `phases.md` | Staged development plan |
| `memory.md` | This file — verified facts, decisions, working protocol |
| `tasks.md` | Actionable checklist and current progress |
| `WORKLOG.md` | Created when code is seeded — changes, commands, results |
| `NEXT-SESSION.md` | Created when code is seeded — the exact next step |

At the end of each session, update `tasks.md`, `WORKLOG.md` and `NEXT-SESSION.md`. Preserve existing
useful content; do not overwrite notes blindly.

---

## 10. Progress-status rule

Do not claim any feature, database or security control is complete based on these documents alone.
Verify against the repository and test evidence, and mark a task complete only when its acceptance
criteria have been checked and recorded.

**Most important rule:** inspect first, preserve existing work, verify before claiming, and ask before
destructive or high-impact actions.
