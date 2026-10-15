# ABB Plant 3 · Security & Gate Management System

An industrial-grade gate access control, canteen verification, and personnel management platform engineered for **ABB Plant 3 (Production & Switchgear Engineering Facility)**.

Built with **React 19**, **TanStack Start (SSR)**, **TypeScript**, **Tailwind CSS v4**, and **Supabase PostgreSQL**.

---

## Key Capabilities

| Module | Purpose & Features |
|---|---|
| **Plant 3 Main Gate Scan** | Rapid USB/Bluetooth barcode gun and camera QR scanner interface. Pre-locked to `"Plant 3 - Main Gate"`. Delivers sub-second ALLOWED / DENIED decisions via authoritative PostgreSQL RPC with high-contrast 3–5m industrial visibility banners, denial reason callouts, and Web Audio chimes/buzzers. |
| **Current Inside & Evacuation** | Rolling 36-hour entry window tracking personnel across 24h midnight shifts. Categorized by Contract Workers, Engineering Interns, and Visitors with stay durations and overtime alerts (>12h). 1-click Evacuation Roster CSV export. |
| **Canteen Verification** | Cafeteria turnstile scanner with auto-detected meal windows (Breakfast, Lunch, Dinner, Night Snack crossing midnight). Enforces daily duplicate-claim prevention against `canteen_logs` table. Filterable meal audit reports with CSV export. |
| **Personnel Management** | Unified directory for Contract Workers (vendor company), Engineering Interns (technical institution), and Temporary Visitors. Issue, renew, suspend, and bulk-import credentials. |
| **CR80 ID & Pass Generation** | Vertical portrait ID card layout (54mm × 85.6mm) in ABB Corporate Red theme with initials avatar fallbacks and Code 128 barcodes. Supports single PDF download and 9-card A4 bulk print sheets with dashed cutting guides. |
| **Expiry & Renewals** | Automated turnstile rejection on expired pass end dates. Admin Dashboard widget tracking expired and upcoming 7-day expiries. Reusable extension modal with +7d, +14d, +30d, +60d, +90d, +180d presets and mandatory audit justification. |
| **Industrial Security Reports** | Hourly gate throughput curves, access denial audit trails with root-cause breakdown, missing exits reports, contractor rosters by vendor, and native jsPDF daily security gate audit export. Formula-injection sanitized exports. |
| **Offline Turnstile Mode** | Upgraded IndexedDB v2 store caching personnel and active security watchlists. Evaluates passes and flags watchlist records locally when offline. Scans are captured in an offline queue with unique UUID sync IDs and deduplicated batch syncing to `access_logs`. |
| **Security Watchlist** | Real-time security alerts with criticality levels (`low`, `medium`, `high`, `critical`) providing instantaneous turnstile block with guard callout. |

---

## Tech Stack

- **Frontend:** React 19, TanStack Router (file-based routing), TanStack Query v5, TanStack Start (SSR)
- **Styling:** Tailwind CSS v4, Lucide Icons, Radix UI primitives
- **Backend / DB:** Supabase PostgreSQL with Authoritative RPCs (`verify_gate_access`) and Row Level Security
- **Local Cache:** IndexedDB via `idb` library
- **PDF & Barcode:** jsPDF, JsBarcode, Quagga2
- **Testing:** Native Node.js test runner (`npm test`)

---

## Getting Started

### 1. Prerequisites
- Node.js 20+ installed
- Supabase CLI or active Supabase project credentials

### 2. Installation
```bash
git clone <repo-url>
cd barcode-student-verification
npm install
```

### 3. Environment Variables
Create or verify `.env` / `.env.local`:
```env
VITE_SUPABASE_URL=https://<your-project-id>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>
```

### 4. Running Locally
```bash
# Start development server
npm run dev

# Run automated regression test suite
npm test

# Build production bundle (Client + SSR Server)
npm run build
```

---

## Database Setup

All database migrations and setup scripts are located in `supabase/`:
- `supabase/migrations/20261015000000_abb_plant3_foundation.sql`: Core schema (plants, gates, personnel categories, canteen logs)
- `supabase/migrations/20261015000001_verify_gate_access_rpc.sql`: Authoritative verification RPC
- `supabase/migrations/20261015000002_rls_hardening.sql`: Append-only access logs and public route lockdown
- `supabase/migrations/20261015000003_abb_plant3_complete_setup.sql`: Complete consolidated setup with clean industrial sample seed data

To execute the complete database setup, run `supabase/migrations/20261015000003_abb_plant3_complete_setup.sql` in your Supabase SQL Editor.
