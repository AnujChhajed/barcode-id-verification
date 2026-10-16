# ABB Plant 3 — Gate Verification & Credential Management System

Industrial gate access control and ID verification platform for **ABB Plant 3**.

Engineered as a **100% self-hosted, independent, and portable** system designed to run locally on company hardware (e.g., security gate laptop or plant server) without dependencies on developer accounts, external cloud services, or hosted databases.

---

## 1. System Architecture & Independence

- **Frontend:** React 19, TypeScript, TanStack Router, TanStack Query, Vanilla CSS & Tailwind v4, Radix UI.
- **Backend API:** Node.js (>= 22), Express 5, connection pool (`pg`), scrypt password hashing (RFC 7914), secure cookie sessions.
- **Database:** Local PostgreSQL 18 server (`abb_gate_verification`).
- **Data Access:** Strict backend-only connection via `DATABASE_URL` in `backend/.env`. No database credentials or connection strings are ever exposed in frontend bundles or `VITE_*` variables.
- **Zero Cloud Dependencies:** All operations (authentication, gate event recording, photo viewing, reporting, personnel and contractor management) run on local infrastructure. No Neon, Supabase, or external database hosting is required.

---

## 2. Prerequisites for Company Laptop

Before running the system on a new Windows laptop, ensure the following are installed:

