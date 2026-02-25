# Insight|DesignCheck (PermitPilot / Epermit) — replit.md

## Overview

**Insight|DesignCheck** (also known as PermitPilot or Epermit) is a permit-management and expediting web application targeting architects, contractors, and project owners. Its core capabilities include:

- **Project management** — Create and track permit projects with team sharing, status tracking, and jurisdiction data.
- **Portal integration** — Connect to DC ProjectDox/Avolve portals; scrape and sync report PDFs and permit status via a local Playwright scraper service.
- **AI-powered comment pipeline** — Parse plan review comments from portals/PDFs, classify by discipline (Structural, Architectural, MEP, Fire, etc.), auto-draft responses using OpenAI, and manage them in a Response Matrix.
- **E-permit submission** — Validate and submit permits to Accela/CityView systems.
- **Inspections** — Track inspections, manage punch lists, generate PDF checklists with photo attachments.
- **Scheduled reports & email campaigns** — Automated report delivery and drip emails via Resend.
- **Billing** — Stripe-powered subscription checkout with tiered plans (starter, professional, business, enterprise).
- **Jurisdiction intelligence** — Jurisdiction data, comparison tools, and an interactive Mapbox map.
- **Calculators** — ROI, consolidation, code compliance, and code reference library tools.
- **PWA + Mobile** — Full PWA support via vite-plugin-pwa; Capacitor for potential iOS/Android builds.

All backend logic lives in **Supabase** (Postgres, Auth, Edge Functions, Storage). A separate **Node.js/Express + Playwright** scraper runs locally alongside the frontend for portal scraping.

---

## User Preferences

Preferred communication style: Simple, everyday language.

---

## System Architecture

### Frontend

- **Framework:** React 18 with TypeScript, built by Vite 5.
- **Routing:** React Router 6 with two route categories:
  - Public marketing routes (landing, pricing, demos, FAQ, contact)
  - Protected app routes (dashboard, projects, analytics, tools) wrapped in `ProtectedRoute` which redirects unauthenticated users to `/auth`
- **UI layer:** shadcn/ui (built on Radix UI primitives) + Tailwind CSS. Theme tokens are CSS variables defined in `src/index.css`. Dark mode is supported via `ThemeProvider`.
- **State management:** TanStack React Query v5 for server state. Local state via React hooks. Selected project persisted in localStorage via `SelectedProjectContext`.
- **Forms:** React Hook Form + Zod for validation.
- **Key contexts:**
  - `AuthProvider` — wraps Supabase auth session, subscription status
  - `SelectedProjectContext` — tracks which project is active (persisted per-user in localStorage)
  - `LeadCaptureContext` — marketing lead capture modal state
- **Entry point:** `src/main.tsx` → `src/App.tsx`
- **Path alias:** `@/` maps to `src/`

### Backend (Supabase)

- **No custom Node API in the main app.** All backend is Supabase:
  - **Postgres** — Primary database, schema managed through migration files in `supabase/migrations/`. No ORM (no Drizzle or Prisma); raw SQL migrations.
  - **Supabase Auth** — Email/password auth. New users get a `profiles` row via the `handle_new_user` trigger.
  - **Edge Functions** — Deno-based serverless functions in `supabase/functions/`. Key functions include:
    - `intake-pipeline-agent` — Orchestrates the comment ingestion pipeline
    - `comment-parser-agent` — Parses raw comment text from portal PDFs
    - `discipline-classifier-agent` — Classifies comments by engineering discipline using OpenAI
    - `auto-router-agent` — Assigns comments to team members
    - `validate-completeness-agent` — Checks response completeness
    - `guardian-quality-agent` — Scores response quality
    - `export-response-package` — Exports comment response packages
    - `epermit-submit` — Handles Accela/CityView e-permit submission
    - `create-checkout` — Stripe checkout session creation
  - **Storage** — Used for inspection photos and document uploads.
  - **RLS (Row Level Security)** — Enforced on all public tables. Access patterns: user owns row (`auth.uid() = user_id`), project-scoped via `has_project_access()`, admin-only via `has_role()`.

### Scraper Service

