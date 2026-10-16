# Handover Prompt — ABB Plant 3 ID Verification System

> **How to use this file:** This is a new Trae account/session with no memory of the previous
> conversation. Copy everything below the line into the new session as your first message.
> It is written as instructions *to the agent*.

---

## Your task

You are continuing work on the **ABB Plant 3 Security Gate Verification & ID Management System**.
Work in this workspace:

`c:\Users\ADMIN\Downloads\ABB Security gate\ABB ID verification using supabase\Anuj ABB Id verification system\`

**The project is being built fresh in this folder.** It currently contains only
`project info/` (documents) and `abb-logo.png` — there is **no application code here yet**.
That is expected. Read this whole file before doing anything.

---

## 1. Verified workspace map — do NOT re-guess this

A previous inspection was completed and verified. These facts are established; do not waste time
re-discovering them, and do not trust contradicting statements in older documents.

| Folder | What it truly is | Use it? |
|---|---|---|
| `ABB ID verification using supabase\Anuj ABB Id verification system\` | **THE NEW PROJECT ROOT.** Documents + logo only. No `backend/`, no `frontend/`. | **YES — build here** |
| `ABB ID verification using supabase\Sagar Barcode id verfication Project\barcode-student-verification\` | **The original college application.** A clean Git checkout at commit `b655ebb`, branch `feature/abb-frontend-theme`. Contains the full working UI shell. | **YES — as the read-only source to copy from. Do NOT edit this folder.** |
| `local database\barcode-id-verification\` | A later, **abandoned** attempt: Node + SQLite backend with serious defects (no backend authorization at all, tests that never executed the real code). | **NO — do not use as a base. Reference only to see what NOT to do.** |

**Critical timeline fact:** the Sagar folder and the abandoned project share the *same Git history*.
The Sagar checkout **is** the "existing college system" that the requirements tell us to adapt.
It is not a separate design reference from another project.

---

## 2. Verified technical facts

1. **The UI shell is already correct.** `src/styles.css` and all 45 `src/components/ui/*` shadcn/ui
   components are **byte-identical** between the Sagar checkout and the abandoned project.
   **No CSS porting, no design work, no theme re-invention is required.** Copy them as-is.
2. Stack of the shell: React 19.2, TypeScript 5.8, Vite 7.3, TanStack Start (SSR) + TanStack Router,
   Tailwind CSS v4, shadcn/ui (`new-york`, base colour `slate`, CSS variables), `lucide-react`,
   `react-i18next`. Libraries already present: `@supabase/supabase-js`, `@zxing/browser`,
   `@zxing/library`, `@ericblade/quagga2`, `jsbarcode`, `qrcode`, `jspdf`, `papaparse`, `idb`,
   `recharts`, `zod`, `sonner`.
3. A Supabase integration layer exists intact in the Sagar checkout at `src/integrations/supabase/`
   (`client.ts`, `client.server.ts`, `auth-middleware.ts`, `types.ts`). **It will not be used.** The
   decision is SQLite behind a local backend, so UI code that currently imports the Supabase client must
   be redirected to the new backend API. Do not build new features on these files.
4. **The requirements document is a DOCX, not a PDF**, and its actual location is:
   `..\..\local database\barcode-id-verification\project info\requirement pdf for friend.docx`
   Read it fully. Its name is `requirement pdf for friend.docx`.
5. The `project info\*.md` files this folder already contains (`PRD.md`, `Architecture.md`,
   `rules.md`, `phases.md`, `memory.md`, `tasks.md`) are **generic planning templates and are partly
   wrong** — they claim a `backend/` and `frontend/` exist, and they describe a stack generally.
   Reconcile them against the truth in this file before relying on them.
6. Do **not** trust these legacy values: Git remote `github.com/sagarkale8177/barcode-student-verification`,
   old branch `feature/abb-frontend-theme`, Supabase project id `gxhhvgqujolqpxxmxtto`,
   and the workspace path recorded in the abandoned project's `memory.md`. Treat all as stale.
7. There is **no Git repository** inside the new project root yet. Create a checkpoint before making
   significant changes (see §7, Task 0).

---

## 3. Decisions already made — do not re-open these

| Decision | Rationale |
|---|---|
| **Database = SQLite, accessed only by the backend server** | **Confirmed by the user's mentor/sir**, overriding an earlier Supabase recommendation. The database file lives on the server machine; the browser must **never** open it or hold credentials for it. |
| **Build in the `Anuj ABB Id verification system\` folder** | The user's chosen, clean project root. |
| **Reuse the shell, replace the domain** | Keep the 45 UI components, `styles.css`, scanning, ID printing, PDF/CSV, offline queue, i18n. Replace the college *domain* (`students` table, `admission_number`, programmes, attendance) with the ABB domain. |
| **Do not use MongoDB** | This is a relational problem (people ↔ credentials ↔ gate events ↔ gates) requiring joins, constraints and an append-only audit trail. |
| **Put all DB access behind a thin data-access layer** | So the backend stays replaceable. All SQL lives in one place (e.g. `server/data/personnel.mjs`, `server/data/gateEvents.mjs`); UI code never contains SQL. |
| **Keep the schema as versioned, portable SQL migrations** | Plain SQL with explicit types and constraints, avoiding SQLite-only constructs, so a later move to PostgreSQL/Supabase is a mechanical job rather than a rewrite. |

### Consequence of choosing SQLite — you MUST design around this

SQLite has **no Row Level Security and no built-in authentication**. Unlike Supabase, the database
itself will enforce nothing. Therefore:

- **Every authorization check must be written by you, in the backend**, and applied centrally (in
  middleware / route guards), not hand-written route by route.
- **Every API endpoint that touches personal records or gate logs must be authenticated and
  role-checked.** An unauthenticated endpoint that returns people or logs is a critical defect.
- The abandoned project failed precisely here: its API served all data with no auth at all, and its
  tests passed while never executing the real gate logic. Do not repeat this.
- SQLite allows **one writer at a time** (WAL mode gives concurrent readers). That is acceptable for a
  few gate laptops plus an administrator, but confirm the expected concurrency and never assume it
  scales like a server database.
- There is **no scheduler and no mail service.** Expiry reminders need a scheduler running inside the
  always-on backend process, writing successes *and* failures to a delivery-log table.
- The database file must be **backed up on a defined schedule** (and a restore must be tested) and
  should be **encrypted at rest**, because it holds personal data and photographs on a machine that can
  be stolen.
- **The migration path stays open:** SQLite → PostgreSQL is a moderate, mechanical conversion when the
  schema is plain portable SQL and all access goes through one data-access layer. This decision does not
  lock the project in permanently.

---

## 4. What "reuse the shell, replace the domain" means concretely

**Keep (already built and working in the Sagar checkout):** login/auth screens, sidebar and navigation,
dashboard shell, barcode/QR scanning and manual search UI, ID-card and visitor-pass rendering, PDF and
CSV export, offline IndexedDB cache and sync queue, incidents, announcements, gates, settings, users,
watchlist, notifications, i18n (en/sw).

**Replace entirely:** the college data model and its labels. Rename/re-model
`students` → ABB people; remove `admission_number`, programmes/courses, academic attendance,
college names, logos and campus references ("ATC").

**Also replace:** the Supabase data client. The UI must call the new local backend API instead.

---

## 5. Business requirements — these come from the approved requirements document

Scope: **ABB Plant 3 ONLY.** Exactly **one physical gate**, `"Plant 3 - Main Gate"` — the requirements
document states this twice, in the form `***** there is only one gate in pant 3 *********`.
Do **not** build screens for Plant 1 or Plant 2. Design the schema so more plants can be added later
without a rewrite, but expose only Plant 3 in the UI.

**Three person categories:** contract/temporary workers · internship students · visitors.

**Required fields per the document:**
- *Contract / temporary worker:* full name, worker ID (or auto-generated unique ID), photograph, phone number, contractor company name, work start date, work end date / ID validity date, assigned location ABB Plant 3.
- *Internship student:* full name, auto-generated unique ID, photograph, phone number, college/institution name, internship start date, internship end date, assigned location ABB Plant 3.
- *Visitor:* visitor name, mobile number, purpose of visit, employee/person to meet, employee email (if required), visit date, gate pass validity, photograph (if required).
- Additional fields are optional unless company policy requires them. Keep forms short so security staff can register quickly.

**ID / gate pass generation:** small portrait-format card showing ABB logo, photograph (optional),
name, category (worker/intern/visitor), barcode or QR code, issue date, validity/expiry date.
Provide print and PDF download. Scanner must read it reliably. Administrators may regenerate or
deactivate. Do not print unnecessary sensitive personal information on the card.

**Barcode gate verification — the security core:**
- Support USB/Bluetooth barcode scanners and camera-based QR scanning.
- Flow: operator scans or searches → system looks up the record → checks status, validity period and
  access permission → shows the photograph and details → shows **Entry Approved**, or rejects with a
  clear reason → records result, date, time, gate and operator.
- **Scanning a barcode alone must NEVER be sufficient to approve entry.** The associated record must
  always be validated against current authoritative data.

**Entry/exit tracking:** record entry time and exit time separately; show who is currently inside
Plant 3; show the person's last entry/exit; identify entries with no recorded exit; keep a searchable
history of all gate scans; prevent duplicate or invalid entry/exit events; allow authorized correction
of missed scans with a reason and an audit log; provide daily entry/exit reports. The gate screen must
clearly indicate whether the next action is entry or exit and must never silently create wrong records.

**Expiry and renewal:** every ID/pass has a start date and expiry date. Track upcoming expiries
automatically. Send an email reminder before expiry according to a configurable reminder period, and a
notification when it actually expires, telling the recipient to contact the administrator for an
extension. Show upcoming and expired records on the administrator dashboard. The administrator can
extend validity, suspend, or terminate, and must enter the new expiry date and a reason. Record who
approved the extension and when. Without an approved extension the ID automatically becomes expired and
is rejected at the gate. Keep expired records for historical reporting — never delete them. Changing an
expiry must update the database and the verification rules, not just the printed card. If email delivery
fails, record the failure and show it to the administrator. Use a reliable scheduled process, not
something that only runs when someone opens the app — with SQLite that means a scheduler inside the
always-on backend service, because SQLite provides neither a scheduler nor a mail service.

**Canteen verification:** a separate screen. Scan the barcode/QR, check eligibility, check whether the
person has already used their permitted entry that day, allow the first eligible entry, reject a second
entry the same day with a clear message, save the successful entry's date and time, prevent simultaneous
scans from creating duplicate successful entries, and provide canteen usage reports. Default rule: **one
entry per person per day**, reset by the configured local date.

**Dashboard:** total active workers and interns, total visitors, today's entries and exits, people
currently inside Plant 3, rejected gate verifications, IDs expiring soon, expired IDs and gate passes,
recent incidents, recent gate activity.

**Reports (with CSV and PDF export where applicable, restricted to authorized users):** daily entry and
exit, worker and intern records, visitor records, expired ID reports, canteen usage, incident reports,
rejected verification reports.

**Roles and permissions:**
- *Administrator:* manage workers, interns and visitors; generate and print IDs; extend validity and
  deactivate IDs; manage gates and system settings; view reports and incidents; manage authorized users
  and permissions.
- *Security Staff:* scan and verify IDs; search for people; record entry and exit; view the information
  required for verification; report security incidents; view relevant gate activity. Security staff must
  **not** be able to extend validity, modify sensitive records, or change system settings unless
  specifically authorized.

**Offline scanning:** retain it only if it can be made reliable. Cache only the records needed for gate
verification, show online/offline status clearly, record offline scans with timestamps and
synchronisation status, sync when connectivity returns, detect duplicate and conflicting events, and
define what staff must do when current validity cannot be checked. **Never silently approve access when
authorization cannot be established.**

---

## 6. Open questions — DO NOT INVENT ANSWERS

The user is confirming these with mentors/ABB. If a decision materially affects security, data integrity
or architecture and is unresolved here, **stop and ask** rather than choosing for them:

1. Mandatory fields per person category (the document lists them, but confirm nothing extra is required).
2. Who may issue, approve, renew, suspend and revoke credentials (exact permission matrix).
3. The exact expiry boundary — does the end date mean end of that calendar day or an exact time?
4. Expiry reminder schedule, recipient address source, and email wording.
5. Duplicate-scan detection window and behaviour for rapid repeated scans.
6. Whether an approved scan automatically records entry/exit or the operator chooses the direction.
7. Offline verification policy: is it permitted, and what data-freshness limit applies?
8. Canteen limit (per calendar day vs per meal) and whether exceptions are allowed.
9. Approved ABB branding assets; final card dimensions and layout; approval process for ID issuance.
10. Data retention, privacy and deletion rules; data residency.
11. **Deployment topology:** does the SQLite file live on a single gate laptop, or on a central machine
    that gate laptops reach over the plant network? How many machines will use the app at once?
12. Backup schedule and location, and whether encryption at rest is required.
13. Who administers the server machine, and the approved process for installing and updating the app.
14. Whether email reminders can use an ABB SMTP server, and who owns those credentials.

---

## 7. Required first tasks, in order

**Task 0 — Safety checkpoint.** Initialise a Git repository in the new project root and commit the
documents as the starting checkpoint *before* adding code. Never commit `.env`, keys or secrets.

**Task 1 — Seed the baseline shell (needs explicit user approval first, because it copies a codebase).**
Copy the Sagar checkout's application code (at commit `b655ebb`) into `Anuj ABB Id verification system\`,
**excluding** `.git`, `node_modules`, `dist`, `.env*` and the college-only documents
(`SRS_Barcode_Student_Verification_System.docx`, `ATC_Barcode_System_Data_Analysis.xlsx`,
`PostgreSQL_vs_MySQL_Justification.pdf`). Do **not** copy anything from `local database\`.
Confirm the app installs and starts. The Supabase integration files will be present but are **not** part
of the new architecture — they are to be removed or replaced once the local API exists.

**Task 2 — Establish the baseline.** Run install, `npm run build`, `npm run lint` and record the actual
results before changing anything. Record pre-existing failures so they are not mistaken for new ones.

**Task 3 — Move the requirements document** into `project info\` in the new project and keep the
`project info\*.md` documents reconciled with the verified facts in this file.

**Task 4 — Design the ABB Plant 3 schema** (tables, constraints, indexes, foreign keys) as versioned
portable SQL migrations, **plus the authorization design**: a written permission matrix mapping every
role to every action, and the list of backend endpoints each role may call. Present both for approval
**before** touching a real database. There are **no RLS policies to write** — with SQLite the enforcement
is your backend code.

**Task 5 — Backend foundation, before any feature work:** the API server, authentication (password
hashing + sessions), centralized role-based authorization middleware, request validation, one consistent
error response shape, and the audit-log writer. Every later feature depends on this, and skipping it is
what produced the abandoned project's security holes.

**Task 6 — Data-access layer**, then Person/Credential management, then Gate verification, then
Entry/Exit, then Expiry/Renewal, then Canteen, then Dashboard/Reports — one task at a time, per the
existing `phases.md`.

---

## 8. Non-negotiable working rules

1. **Inspect before editing.** Read the actual code; never assume a feature exists because a document
   says so.
2. **One task at a time.** For each task state: what you will change, the exact files, the risks and
   dependencies, then implement, test, and report the real results.
3. **Preserve working features.** Do not delete a feature without explaining its purpose and impact.
4. **Do not modify the Sagar reference folder.**
5. **Do not start over** just because a session or account changed. Continue from the current state.
6. **Never claim something works unless you verified it.** Report the exact command and result.
7. **Ask before:** destructive operations, database migrations, major architecture changes, deployments,
   or copying/overwriting substantial code.
8. **Update the tracking documents after every task:** `tasks.md`, `WORKLOG.md`, `NEXT-SESSION.md`
   (create `WORKLOG.md` and `NEXT-SESSION.md` in the new project when the code is seeded; preserve any
   existing useful content rather than overwriting it).
9. Never report success when an operation actually failed. If verification cannot be completed because
   of a technical failure, show an **unable to verify** result — never a silent approval.

---

## 9. Security requirements (this is an industrial production system)

1. **Enforce authorization in the backend — there is no RLS.** SQLite enforces nothing. Implement
   centralized role checks in the API and **test them with negative tests** (a security-staff account
   calling an admin endpoint must be *denied*, and that must be asserted). Hiding a button is not a
   security control.
2. **Never expose secrets to the frontend.** The browser talks only to the backend API. It must never
   receive a path to the SQLite file, a database password, an SMTP password, or any API key. Keep all
   secrets in server-side environment variables, outside source control.
3. **Fail closed.** A network error, missing record, stale offline data, or server failure must produce
   **UNABLE TO VERIFY**, never APPROVED.
4. Validate all important input on the server as well as in the form.
5. Protect personal records, photographs and gate logs: keep photo files outside the web root, serve them
   only through authenticated and permission-checked endpoints, and let no role read more than it needs.
6. **Prevent duplicate scans and concurrent requests from creating duplicate events or duplicate canteen
   uses.** Enforce this with database constraints (unique indexes) and transactions, not only in the
   client, and enable WAL mode deliberately.
7. Log important administrative changes and gate verification events. Keep **business audit history
   separate from diagnostic logs**. Never log passwords, tokens, keys or unnecessary personal data.
8. Make `access_logs` **append-only**. Corrections must record actor, timestamp and reason.
9. Show users clear, friendly messages — never stack traces, database internals or secret values.
10. Keep `.env` files and credentials out of source control.
11. **Protect the database file itself:** filesystem permissions limited to the service account,
    scheduled backups with a tested restore, and encryption at rest if the machine could be stolen, since
    it contains personal data and photographs.

**Lesson to carry forward:** the abandoned project's test suite passed 18/18 while the real gate logic
was never executed, and its API had no authorization at all. Tests must exercise the **real**
implementation, and "verified" must mean actually verified.

---

## 10. Reference — exact paths

| What | Path |
|---|---|
| New project root | `c:\Users\ADMIN\Downloads\ABB Security gate\ABB ID verification using supabase\Anuj ABB Id verification system\` |
| Approved requirements (DOCX) | `..\..\local database\barcode-id-verification\project info\requirement pdf for friend.docx` |
| Reusable shell (read-only) | `..\Sagar Barcode id verfication Project\barcode-student-verification\` (commit `b655ebb`) |
| Do not use as a base | `..\..\local database\barcode-id-verification\` |
| ABB logo already provided | `Anuj ABB Id verification system\abb-logo.png` |

**Your first action:** read the requirements DOCX and the existing `project info\*.md` files, then
present a short confirmation of this plan and ask for approval to begin Task 0.
