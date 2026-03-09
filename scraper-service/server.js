require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { chromium } = require("playwright");
const ExcelJS = require("exceljs");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const { accelaLogin: accelaScraperLogin, scrapeAccelaRecord } = require("./accela-scraper");
const {
  permitWizardLogin,
  getSession: getPWSession,
  checkSessionAlive,
  reAuthenticate,
  destroySession: destroyPWSession,
  getActiveSessionCount,
  accelaLogin,
  accelaLogout,
  getAccelaSession,
} = require("./permitwizard-auth");
const { permitWizardFile, WIZARD_STEPS } = require("./permitwizard-filer");
const { permitWizardSubmit } = require("./permitwizard-submit");
const {
  momentumLogin,
  momentumLogout,
  getMomentumSession,
  checkSessionAlive: checkMomentumSessionAlive,
} = require("./momentum-auth");
const {
  montgomeryLogin,
  montgomeryLogout,
  getMontgomerySession,
  checkSessionAlive: checkMontgomerySessionAlive,
  reAuthenticate: reAuthenticateMontgomery,
} = require("./montgomery-auth");
const {
  energovLogin,
  energovLogout,
  getEnergovSession,
  checkSessionAlive: checkEnergovSessionAlive,
} = require("./energov-auth");
const { momentumFile } = require("./momentum-filer");
const { momentumSubmit } = require("./momentum-submit");
const { montgomeryFile } = require("./montgomery-filer");
const { montgomerySubmit } = require("./montgomery-submit");
const { energovFile } = require("./energov-filer");
const { energovSubmit } = require("./energov-submit");

function detectPortalType(url) {
  if (!url) return "projectdox";
  const lower = url.toLowerCase();
  if (lower.includes("avolvecloud.com") || lower.includes("projectdox")) return "projectdox";
  if (lower.includes("accela.com")) return "accela";
  return "unknown";
}

function stableStringify(obj) {
  if (obj === null || obj === undefined) return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(stableStringify).join(",") + "]";
  if (typeof obj === "object") {
    const keys = Object.keys(obj).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
  }
  return JSON.stringify(obj);
}

function hashPortalData(data) {
  return crypto.createHash("sha256").update(stableStringify(data)).digest("hex");
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = 3001;
const DEFAULT_DASHBOARD_URL = "https://washington-dc-us.avolvecloud.com";

function deriveWebUiBase(dashboardUrl) {
  try {
    const u = new URL(dashboardUrl);
    const parts = u.hostname.split(".");
    if (parts.length >= 2 && parts[0]) {
      parts[0] = parts[0] + "-projectdoxwebui";
      return `${u.protocol}//${parts.join(".")}`;
    }
  } catch (e) {}
  return "https://washington-dc-us-projectdoxwebui.avolvecloud.com";
}

// ─── Supabase: load from .env ───────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const sessions = {};

app.get("/", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "index.html")),
);

app.get("/api/progress/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  const interval = setInterval(() => {
    const s = sessions[sessionId];
    if (s) {
      res.write(
        `data: ${JSON.stringify({ status: s.status, message: s.message, progress: s.progress, total: s.total })}\n\n`,
      );
      if (s.status === "done" || s.status === "error") {
        clearInterval(interval);
        res.end();
      }
    }
  }, 800);
  req.on("close", () => clearInterval(interval));
});

