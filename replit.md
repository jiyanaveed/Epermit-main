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
- **Functionality:** Logs into ProjectDox/Avolve portals to extract project data, report PDFs, and syncs this information back to Supabase.
- **Dynamic Portal Routing:** The scraper accepts a `portalUrl` parameter in `/api/login` requests. It derives the WebUI base URL dynamically from the portal URL (subdomain + `-projectdoxwebui`). Both URLs are stored in the session object for use by `/api/scrape`. Falls back to Washington DC URL if no portal URL is provided.
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