- **Location:** `scraper-service/` — separate Node.js/Express app (CommonJS).
- **Port:** 3001.
- **Purpose:** Logs into DC ProjectDox/Avolve portal using Playwright (Chromium), extracts project data and report PDFs, writes results back to Supabase (`projects.portal_data` JSONB field).
- **Started with:** `npm run dev:scraper` (or concurrently with frontend via `npm run dev`).
- **Dependencies:** `playwright`, `express`, `cors`, `@supabase/supabase-js`, `exceljs`, `dotenv`.
- **Config:** Requires `.env` with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

### Database Schema (Key Tables)

| Table | Purpose |
|---|---|
| `profiles` | Extended user data (name, company, subscription tier/status) |
| `user_roles` | Role assignments (`admin`, `moderator`, `user`) |
| `projects` | Core project records with status, jurisdiction, permit info, `portal_data` JSONB |
| `project_team_members` | Project sharing with roles (owner, admin, editor, viewer) |
| `project_invitations` | Email-based project invitations with token and expiry |
| `portal_credentials` | Stored portal login credentials per project |
| `parsed_comments` | Plan review comments parsed from portal reports |
| `inspections` | Inspection records per project |
| `project_documents` | Uploaded documents stored in Supabase Storage |
| `scheduled_reports` | Automated report delivery schedules |
| `jurisdictions` | Jurisdiction metadata for map and comparison tools |

### Auth & Roles

- Supabase Auth (email/password). The anon key is in `src/lib/supabase.ts`.
- Subscription tier (`starter` | `professional` | `business` | `enterprise`) stored in `profiles` and checked in `useAuth`.
- Project access checked via `has_project_access(user_id, project_id)` Postgres function.
- Admin features gated by `has_role(user_id, 'admin')`.

### PWA & Mobile

- PWA: `vite-plugin-pwa` with `autoUpdate` register type. Manifest in `vite.config.ts`.
- Mobile: Capacitor 8 configured in `capacitor.config.ts` for potential iOS/Android builds. App ID: `app.lovable.0664b92985614c0ebe90b14e3fcda8e1`.

### Deployment

- Frontend: Vercel (configured in `vercel.json` with SPA rewrite rules) or Lovable deploy.
- Edge Functions: Supabase (deployed via `supabase functions deploy`). Project ref: `eeqxyjrcldivtpikcpvk`.
- Scraper: Runs locally only (requires a machine with a browser for Playwright).

---

## External Dependencies

### Supabase
- **Role:** Primary backend — Postgres database, authentication, edge functions, file storage.
- **Config:** `supabase/config.toml`. Project URL and anon key in `src/lib/supabase.ts` and env vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).
- **Service role key** required for scraper service (`.env` in `scraper-service/`).

### OpenAI
- **Role:** AI comment response drafting, discipline classification, drawing compliance analysis.
- **Used in:** Supabase Edge Functions. Requires `OPENAI_API_KEY` secret set on the Supabase project.

### Stripe
- **Role:** Subscription billing — checkout sessions, webhooks, customer portal.
- **Used in:** Edge functions (`create-checkout`, webhook handler). Requires `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` secrets.

### Resend
- **Role:** Transactional emails — inspection reminders, scheduled reports, drip campaigns, invitation emails.
- **Used in:** Edge functions. Requires `RESEND_API_KEY` secret.

### Mapbox
- **Role:** Interactive jurisdiction map display.
- **Used in:** `src/pages/JurisdictionMapPage.tsx`. Requires a Mapbox access token (likely env var).

### Playwright (via scraper-service)
- **Role:** Browser automation to scrape DC ProjectDox portal for permit status and report PDFs.
- **Runtime:** Local Node.js process only; not deployed to cloud.

### Firecrawl
- **Role:** Alternative/supplemental web scraping for portal status checks.
- **Used in:** Referenced in app summary as alternative to Playwright-based scraping.

### Capacitor
- **Role:** Native mobile app wrapper for potential iOS/Android distribution.
- **Packages:** `@capacitor/cli`, `@capacitor/core` (v8).

### PDF Libraries
- **jsPDF + jspdf-autotable:** Client-side PDF generation for checklists, compliance reports, API docs, design memos.
- **pdfjs-dist:** PDF parsing/rendering for uploaded document viewing.

### Other Notable Libraries
- **Framer Motion:** UI animations.
- **Recharts:** Data visualization/charts in analytics.
- **date-fns:** Date formatting and manipulation.
- **cmdk:** Command palette UI.
- **sonner:** Toast notifications.
- **ExcelJS:** Excel report generation in the scraper service.