// ─── Login helper ────────────────────────────────────────────────────────────
async function performLogin(page, username, password, dashboardUrl) {
  await page.goto(dashboardUrl, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(2000);
  let url = page.url();
  console.log(`  Landed on: ${url}`);

  if (url.includes("SessionEnded")) {
    const link = await page.$(
      'a:has-text("Log in again"), a:has-text("Login"), a[href*="Login"]',
    );
    if (link) {
      await link.click();
      await page
        .waitForNavigation({ waitUntil: "networkidle", timeout: 15000 })
        .catch(() => {});
      await page.waitForTimeout(2000);
      url = page.url();
    }
  }
  if (url.includes("SSOLanding") || url.includes("Home/SSO")) {
    const btn = await page.$(
      'button:has-text("Continue"), a:has-text("Continue"), input[value="Continue"]',
    );
    if (btn) {
      await btn.click();
      await page
        .waitForNavigation({ waitUntil: "networkidle", timeout: 15000 })
        .catch(() => {});
      await page.waitForTimeout(2000);
      url = page.url();
    }
  }
  if (url.includes("b2clogin.com")) {
    const ab = await page.$("#OktaExchange");
    if (ab) await ab.click();
    else await page.click('button[type="submit"]');
    await page
      .waitForNavigation({ waitUntil: "networkidle", timeout: 30000 })
      .catch(() => {});
    await page.waitForTimeout(3000);
    url = page.url();
    console.log(`  After B2C: ${url}`);
  }
  if (
    url.includes("okta") ||
    url.includes("b2clogin") ||
    url.includes("login") ||
    url.includes("signin")
  ) {
    const uSel = [
      'input[name="identifier"]',
      "#okta-signin-username",
      'input[name="username"]',
      'input[type="email"]',
      'input[type="text"]',
    ];
    let uF = null;
    for (const s of uSel) {
      uF = await page.$(s);
      if (uF && (await uF.isVisible().catch(() => false))) break;
      uF = null;
    }
    if (!uF) throw new Error("Cannot find username field");
    await uF.fill(username);
    console.log("  Filled username");

    const pSel = [
      'input[name="credentials.passcode"]',
      "#okta-signin-password",
      'input[name="password"]',
      'input[type="password"]',
    ];
    let pF = null;
    for (const s of pSel) {
      pF = await page.$(s);
      if (pF && (await pF.isVisible().catch(() => false))) break;
      pF = null;
    }
    if (!pF) {
      console.log("  Two-step login...");
      const nb = await page.$('input[type="submit"], button[type="submit"]');
      if (nb) await nb.click();
      else await page.keyboard.press("Enter");
      await page
        .waitForNavigation({ waitUntil: "networkidle", timeout: 15000 })
        .catch(() => {});
      await page.waitForTimeout(2000);
      for (const s of pSel) {
        pF = await page.$(s);
        if (pF && (await pF.isVisible().catch(() => false))) break;
        pF = null;
      }
      if (!pF) throw new Error("Cannot find password field");
    }
    await pF.fill(password);
    console.log("  Filled password");
    const sb = await page.$('input[type="submit"], button[type="submit"]');
    if (sb) await sb.click();
    else await page.keyboard.press("Enter");
    await page
      .waitForNavigation({ waitUntil: "networkidle", timeout: 30000 })
      .catch(() => {});
    await page.waitForTimeout(3000);
    url = page.url();
    console.log(`  After login: ${url}`);
  }
  if (url.includes("SSOLanding") || url.includes("Home/SSO")) {
    const btn = await page.$(
      'button:has-text("Continue"), a:has-text("Continue"), input[value="Continue"]',
    );
    if (btn) {
      await btn.click();
      await page
        .waitForNavigation({ waitUntil: "networkidle", timeout: 15000 })
        .catch(() => {});
      await page.waitForTimeout(2000);
    }
  }
  url = page.url();
  if (
    url.includes("b2clogin") ||
    url.includes("SessionEnded") ||
    url.includes("okta.com/signin")
  )
    throw new Error("Login failed");
  return url;
}

// ─── Login endpoint ──────────────────────────────────────────────────────────
app.post("/api/login", async (req, res) => {
  const { username, password, portalUrl } = req.body;
  const dashboardUrl = (portalUrl && portalUrl.trim()) ? portalUrl.trim().replace(/\/+$/, "").replace(/\/User\/Index$/i, "") : DEFAULT_DASHBOARD_URL;
  const portalType = detectPortalType(dashboardUrl);
  console.log(`Portal URL: ${dashboardUrl}`);
  console.log(`Portal Type: ${portalType}`);

  if (portalType === "unknown") {
    return res.status(400).json({ error: "Unsupported portal type. Supported: ProjectDox (avolvecloud.com) and Accela (accela.com)" });
  }

  const webUiBase = portalType === "projectdox" ? deriveWebUiBase(dashboardUrl) : null;
  if (webUiBase) console.log(`WebUI Base: ${webUiBase}`);
  let browser;
  try {
    console.log("🔐 Launching browser...");
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();

    if (portalType === "accela") {
      await accelaScraperLogin(page, username, password, dashboardUrl);
      console.log("✅ Accela login successful!");

      await page.screenshot({
        path: path.join(__dirname, "debug_dashboard.png"),
        fullPage: true,
      });

      const sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2);
      sessions[sessionId] = {
        status: "logged_in",
        portalType: "accela",
        portalUrl: dashboardUrl,
        projects: [],
        browser,
        context,
        page,
        username,
        password,
        dashboardUrl,
        message: "Logged in to Accela — ready to search permits",
        progress: 0,
        total: 0,
        data: {},
      };
      sessions[sessionId]._timeout = setTimeout(
        () => cleanupSession(sessionId),
        15 * 60 * 1000,
      );
      return res.json({ sessionId, projectCount: 0, projects: [], portalType: "accela", message: "Logged in to Accela. Use /api/scrape with permitNumber to search." });
    }

    await performLogin(page, username, password, dashboardUrl);
    console.log("✅ Login successful!");

    if (
      !page.url().includes("avolvecloud.com") ||
      page.url().includes("projectdoxwebui")
    ) {
      await page.goto(dashboardUrl, {
        waitUntil: "networkidle",
        timeout: 30000,
      });
      await page.waitForTimeout(2000);
    }

    await page.screenshot({
      path: path.join(__dirname, "debug_dashboard.png"),
      fullPage: true,
    });

    // Extract projects — also grab ProjectID from the javascript:launchRemote hrefs
    const projects = await page.evaluate(() => {
      const results = [];
      const seen = new Set();
      document.querySelectorAll("table tr").forEach((tr) => {
        const cells = tr.querySelectorAll("td");
        if (cells.length >= 2) {
          const link = cells[0]?.querySelector("a");
          if (link) {
            const num = link.textContent.trim();
            const href = link.getAttribute("href") || "";
            // Extract ProjectID from javascript:launchRemote('Frame.aspx?tab=projectStatusTab&ProjectID=9187')
            const pidMatch = href.match(/ProjectID=(\d+)/);
            const projectId = pidMatch ? pidMatch[1] : "";

            if (num && !seen.has(num)) {
              seen.add(num);
              let status = (() => {
                const cell = cells[3];
                if (!cell) return "";
                const btn = cell.querySelector("button, a.btn, span.badge, a");
                if (btn) return btn.textContent.trim();
                return cell.textContent.trim();
              })();
              if (status && status.length > 2 && status.length % 2 === 0) {
                const half = status.substring(0, status.length / 2);
                if (status === half + half) status = half;
              }
              results.push({
                id: projectId || num,
                name: num,
                projectNum: num,
                projectId,
                description: cells[1]?.textContent?.trim() || "",
                location: cells[2]?.textContent?.trim() || "",
                status: status || "",
                tasks: cells[4]?.textContent?.trim() || "",
                href,
              });
            }
          }
        }
      });
      return results;
    });

    console.log(`📋 Found ${projects.length} projects`);
    projects.forEach((p) =>
      console.log(`   ${p.projectNum} (ID: ${p.projectId})`),
    );

    // ── CRITICAL: Establish WebUI session by navigating through a project link ──
    if (projects.length > 0) {
      const firstProject = projects[0];
      console.log(
        `\n🔗 Establishing WebUI session via project ${firstProject.projectNum}...`,
      );

      const [popup] = await Promise.all([
        context.waitForEvent("page", { timeout: 15000 }).catch(() => null),
        page.click(`a:has-text("${firstProject.projectNum}")`),
      ]);

      if (popup) {
        console.log(`   Popup opened: ${popup.url()}`);
        await popup.waitForLoadState("networkidle").catch(() => {});
        await popup.waitForTimeout(2000);
        console.log(`   Popup final URL: ${popup.url()}`);
        await popup.close();
      } else {
        console.log(
          "   No popup detected. Checking for iframe or navigation...",
        );
        await page.waitForTimeout(3000);
        const testPage = await context.newPage();
        await testPage.goto(
          `${webUiBase}/WebForms/Frame.aspx?tab=projectStatusTab&ProjectID=${firstProject.projectId}`,
          {
            waitUntil: "networkidle",
            timeout: 30000,
          },
        );
        await testPage.waitForTimeout(2000);
        await testPage.close();
      }
    }

    const sessionId =
      Date.now().toString(36) + Math.random().toString(36).slice(2);
    sessions[sessionId] = {
      status: "logged_in",
      portalType: "projectdox",
      projects,
      browser,
      context,
      page,
      username,
      password,
      dashboardUrl,
      webUiBase,
      message: `Found ${projects.length} projects`,
      progress: 0,
      total: 0,
      data: {},
    };
    sessions[sessionId]._timeout = setTimeout(
      () => cleanupSession(sessionId),
      15 * 60 * 1000,
    );
    res.json({ sessionId, projectCount: projects.length, projects });
  } catch (err) {
    console.error("❌ Login error:", err.message);
    if (browser) await browser.close().catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

function cleanupSession(sid) {
  const s = sessions[sid];
  if (s) {
    if (s._timeout) clearTimeout(s._timeout);
    if (s.browser) s.browser.close().catch(() => {});
    s.browser = null;
    s.context = null;
    s.page = null;
  }
}

// ─── Scrape endpoint ─────────────────────────────────────────────────────────
app.post("/api/scrape", async (req, res) => {
  const {
    sessionId,
    projectIds,
    tabs: tabsParam,
    permitNumber,
    projectId,
    userId,
  } = req.body;
  const session = sessions[sessionId];
  if (!session) return res.status(404).json({ error: "Session not found" });
  if (!session.browser)
    return res.status(400).json({ error: "Session expired." });
  if (session._timeout) clearTimeout(session._timeout);
  session._timeout = setTimeout(
    () => cleanupSession(sessionId),
    15 * 60 * 1000,
  );

  if (session.portalType === "accela") {
    if (!permitNumber || String(permitNumber).trim() === "") {
      return res.status(400).json({ error: "Accela scraping requires a permitNumber" });
    }
    session.status = "scraping";
    session.total = 1;
    session.progress = 0;
    session.message = `Scraping Accela permit: ${permitNumber}`;
    res.json({ message: "Accela scraping started", total: 1, portalType: "accela" });
    scrapeAccelaRecord(session, String(permitNumber).trim(), projectId, userId, supabase, hashPortalData)
      .then(() => {
        session.status = "done";
        session.progress = 1;
        session.message = `Accela scrape complete for ${permitNumber}`;
        console.log(`   ✅ Accela sync complete — session status set to "done"`);
      })
      .catch((err) => {
        session.status = "error";
        session.message = `Error: ${err.message}`;
        console.error("❌ Accela scrape error:", err.message);
      });
    return;
  }

  // permitNumber takes priority over projectIds
  let targets;
  if (permitNumber != null && String(permitNumber).trim() !== "") {
    targets = session.projects.filter(
      (p) => String(p.projectNum || "").trim() === String(permitNumber).trim(),
    );
    if (targets.length === 0) {
      return res
        .status(404)
        .json({
          error: "No project found matching permit number: " + permitNumber,
        });
    }
  } else {
    const ids = Array.isArray(projectIds) ? projectIds : [];
    targets =
      ids.length > 0
        ? session.projects.filter((p) =>
            ids.some((pid) => String(pid) === String(p.id)),
          )
        : session.projects;
  }

  const tabsFilter =
    Array.isArray(tabsParam) && tabsParam.length > 0 ? tabsParam : null;
  const tabsToUse = tabsFilter || TAB_DEFS.map((t) => t.key);
  const tabCount = TAB_DEFS.filter((t) => tabsToUse.includes(t.key)).length;
  session.status = "scraping";
  session.total = targets.length * tabCount;
  session.progress = 0;
  session.data = {};
  res.json({ message: "Scraping started", total: session.total });
  scrapeAll(session, targets, sessionId, tabsToUse, projectId, userId).catch(
    (err) => {
      session.status = "error";
      session.message = `Error: ${err.message}`;
      console.error("❌", err);
    },
  );
});

const TAB_DEFS = [
  { key: "status", label: "Status", param: "projectStatusTab" },
  { key: "files", label: "Files", param: "filesTab" },
  { key: "tasks", label: "Tasks", param: "tasksTab" },
  { key: "info", label: "Info", param: "infoTab" },
  { key: "reports", label: "Reports", param: "reportsTab" },
];

async function scrapeAll(
  session,
  projects,
  sessionId,
  tabsToUse,
  supabaseProjectId,
  userId,
) {
  const tabsFilter =
    tabsToUse && tabsToUse.length > 0 ? new Set(tabsToUse) : null;
  const tabsToScrape = tabsFilter
    ? TAB_DEFS.filter((t) => tabsFilter.has(t.key))
    : TAB_DEFS;

  console.log(`\n🔍 Scraping ${projects.length} projects...`);
  const context = session.context;
  const dashPage = session.page;

  for (let pi = 0; pi < projects.length; pi++) {
    const project = projects[pi];
    console.log(
      `\n📂 [${pi + 1}/${projects.length}] ${project.projectNum} (ID: ${project.projectId})`,
    );
    session.data[project.id] = {
      name: project.name,
      projectNum: project.projectNum,
      description: project.description || "",
      location: project.location || "",
      dashboardStatus: project.status || "",
      tabs: {},
    };

    for (const tab of tabsToScrape) {
      session.message = `${project.projectNum} → ${tab.label}`;
      console.log(`   📑 ${tab.label}...`);

      let page;
      try {
        page = await context.newPage();
        const webUiUrl = `${session.webUiBase}/WebForms/Frame.aspx?tab=${tab.param}&ProjectID=${project.projectId}`;
        await page.goto(webUiUrl, { waitUntil: "networkidle", timeout: 30000 });
        await page.waitForTimeout(2000);

        let pUrl = page.url();
        if (pUrl.includes("SessionEnded") || pUrl.includes("b2clogin")) {
          // Basic session logic here
        }

        // Ensure correct tab content is loaded
        if (tab.key === "info") {
          // ProjectDox Info tab has a "Project Info" sub-tab that needs clicking
          const projectInfoTab = await page.$(
            'a:has-text("Project Info"), [id*="projectInfo"], a[href*="projectInfo"]',
          );
          if (projectInfoTab) {
            console.log("     Clicking 'Project Info' sub-tab...");
            await projectInfoTab.click().catch(() => {});
            await page.waitForTimeout(3000);
            await page.waitForLoadState("networkidle").catch(() => {});
          }
          // Also try clicking the Info tab itself in case page loaded on wrong tab
          const infoTabLink = await page.$(
            'a[href*="infoTab"]:not([class*="active"]), li:not(.active) > a:has-text("Info")',
          );
          if (infoTabLink) {
            console.log("     Clicking 'Info' tab link...");
            await infoTabLink.click().catch(() => {});
            await page.waitForTimeout(3000);
            await page.waitForLoadState("networkidle").catch(() => {});
          }
        }

        if (tab.key === "reports") {
          // Make sure Reports tab content is loaded
          const reportsTabLink = await page.$(
            'a[href*="reportsTab"]:not([class*="active"]), li:not(.active) > a:has-text("Reports")',
          );
          if (reportsTabLink) {
            console.log("     Clicking 'Reports' tab link...");
            await reportsTabLink.click().catch(() => {});
            await page.waitForTimeout(3000);
            await page.waitForLoadState("networkidle").catch(() => {});
          }
        }

        const tabData = await extractPageData(page);
        if (tab.key === "info") {
          const infoKeyValues = await page.evaluate(() => {
            const kvs = [];
            const seen = new Set();

            // The Project Info table has 2-column rows: label cell and value cell
            // Labels are bold text ending with ":"
            const allRows = document.querySelectorAll("table tr");

            for (const tr of allRows) {
              const cells = tr.querySelectorAll("td");
              // Support both 2-cell rows and 1-cell rows (empty value cell missing in DOM)
              if (cells.length < 1) continue;

              const labelCell = cells[0];
              const valueCell = cells.length >= 2 ? cells[1] : null;

              const boldEl = labelCell.querySelector("b, strong");
              let label = "";
              if (boldEl) {
                label = boldEl.textContent.trim();
              } else {
                label = labelCell.textContent.trim();
              }

              label = label.replace(/:$/, "").trim();

              if (!label || label.length > 50 || seen.has(label)) continue;
              if (label.toLowerCase().includes("filter")) continue;
              if (label.toLowerCase().includes("select")) continue;

              const rawValue = valueCell
                ? valueCell.textContent.trim().replace(/\s+/g, " ").trim()
                : "";
              const value = (rawValue || "").replace(/\u00a0/g, "").trim();

              seen.add(label);
              kvs.push({ key: label, value: value });
            }

            return kvs;
          });

          // DEBUG: log raw Project Info extraction for alignment bug (Cell Phone blank)
          console.log(
            "     [DEBUG] infoKeyValues count:",
            infoKeyValues.length,
          );
          const cellPhoneEntry = infoKeyValues.find((kv) =>
            /cell\s*phone/i.test(kv.key),
          );
          console.log(
            "     [DEBUG] Cell Phone in raw list:",
            cellPhoneEntry
              ? {
                  key: cellPhoneEntry.key,
                  valueLength: cellPhoneEntry.value?.length,
                  valuePreview: (cellPhoneEntry.value || "").slice(0, 20),
                }
              : "NOT FOUND",
          );
          console.log(
            "     [DEBUG] All keys in order:",
            infoKeyValues.map((k) => k.key),
          );

          // Filter out noise but keep Description (allow up to 1000 chars)
          const cleanKvs = infoKeyValues.filter((kv) => {
            if (kv.key === "") return false;
            if (kv.value.includes("Select One")) return false;
            if (kv.value.length > 1000) return false;
            return true;
          });

          // DC ProjectDox often produces malformed projectInfo (values as keys). Frontend will use
          // tabs.info.tables + portalData instead. Skip writing projectInfo when extraction looks wrong.
          const firstKey = cleanKvs[0]?.key ?? "";
          const looksLikePermitNumber =
            /^[A-Z]\d{6,}$/.test(firstKey.trim()) ||
            firstKey === project.projectNum;
          const looksLikeValueNotLabel = cleanKvs.some(
            (kv) => kv.key?.length > 50 || /^\d+$/.test(kv.key?.trim()),
          );
          const skipProjectInfo =
            looksLikePermitNumber || looksLikeValueNotLabel;

          if (cleanKvs.length > 0 && !skipProjectInfo) {
            console.log(
              `     📋 Extracted ${cleanKvs.length} Project Info fields: ${cleanKvs.map((k) => k.key).join(", ")}`,
            );
            tabData.projectInfo = cleanKvs;
          } else if (skipProjectInfo) {
            console.log(
              `     📋 Skipping projectInfo (DC ProjectDox-style extraction); frontend will use tables + portalData`,
            );
          }

          // Filter out malformed tables (those with huge headers > 100 chars)
          tabData.tables = (tabData.tables || []).filter((tbl) => {
            const hasHugeHeader = tbl.headers?.some((h) => h.length > 100);
            return !hasHugeHeader;
          });
        }
        if (tab.key === "files") {
          const filesResult = await extractFilesTab(page, context, session);
          tabData.folders = filesResult.folders;
          const totalFiles = filesResult.folders.reduce((s, f) => s + f.files.length, 0);
          const totalComments = filesResult.folders.reduce((s, f) => s + f.files.reduce((s2, fi) => s2 + fi.commentCount, 0), 0);
          console.log(
            `      ✓ ${filesResult.folders.length} folders, ${totalFiles} files, ${totalComments} comments`,
          );
        } else if (tab.key === "reports") {
          const pdfs = await extractPDFsFromPage(page, context);
          tabData.pdfs = pdfs;
          console.log(
            `      ✓ ${tabData.keyValues.length} fields, ${tabData.tables.length} tables, ${pdfs.length} PDFs`,
          );
        } else {
          console.log(
            `      ✓ ${tabData.keyValues.length} fields, ${tabData.tables.length} tables`,
          );
        }
        session.data[project.id].tabs[tab.key] = tabData;
      } catch (err) {
        console.error(`      ✗ ${err.message}`);
        const errTab = {
          error: err.message,
          keyValues: [],
          tables: [],
          links: [],
        };
        if (tab.key === "reports") errTab.pdfs = [];
        if (tab.key === "files") errTab.folders = [];
        session.data[project.id].tabs[tab.key] = errTab;
      }
      if (page) await page.close().catch(() => {});
      session.progress++;
    }
  }

  session.message = `Scraping complete! Syncing to database...`;
  console.log(`\n✅ Done! Syncing to Supabase...`);

  // ─── 💾 SYNC TO SUPABASE (after scraping completes) ─────────────────────────
  for (let i = 0; i < projects.length; i++) {
    const project = projects[i];
    const projectNum = project.projectNum;
    const currentData = session.data[project.id];
    if (!currentData) continue;
    let actualProjectId = null;

    const newHash = hashPortalData(currentData);

    try {
      console.log(`   🔄 Syncing ${projectNum} to Supabase...`);

      const { data: existingRows } = await supabase
        .from("projects")
        .select("id, portal_data_hash")
        .eq("permit_number", projectNum)
        .eq("user_id", userId);

      const existingRow = existingRows && existingRows.length > 0 ? existingRows[0] : null;

      if (existingRow && existingRow.portal_data_hash === newHash) {
        actualProjectId = existingRow.id;
        console.log(
          `   ⏭️  Data unchanged for ${projectNum} (hash match), skipping update`,
        );
        await supabase
          .from("projects")
          .update({ last_checked_at: new Date().toISOString() })
          .eq("id", actualProjectId);
      } else {
        const updatePayload = {
          portal_status: currentData.dashboardStatus || "Scraped",
          last_checked_at: new Date().toISOString(),
          portal_data: currentData,
          portal_data_hash: newHash,
          permit_number: projectNum,
        };

        let { data, error } = await supabase
          .from("projects")
          .update(updatePayload)
          .eq("permit_number", projectNum)
          .eq("user_id", userId)
          .select();

        if (error) {
          console.error("   ❌ Supabase error:", error.message, error.details);
          continue;
        }

        if (data && Array.isArray(data) && data.length > 0) {
          actualProjectId = data[0].id;
          console.log(
            "   ✅ Updated existing project (new data):",
            actualProjectId,
          );
        } else {
          const { data: data2, error: err2 } = await supabase
            .from("projects")
            .update(updatePayload)
            .eq("permit_number", projectNum)
            .select();
          if (err2) {
            console.error(
              "   ❌ Supabase error (permit_number fallback):",
              err2.message,
              err2.details,
            );
            continue;
          }
          if (data2 && Array.isArray(data2) && data2.length > 0) {
            actualProjectId = data2[0].id;
            console.log(
              "   ✅ Updated existing project (permit_number match):",
              actualProjectId,
            );
          } else {
            if (!userId) {
              console.error("   ❌ Cannot create project: userId not provided");
              continue;
            }
            const { data: created, error: createError } = await supabase
              .from("projects")
              .insert({
                user_id: userId,
                name: currentData.projectNum || projectNum,
                permit_number: projectNum,
                description: currentData.description || "",
                address: currentData.location || "",
                jurisdiction: "Washington DC",
                status: "draft",
                portal_status: currentData.dashboardStatus || "Unknown",
                last_checked_at: new Date().toISOString(),
                portal_data: currentData,
                portal_data_hash: newHash,
              })
              .select();
            if (createError) {
              console.error(
                "   ❌ Supabase create error:",
                createError.message,
                createError.details,
              );
              continue;
            }
            if (created && created.length > 0) {
              actualProjectId = created[0].id;
              console.log(
                "   📝 Created new project:",
                actualProjectId,
                "for permit",
                projectNum,
              );
            }
          }
        }
      }

      if (actualProjectId) {
        const { error: credErr } = await supabase
          .from("portal_credentials")
          .update({ project_id: actualProjectId, permit_number: projectNum })
          .or(
            `project_id.eq.${actualProjectId},permit_number.eq.${projectNum}`,
          );
        if (credErr) {
          console.warn(
            "   ⚠️ Could not update portal_credentials project_id:",
            credErr.message,
          );
        }
      }
    } catch (dbErr) {
      console.error("   ❌ DB Error:", dbErr.message);
    }
  }

  session.status = "done";
  session.message = `Scraping complete! ${projects.length} projects extracted and synced.`;
  console.log(`   ✅ Supabase sync complete — session status set to "done"`);
}

function escapeCSSId(str) {
  return str.replace(/([^\w-])/g, "\\$1");
}

async function extractFilesTab(page, context, session) {
  const result = { folders: [] };

  const folderElements = await page.$$eval(
    'a[id*="FolderName"], a[id*="folderName"], .folder-name, td a[onclick*="Folder"], div.TreeNode a, span.TreeNode a, a[href*="FolderID"], tr a[id*="lnk"]',
    (els) =>
      els.map((el, idx) => ({
        text: el.textContent.trim(),
        id: el.id || "",
        idx: idx,
      }))
  );

  if (folderElements.length === 0) {
    const treeNodes = await page.$$eval(
      'table a, div.tree a, li a, td a',
      (els) =>
        els
          .filter((a) => {
            const t = a.textContent.trim();
            return t.includes("(") && t.includes(")") && t.length < 100;
          })
          .map((el, idx) => ({ text: el.textContent.trim(), id: el.id || "", idx: idx }))
    );
    if (treeNodes.length > 0) {
      console.log(`     Found ${treeNodes.length} folder-like nodes via fallback`);
      folderElements.push(...treeNodes);
    }
  }

  console.log(`     📁 Found ${folderElements.length} folders`);

  for (let fi = 0; fi < folderElements.length; fi++) {
    const folderInfo = folderElements[fi];
    const rawName = folderInfo.text;
    const folderId = folderInfo.id;

    const countMatch = rawName.match(/\((\d+)/);
    const fileCount = countMatch ? parseInt(countMatch[1], 10) : 0;
    const folderName = rawName.replace(/\s*\(.*$/, "").trim();

    console.log(`     📁 [${fi + 1}/${folderElements.length}] "${folderName}" (${fileCount} files)`);
    if (session) session.message = `Files → ${folderName}`;

    const folderData = {
      name: folderName,
      fileCount: fileCount,
      files: [],
    };

    try {
      let folderLink = null;
      if (folderId) {
        folderLink = await page.$(`#${escapeCSSId(folderId)}`);
      }
      if (!folderLink) {
        const allLinks = await page.$$("a");
        for (const link of allLinks) {
          const linkText = await link.textContent().catch(() => "");
          if (linkText.trim() === rawName) {
            folderLink = link;
            break;
          }
        }
      }
      if (folderLink) {
        await folderLink.click();
        await page.waitForTimeout(2000);
        await page.waitForLoadState("networkidle").catch(() => {});
      }

      const fileRows = await page.evaluate(() => {
        const files = [];
        const seen = new Set();
        const rows = document.querySelectorAll(
          'table tr, div.file-list tr, table[id*="File"] tr, table[id*="Grid"] tr'
        );
        for (const row of rows) {
          const cells = row.querySelectorAll("td");
          if (cells.length < 2) continue;

          const linkEl = row.querySelector("a");
          if (!linkEl) continue;

          const fileName = linkEl.textContent.trim();
          if (
            !fileName ||
            fileName.length < 2 ||
            fileName.includes("Folder") ||
            fileName.includes("(")
          )
            continue;

          const href = linkEl.getAttribute("href") || "";
          const onclick = linkEl.getAttribute("onclick") || "";
          const linkId = linkEl.id || "";

          const fileIdMatch =
            href.match(/fileID=(\d+)/i) ||
            onclick.match(/fileID=(\d+)/i) ||
            href.match(/FileId=(\d+)/i);
          const fileId = fileIdMatch ? fileIdMatch[1] : "";

          const dedup = fileId || fileName;
          if (seen.has(dedup)) continue;
          seen.add(dedup);

          const cellTexts = Array.from(cells).map((c) => c.textContent.trim());

          files.push({
            name: fileName,
            fileId: fileId,
            linkId: linkId,
            status: cellTexts[1] || "",
            reviewedBy: cellTexts[2] || "",
            uploadedDate: cellTexts[3] || "",
            hasLink: !!href || !!onclick,
          });
        }
        return files;
      });

      console.log(`       Found ${fileRows.length} files in folder`);

      for (let fileIdx = 0; fileIdx < fileRows.length; fileIdx++) {
        const file = fileRows[fileIdx];
        console.log(
          `       📄 [${fileIdx + 1}/${fileRows.length}] ${file.name}${file.fileId ? ` (ID: ${file.fileId})` : ""}`
        );

        const fileEntry = {
          name: file.name,
          fileId: file.fileId,
          status: file.status,
          reviewedBy: file.reviewedBy,
          uploadedDate: file.uploadedDate,
          comments: [],
          commentCount: 0,
        };

        if (file.fileId && file.hasLink) {
          try {
            let fileLink = null;
            if (file.linkId) {
              fileLink = await page.$(`#${escapeCSSId(file.linkId)}`);
            }
            if (!fileLink && file.fileId) {
              fileLink = await page.$(`a[href*="fileID=${file.fileId}" i], a[onclick*="fileID=${file.fileId}" i]`);
            }
            if (!fileLink) {
              const allAnchors = await page.$$("a");
              for (const a of allAnchors) {
                const t = await a.textContent().catch(() => "");
                if (t.trim() === file.name) {
                  fileLink = a;
                  break;
                }
              }
            }
            if (!fileLink) {
              folderData.files.push(fileEntry);
              continue;
            }

            const [newPage] = await Promise.all([
              context.waitForEvent("page", { timeout: 10000 }).catch(() => null),
              fileLink.click(),
            ]);

            let viewerPage = newPage;
            let openedInNewTab = !!newPage;

            if (!viewerPage) {
              await page.waitForTimeout(3000);
              const currentUrl = page.url();
              if (currentUrl.includes("FileViewer") || currentUrl.includes("fileID")) {
                viewerPage = page;
                openedInNewTab = false;
              } else {
                folderData.files.push(fileEntry);
                continue;
              }
            } else {
              await viewerPage.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
              await viewerPage.waitForTimeout(2000);
            }

            const commentsData = await viewerPage.evaluate(() => {
              const result = { count: 0, comments: [] };

              let commentCount = 0;
              const bodyText = document.body.textContent || "";
              const commentMatch = bodyText.match(/Comments\s*\((\d+)\)/);
              if (commentMatch) {
                commentCount = parseInt(commentMatch[1], 10);
              }
              result.count = commentCount;

              if (commentCount > 0) {
                const commentEls = document.querySelectorAll(
                  '.comment, div[class*="comment"], div[class*="Comment"], tr[class*="comment"]'
                );

                for (const cel of commentEls) {
                  const textEl = cel.querySelector(
                    '.comment-text, .commentText, td:nth-child(2), p, span'
                  );
                  const authorEl = cel.querySelector(
                    '.comment-author, .author, td:nth-child(1), .user'
                  );
                  const dateEl = cel.querySelector(
                    '.comment-date, .date, td:nth-child(3), time'
                  );
                  const pageEl = cel.querySelector(
                    '.comment-page, .page, td:nth-child(4)'
                  );

                  result.comments.push({
                    text: textEl ? textEl.textContent.trim() : cel.textContent.trim().substring(0, 500),
                    author: authorEl ? authorEl.textContent.trim() : "",
                    date: dateEl ? dateEl.textContent.trim() : "",
                    page: pageEl
                      ? parseInt(pageEl.textContent.trim(), 10) || null
                      : null,
                  });
                }

                if (result.comments.length === 0 && commentCount > 0) {
                  const panels = document.querySelectorAll(
                    'div[id*="comment"], div[id*="Comment"], div.panel, div.side-panel'
                  );
                  for (const panel of panels) {
                    const items = panel.querySelectorAll("div, tr, li");
                    for (const item of items) {
                      const t = item.textContent.trim();
                      if (t.length > 5 && t.length < 1000 && !/Comments\s*\(/.test(t)) {
                        result.comments.push({
                          text: t.substring(0, 500),
                          author: "",
                          date: "",
                          page: null,
                        });
                      }
                    }
                  }
                }
              }
              return result;
            }).catch((err) => {
              console.error("         ❌ Comment extraction error:", err.message);
              return { count: 0, comments: [], error: err.message };
            });

            fileEntry.commentCount = commentsData.count;
            fileEntry.comments = commentsData.comments;

            if (commentsData.count > 0) {
              console.log(
                `         💬 ${commentsData.count} comments (extracted ${commentsData.comments.length})`
              );
            }
            if (commentsData.error) {
              console.log(`         ⚠️ Comment extraction error: ${commentsData.error}`);
            }

            if (openedInNewTab) {
              await viewerPage.close().catch(() => {});
            } else {
              await page.goBack({ waitUntil: "networkidle", timeout: 15000 }).catch(async () => {
                let folderLink2 = null;
                if (folderId) {
                  folderLink2 = await page.$(`#${escapeCSSId(folderId)}`);
                }
                if (!folderLink2) {
                  const links = await page.$$("a");
                  for (const link of links) {
                    const t = await link.textContent().catch(() => "");
                    if (t.trim() === rawName) {
                      folderLink2 = link;
                      break;
                    }
                  }
                }
                if (folderLink2) {
                  await folderLink2.click();
                  await page.waitForTimeout(2000);
                }
              });
              await page.waitForTimeout(1000);
            }
          } catch (fileErr) {
            console.log(`         ⚠️ Error opening file: ${fileErr.message}`);
          }
        }

        folderData.files.push(fileEntry);
      }
    } catch (folderErr) {
      console.log(`     ⚠️ Error processing folder "${folderName}": ${folderErr.message}`);
    }

    result.folders.push(folderData);
  }

  return result;
}

async function extractPDFsFromPage(page, context) {
  const pdfData = [];

  // Get all report names from the visible table first
  const reportNames = await page.evaluate(() => {
    const names = [];
    document.querySelectorAll("table tr").forEach((tr) => {
      const cells = tr.querySelectorAll("td");
      if (cells.length >= 3) {
        // Find any link or text in the second cell (Report Name column)
        const nameCell = cells[1];
        if (nameCell) {
          const link = nameCell.querySelector("a");
          const text = (link || nameCell).textContent.trim();
          if (
            text &&
            text.length > 5 &&
            !text.toLowerCase().includes("contains")
          ) {
            names.push(text);
          }
        }
      }
    });
    return names;
  });

  console.log(
    `     📄 Found ${reportNames.length} report names: ${reportNames.map((n) => '"' + n + '"').join(", ")}`,
  );

  if (reportNames.length === 0) {
    console.log("     ⚠️ No report names found in table");
    return pdfData;
  }

  // Click each report link by its text
  for (let i = 0; i < reportNames.length; i++) {
    const reportName = reportNames[i];
    console.log(
      `     📄 [${i + 1}/${reportNames.length}] Clicking: "${reportName}"`,
    );

    try {
      // Find the clickable link by text content
      const linkHandle = await page
        .locator(`a:has-text("${reportName}")`)
        .first()
        .elementHandle()
        .catch(() => null);

      if (!linkHandle) {
        console.log(
          `        ⚠️ Could not find clickable link for "${reportName}"`,
        );
        pdfData.push({
          fileName: reportName,
          text: "",
          pages: 0,
          error: "Link element not found on page",
        });
        continue;
      }

      // Set up popup listener BEFORE clicking
      const popupPromise = context
        .waitForEvent("page", { timeout: 25000 })
        .catch(() => null);

      // Click the link
      await linkHandle.click();
      console.log(`        Clicked, waiting for popup...`);

      const popup = await popupPromise;

      if (popup) {
        console.log(`        Popup detected: ${popup.url()}`);

        // Wait for the report to fully render
        await popup.waitForLoadState("domcontentloaded").catch(() => {});
        await popup.waitForTimeout(3000);
        await popup.waitForLoadState("networkidle").catch(() => {});
        await popup.waitForTimeout(5000);

        const finalUrl = popup.url();
        console.log(`        Popup final URL: ${finalUrl}`);

        // Save debug screenshot for first report
        if (i === 0) {
          await popup
            .screenshot({
              path: path.join(__dirname, "debug_report_popup.png"),
              fullPage: true,
            })
            .catch(() => {});
          console.log(`        📸 debug_report_popup.png saved`);
        }

        // Extract text + full HTML from report popup (SSRS uses nested tables; capture HTML for direct render)
        const content = await popup.evaluate(() => {
          const ssrsSelectors = [
            '[id*="oReportDiv"]',
            '[id*="ReportDiv"]',
            '[id*="VisibleReportContent"]',
            '[id*="ReportViewerControl"]',
            '[id*="reportDiv"]',
          ];

          let targetEl = null;
          for (const sel of ssrsSelectors) {
            const el = document.querySelector(sel);
            if (el && el.innerText && el.innerText.trim().length > 50) {
              targetEl = el;
              break;
            }
          }

          if (!targetEl) {
            const iframes = document.querySelectorAll("iframe");
            for (const iframe of iframes) {
              try {
                const doc =
                  iframe.contentDocument || iframe.contentWindow?.document;
                if (doc?.body?.innerText?.length > 50) {
                  targetEl = doc.body;
                  break;
                }
              } catch (e) {}
            }
          }

          if (!targetEl) {
            const clone = document.body.cloneNode(true);
            clone
              .querySelectorAll(
                "nav, header, footer, style, script, noscript, " +
                  "[id*='toolbar'], [id*='Toolbar'], [class*='toolbar'], " +
                  "button, select, input",
              )
              .forEach((el) => el.remove());
            targetEl = clone;
          }

          const text = targetEl.innerText?.trim() || "";
          const html = targetEl.innerHTML || "";

          return { text, html, source: "ssrs" };
        });

        // Capture full-page screenshot of the report
        let screenshotBase64 = "";
        try {
          const screenshotBuffer = await popup.screenshot({
            fullPage: true,
            type: "png",
          });
          screenshotBase64 = screenshotBuffer.toString("base64");
          console.log(
            `        📸 Screenshot: ${Math.round(screenshotBase64.length / 1024)}KB base64`,
          );
        } catch (ssErr) {
          console.log(`        ⚠️ Screenshot failed: ${ssErr.message}`);
        }
        if (content?.text && content.text.length > 50) {
          const cleaned = content.text
            .replace(
              /^(Export|Print|Refresh|Find\s*\|?\s*Next|Home|Logout|View Report|100%|\d+ of \d+).*$/gm,
              "",
            )
            .replace(/\n{3,}/g, "\n\n")
            .trim();
          console.log(
            `        ✓ Extracted ${cleaned.length} chars, html: ${(content.html || "").length} (source: ${content.source})`,
          );
          console.log(`        [DEBUG] text length: ${cleaned?.length || 0}`);
          console.log(
            `        [DEBUG] html length: ${content?.html?.length || 0}`,
          );
          console.log(
            `        [DEBUG] html first 200 chars: ${(content?.html || "").substring(0, 200)}`,
          );
          pdfData.push({
            fileName: reportName,
            text: cleaned,
            screenshot: screenshotBase64,
            pages: 1,
            url: finalUrl,
            info: { source: content.source },
          });
        } else {
          console.log(
            `        ⚠️ No meaningful content (${content?.text?.length || 0} chars, source: ${content?.source})`,
          );
          pdfData.push({
            fileName: reportName,
            text: "",
            pages: 0,
            error: "No content extracted",
          });
        }

        await popup.close().catch(() => {});
      } else {
        // No popup — check if content appeared in an iframe on the same page
        console.log(
          `        ⚠️ No popup opened, checking page for iframe/overlay...`,
        );
        await page.waitForTimeout(3000);

        const inlineContent = await page.evaluate(() => {
          const iframes = document.querySelectorAll("iframe");
          for (const iframe of iframes) {
            try {
              const doc =
                iframe.contentDocument || iframe.contentWindow?.document;
              if (doc?.body?.innerText?.length > 100) return doc.body.innerText;
            } catch (e) {}
          }
          // Check for modal/overlay
          const modal = document.querySelector(
            "[class*='modal'], [class*='overlay'], [class*='dialog']",
          );
          if (modal?.innerText?.length > 100) return modal.innerText;
          return null;
        });

        if (inlineContent) {
          console.log(
            `        ✓ Found inline content: ${inlineContent.length} chars`,
          );
          pdfData.push({
            fileName: reportName,
            text: inlineContent,
            pages: 1,
            url: page.url(),
            info: { source: "inline" },
          });
        } else {
          pdfData.push({
            fileName: reportName,
            text: "",
            pages: 0,
            error: "No popup or inline content",
          });
        }
      }
    } catch (err) {
      console.error(`        ✗ Error: ${err.message}`);
      pdfData.push({
        fileName: reportName,
        text: "",
        pages: 0,
        error: err.message,
      });
    }
  }

  return pdfData;
}

async function extractPageData(page) {
  const data = await page.evaluate(() => {
    const d = { keyValues: [], tables: [], links: [], rawText: "" };
    const seen = new Set();
    const add = (label, value) => {
      const k = label ? label.trim().replace(/:$/, "").trim() : "";
      const v = value ? String(value).trim() : "";
      const key = `${k}|${v}`;
      if (k && v && !seen.has(key)) {
        seen.add(key);
        d.keyValues.push({ key: k, value: v });
      }
    };

    // 1. Label + value: label followed by adjacent span, div, or p
    document.querySelectorAll("label").forEach((label) => {
      const lbl = label.textContent.trim().replace(/:$/, "").trim();
      if (!lbl) return;
      let next = label.nextElementSibling;
      while (next) {
        const tag = (next.tagName || "").toLowerCase();
        if (["span", "div", "p"].includes(tag)) {
          add(lbl, next.textContent);
          break;
        }
        if (["label", "dt"].includes(tag)) break;
        next = next.nextElementSibling;
      }
    });

    // 2. Definition lists: dt (key) + dd (value)
    document.querySelectorAll("dl").forEach((dl) => {
      const dts = dl.querySelectorAll("dt");
      dts.forEach((dt) => {
        const lbl = dt.textContent.trim().replace(/:$/, "").trim();
        if (!lbl) return;
        let dd = dt.nextElementSibling;
        while (dd && dd.tagName.toLowerCase() !== "dd")
          dd = dd.nextElementSibling;
        if (dd) add(lbl, dd.textContent);
      });
    });

    // 3. Form fields: label with for, find element by ID
    document.querySelectorAll("label[for]").forEach((label) => {
      const forId = label.getAttribute("for");
      const lbl = label.textContent.trim().replace(/:$/, "").trim();
      if (!lbl || !forId) return;
      const el = document.getElementById(forId);
      if (el) {
        const v = el.getAttribute("value") || el.textContent || "";
        add(lbl, v);
      }
    });

    // 4. Div-based layouts: field-label/label/key/form-label + field-value/value/form-control
    const labelClasses = [
      "field-label",
      "label",
      "key",
      "form-label",
      "field-name",
      "col-label",
    ];
    const valueClasses = [
      "field-value",
      "value",
      "form-control",
      "field-data",
      "col-value",
    ];
    labelClasses.forEach((lc) => {
      document
        .querySelectorAll(`.${lc}, [class*="${lc}"]`)
        .forEach((labelEl) => {
          const lbl = labelEl.textContent.trim().replace(/:$/, "").trim();
          if (!lbl) return;
          let sibling = labelEl.nextElementSibling;
          while (sibling) {
            const cls = (sibling.className || "") + " ";
            if (valueClasses.some((vc) => cls.includes(vc))) {
              add(lbl, sibling.textContent);
              break;
            }
            sibling = sibling.nextElementSibling;
          }
          if (!sibling && labelEl.parentElement) {
            Array.from(labelEl.parentElement.children).forEach((child) => {
              if (child === labelEl) return;
              const cls = (child.className || "") + " ";
              if (valueClasses.some((vc) => cls.includes(vc)))
                add(lbl, child.textContent);
            });
          }
        });
    });

    // 5. Span pairs: bold/semibold span followed by value span
    document.querySelectorAll("span").forEach((span) => {
      const style = (window.getComputedStyle(span).fontWeight || "").toString();
      const cls = (span.className || "") + " ";
      const isBold = parseInt(style, 10) >= 600 || /bold|semibold/i.test(cls);
      if (!isBold) return;
      const lbl = span.textContent.trim().replace(/:$/, "").trim();
      if (!lbl || lbl.length > 80) return;
      let next = span.nextElementSibling;
      if (next && (next.tagName || "").toLowerCase() === "span")
        add(lbl, next.textContent);
      else if (span.nextSibling && span.nextSibling.nodeType === 3) {
        add(lbl, span.nextSibling.textContent);
      }
    });

    // 6. Two-cell table rows (existing)
    document.querySelectorAll("table tr").forEach((tr) => {
      const cells = tr.querySelectorAll("td");
      if (cells.length === 2) {
        const label = cells[0].textContent.trim().replace(/:$/, "").trim();
        const value = cells[1].textContent.trim();
        add(label, value);
      }
    });

    document.querySelectorAll("table").forEach((table, ti) => {
      const headers = [];
      const hr = table.querySelector("thead tr, tr:has(th)");
      if (hr)
        hr.querySelectorAll("th, td").forEach((c) => {
          const h = c.textContent.trim();
          if (h) headers.push(h);
        });

      const rows = [];
      const dr = table.querySelectorAll("tbody tr, tr");
      dr.forEach((tr) => {
        if (tr === hr) return;
        // Ignore rows that look like headers (bold only)
        if (tr.querySelector("th") && !tr.querySelector("td")) return;

        const row = {};
        let has = false;
        tr.querySelectorAll("td").forEach((td, ci) => {
          const cn = headers[ci] || `Col_${ci}`;
          const t = td.textContent.trim();
          row[cn] = t;
          if (t) has = true;
        });
        if (has) rows.push(row);
      });
      if (rows.length > 0) d.tables.push({ headers, rows, tableIndex: ti });
    });

    d.keyValues = d.keyValues.filter((kv) => {
      if (/filter/i.test(kv.key)) return false;
      if (
        kv.value.startsWith("Select One") ||
        kv.value.startsWith("Select All")
      )
        return false;
      if (kv.value.length > 300) return false;
      return true;
    });

    return d;
  });
  return data;
}

// ─── PermitWizard Authentication Endpoints ──────────────────────────────────
app.post("/api/permitwizard/login", async (req, res) => {
  const { credentialId, username, password, userId } = req.body;

  let loginUsername = username;
  let loginPassword = password;

  if (credentialId && (!loginUsername || !loginPassword)) {
    try {
      const { data: cred, error } = await supabase
        .from("portal_credentials")
        .select("portal_username, portal_password, login_url")
        .eq("id", credentialId)
        .single();

      if (error || !cred) {
        return res.status(404).json({
          success: false,
          error: "credential_not_found",
          message: "Portal credential not found",
        });
      }

      loginUsername = cred.portal_username;
      loginPassword = cred.portal_password;
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: "credential_lookup_failed",
        message: err.message,
      });
    }
  }

  if (!loginUsername || !loginPassword) {
    return res.status(400).json({
      success: false,
      error: "missing_credentials",
      message: "Username and password are required (or provide credentialId)",
    });
  }

  let browser;
  try {
    console.log("🔐 [PermitWizard] Launching browser for SSO login...");
    browser = await chromium.launch({ headless: true });

    const result = await permitWizardLogin(browser, loginUsername, loginPassword);

    if (!result.success) {
      await browser.close().catch(() => {});

      if (result.error === "captcha_detected") {
        return res.status(403).json(result);
      }
      if (result.doNotRetry) {
        return res.status(401).json(result);
      }
      return res.status(500).json(result);
    }

    const responseData = {
      success: true,
      sessionToken: result.sessionToken,
      expiresAt: result.expiresAt,
      portalUrl: result.portalUrl,
      message: "PermitWizard SSO login successful",
    };

    if (userId) {
      console.log(`  [PermitWizard] Login by user: ${userId}`);
    }

    res.json(responseData);
  } catch (err) {
    console.error("❌ [PermitWizard] Login error:", err.message);
    if (browser) await browser.close().catch(() => {});
    res.status(500).json({
      success: false,
      error: "login_error",
      message: err.message,
    });
  }
});

app.get("/api/permitwizard/session/:sessionToken", async (req, res) => {
  const { sessionToken } = req.params;
  const status = await checkSessionAlive(sessionToken);
  res.json(status);
});

app.post("/api/permitwizard/reauth", async (req, res) => {
  const { sessionToken } = req.body;

  if (!sessionToken) {
    return res.status(400).json({
      success: false,
      error: "missing_session_token",
      message: "sessionToken is required",
    });
  }

  const session = getPWSession(sessionToken);
  if (!session) {
    return res.status(404).json({
      success: false,
      error: "session_not_found",
      message: "Session not found or expired. Perform a fresh login.",
    });
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const result = await reAuthenticate(browser, sessionToken);

    if (!result || !result.success) {
      await browser.close().catch(() => {});
      return res.status(401).json(result || {
        success: false,
        error: "reauth_failed",
        message: "Re-authentication failed",
      });
    }

    res.json(result);
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    res.status(500).json({
      success: false,
      error: "reauth_error",
      message: err.message,
    });
  }
});

app.post("/api/permitwizard/logout", async (req, res) => {
  const { sessionToken } = req.body;

  if (!sessionToken) {
    return res.status(400).json({ error: "sessionToken is required" });
  }

  await destroyPWSession(sessionToken);
  res.json({ success: true, message: "PermitWizard session destroyed" });
});

app.get("/api/permitwizard/sessions/count", (req, res) => {
  res.json({ activeSessions: getActiveSessionCount() });
});

app.get("/api/permitwizard/wizard-steps", (req, res) => {
  res.json({ steps: WIZARD_STEPS });
});

app.post("/api/permitwizard/file", async (req, res) => {
  const { sessionToken, filingId, filingData } = req.body;

  if (!sessionToken) {
    return res.status(400).json({
      success: false,
      error: "missing_session_token",
      message: "sessionToken is required",
    });
  }

  if (!filingId && (!filingData || !filingData.filing_id)) {
    return res.status(400).json({
      success: false,
      error: "missing_filing_id",
      message: "filingId or filingData.filing_id is required",
    });
  }

  const session = getPWSession(sessionToken);
  if (!session) {
    return res.status(404).json({
      success: false,
      error: "session_not_found",
      message: "PermitWizard session not found or expired. Perform a fresh login.",
    });
  }

  const resolvedFilingId = filingId || filingData.filing_id;
  let resolvedFilingData = filingData || {};
  resolvedFilingData.filing_id = resolvedFilingId;

  if (!resolvedFilingData.property_address && resolvedFilingId) {
    try {
      const { data: filing, error } = await supabase
        .from("permit_filings")
        .select("*")
        .eq("id", resolvedFilingId)
        .single();

      if (!error && filing) {
        resolvedFilingData = {
          ...resolvedFilingData,
          filing_id: filing.id,
          property_address: resolvedFilingData.property_address || filing.property_address,
          permit_type: resolvedFilingData.permit_type || filing.permit_type,
          permit_subtype: resolvedFilingData.permit_subtype || filing.permit_subtype,
          review_track: resolvedFilingData.review_track || filing.review_track,
          scope_of_work: resolvedFilingData.scope_of_work || filing.scope_of_work,
          construction_value: resolvedFilingData.construction_value || filing.construction_value,
          property_type: resolvedFilingData.property_type || filing.property_type,
          estimated_fee: resolvedFilingData.estimated_fee || filing.estimated_fee,
        };

        if (!resolvedFilingData.professionals) {
          const { data: profs } = await supabase
            .from("filing_professionals")
            .select("*")
            .eq("filing_id", resolvedFilingId);
          if (profs && profs.length > 0) {
            resolvedFilingData.professionals = profs;
          }
        }

        if (!resolvedFilingData.documents) {
          const { data: docs } = await supabase
            .from("filing_documents")
            .select("*")
            .eq("filing_id", resolvedFilingId)
            .order("upload_order", { ascending: true });
          if (docs && docs.length > 0) {
            resolvedFilingData.documents = docs;
          }
        }
      }
    } catch (err) {
      console.log(`  [PermitWizard File] Could not load filing data: ${err.message}`);
    }
  }

  if (!resolvedFilingData.property_address) {
    return res.status(400).json({
      success: false,
      error: "missing_address",
      message: "property_address is required in filingData or in the permit_filings record",
    });
  }

  try {
    await supabase.from("agent_runs").insert({
      filing_id: resolvedFilingId,
      agent_name: "form_filing",
      layer: 2,
      status: "running",
      input_data: {
        property_address: resolvedFilingData.property_address,
        permit_type: resolvedFilingData.permit_type,
        documents_count: (resolvedFilingData.documents || []).length,
        professionals_count: (resolvedFilingData.professionals || []).length,
      },
      started_at: new Date().toISOString(),
    });
  } catch (err) {
    console.log(`  [PermitWizard File] Could not create agent_run: ${err.message}`);
  }

  console.log(`\n🏛️ [PermitWizard File] Starting form filing for: ${resolvedFilingData.property_address}`);

  res.json({
    success: true,
    message: "Form filing started",
    filing_id: resolvedFilingId,
    steps: WIZARD_STEPS,
  });

  permitWizardFile(sessionToken, resolvedFilingData, supabase)
    .then(async (result) => {
      console.log(`  [PermitWizard File] Filing complete: ${result.success ? "SUCCESS" : "FAILED"}`);

      try {
        await supabase
          .from("agent_runs")
          .update({
            status: result.success ? "completed" : "failed",
            output_data: {
              steps: result.steps,
              stopped_before_submit: result.stopped_before_submit,
              field_audits: result.field_audits,
              screenshots_count: (result.screenshots || []).length,
            },
            error_message: result.success ? null : result.message,
            completed_at: new Date().toISOString(),
          })
          .eq("filing_id", resolvedFilingId)
          .eq("agent_name", "form_filing")
          .eq("status", "running");
      } catch (err) {
        console.log(`  [PermitWizard File] Could not update agent_run: ${err.message}`);
      }
    })
    .catch(async (err) => {
      console.error(`  [PermitWizard File] Fatal error: ${err.message}`);
      try {
        await supabase
          .from("agent_runs")
          .update({
            status: "failed",
            error_message: err.message,
            completed_at: new Date().toISOString(),
          })
          .eq("filing_id", resolvedFilingId)
          .eq("agent_name", "form_filing")
          .eq("status", "running");
      } catch (_) {}
    });
});

// ─── PermitWizard Submission Finalization (Agent 08) ─────────────────────────
app.post("/api/permitwizard/submit", async (req, res) => {
  const { sessionToken, filingId, filingData } = req.body;

  if (!sessionToken) {
    return res.status(400).json({
      success: false,
      error: "missing_session_token",
      message: "sessionToken is required",
    });
  }

  if (!filingId && (!filingData || !filingData.filing_id)) {
    return res.status(400).json({
      success: false,
      error: "missing_filing_id",
      message: "filingId or filingData.filing_id is required",
    });
  }

  const session = getPWSession(sessionToken);
  if (!session) {
    return res.status(404).json({
      success: false,
      error: "session_not_found",
      message: "PermitWizard session not found or expired. Perform a fresh login.",
    });
  }

  const resolvedFilingId = filingId || filingData.filing_id;
  let resolvedFilingData = filingData || {};
  resolvedFilingData.filing_id = resolvedFilingId;

  if (!resolvedFilingData.property_address && resolvedFilingId) {
    try {
      const { data: filing, error } = await supabase
        .from("permit_filings")
        .select("*")
        .eq("id", resolvedFilingId)
        .single();

      if (!error && filing) {
        resolvedFilingData = {
          ...resolvedFilingData,
          filing_id: filing.id,
          property_address: resolvedFilingData.property_address || filing.property_address,
          permit_type: resolvedFilingData.permit_type || filing.permit_type,
          permit_subtype: resolvedFilingData.permit_subtype || filing.permit_subtype,
          review_track: resolvedFilingData.review_track || filing.review_track,
          scope_of_work: resolvedFilingData.scope_of_work || filing.scope_of_work,
          construction_value: resolvedFilingData.construction_value || filing.construction_value,
          property_type: resolvedFilingData.property_type || filing.property_type,
          estimated_fee: resolvedFilingData.estimated_fee || filing.estimated_fee,
        };
      }
    } catch (err) {
      console.log(`  [PermitWizard Submit] Could not load filing data: ${err.message}`);
    }
  }

  try {
    await supabase.from("agent_runs").insert({
      filing_id: resolvedFilingId,
      agent_name: "submission_finalization",
      layer: 2,
      status: "running",
      input_data: {
        filing_id: resolvedFilingId,
        property_address: resolvedFilingData.property_address,
        permit_type: resolvedFilingData.permit_type,
      },
      started_at: new Date().toISOString(),
    });
  } catch (err) {
    console.log(`  [PermitWizard Submit] Could not create agent_run: ${err.message}`);
  }

  console.log(`\n🏛️ [PermitWizard Submit] Starting submission finalization for filing: ${resolvedFilingId}`);

  res.json({
    success: true,
    message: "Submission finalization started",
    filing_id: resolvedFilingId,
  });

  permitWizardSubmit(sessionToken, resolvedFilingData, supabase)
    .then(async (result) => {
      console.log(`  [PermitWizard Submit] Finalization complete: ${result.success ? "SUCCESS" : "FAILED"}`);

      try {
        await supabase
          .from("agent_runs")
          .update({
            status: result.success ? "completed" : "failed",
            output_data: {
              application_id: result.application_id || null,
              confirmation_number: result.confirmation_number || null,
              confirmation_message: result.confirmation_message || null,
              validation: result.validation || null,
              screenshots_count: (result.screenshots || []).length,
              submitted_at: result.submitted_at || null,
            },
            error_message: result.success ? null : result.message,
            completed_at: new Date().toISOString(),
          })
          .eq("filing_id", resolvedFilingId)
          .eq("agent_name", "submission_finalization")
          .eq("status", "running");
      } catch (err) {
        console.log(`  [PermitWizard Submit] Could not update agent_run: ${err.message}`);
      }

      if (!result.success && result.error !== "validation_failed") {
        try {
          await supabase
            .from("permit_filings")
            .update({
              filing_status: "failed",
              updated_at: new Date().toISOString(),
            })
            .eq("id", resolvedFilingId);
        } catch (_) {}
      }
    })
    .catch(async (err) => {
      console.error(`  [PermitWizard Submit] Fatal error: ${err.message}`);
      try {
        await supabase
          .from("agent_runs")
          .update({
            status: "failed",
            error_message: err.message,
            completed_at: new Date().toISOString(),
          })
          .eq("filing_id", resolvedFilingId)
          .eq("agent_name", "submission_finalization")
          .eq("status", "running");

        await supabase
          .from("permit_filings")
          .update({
            filing_status: "failed",
            updated_at: new Date().toISOString(),
          })
          .eq("id", resolvedFilingId);
      } catch (_) {}
    });
});

// ─── Multi-Municipality Filing Endpoints ─────────────────────────────────────
const VALID_PORTAL_TYPES = ["accela", "momentum_liferay", "aspnet_webforms", "energov"];

app.post("/api/filing/login", async (req, res) => {
  const { portal_type, portal_config, credentialId, username, password, userId } = req.body;

  if (!portal_type || !VALID_PORTAL_TYPES.includes(portal_type)) {
    return res.status(400).json({
      success: false,
      error: "invalid_portal_type",
      message: `portal_type must be one of: ${VALID_PORTAL_TYPES.join(", ")}`,
    });
  }

  let loginUsername = username;
  let loginPassword = password;

  if (credentialId && (!loginUsername || !loginPassword)) {
    try {
      const { data: cred, error } = await supabase
        .from("portal_credentials")
        .select("portal_username, portal_password, login_url")
        .eq("id", credentialId)
        .single();

      if (error || !cred) {
        return res.status(404).json({
          success: false,
          error: "credential_not_found",
          message: "Portal credential not found",
        });
      }

      loginUsername = cred.portal_username;
      loginPassword = cred.portal_password;
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: "credential_lookup_failed",
        message: err.message,
      });
    }
  }

  if (!loginUsername || !loginPassword) {
    return res.status(400).json({
      success: false,
      error: "missing_credentials",
      message: "Username and password are required (or provide credentialId)",
    });
  }

  let browser;
  try {
    console.log(`[Filing] Launching browser for ${portal_type} login...`);
    browser = await chromium.launch({ headless: true });

    let result;
    const credentials = { username: loginUsername, password: loginPassword };
    const config = portal_config || {};

    switch (portal_type) {
      case "accela":
        result = await accelaLogin(browser, credentials, config);
        break;
      case "momentum_liferay":
        result = await momentumLogin(browser, credentials);
        break;
      case "aspnet_webforms":
        result = await montgomeryLogin(browser, credentials);
        break;
      case "energov":
        result = await energovLogin(browser, credentials, config);
        break;
    }

    if (!result.success) {
      await browser.close().catch(() => {});
      if (result.error === "captcha_detected") {
        return res.status(403).json(result);
      }
      if (result.doNotRetry) {
        return res.status(401).json(result);
      }
      return res.status(500).json(result);
    }

    const responseData = {
      success: true,
      sessionToken: result.sessionToken,
      expiresAt: result.expiresAt,
      portalUrl: result.portalUrl,
      portal_type,
      message: `${portal_type} login successful`,
    };

    if (userId) {
      console.log(`  [Filing] Login by user: ${userId} (${portal_type})`);
    }

    res.json(responseData);
  } catch (err) {
    console.error(`[Filing] Login error (${portal_type}):`, err.message);
    if (browser) await browser.close().catch(() => {});
    res.status(500).json({
      success: false,
      error: "login_error",
      message: err.message,
    });
  }
});

app.get("/api/filing/session/:token", async (req, res) => {
  const { token } = req.params;
  const { portal_type } = req.query;

  if (portal_type && VALID_PORTAL_TYPES.includes(portal_type)) {
    let status;
    switch (portal_type) {
      case "accela":
        status = await checkSessionAlive(token);
        break;
      case "momentum_liferay":
        status = await checkMomentumSessionAlive(token);
        break;
      case "aspnet_webforms":
        status = await checkMontgomerySessionAlive(token);
        break;
      case "energov":
        status = await checkEnergovSessionAlive(token);
        break;
    }
    return res.json({ ...status, portal_type });
  }

  const accelaSession = getAccelaSession(token);
  if (accelaSession) {
    const status = await checkSessionAlive(token);
    return res.json({ ...status, portal_type: "accela" });
  }

  const momentumSession = getMomentumSession(token);
  if (momentumSession) {
    const status = await checkMomentumSessionAlive(token);
    return res.json({ ...status, portal_type: "momentum_liferay" });
  }

  const montgomerySession = getMontgomerySession(token);
  if (montgomerySession) {
    const status = await checkMontgomerySessionAlive(token);
    return res.json({ ...status, portal_type: "aspnet_webforms" });
  }

  const energovSession = getEnergovSession(token);
  if (energovSession) {
    const status = await checkEnergovSessionAlive(token);
    return res.json({ ...status, portal_type: "energov" });
  }

  res.json({ alive: false, reason: "session_not_found" });
});

app.post("/api/filing/file", async (req, res) => {
  const { portal_type, portal_config, sessionToken, filingId, filingData } = req.body;

  if (!portal_type || !VALID_PORTAL_TYPES.includes(portal_type)) {
    return res.status(400).json({
      success: false,
      error: "invalid_portal_type",
      message: `portal_type must be one of: ${VALID_PORTAL_TYPES.join(", ")}`,
    });
  }

  if (!sessionToken) {
    return res.status(400).json({
      success: false,
      error: "missing_session_token",
      message: "sessionToken is required",
    });
  }

  if (!filingId && (!filingData || !filingData.filing_id)) {
    return res.status(400).json({
      success: false,
      error: "missing_filing_id",
      message: "filingId or filingData.filing_id is required",
    });
  }

  let sessionLookup;
  switch (portal_type) {
    case "accela":
      sessionLookup = getAccelaSession(sessionToken) || getPWSession(sessionToken);
      break;
    case "momentum_liferay":
      sessionLookup = getMomentumSession(sessionToken);
      break;
    case "aspnet_webforms":
      sessionLookup = getMontgomerySession(sessionToken);
      break;
    case "energov":
      sessionLookup = getEnergovSession(sessionToken);
      break;
  }

  if (!sessionLookup) {
    return res.status(404).json({
      success: false,
      error: "session_not_found",
      message: `${portal_type} session not found or expired. Perform a fresh login.`,
    });
  }

  const resolvedFilingId = filingId || filingData.filing_id;
  let resolvedFilingData = filingData || {};
  resolvedFilingData.filing_id = resolvedFilingId;

  if (!resolvedFilingData.property_address && resolvedFilingId) {
    try {
      const { data: filing, error } = await supabase
        .from("permit_filings")
        .select("*")
        .eq("id", resolvedFilingId)
        .single();

      if (!error && filing) {
        resolvedFilingData = {
          ...resolvedFilingData,
          filing_id: filing.id,
          property_address: resolvedFilingData.property_address || filing.property_address,
          permit_type: resolvedFilingData.permit_type || filing.permit_type,
          permit_subtype: resolvedFilingData.permit_subtype || filing.permit_subtype,
          review_track: resolvedFilingData.review_track || filing.review_track,
          scope_of_work: resolvedFilingData.scope_of_work || filing.scope_of_work,
          construction_value: resolvedFilingData.construction_value || filing.construction_value,
          property_type: resolvedFilingData.property_type || filing.property_type,
          estimated_fee: resolvedFilingData.estimated_fee || filing.estimated_fee,
        };

        if (!resolvedFilingData.professionals) {
          const { data: profs } = await supabase
            .from("filing_professionals")
            .select("*")
            .eq("filing_id", resolvedFilingId);
          if (profs && profs.length > 0) {
            resolvedFilingData.professionals = profs;
          }
        }

        if (!resolvedFilingData.documents) {
          const { data: docs } = await supabase
            .from("filing_documents")
            .select("*")
            .eq("filing_id", resolvedFilingId)
            .order("upload_order", { ascending: true });
          if (docs && docs.length > 0) {
            resolvedFilingData.documents = docs;
          }
        }
      }
    } catch (err) {
      console.log(`  [Filing File] Could not load filing data: ${err.message}`);
    }
  }

  if (!resolvedFilingData.property_address) {
    return res.status(400).json({
      success: false,
      error: "missing_address",
      message: "property_address is required in filingData or in the permit_filings record",
    });
  }

  try {
    await supabase.from("agent_runs").insert({
      filing_id: resolvedFilingId,
      agent_name: "form_filing",
      layer: 2,
      status: "running",
      input_data: {
        portal_type,
        property_address: resolvedFilingData.property_address,
        permit_type: resolvedFilingData.permit_type,
        documents_count: (resolvedFilingData.documents || []).length,
        professionals_count: (resolvedFilingData.professionals || []).length,
      },
      started_at: new Date().toISOString(),
    });
  } catch (err) {
    console.log(`  [Filing File] Could not create agent_run: ${err.message}`);
  }

  console.log(`\n[Filing File] Starting ${portal_type} form filing for: ${resolvedFilingData.property_address}`);

  res.json({
    success: true,
    message: "Form filing started",
    filing_id: resolvedFilingId,
    portal_type,
  });

  let filePromise;
  const config = portal_config || {};

  switch (portal_type) {
    case "accela":
      filePromise = permitWizardFile(sessionToken, resolvedFilingData, supabase, config);
      break;
    case "momentum_liferay":
      filePromise = momentumFile(null, sessionToken, resolvedFilingData, supabase);
      break;
    case "aspnet_webforms":
      filePromise = montgomeryFile(sessionToken, resolvedFilingData, supabase);
      break;
    case "energov":
      filePromise = energovFile(sessionToken, resolvedFilingData, config, supabase);
      break;
  }

  filePromise
    .then(async (result) => {
      console.log(`  [Filing File] (${portal_type}) Filing complete: ${result.success ? "SUCCESS" : "FAILED"}`);
      try {
        await supabase
          .from("agent_runs")
          .update({
            status: result.success ? "completed" : "failed",
            output_data: {
              portal_type,
              steps: result.steps,
              stopped_before_submit: result.stopped_before_submit,
              field_audits: result.field_audits,
              screenshots_count: (result.screenshots || []).length,
            },
            error_message: result.success ? null : result.message,
            completed_at: new Date().toISOString(),
          })
          .eq("filing_id", resolvedFilingId)
          .eq("agent_name", "form_filing")
          .eq("status", "running");
      } catch (err) {
        console.log(`  [Filing File] Could not update agent_run: ${err.message}`);
      }
    })
    .catch(async (err) => {
      console.error(`  [Filing File] (${portal_type}) Fatal error: ${err.message}`);
      try {
        await supabase
          .from("agent_runs")
          .update({
            status: "failed",
            error_message: err.message,
            completed_at: new Date().toISOString(),
          })
          .eq("filing_id", resolvedFilingId)
          .eq("agent_name", "form_filing")
          .eq("status", "running");
      } catch (_) {}
    });
});

app.post("/api/filing/submit", async (req, res) => {
  const { portal_type, portal_config, sessionToken, filingId, filingData } = req.body;

  if (!portal_type || !VALID_PORTAL_TYPES.includes(portal_type)) {
    return res.status(400).json({
      success: false,
      error: "invalid_portal_type",
      message: `portal_type must be one of: ${VALID_PORTAL_TYPES.join(", ")}`,
    });
  }

  if (!sessionToken) {
    return res.status(400).json({
      success: false,
      error: "missing_session_token",
      message: "sessionToken is required",
    });
  }

  if (!filingId && (!filingData || !filingData.filing_id)) {
    return res.status(400).json({
      success: false,
      error: "missing_filing_id",
      message: "filingId or filingData.filing_id is required",
    });
  }

  let sessionLookup;
  switch (portal_type) {
    case "accela":
      sessionLookup = getAccelaSession(sessionToken) || getPWSession(sessionToken);
      break;
    case "momentum_liferay":
      sessionLookup = getMomentumSession(sessionToken);
      break;
    case "aspnet_webforms":
      sessionLookup = getMontgomerySession(sessionToken);
      break;
    case "energov":
      sessionLookup = getEnergovSession(sessionToken);
      break;
  }

  if (!sessionLookup) {
    return res.status(404).json({
      success: false,
      error: "session_not_found",
      message: `${portal_type} session not found or expired. Perform a fresh login.`,
    });
  }

  const resolvedFilingId = filingId || filingData.filing_id;
  let resolvedFilingData = filingData || {};
  resolvedFilingData.filing_id = resolvedFilingId;

  if (!resolvedFilingData.property_address && resolvedFilingId) {
    try {
      const { data: filing, error } = await supabase
        .from("permit_filings")
        .select("*")
        .eq("id", resolvedFilingId)
        .single();

      if (!error && filing) {
        resolvedFilingData = {
          ...resolvedFilingData,
          filing_id: filing.id,
          property_address: resolvedFilingData.property_address || filing.property_address,
          permit_type: resolvedFilingData.permit_type || filing.permit_type,
          permit_subtype: resolvedFilingData.permit_subtype || filing.permit_subtype,
          review_track: resolvedFilingData.review_track || filing.review_track,
          scope_of_work: resolvedFilingData.scope_of_work || filing.scope_of_work,
          construction_value: resolvedFilingData.construction_value || filing.construction_value,
          property_type: resolvedFilingData.property_type || filing.property_type,
          estimated_fee: resolvedFilingData.estimated_fee || filing.estimated_fee,
        };
      }
    } catch (err) {
      console.log(`  [Filing Submit] Could not load filing data: ${err.message}`);
    }
  }

  try {
    await supabase.from("agent_runs").insert({
      filing_id: resolvedFilingId,
      agent_name: "submission_finalization",
      layer: 2,
      status: "running",
      input_data: {
        portal_type,
        filing_id: resolvedFilingId,
        property_address: resolvedFilingData.property_address,
        permit_type: resolvedFilingData.permit_type,
      },
      started_at: new Date().toISOString(),
    });
  } catch (err) {
    console.log(`  [Filing Submit] Could not create agent_run: ${err.message}`);
  }

  console.log(`\n[Filing Submit] Starting ${portal_type} submission for filing: ${resolvedFilingId}`);

  res.json({
    success: true,
    message: "Submission finalization started",
    filing_id: resolvedFilingId,
    portal_type,
  });

  let submitPromise;
  const config = portal_config || {};

  switch (portal_type) {
    case "accela":
      submitPromise = permitWizardSubmit(sessionToken, resolvedFilingData, supabase);
      break;
    case "momentum_liferay":
      submitPromise = momentumSubmit(null, sessionToken, resolvedFilingData, supabase);
      break;
    case "aspnet_webforms":
      submitPromise = montgomerySubmit(sessionToken, resolvedFilingData, supabase);
      break;
    case "energov":
      submitPromise = energovSubmit(sessionToken, resolvedFilingData, config, supabase);
      break;
  }

  submitPromise
    .then(async (result) => {
      console.log(`  [Filing Submit] (${portal_type}) Finalization complete: ${result.success ? "SUCCESS" : "FAILED"}`);
      try {
        await supabase
          .from("agent_runs")
          .update({
            status: result.success ? "completed" : "failed",
            output_data: {
              portal_type,
              application_id: result.application_id || null,
              confirmation_number: result.confirmation_number || null,
              confirmation_message: result.confirmation_message || null,
              validation: result.validation || null,
              screenshots_count: (result.screenshots || []).length,
              submitted_at: result.submitted_at || null,
            },
            error_message: result.success ? null : result.message,
            completed_at: new Date().toISOString(),
          })
          .eq("filing_id", resolvedFilingId)
          .eq("agent_name", "submission_finalization")
          .eq("status", "running");
      } catch (err) {
        console.log(`  [Filing Submit] Could not update agent_run: ${err.message}`);
      }

      if (!result.success && result.error !== "validation_failed") {
        try {
          await supabase
            .from("permit_filings")
            .update({
              filing_status: "failed",
              updated_at: new Date().toISOString(),
            })
            .eq("id", resolvedFilingId);
        } catch (_) {}
      }
    })
    .catch(async (err) => {
      console.error(`  [Filing Submit] (${portal_type}) Fatal error: ${err.message}`);
      try {
        await supabase
          .from("agent_runs")
          .update({
            status: "failed",
            error_message: err.message,
            completed_at: new Date().toISOString(),
          })
          .eq("filing_id", resolvedFilingId)
          .eq("agent_name", "submission_finalization")
          .eq("status", "running");

        await supabase
          .from("permit_filings")
          .update({
            filing_status: "failed",
            updated_at: new Date().toISOString(),
          })
          .eq("id", resolvedFilingId);
      } catch (_) {}
    });
});

app.post("/api/filing/logout", async (req, res) => {
  const { portal_type, sessionToken } = req.body;

  if (!sessionToken) {
    return res.status(400).json({ error: "sessionToken is required" });
  }

  if (portal_type && VALID_PORTAL_TYPES.includes(portal_type)) {
    switch (portal_type) {
      case "accela":
        await accelaLogout(sessionToken);
        break;
      case "momentum_liferay":
        await momentumLogout(sessionToken);
        break;
      case "aspnet_webforms":
        await montgomeryLogout(sessionToken);
        break;
      case "energov":
        await energovLogout(sessionToken);
        break;
    }
    return res.json({ success: true, message: `${portal_type} session destroyed` });
  }

  if (getAccelaSession(sessionToken)) {
    await accelaLogout(sessionToken);
    return res.json({ success: true, message: "accela session destroyed" });
  }
  if (getMomentumSession(sessionToken)) {
    await momentumLogout(sessionToken);
    return res.json({ success: true, message: "momentum_liferay session destroyed" });
  }
  if (getMontgomerySession(sessionToken)) {
    await montgomeryLogout(sessionToken);
    return res.json({ success: true, message: "aspnet_webforms session destroyed" });
  }
  if (getEnergovSession(sessionToken)) {
    await energovLogout(sessionToken);
    return res.json({ success: true, message: "energov session destroyed" });
  }

  res.json({ success: true, message: "Session not found (may have already expired)" });
});

// ─── Generic Filing Re-Authentication ────────────────────────────────────────
app.post("/api/filing/reauth", async (req, res) => {
  const { portal_type, sessionToken } = req.body;

  if (!sessionToken) {
    return res.status(400).json({ success: false, error: "sessionToken is required" });
  }

  try {
    let resolvedType = portal_type;
    if (!resolvedType) {
      if (getAccelaSession(sessionToken)) resolvedType = "accela";
      else if (getMomentumSession(sessionToken)) resolvedType = "momentum_liferay";
      else if (getMontgomerySession(sessionToken)) resolvedType = "aspnet_webforms";
      else if (getEnergovSession(sessionToken)) resolvedType = "energov";
    }

    if (!resolvedType) {
      return res.status(404).json({
        success: false,
        error: "session_not_found",
        message: "Session not found. Perform a fresh login.",
      });
    }

    let browser;
    switch (resolvedType) {
      case "accela":
        browser = await chromium.launch({ headless: true });
        await reAuthenticate(browser, sessionToken);
        break;
      case "aspnet_webforms":
        browser = await chromium.launch({ headless: true });
        await reAuthenticateMontgomery(browser, sessionToken);
        break;
      case "momentum_liferay":
      case "energov":
        return res.status(501).json({
          success: false,
          error: "reauth_not_supported",
          message: `Re-authentication not yet supported for ${resolvedType}. Perform a fresh login.`,
        });
      default:
        return res.status(400).json({
          success: false,
          error: "unsupported_portal_type",
          message: `Unsupported portal type: ${resolvedType}`,
        });
    }

    res.json({
      success: true,
      sessionToken,
      portal_type: resolvedType,
      message: "Re-authentication successful",
    });
  } catch (err) {
    console.error(`[Filing Reauth] Error:`, err.message);
    res.status(500).json({
      success: false,
      error: "reauth_failed",
      message: err.message,
    });
  }
});

// ─── Data / Export / Cleanup ─────────────────────────────────────────────────
app.get("/api/data/:sessionId", (req, res) => {
  const s = sessions[req.params.sessionId];
  if (!s) return res.status(404).json({ error: "Not found" });
  res.json({
    status: s.status,
    message: s.message,
    progress: s.progress,
    total: s.total,
    data: s.data,
  });
});

app.post("/api/logout/:sessionId", (req, res) => {
  cleanupSession(req.params.sessionId);
  res.json({ message: "Closed" });
});

// ─── UPDATED EXPORT FUNCTION: Fixed Sorting ──────────────────────────────────
app.get("/api/export/:sessionId", async (req, res) => {
  const s = sessions[req.params.sessionId];
  if (!s?.data || Object.keys(s.data).length === 0)
    return res.status(404).json({ error: "No data" });

  try {
    const wb = new ExcelJS.Workbook();
    wb.creator = "ProjectDox Scraper";

    // 1. Employee Sheet
    const empSheet = wb.addWorksheet("Work by Employee");
    empSheet.columns = [
      { header: "Employee / User", key: "emp", width: 25 },
      { header: "Project", key: "proj", width: 15 },
      { header: "Task / Workflow", key: "task", width: 40 },
      { header: "Status", key: "status", width: 15 },
      { header: "Cycle / Dept", key: "dept", width: 20 },
      { header: "Date", key: "date", width: 15 },
    ];

    // TEMPORARY LIST TO HOLD ROWS FOR SORTING
    const empRows = [];

    // Helper to add to list
    const addEmpRow = (empName, projNum, taskName, status, dept, date) => {
      if (!empName || empName.includes("Unassigned")) return;
      empRows.push({
        emp: empName,
        proj: projNum,
        task: taskName,
        status: status || "",
        dept: dept || "",
        date: date || "",
      });
    };

    // Iterate through all projects to find employee data
    for (const [pid, pd] of Object.entries(s.data)) {
      const taskTab = pd.tabs["tasks"];
      if (taskTab && taskTab.tables) {
        taskTab.tables.forEach((table) => {
          const findKey = (candidates) =>
            table.headers.find((h) =>
              candidates.some((c) => h.toLowerCase().includes(c)),
            );
          const userHeader = findKey([
            "assigned",
            "user",
            "owner",
            "department",
          ]);
          const taskHeader = findKey(["task", "workflow", "step", "activity"]);
          const statusHeader = findKey(["status"]);
          const dateHeader = findKey(["date", "due", "start"]);

          if (userHeader) {
            table.rows.forEach((row) => {
              addEmpRow(
                row[userHeader],
                pd.projectNum || pid,
                row[taskHeader] || "Unknown Task",
                row[statusHeader],
                "Workflow Task",
                row[dateHeader],
              );
            });
          }
        });
      }

      const infoTab = pd.tabs["info"];
      if (infoTab && infoTab.keyValues) {
        infoTab.keyValues.forEach((kv) => {
          const k = kv.key.toLowerCase();
          if (
            k.includes("applicant") ||
            k.includes("coordinator") ||
            k.includes("contact") ||
            k.includes("manager")
          ) {
            addEmpRow(
              kv.value,
              pd.projectNum || pid,
              kv.key,
              "Info Field",
              "",
              "",
            );
          }
        });
      }
    }

    // 🟢 FIX: Sort the array in JavaScript before adding to Excel
    empRows.sort((a, b) => a.emp.localeCompare(b.emp));

    // Add sorted rows to sheet
    empRows.forEach((row) => empSheet.addRow(row));

    styleSheet(empSheet);

    // 2. Summary Sheet (Original)
    const summary = wb.addWorksheet("Summary");
    summary.columns = [
      { header: "Project", key: "num", width: 18 },
      { header: "Description", key: "desc", width: 55 },
      { header: "Location", key: "loc", width: 35 },
      { header: "Status", key: "status", width: 15 },
      { header: "Fields", key: "fields", width: 12 },
    ];
    for (const [pid, pd] of Object.entries(s.data)) {
      let f = 0;
      Object.values(pd.tabs).forEach((t) => {
        if (t.keyValues) f += t.keyValues.length;
        if (t.tables) t.tables.forEach((tb) => (f += tb.rows.length));
      });
      summary.addRow({
        num: pd.projectNum || pid,
        desc: pd.description || "",
        loc: pd.location || "",
        status: pd.dashboardStatus || "",
        fields: f,
      });
    }
    styleSheet(summary);

    // 3. Detailed Tabs (Original)
    for (const tab of TAB_DEFS) {
      const sheet = wb.addWorksheet(tab.label);
      const allRows = [];
      for (const [pid, pd] of Object.entries(s.data)) {
        const td = pd.tabs[tab.key];
        if (!td || td.error) continue;
        td.keyValues?.forEach((kv) =>
          allRows.push({
            Project: pd.projectNum || pid,
            Type: "Field",
            Field: kv.key,
            Value: kv.value,
          }),
        );
        td.tables?.forEach((tbl, ti) =>
          tbl.rows.forEach((row) => {
            const fr = {
              Project: pd.projectNum || pid,
              Type: `Table ${ti + 1}`,
            };
            Object.entries(row).forEach(([k, v]) => (fr[k] = v));
            allRows.push(fr);
          }),
        );
      }
      if (allRows.length > 0) {
        const keys = [...new Set(allRows.flatMap((r) => Object.keys(r)))];
        sheet.columns = keys.map((k) => ({ header: k, key: k, width: 25 }));
        allRows.forEach((r) => sheet.addRow(r));
        styleSheet(sheet);
      } else {
        sheet.addRow(["No data"]);
      }
    }

    const fp = path.join(__dirname, `Export_${req.params.sessionId}.xlsx`);
    await wb.xlsx.writeFile(fp);
    res.download(fp, "ProjectDox_Export.xlsx", () => {
      try {
        fs.unlinkSync(fp);
      } catch (e) {}
    });
  } catch (err) {
    console.error("Export error:", err);
    res.status(500).json({ error: err.message });
  }
});

function styleSheet(sheet) {
  const r = sheet.getRow(1);
  r.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1a1a2e" } };
  r.alignment = { vertical: "middle" };
  r.height = 28;
  r.eachCell((c) => {
    c.border = { bottom: { style: "thin", color: { argb: "FF555577" } } };
  });
}

process.on("SIGINT", () => {
  console.log("\n🛑 Shutting down...");
  for (const sid of Object.keys(sessions)) cleanupSession(sid);
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║  🏛️  ProjectDox Data Extractor                       ║
║  Server running at: http://localhost:${PORT}          ║
║  Export now includes "Work by Employee" Tab          ║
╚══════════════════════════════════════════════════════╝
  `);
  import("open")
    .then((mod) => mod.default(`http://localhost:${PORT}`))
    .catch(() => {});
});
