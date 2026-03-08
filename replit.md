# Insight|DesignCheck (PermitPilot / Epermit) — replit.md

## Overview
**Insight|DesignCheck** (PermitPilot / Epermit) is a permit-management and expediting web application designed for architects, contractors, and project owners. It streamlines the permitting process by offering project tracking, portal integrations with AI-powered comment analysis, e-permit submission, inspection management, and automated reporting. The platform aims to centralize permit-related workflows, enhance efficiency through AI, and provide valuable jurisdiction intelligence and financial tools. All backend logic is powered by Supabase, complemented by a local Node.js/Express + Playwright scraper service.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Framework:** React 18 with TypeScript, built using Vite 5.
- **Routing:** React Router 6, separating public marketing routes from protected application routes.
- **UI Layer:** shadcn/ui (Radix UI primitives) and Tailwind CSS, featuring full light/dark mode support.
- **Design System:** Commun-ET dark obsidian theme with specific fonts (Cormorant Garamond, DM Mono, Barlow) and a defined color palette for both dark and light modes.
- **State Management:** TanStack React Query for server state; React hooks for local state; `SelectedProjectContext` for persistent project selection.
- **Forms:** React Hook Form with Zod for validation.
- **PWA & Mobile:** Full PWA support via `vite-plugin-pwa` and Capacitor 8 for potential iOS/Android builds.

### Backend (Supabase)
- **Database:** Postgres, with schema managed via raw SQL migrations.
- **Authentication:** Supabase Auth for email/password, integrated with user profiles and subscription tiers.
- **Edge Functions:** Deno-based serverless functions for AI-powered pipelines (comment parsing, classification, auto-drafting), e-permit submission, and Stripe checkout.
- **Storage:** Used for inspection photos and document uploads.
- **Security:** Row Level Security (RLS) enforced across all public tables, controlling access based on user ownership, project roles, and admin status.

### Scraper Service
- **Technology:** Separate Node.js/Express app using Playwright (Chromium) for browser automation.
- **Multi-Portal Support:** Detects portal type from URL and routes to correct scraper:
  - `avolvecloud.com` / `projectdox` → ProjectDox scraper (`server.js` performLogin + scrapeAll)
  - `accela.com` → Accela scraper (`accela-scraper.js`)
  - Otherwise → error "Unsupported portal type"
- **ProjectDox Scraper:** Logs into ProjectDox/Avolve portals to extract project data, report PDFs, and syncs to Supabase.
- **Accela Scraper:** (`scraper-service/accela-scraper.js`) Handles Baltimore MD's Accela Citizen Access portal. Supports login, permit search, and extraction of: record info, processing status, plan review comments, related records, attachments, inspections, payments. Data structured in portal_data format compatible with existing frontend Portal Data Viewer.
- **Dynamic Portal Routing:** The scraper accepts a `portalUrl` parameter in `/api/login` requests. For ProjectDox, it derives the WebUI base URL dynamically from the portal URL (subdomain + `-projectdoxwebui`). For Accela, it navigates directly to the portal URL. Falls back to Washington DC URL if no portal URL is provided.
- **Credential Matching:** The frontend matches credentials by jurisdiction (exact match → partial match → single-credential fallback). Missing credentials or portal URL produce clear toast error messages.
- **Sync-before-done:** The scraper sets `session.status = "done"` only AFTER the Supabase sync completes, preventing race conditions where the frontend starts the AI chain before portal_data is saved.
- **Deployment:** Runs locally, proxied by Vite for frontend access.

