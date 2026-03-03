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
- **UI layer:** shadcn/ui (built on Radix UI primitives) + Tailwind CSS. Theme tokens are CSS variables defined in `src/index.css`. Dark obsidian theme (#050E1F) is the default with gold (#FF6B2B) accent.
- **Design system:** Commun-ET dark obsidian theme. Fonts: Cormorant Garamond (headings), DM Mono (labels/tags), Barlow (body). Colors: obsidian #050E1F, slate #091428, panel #0D1E38, gold #FF6B2B, fog #6B9AC4, teal #38BDF8.
- **Landing page:** `src/pages/CommunETLanding.tsx` — self-contained marketing page with inline styles, rendered at `/` for unauthenticated users via `src/pages/LandingPage.tsx`.
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
- **Started with:** `dev.sh` launches scraper as a background process and Vite as the foreground process.
- **Proxy:** Vite proxies `/api/*` requests to `http://127.0.0.1:3001` so the frontend uses relative URLs (`SCRAPER_URL = ""`).
- **Playwright:** Uses Nix-installed system libraries (chromium, libXcomposite, libXdamage, etc.). Launches in `headless: true` mode.
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
| `shadow_predictions` | Shadow Mode: background AI predictions logged without affecting production |
| `baseline_actions` | Shadow Mode: tracks human expeditor performance for baseline metrics |
| `audit_trail` | Shadow Mode: immutable ESG-compliant audit logging |
| `comment_quality_checks` | Guardian QA agent results (scores, flags, suggested improvements) |

### Shadow Mode

- **Dashboard:** `/admin/shadow-mode` — React page at `src/pages/ShadowModeDashboard.tsx` showing accuracy, agent performance, baseline metrics, and audit trail.
- **Metrics Edge Function:** `supabase/functions/shadow-metrics/index.ts` — aggregates data from `shadow_predictions`, `baseline_actions`, and `audit_trail`.
- **Flag:** `projects.is_shadow_mode` (boolean) — when true, AI agents log predictions to `shadow_predictions` instead of updating `parsed_comments`.
- **Supported agents:** `discipline-classifier-agent` — In shadow mode, fetches ALL comments (including already-classified ones from the portal), classifies via LLM, and writes to `shadow_predictions` with `prediction_data: { ai_discipline, portal_discipline }`. Auto-computes `match_status` ("match"/"mismatch") when portal discipline exists, or "pending" when no baseline. Audit trail entries use `shadow_match`/`shadow_mismatch`/`shadow_no_baseline` routing decisions.

### Agent Chain Mechanism

- **Location:** `src/components/dashboard/AgentWorkflowStatus.tsx` — `runChainedPipeline()` function.
- **Trigger:** Two paths: (1) Clicking "Run Manual Check" starts scrape + chain automatically; (2) Supabase Realtime listener on `projects` table detects `portal_data_hash` changes and auto-triggers the chain.
- **Sequence:** Scrape (Step 1) → Intake Pipeline (Step 2) → Discipline Classifier (Step 3) → Context & Reference Engine (Step 4) → Auto-Router (Step 5).
- **Shadow Mode Enforcement:** Before the chain starts, `is_shadow_mode` is read from the project row and passed to every agent invocation (both chained and manual).
- **Error Handling:** If any agent fails, the error is logged to `shadow_predictions` (with `match_status: "fail"`) and `audit_trail` via `shadow-evaluator` Edge Function's `log_failure` action. The chain halts at the failed step (visible in UI for 8 seconds).
- **UI State:** `chainPhase` state drives step status badges ("Chain Active", "Chain Complete", "Shadow Mode") and disables manual buttons while the chain is running. **Strict sequential dependency:** downstream steps (3→4→5) are forced to "Pending" if their immediate upstream step isn't "Complete", preventing historical DB records from prematurely showing "Complete" during a pipeline run. Descriptions show "Waiting for upstream steps" when overridden.
- **Individual agent buttons:** Each agent can still be run manually outside the chain; manual runs also check `is_shadow_mode`.
- **Data Hashing:** Scraper computes SHA-256 hash of `portal_data` JSON before writing to Supabase. If hash matches existing `portal_data_hash`, only `last_checked_at` is updated (no chain triggered). Column: `projects.portal_data_hash`.
- **Smart Diff Parsing:** `comment-parser-agent` no longer deletes all existing comments before reparsing. Instead, it compares new blocks against existing `parsed_comments` by normalized text and only inserts genuinely new comments.
- **Auto Shadow Evaluation:** Database trigger `trg_shadow_prediction_auto_evaluate` fires on INSERT to `shadow_predictions` with `match_status = 'pending'`, calling `shadow-evaluator` Edge Function's `evaluate_new_prediction` action via `pg_net`.
- **Realtime:** `projects` table has `REPLICA IDENTITY FULL` set to ensure `old` payload includes `portal_data_hash` for diff detection.
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