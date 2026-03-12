# Insight|DesignCheck (PermitPilot / Epermit)

## Overview
Insight|DesignCheck (PermitPilot / Epermit) is a web application designed to streamline the permit-management and expediting process for architects, contractors, and project owners. It offers centralized project tracking, AI-powered comment analysis, e-permit submission, inspection management, and automated reporting. The platform aims to enhance efficiency, provide jurisdiction intelligence, and integrate financial tools, leveraging Supabase for backend logic and a Node.js/Express + Playwright service for scraping.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Framework:** React 18 with TypeScript and Vite 5.
- **UI/UX:** shadcn/ui (Radix UI primitives) and Tailwind CSS, supporting light/dark modes. Design adheres to a Commun-ET dark obsidian theme with specific fonts and color palettes.
- **State Management:** TanStack React Query for server state; React hooks for local state; `SelectedProjectContext` for persistent project selection (localStorage + URL `?projectId=` sync). Active project badge displayed in header bar.
- **Forms:** React Hook Form with Zod for validation.
- **PWA & Mobile:** Full PWA support and Capacitor 8 for potential native mobile applications.

### Backend (Supabase)
- **Database:** Postgres, managed with raw SQL migrations.
- **Authentication:** Supabase Auth with user profiles and subscription tiers.
- **Edge Functions:** Deno-based serverless functions for AI pipelines (comment parsing, classification, auto-drafting), e-permit submission, and Stripe checkout.
- **Storage:** Used for inspection photos and document uploads.
- **Security:** Row Level Security (RLS) based on user ownership, project roles, and admin status.

### Scraper Service
- **Technology:** Node.js/Express with Playwright for browser automation, supporting multi-portal types (ProjectDox, Accela).
- **Functionality:** Extracts project data, PDFs, files, and comments, syncing to Supabase. Handles dynamic portal routing and credential matching by jurisdiction. File downloads use `viewFile(fileId)` popup approach with multi-strategy fallback (download button, embed src, captured responses). File-size guardrails: MIN 1KB, MAX 100MB per file, 500MB per-scrape cumulative cap, 1GB downloads dir cleanup.
- **AI Compliance Analysis:** `/api/analyze-drawing` endpoint uses OpenAI GPT-4o Vision to analyze architectural drawings for building code compliance. Supports jurisdiction-specific amendments (DC, NYC, California, Florida, Chicago). Protected by Supabase auth token validation.
- **Data Sync:** Merges newly scraped data with existing `portal_data` to avoid data loss during partial scrapes. Ensures Supabase sync completion before marking a session as "done."

### Shadow Mode
- **Purpose:** Evaluates AI agent performance without impacting production data, logging predictions to `shadow_predictions`.
- **Features:** Includes a dashboard for performance monitoring, baseline comparisons, and audit trails. Employs a sequential pipeline of agents.
- **Safety:** Implements a circuit breaker to disable agents if failure rates exceed thresholds.

### Plan Markup Workflow
- **Purpose:** Integrates a "Plan Markup" step into the response matrix.
- **Features:** Multi-page PDF viewer (`PlanViewer`), comment panel grouped by page (`CommentPlanPanel`), SVG overlay for revision clouds (`RevisionCloudOverlay`), and architect approval with digital seal (`ArchitectApprovalDialog`).
- **Export:** Generates revised PDFs with revision clouds, seal stamps, and revision blocks (`stampedPdfExport`).
- **Database:** `plan_markups` and `architect_profiles` tables.

### Branded Response Package Export
- **Purpose:** Exports response packages with company branding and selectable templates.
- **Templates:** Offers Formal Letter, Technical Memo, and Simple Table templates with customizable branding.
- **Configuration:** Managed via `company_branding` table and `ExportBrandingManager` settings.

### Multi-Round Draft Management
- **Purpose:** Supports saving and resuming response package drafts across multiple review rounds.
- **Features:** Auto-incrementing rounds, comment snapshots, and comparison of changes between rounds.
- **Database:** `response_package_drafts` table and `review_round` column on `parsed_comments`.

### Multi-Municipality Permit Filing System
- **Purpose:** Autonomous permit filing across 10 DMV jurisdictions using a 9-agent pipeline.
- **Support:** Integrates with Accela Citizen Access, Liferay/Momentum, ASP.NET WebForms, and Tyler EnerGov platforms.
- **Architecture:** Consists of Pre-Flight Agents (jurisdiction-aware), a Human Gate, Execution Agents (portal-routed), and Post-Submission monitoring.
- **Database:** `permit_filings`, `municipality_configs`, `agent_runs`, and related tables for document and professional data.

