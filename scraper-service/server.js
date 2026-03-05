require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { chromium } = require("playwright");
const ExcelJS = require("exceljs");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

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
  const webUiBase = deriveWebUiBase(dashboardUrl);
  console.log(`Portal URL: ${dashboardUrl}`);
  console.log(`WebUI Base: ${webUiBase}`);
  let browser;
  try {
    console.log("🔐 Launching browser...");
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
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
        if (tab.key === "reports") {
          // DEBUG: about to call extractPDFsFromPage
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