### Shadow Mode
- **Purpose:** A system for evaluating AI agent performance in the background without affecting production data.
- **Mechanism:** When active, AI agents log predictions to `shadow_predictions` instead of updating `parsed_comments`. It includes a dashboard for performance monitoring, baseline comparisons, and audit trails.
- **Agent Chain Mechanism:** A sequential pipeline of agents (Scrape, Intake, Discipline Classifier, Context Engine, Auto-Router) can be triggered manually or automatically. Shadow Mode policies are applied consistently across all agent invocations.
- **Smart Diff Parsing:** The `comment-parser-agent` intelligently identifies and inserts only genuinely new comments, avoiding full re-parsing.
- **Weekly Report Export:** Edge function `export-weekly-report` aggregates last 7 days of predictions into a structured CSV (Executive Summary, Agent Performance, Baseline Metrics, Confidence Calibration with high-risk errors, raw predictions). Triggered from dashboard "Export Weekly Report" button.
- **Circuit Breaker:** Edge function `circuit-breaker-check` enforces ESG safety rule: agent auto-disabled if >10% fail rate in 24h (minimum 10 predictions for statistical significance). Warning at 3 consecutive mismatches. Status badges (ACTIVE/WARNING/DISABLED) shown per-agent in dashboard.

### Plan Markup Workflow
- **Purpose:** Adds a "Plan Markup" step to the Response Matrix between "Validate Completeness" and "Quality Check."
- **Components:**
  - `PlanViewer` (`src/components/plans/PlanViewer.tsx`): Multi-page PDF viewer with zoom, page navigation using `pdfjs-dist`.
  - `CommentPlanPanel` (`src/components/plans/CommentPlanPanel.tsx`): Side panel grouping parsed comments by page number with click-to-navigate.
  - `RevisionCloudOverlay` (`src/components/plans/RevisionCloudOverlay.tsx`): SVG overlay for drawing AIA-standard revision clouds, linked to comments. Stores coordinates as normalized 0-1 ratios.
  - `ArchitectApprovalDialog` (`src/components/plans/ArchitectApprovalDialog.tsx`): Password re-auth gate; approves all pending markups; shows seal watermark on approved pages.
  - `PlanMarkupWorkspace` (`src/components/plans/PlanMarkupWorkspace.tsx`): Full workspace dialog integrating PlanViewer + overlay + comment panel.
  - `stampedPdfExport` (`src/lib/stampedPdfExport.ts`): Generates revised PDF with revision clouds, seal stamp, and revision block using `pdf-lib`.
- **Database:** `plan_markups` and `architect_profiles` tables (migration `20260307000001`).
- **Hooks:** `usePlanMarkups` (CRUD for markups, filters by project + document + page), `useApprovalGate` (checks pending markup status).
- **Settings:** `ArchitectProfileManager` in Settings for seal/signature upload and license info.

### Branded Response Package Export
- **Purpose:** Upgrades the export-response-package PDF with company branding and selectable templates.
- **Templates** (`src/lib/responsePackageTemplates.ts`): Formal Letter, Technical Memo, Simple Table — all with company logo, contact info, signature block.
- **Export Dialog** (`src/components/response-matrix/ExportPackageDialog.tsx`): Template selection cards, branding preview, municipality address for letter template, draft management.
- **Edge Function:** `export-response-package` upgraded to accept `template` parameter, fetch branding/architect profile, render branded PDFs.
- **Database:** `company_branding` table (migration `20260307000002`).
- **Settings:** `ExportBrandingManager` in Settings for company branding.

### Multi-Round Draft Management
- **Purpose:** Supports saving/resuming response package drafts across multiple city review rounds.
- **Hook:** `useResponsePackageDrafts` (`src/hooks/useResponsePackageDrafts.ts`) — CRUD for drafts, auto-increment rounds, comment snapshots, supersede previous drafts.
- **Round Comparison:** `RoundChangeSummary` (`src/components/response-matrix/RoundChangeSummary.tsx`) — shows new/modified/resolved comments between rounds.
- **Database:** `response_package_drafts` table + `review_round` column on `parsed_comments` (migration `20260307000002`).
- **Integration:** Export dialog shows draft list with status badges, resume/new round buttons, "Modified" badges on changed comments.

### Multi-Municipality Permit Filing System (formerly DC DOB PermitWizard)
- **Purpose:** Autonomous permit filing across 10 DMV jurisdictions via 9-agent pipeline.
- **Supported Municipalities (4 portal platforms):**
  - **Accela Citizen Access (6):** DC DOB, Fairfax County VA, Baltimore City MD, Howard County MD, Arlington County VA, Anne Arundel County MD
  - **Liferay/Momentum (1):** Prince George's County MD
  - **ASP.NET WebForms (1):** Montgomery County MD
  - **Tyler EnerGov (2):** City of Alexandria VA, Loudoun County VA