### Jurisdiction Map & Intelligence
- **Purpose:** Interactive Mapbox-powered map displaying jurisdiction permit data and intelligence.
- **Data:** `jurisdictions` table storing permit volumes, review timelines, and portal URLs.
- **Display:** Sizes markers by permit volume and provides detailed breakdowns on interaction.

### Auth & Roles
- Manages user authentication, subscription tiers, project access via Postgres functions (`has_project_access`), and admin privileges (`has_role`).

### Background Scrape (March 2026)
- **Global ScrapeContext** (`src/contexts/ScrapeContext.tsx`): Scraping state (overlay, progress, SSE, polling) lifted from Dashboard-only `AgentWorkflowStatus` into a global React context. Wraps `DashboardLayout` so state persists across all page navigation (Dashboard, Settings, Portal Data, etc.).
- **Non-blocking polling**: `monitorScrapeInBackground` uses `setTimeout`-based fire-and-forget polling instead of a blocking `while` loop. The `/api/scrape` endpoint returns immediately; progress is tracked via `/api/data/:sessionId` polling.
- **Floating progress bar**: Compact floating widget (`fixed bottom-4 right-4`) rendered by `ScrapeProvider`. Supports minimize/expand. "Hide to Background" button replaces plain minimize. Cancel button available alongside.
- **Header scrape indicator**: `ScrapeHeaderIndicator` in the topbar shows "Scraping: X/Y" badge with spinner when a scrape is active. Clicking it expands the floating overlay. Visible on every page.
- **Re-attach logic**: Active scrape sessions persisted to `localStorage` key `scrape_active_session` with `{sessionId, projectId, projectNum, startedAt}`. On `ScrapeProvider` mount, checks if a session is still running via `/api/data/:sessionId` poll and auto-re-attaches to show progress. Sessions older than 15 minutes are discarded.
- **Layout route pattern**: `App.tsx` uses a single `<Route element={<ProtectedLayoutRoute />}>` wrapping all protected pages as nested `<Route>` children. `ProtectedLayoutRoute` (in `ProtectedRoute.tsx`) renders `<DashboardLayout><Outlet /></DashboardLayout>`, ensuring `ScrapeProvider` does NOT remount on page navigation.
- **onScrapeCompleteRef + pendingCompletion**: `AgentWorkflowStatus` registers a callback via `scrape.onScrapeCompleteRef` that fires `loadDashboardData` + `runChainedPipeline` when scraping completes. If the user navigated away from Dashboard (callback is null), `ScrapeContext` stores `pendingCompletionProjectId`. When `AgentWorkflowStatus` remounts and finds a pending completion, it triggers the pipeline chain.
- **startScrapeSession cleanup**: Before starting a new session, `startScrapeSession` closes any existing EventSource, clears intervals/timeouts, and resets pending completion state.
- **Credential selection**: Scraper uses only `project.credential_id` — no auto-match fallback by jurisdiction or permit number.
- **File storage**: Downloaded files are uploaded to Supabase Storage bucket `project-drawings` (slug, no spaces) at path `drawings/${projectId}/${fileName}`. Public URLs stored as `viewUrl` in `portal_data`. Local file deleted after successful upload; kept as backup if upload fails. Bucket auto-created on first use. `ensureStorageBucket()` finds bucket by slug `project-drawings`, auto-sets public if not already. File paths are sanitized via `sanitizeStorageKey()` (spaces→underscores, special chars stripped).
- **PDF corruption prevention**: All 3 download paths (download-button, viewer-source-URL, captured-responses) validate `%PDF` magic header before saving. `hasValidPdfHeader()` checks first 4 bytes. Captured responses are pre-filtered to valid PDFs only before selecting the largest. Non-PDF file types bypass header validation. Prevents saving HTML viewer wrappers or CSS bundles as PDFs.
- **Download cache busting**: Route interceptor strips `Cache-Control`, `Pragma`, `If-None-Match`, `If-Modified-Since` headers on file-like requests to prevent Chromium HTTP cache from returning stale/duplicate responses across `viewFile()` calls. Viewer source URL fetch uses `cache: "no-store"` plus `_nocache` query param. Route handler properly unrouted in `finally` block.
- **Duplicate detection**: MD5 hash computed for every downloaded file. Session-level `_downloadedHashes` Map tracks `{ fileName, viewUrl }` per content hash. `isDuplicate()` returns `{ dup, aliasUrl }` — when a duplicate is found, the original file's `viewUrl` is aliased to the duplicate entry so both files are clickable in the UI. `registerHash()` records hash→URL after each upload. `skippedDuplicate: true` returned for duplicate files.
- **Junk URL filtering**: `JUNK_URL_PATTERNS` regex filters out WebViewer library files (`pdfnet.res`, `PDFNetCWasm`, `webviewer.min`, etc.) at both capture time and selection time. PDF response selection priority: `RetrieveFile`/`File/Download` URLs with `application/pdf` → any `application/pdf` with valid header → fallback valid `%PDF` header.
- **Browser crash resilience (March 2026)**: Long scrapes no longer crash due to accumulated RAM.
  - **Mini-reset**: Every 10 file downloads (tab-wide counter across folders), the scraper closes the current page and opens a fresh one in the same browser context (preserving cookies), then re-navigates to the files tab and current folder. Clears page-level JS heap and DOM.
  - **Target-closed recovery**: `isTargetClosedError()` detects browser/context/page crash errors. `recoverPage()` first tries creating a fresh page in the existing context; if the context is also dead, `reinitializeBrowser()` launches a new browser, logs in again, re-establishes the WebUI session, and updates `session.browser`/`session.context`.
  - **Folder-level recovery**: Before clicking each folder, `isPageAlive()` AND `browser.isConnected()` are checked. If browser is disconnected, full re-initialization is triggered. If just the page died, `recoverPage()` is used. If a folder crashes mid-scrape, recovery is attempted before the next folder; if unrecoverable, remaining folders are marked with `folderError: "browser_crashed"`.
  - **Tab-level recovery**: `scrapeAll` re-reads `session.context` before each tab. If a tab crashes with a target-closed error, `reinitializeBrowser()` is called before proceeding to the next tab.
  - **Failed file tracking**: Files that fail to download get `downloadStatus: "failed"` and `downloadError` in the portal data. A red "Failed" badge is shown next to these files in `PortalDataViewer`.
  - **Folder name on files**: Each file entry includes `folderName` attribute for UI grouping (e.g. "Drawings", "Supporting Documents").
  - **Extended timeouts**: Navigation timeout increased to 90s, grid wait timeout to 60s to prevent premature timeouts on slow portals.