| Component | Minimum Version | Download / Install Command |
|---|---|---|
| **Operating System** | Windows 10 / 11 (64-bit) | Standard Windows install |
| **Node.js** | Node.js 22 LTS or 24 | [https://nodejs.org](https://nodejs.org) or `winget install OpenJS.NodeJS.LTS` |
| **PostgreSQL** | PostgreSQL 16, 17, or 18 | [https://www.postgresql.org/download/windows/](https://www.postgresql.org/download/windows/) or `winget install PostgreSQL.PostgreSQL.18` |
| **Shell** | Windows PowerShell 5.1+ | Built into Windows |

Verify installation in PowerShell:
```powershell
node --version
npm --version
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" --version
```

---

## 3. Quick Start (Automated PowerShell Setup)

For a fully automated deployment on the company laptop:

### Step 1: Open PowerShell as Administrator
Navigate to the project folder:
```powershell
cd "C:\path\to\Anuj ABB Id verification system"
```

### Step 2: Run Database Setup Script
```powershell
.\scripts\setup-db.ps1
```

The script will:
1. Detect your local PostgreSQL binaries and service.
2. Prompt for your local PostgreSQL superuser password securely (hidden from screen, never saved).
3. Check whether database `abb_gate_verification` already exists (it will **never** drop or overwrite existing databases).
4. Create the `abb_gate_verification` database with UTF-8 encoding if missing.
5. Create a dedicated application role `abb_app` with least-privilege permissions (or configure standard access).
6. Update `backend/.env` automatically with the local `DATABASE_URL`.
7. Execute versioned SQL migrations (`0001_init.sql` and `0002_seed_plant3.sql`) inside safe transactions.
8. Verify that all 10 schema tables and views are active.
9. Launch the interactive administrator bootstrap prompt.

### Step 3: Launch the Application
```powershell
.\scripts\start-all.ps1
```
This script launches the Express backend on port `4000`, the frontend on port `5173`, and opens the browser.

---

## 4. Manual Setup & Deployment Instructions

If you prefer to configure PostgreSQL manually using standard PostgreSQL commands:

### 1. Create the Database
In PowerShell:
```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -h localhost -c "CREATE DATABASE abb_gate_verification WITH ENCODING 'UTF8';"
```

### 2. Create the Application Role
```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -h localhost -d abb_gate_verification -c @"
CREATE ROLE abb_app WITH LOGIN PASSWORD 'ChooseAStrongAppPassword';
GRANT CONNECT ON DATABASE abb_gate_verification TO abb_app;
GRANT USAGE, CREATE ON SCHEMA public TO abb_app;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO abb_app;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO abb_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO abb_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO abb_app;
"@
```

### 3. Configure Backend Environment
Copy the example environment file:
```powershell
Copy-Item "backend\.env.example" "backend\.env"
```
Edit `backend/.env` and set:
```ini
PORT=4000
HOST=127.0.0.1
NODE_ENV=production
DATABASE_URL=postgresql://abb_app:ChooseAStrongAppPassword@localhost:5432/abb_gate_verification
CORS_ORIGINS=http://localhost:5173,http://localhost:8080
SESSION_COOKIE_NAME=abb_session
SESSION_TIMEOUT_MINUTES=30
SESSION_COOKIE_SECURE=false
LOGIN_RATE_WINDOW_MS=900000
LOGIN_RATE_MAX=5
```

### 4. Install Dependencies
```powershell
# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ..
npm install
```

### 5. Run Migrations
From the `backend` directory:
```powershell
npm run migrate
```

---

## 5. First Administrator Account Creation

To ensure the company owner maintains independent and secure administrative ownership, no hardcoded administrator accounts or public default credentials exist in the database seeds.

Run the secure administrator bootstrap CLI:
```powershell
cd backend
npm run bootstrap-admin
```

Follow the interactive prompts:
```
--- Create Plant 3 Administrator Account ---
Username: owner.admin
Full Name: Plant 3 Director
Email (optional): owner@plant3.abb.com
Password (min 12 chars): ************
Confirm Password: ************
```
The password is salted and hashed using **scrypt (RFC 7914)** before saving to the `users` table.

---

## 6. Daily Operation: Starting and Stopping

### Starting Both Services:
```powershell
.\scripts\start-all.ps1
```

### Starting Manually:
- **Backend (Port 4000):**
  ```powershell
  cd backend
  npm start
  ```
- **Frontend (Port 5173):**
  ```powershell
  npm run dev
  ```
Access the application at [http://localhost:5173](http://localhost:5173).

---

## 7. Database Backup and Disaster Recovery

### Automated Backup Script
```powershell
.\scripts\backup-db.ps1
```
Creates a compressed, timestamped custom-format PostgreSQL dump file in `backups/`:
`backups/abb_gate_verification_YYYYMMDD_HHMMSS.dump`

### Automated Restore Script
```powershell
.\scripts\restore-db.ps1
```
Lists available backup dumps in `backups/`, prompts for confirmation, and restores the database using `pg_restore --clean`.

### Manual Backup (via pg_dump)
```powershell
& "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe" -U abb_app -h localhost -p 5432 -F c -b -v -f "backups/abb_backup.dump" abb_gate_verification
```

### Manual Restore (via pg_restore)
```powershell
& "C:\Program Files\PostgreSQL\18\bin\pg_restore.exe" -U postgres -h localhost -p 5432 -d abb_gate_verification -v --clean "backups/abb_backup.dump"
```

---

## 8. Database Schema Overview

The database consists of 8 core business tables and 2 operational support tables:

1. **`users`**: Administrative and security staff operator accounts with scrypt password hashes and role-based access.
2. **`contractors`**: Registered third-party vendor and contractor companies operating inside Plant 3.
3. **`persons`**: Authoritative directory of workers, interns, and visitors.
4. **`id_cards`**: Physical credentials, barcodes, and QR codes linked to personnel.
5. **`visits`**: Walk-in visitor passes and pre-approved appointments.
6. **`gate_logs`**: Append-only event history of every entry/exit scan at Plant 3 gates.
7. **`canteen_logs`**: Append-only records of meal entries, strictly enforcing 1 meal per person per day.
8. **`audit_logs`**: Comprehensive administrative audit trail for security compliance.
9. **`sessions`**: Server-side session tokens with cryptographically secure SHA-256 hashes.
10. **`settings`**: Runtime operational parameters (e.g. anti-passback window, duplicate scan threshold).

---

## 9. Troubleshooting & FAQ

### Issue: "connection to server at localhost:5432 failed"
- Verify the PostgreSQL Windows service is running:
  ```powershell
  Get-Service -Name postgresql*
  Start-Service postgresql-x64-18
  ```
- Test with `pg_isready`:
  ```powershell
  & "C:\Program Files\PostgreSQL\18\bin\pg_isready.exe" -h localhost -p 5432
  ```

### Issue: "fe_sendauth: no password supplied"
- Verify the password in `backend/.env` under `DATABASE_URL`. Ensure special characters in passwords are URL-encoded if applicable.

### Issue: "Port 4000 or 5173 is already in use"
- Check which process is using the port:
  ```powershell
  Get-NetTCPConnection -LocalPort 4000
  ```

---

## 10. Handover Checklist & Verification

- [x] Local PostgreSQL database configured (`abb_gate_verification`).
- [x] Backend-only `DATABASE_URL` connection in `backend/.env`.
- [x] No personal passwords or hardcoded secrets in source files.
- [x] Zero external cloud dependencies (Supabase, Neon, personal cloud hosts removed).
- [x] Repeatable Windows setup script provided (`scripts/setup-db.ps1`).
- [x] Automated backup and disaster recovery scripts provided (`backup-db.ps1`, `restore-db.ps1`).
- [x] Secure first-administrator creation via `npm run bootstrap-admin`.
- [x] Append-only audit integrity for gate scans, canteen meals, and admin modifications.
- [x] Fail-closed security architecture for all access verification requests.
