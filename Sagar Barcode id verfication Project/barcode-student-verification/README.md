# 🎓 Barcode Gate Verification System

A real-time campus gate access control system built for colleges and institutions. Gate operators scan student ID barcodes to grant or deny entry, while administrators manage students, visitors, incidents, reports, and system settings — all from a single web interface.

**Supports English and Swahili (EN / SW).**

---

## ✨ Features

| Area | What it does |
|---|---|
| **Gate Scan** | USB/Bluetooth barcode scanner, camera QR scan, or manual lookup — real-time allow/deny with photo display |
| **Dashboard** | Live stats, hourly & weekly charts, denial surge alerts, live feed of recent scans |
| **Students** | Add, edit, suspend, import via CSV, bulk photo upload, download ID cards (PDF) |
| **Visitors** | Issue time-limited visitor passes with CODE128 barcode, print or download PDF |
| **Inside Now** | Live view of who is currently on campus |
| **Reports** | Daily attendance, absentees, late arrivals — export CSV or PDF |
| **Incidents** | Report and manage security incidents with severity levels |
| **Announcements** | Post notices for gate operators to acknowledge before their shift |
| **Gates** | Register physical gates so every scan is tagged by location |
| **Settings** | Access hours, anti-passback, session timeout, denial surge threshold |
| **Offline mode** | Caches students locally so scanning works without internet |
| **i18n** | Full English and Swahili translations |

---

## 🛠️ Tech Stack

- **Frontend** — React 19, TanStack Router, TanStack Query
- **Styling** — Tailwind CSS v4, shadcn/ui (Radix UI)
- **Backend / Database** — [Supabase](https://supabase.com) (Postgres + Auth + Realtime + Storage)
- **Build tool** — Vite 7
- **PDF generation** — jsPDF + JsBarcode
- **Barcode scanning** — Quagga2 (camera), Web HID API (USB/BT scanner detection)
- **Language** — TypeScript

---

## ⚙️ Prerequisites

Make sure you have these installed before you begin:

| Tool | Minimum version | Download |
|---|---|---|
| **Node.js** | 18 or newer (20+ recommended) | https://nodejs.org |
| **npm** | 9 or newer (comes with Node) | — |
| **Git** | any recent version | https://git-scm.com |

Check your versions:
```bash
node --version
npm --version
```

---

## 🚀 Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/barcode_system.git
cd barcode_system
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up Supabase

This project uses **Supabase** as its backend. You need your own Supabase project (free tier is enough).

1. Go to [https://supabase.com](https://supabase.com) and sign in (or create a free account)
2. Click **"New project"** and fill in the project name and database password
3. Wait for the project to finish provisioning (about 1–2 minutes)
4. Go to **Settings → API** and copy:
   - **Project URL** (looks like `https://xxxxxxxxxxxx.supabase.co`)
   - **anon / public key** (the long JWT string under "Project API keys")

### 4. Create your `.env` file

Copy the example file and fill in your Supabase values:

```bash
# Windows
copy .env.example .env

# macOS / Linux
cp .env.example .env
```

Open `.env` and replace the placeholder values:

```env
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-anon-public-key-here
VITE_SUPABASE_PROJECT_ID=your-project-id

SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_PUBLISHABLE_KEY=your-anon-public-key-here
```

> ⚠️ **Never commit `.env` to Git.** It is already listed in `.gitignore`.

### 5. Set up the database schema

The database tables need to be created in your Supabase project. In the Supabase dashboard:

1. Go to **SQL Editor**
2. Run the schema migrations found in the `supabase/migrations/` folder (if present), **or** ask the project owner for the SQL schema script

The main tables the app uses are:

| Table | Purpose |
|---|---|
| `students` | Students and visitor pass records |
| `access_logs` | Every scan event (allowed / denied / unknown) |
| `gates` | Physical gate locations |
| `settings` | System configuration key-value store |
| `incidents` | Security incident reports |
| `announcements` | Operator notices |
| `watchlist` | Flagged individuals |
| `notifications` | System-generated alert log |

### 6. Create the first admin user

1. In Supabase → **Authentication → Users**, click **"Invite user"** and enter your email
2. Check your email and complete sign-up
3. In **SQL Editor**, run:
   ```sql
   UPDATE auth.users SET raw_user_meta_data = '{"role":"admin"}' WHERE email = 'your@email.com';
   ```
   This promotes your account to admin so you can access Settings, Students, Gates, etc.

### 7. Run the development server

```bash
npm run dev
```

The app will be available at **http://localhost:8080**

To access from another device on the same Wi-Fi network (e.g. a phone or tablet for the gate scanner), use your machine's local IP address instead of `localhost`:

```
http://192.168.x.x:8080
```

---

## 📦 Build for Production

```bash
npm run build
```

Output goes to the `dist/` folder. You can deploy it to any static host (Netlify, Vercel, Cloudflare Pages, etc.).

Preview the production build locally:

```bash
npm run preview
```

---

## 📁 Project Structure

```
src/
├── components/          # Shared UI components (ScannerStatus, etc.)
├── components/ui/       # shadcn/ui primitives (Button, Input, etc.)
├── integrations/
│   └── supabase/        # Auto-generated Supabase client + TypeScript types
├── lib/
│   ├── auth-context.tsx # Auth state (isAdmin, user)
│   ├── idcard.ts        # PDF generation for student ID cards and visitor passes
│   ├── offline.ts       # IndexedDB cache for offline barcode scanning
│   └── utils.ts         # Tailwind class helpers
├── locales/
│   ├── en.json          # English translations
│   └── sw.json          # Swahili translations
└── routes/
    ├── index.tsx         # Login page
    └── _authenticated/   # All protected pages (dashboard, verify, students…)
```

---

## 🔐 Environment Variables Reference

| Variable | Required | Description |
|---|---|---|
| `VITE_SUPABASE_URL` | ✅ | Your Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | ✅ | Your Supabase anon/public key |
| `VITE_SUPABASE_PROJECT_ID` | ✅ | Your Supabase project ID (the part before `.supabase.co`) |
| `SUPABASE_URL` | ✅ | Same as `VITE_SUPABASE_URL` (used by SSR) |
| `SUPABASE_PUBLISHABLE_KEY` | ✅ | Same as `VITE_SUPABASE_PUBLISHABLE_KEY` (used by SSR) |

---

## 🌐 Language / i18n

The app ships with full English and Swahili translations. Users switch language from the top-right language toggle (EN / SW) on the Gate Scan page.

Translation files are in `src/locales/en.json` and `src/locales/sw.json`.

---

## 🖨️ Hardware Scanner Support

The Gate Scan page works with:

- **USB barcode scanners** — plug in and select "Barcode Scanner" mode; the scanner acts as a keyboard
- **Bluetooth barcode scanners** — pair to the device's OS first, then use the same mode
- **Device camera** — select "Camera / QR Code" mode (requires HTTPS in production)
- **Manual lookup** — type the student name or admission number

Scanner detection (Web HID API) works in **Chrome and Edge** only. Firefox will still scan correctly but won't show the device name in the status panel.

---

## 🤝 Contributing / Reporting Issues

Open an issue or pull request on GitHub. For schema changes, include the SQL migration in `supabase/migrations/`.

---

## 📄 License

Private — all rights reserved. Contact the project owner for usage permissions.
