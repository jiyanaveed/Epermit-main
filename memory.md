# Project memory — Epermit (PermitPilot)

Long-term memory for work performed on this repository. Append new entries; do not overwrite. No secrets or env values.

---

## 2026-03-18 — Repo cleanup audit (no deletions)

**Action:** Safe cleanup audit of the full repository. No files were deleted.

**Scope:**
- Scanned repository tree for suspicious files: debug screenshots, temp exports, test artifacts, duplicate assets, unused images/media, orphan components/pages, dead scripts, unused SQL/docs, backup/empty files.
- Checked references via imports, routes, config (vite, package.json), and grep across frontend and scraper-service.

**Key findings:**
- **Safe to delete (4):** Root file `Untitled` (scratch git instructions), `scraper-service/0_DISK_TEST.txt`, `scraper-service/debug_accela_search.png`, `scraper-service/login_stuck.png` — none referenced.
- **Likely safe / manual review (95+):** 57 `scraper-service/PROBE_*` PNGs (probe/debug screenshots, unreferenced); entire `attached_assets/` folder (78+ files: Screenshots, Pasted-*.txt, videos, docx — not referenced in code); 3 `public/data/*.csv`; `scripts/run_parsed_comments_discipline_nullable.sql` (redundant with migration); `scripts/DISCIPLINE_CLASSIFIER_DEBUG_REPORT.md`; orphan page `src/pages/Index.tsx` (not in router; App uses LandingPage for `/`).
- **Must keep:** All `public/` assets referenced in index.html/vite.config (placeholder.svg, PWA icons, og-image, etc.); supabase/migrations; scripts referenced in docs (test-intake-pipeline.js, DEPLOY_AND_VERIFY.md); root docs (README, PROJECT_KNOWLEDGE_BASE, TECHNICAL_AUDIT_REPORT, ADMIN_PANEL_ANALYSIS, APP_SUMMARY, SPEC_COMPLIANCE_REPORT, replit.md); dev.sh; scraper code that writes debug PNGs (no dependency on existing files).

**Files produced:**
- `REPO_CLEANUP_AUDIT.md` — Full audit with tables, batches, and warnings.

**Risks / warnings:**
- Do not delete supabase/migrations, referenced public assets, or .env.
- attached_assets may contain conversation/design context; review before bulk delete.
- Index.tsx imports many home components; if removed, confirm LandingPage or others still use them.

**Next recommended step:** Await approval for deletion. Then execute in order: Batch 1 (4 items) → Batch 2 (57 PROBE_* PNGs) → Batches 3–4 after manual review of attached_assets, public/data CSV, scripts, and Index.tsx.

---

## 2026-03-18 — Safe deletion Batch 1 completed

**Timestamp:** 2026-03-18

**Action:** Permanently deleted the four files listed as "Safe to delete now" in REPO_CLEANUP_AUDIT.md (Batch 1 only).

**Files deleted:**
- `Untitled` (root scratch file)
- `scraper-service/0_DISK_TEST.txt`
- `scraper-service/debug_accela_search.png`
- `scraper-service/login_stuck.png`

**Verification:** Confirmed all four paths no longer exist (ls returned "No such file or directory" for each). No directories were removed. No other files were modified.

**Confirmation:** No errors occurred during deletion.

**Next recommended step:** If desired, proceed with Batch 2 (delete all 57 `scraper-service/PROBE_1_BEFORE_*.png` and `scraper-service/PROBE_2_AFTER_*.png` files). Otherwise, leave Batches 3–4 for manual review as in the audit.

---