- **PortalDataViewer real-time refresh**: Supabase realtime subscription triggers `silentRefetch` (full DB query) instead of using payload directly (avoids Supabase ~1MB payload limit). Auto-polls every 10s while scraping is active via `useScrape().isScraping`. Manual "Refresh Data" button for on-demand refresh. Console logs file count and viewUrl status on load/refetch.
- **Targeted folder scraping (March 2026)**: `scrapeMode: "supporting_docs"` triggers files-only scrape filtered to the "Supporting Documents" folder. `targetFolder` param threaded through `/api/scrape` → `scrapeAll` → `extractFilesTab`. `TARGET_FOLDER_MAP` maps folder keys to regex patterns. Folder-level merge logic preserves existing folders (e.g. Drawings) when only targeted folders are updated. Falls back to all folders if no match found. Progress messages show "Targeting: Supporting Documents..." during the scrape. Frontend dropdown option: "Scrape Supporting Docs Only" in AgentWorkflowStatus.

### Data Fetching Optimization (March 2026)
- **`useProjects` hook** excludes `portal_data` JSONB from default fetch to avoid loading megabytes on every page. Uses explicit column list.
- **`useProjectPortalData` hook** (`src/hooks/useProjectPortalData.ts`) fetches `portal_data` on-demand for specific project IDs only.
- **All data hooks** use explicit `.select()` column lists instead of `.select('*')`: `useAnalytics`, `useProjectDocuments`, `useProjectActivity`, `useProjectTeam`, `useInspections`, `useDocumentComments`.
- **Database indexes** added via migration `20260310000001`: `agent_runs(filing_id)`, `shadow_predictions(created_at)`, `parsed_comments(discipline)`.

## External Dependencies

- **Supabase:** Primary backend for database, authentication, edge functions, and storage.
- **OpenAI:** Powers AI functionalities within Supabase Edge Functions.
- **Stripe:** Handles subscription billing and checkout.
- **Resend:** Manages transactional emails.
- **Mapbox:** Provides interactive mapping capabilities.
- **Playwright:** Used by the scraper service for web automation.
- **Capacitor:** For potential native iOS/Android builds.
- **PDF Libraries:** `jsPDF` for client-side PDF generation and `pdfjs-dist` for parsing and rendering PDFs.