- **Municipality Config:** `municipality_configs` table stores portal type, URLs, data sources, license validation sources, permit types, and agent_config JSONB per jurisdiction (migration `20260307000004`).
- **Architecture:** 9 specialized agents across 3 layers with 1 mandatory human decision gate.
- **Layer 1 — Pre-Flight Agents (jurisdiction-aware):**
  - Agent 01 `property-intelligence-agent`: DC Scout (DC), MD SDAT (MD jurisdictions), or advisory fallback (VA).
  - Agent 02 `license-validation-agent`: DLCP (DC), MD DLLR (MD), VA DPOR (VA); hard-stop rules vary by jurisdiction.
  - Agent 03 `document-preparation-agent`: Validates documents (mostly jurisdiction-agnostic).
  - Agent 04 `permit-classifier-agent`: Dynamic GPT prompt per jurisdiction from `municipality_configs.agent_config`.
  - Orchestrator `permitwizard-preflight`: Accepts `municipality_key`, routes to correct data sources.
- **Layer 1.5 — Human Gate:**
  - Agent 05 `FilingReviewPanel`: Shows municipality context, data source labels, jurisdiction-specific agency names.
- **Layer 2 — Execution Agents (portal-routed):**
  - Auth modules: `permitwizard-auth.js` (Accela), `momentum-auth.js` (Liferay), `montgomery-auth.js` (ASP.NET), `energov-auth.js` (EnerGov)
  - Filer modules: `permitwizard-filer.js` (Accela), `momentum-filer.js`, `montgomery-filer.js`, `energov-filer.js`
  - Submit modules: `permitwizard-submit.js` (Accela), `momentum-submit.js`, `montgomery-submit.js`, `energov-submit.js`
  - Orchestrator `permitwizard-execute`: Routes to correct scraper based on `portal_type` from municipality config.
- **Layer 3 — Post-Submission:**
  - Agent 09 `permit-status-monitor`: Monitors status per jurisdiction.
- **Database:** `permit_filings` (+ `municipality`, `credential_id`, `permit_type`, `square_footage`, `number_of_stories`, `owner_name`, `owner_phone`, `owner_email` columns), `agent_runs`, `property_intelligence`, `license_validations`, `filing_documents` (12 document types: plan, cost_estimate, contract, specification, approved_documents, menu, plat_survey, geotech_report, letter_of_authorization, eif, checklist, other), `filing_screenshots`, `filing_professionals`, `municipality_configs` (migrations `20260307000003`, `20260307000004`, `20260308000002`).
- **Frontend:** `PermitWizardFiling.tsx` ("Permit Filing" page) with municipality selector/filter, `StartFilingDialog.tsx` with municipality dropdown + permit type selector + owner info + square footage/stories fields, `AgentRunDetail.tsx`.
- **Scraper endpoints:** Legacy `/api/permitwizard/*` (DC backward compat) + generic `/api/filing/login|file|submit|session|reauth|logout` (multi-portal routing by `portal_type`).

### Auth & Roles
- Manages user authentication, subscription tiers, project access via Postgres functions (`has_project_access`), and admin privileges (`has_role`).

## External Dependencies

- **Supabase:** Primary backend for database, authentication, edge functions, and storage.
- **OpenAI:** Powers AI functionalities like comment response drafting, discipline classification, and compliance analysis within Supabase Edge Functions.
- **Stripe:** Handles subscription billing, checkout sessions, and webhooks.
- **Resend:** Manages transactional emails for reminders, reports, and invitations.
- **Mapbox:** Provides interactive mapping capabilities for jurisdiction data.
- **Playwright:** Utilized by the local scraper service for web automation and data extraction from portals.
- **Capacitor:** Used for wrapping the web application into potential native iOS/Android builds.
- **PDF Libraries:** `jsPDF` for client-side PDF generation and `pdfjs-dist` for parsing and rendering PDFs.
- **Framer Motion:** For UI animations.
- **Recharts:** For data visualization and charts.
- **ExcelJS:** For generating Excel reports within the scraper service.