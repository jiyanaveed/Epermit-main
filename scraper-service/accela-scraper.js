const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

async function findFieldInFrames(page, selectors) {
  for (const sel of selectors) {
    const el = await page.$(sel);
    if (el && (await el.isVisible().catch(() => false))) return el;
  }
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    for (const sel of selectors) {
      try {
        const el = await frame.$(sel);
        if (el && (await el.isVisible().catch(() => false))) return el;
      } catch (_) {}
    }
  }
  return null;
}

async function waitForAccelaLoad(page, timeoutMs = 30000) {
  await page
    .waitForLoadState("networkidle", { timeout: timeoutMs })
    .catch(() => {});
  await page
    .waitForSelector(".aca_loading, .ACA_Loading, .loading-mask", {
      state: "detached",
      timeout: 10000,
    })
    .catch(() => {});
  await page.waitForTimeout(1500);
}

async function clickAccelaLink(page, selectors, label) {
  for (const sel of selectors) {
    const link = await page.$(sel);
    if (link && (await link.isVisible().catch(() => false))) {
      console.log(`     Clicking "${label}"...`);
      try {
        await link.click();
        await waitForAccelaLoad(page);
        return true;
      } catch (clickErr) {
        console.log(
          `     ⚠️ Click failed for "${label}" (${sel}): ${clickErr.message}, trying next selector...`,
        );
        continue;
      }
    }
  }
  console.log(`     "${label}" link not found — skipping`);
  return false;
}

async function accelaLogin(page, username, password, portalUrl) {
  const cleanUrl = portalUrl.replace(/\/$/, "").replace(/\/Login\.aspx$/i, "");
  const loginUrl = cleanUrl + "/Login.aspx";
  console.log(`  Navigating to Accela login: ${loginUrl}`);
  await page.goto(loginUrl, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(3000);

  const allInputs = await page.$$("input");
  console.log(`  Found ${allInputs.length} input elements on page`);
  for (const inp of allInputs) {
    const id = await inp.getAttribute("id").catch(() => "");
    const name = await inp.getAttribute("name").catch(() => "");
    const type = await inp.getAttribute("type").catch(() => "");
    const visible = await inp.isVisible().catch(() => false);
    if (id || name)
      console.log(
        `    input: id="${id}" name="${name}" type="${type}" visible=${visible}`,
      );
  }

  const userSelectors = [
    "#ctl00_PlaceHolderMain_LoginBox_txtUserId",
    'input[name*="txtUserId"]',
    'input[name*="UserName"]',
    'input[name*="userName"]',
    'input[id*="UserId"]',
    'input[id*="userId"]',
    'input[type="text"][id*="User"]',
    'input[type="email"]',
  ];

  let userField = await findFieldInFrames(page, userSelectors);
  if (!userField) {
    const textInputs = await page.$$('input[type="text"]');
    for (const inp of textInputs) {
      if (await inp.isVisible().catch(() => false)) {
        userField = inp;
        break;
      }
    }
  }
  if (!userField) throw new Error("Cannot find Accela username field");
  await userField.fill(username);
  console.log("  Filled username");

  const passSelectors = [
    "#ctl00_PlaceHolderMain_LoginBox_txtPassword",
    'input[name*="txtPassword"]',
    'input[name*="Password"]',
    'input[name*="password"]',
    'input[id*="Password"]',
    'input[id*="password"]',
    'input[type="password"]',
  ];

  let passField = await findFieldInFrames(page, passSelectors);
  if (!passField) throw new Error("Cannot find Accela password field");
  await passField.fill(password);
  console.log("  Filled password");

  const loginBtnSelectors = [
    "#ctl00_PlaceHolderMain_LoginBox_btnLogin",
    'input[name*="btnLogin"]',
    'a[id*="btnLogin"]',
    'a[id*="Login"]',
    'button:has-text("SIGN IN")',
    'button:has-text("Sign In")',
    'button:has-text("Log In")',
    'input[type="submit"]',
    'button[type="submit"]',
  ];

  let loginBtn = await findFieldInFrames(page, loginBtnSelectors);

  console.log(`  Login button found: ${!!loginBtn}`);
  if (!loginBtn) {
    const allAnchors = await page.$$("a");
    for (const a of allAnchors) {
      const text = (await a.textContent().catch(() => "")).trim().toUpperCase();
      const visible = await a.isVisible().catch(() => false);
      if (
        visible &&
        (text === "SIGN IN" || text === "LOG IN" || text === "LOGIN")
      ) {
        loginBtn = a;
        console.log(`  Found login anchor by text: "${text}"`);
        break;
      }
    }
  }

  if (loginBtn) {
    await Promise.all([
      page
        .waitForNavigation({ waitUntil: "networkidle", timeout: 30000 })
        .catch(() => {}),
      loginBtn.click(),
    ]);
  } else {
    console.log("  No login button found, pressing Enter");
    await page.keyboard.press("Enter");
    await page
      .waitForNavigation({ waitUntil: "networkidle", timeout: 30000 })
      .catch(() => {});
  }
  await page.waitForTimeout(3000);

  const url = page.url();
  console.log(`  After login URL: ${url}`);

  const logoutLink = await page.$(
    'a[href*="Logout"], a:has-text("Logout"), a:has-text("Log Out"), a:has-text("Sign Out")',
  );
  const myAccountLink = await page.$(
    'a:has-text("My Account"), a:has-text("My Records"), a:has-text("Dashboard")',
  );
  const welcomeText = await page.$(
    '[id*="Welcome"], [class*="welcome"], [id*="loggedIn"]',
  );

  if (logoutLink || myAccountLink || welcomeText) {
    console.log(`  Login confirmed (found post-login elements)`);
    return url;
  }

  if (url.includes("Login.aspx") || url.includes("login")) {
    const errorEl = await page.$(
      ".ACA_Error, .error-message, [id*='Error'], [id*='error'], .font11px",
    );
    const errorText = errorEl
      ? await errorEl.textContent().catch(() => "")
      : "";
    throw new Error(
      "Accela login failed" + (errorText ? `: ${errorText.trim()}` : ""),
    );
  }

  console.log(`  After login: ${url}`);
  return url;
}

// ==============================================================================
// 🚀 NEW SIMPLIFIED SEARCH: Uses the "My Records" view from the Permits Tab
// ==============================================================================
async function searchPermit(page, portalUrl, permitNumber) {
  console.log(`  Searching for permit: ${permitNumber} via My Records flow`);

  // 1. Establish session if opening a new blank tab
  if (page.url() === "about:blank") {
    console.log(`  Loading base portal to establish session: ${portalUrl}`);
    await page.goto(portalUrl, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(2000);
  }

  // 2. Click the Permits and Inspections tab to view My Records
  const permitsTab = await findFieldInFrames(page, [
    'a:has-text("Permits and Inspections")',
    'a:has-text("Permits & Inspections")',
    'a:has-text("Building")',
  ]);

  if (permitsTab) {
    const tabText = (await permitsTab.textContent().catch(() => "")).trim();
    console.log(`  Clicking tab: "${tabText}"`);
    await permitsTab.click();
    await page.waitForTimeout(5000); // Give the Accela list time to load the grid
  } else {
    throw new Error("Could not find the Permits and Inspections tab");
  }

  console.log("  Scanning the loaded records list...");

// 3. SKIP THE FILTER BOX - Go straight to scanning the list
console.log("  Scanning visible records list (Manual-Style)...");

  // 4. Find the specific permit link by scanning all clickable elements
  const permitFound = await page.evaluate((targetPermit) => {
    // Broad search: look for links, spans, or table cells containing the number
    const elements = Array.from(document.querySelectorAll('a, span, td'));

    // Find the first visible element that exactly matches or contains the permit
    const match = elements.find(el => {
      const text = el.textContent.trim();
      const isVisible = el.offsetWidth > 0 && el.offsetHeight > 0;
      return isVisible && text.includes(targetPermit);
    });

    if (match) {
      // Force a click on the element (or its closest anchor parent)
      const clickable = match.tagName === 'A' ? match : match.closest('a') || match;
      clickable.click();
      return true;
    }
    return false;
  }, permitNumber);

  if (permitFound) {
    console.log(`  ✅ Found and clicked permit: ${permitNumber}`);
    await waitForAccelaLoad(page);
  } else {
    await page.screenshot({ path: "grid_not_found.png", fullPage: true });
    throw new Error(`Permit ${permitNumber} not visible in the current list.`);
  }
}
// ==============================================================================

async function extractRecordHeader(page) {
  console.log("  📋 Extracting record header...");
  const header = await page.evaluate(() => {
    const fields = {};

    const capNumEl = document.querySelector(
      '[id*="lblPermitNumber"], [id*="capNumber"], .aca_page_title, h1',
    );
    if (capNumEl) fields.record_number = capNumEl.textContent.trim();

    const typeEl = document.querySelector(
      '[id*="lblPermitType"], [id*="lblCapType"]',
    );
    if (typeEl) fields.record_type = typeEl.textContent.trim();

    const statusEl = document.querySelector(
      '[id*="lblPermitStatus"], [id*="lblCapStatus"], [id*="Status"]',
    );
    if (statusEl) fields.record_status = statusEl.textContent.trim();

    const allSpans = document.querySelectorAll("span, td");
    for (const el of allSpans) {
      const text = el.textContent.trim();
      if (text.includes("Expiration") || text.includes("Expire")) {
        const next = el.nextElementSibling;
        if (next) fields.expiration_date = next.textContent.trim();
      }
    }

    return fields;
  });
  console.log(
    `     Record: ${header.record_number || "unknown"} | Status: ${header.record_status || "unknown"}`,
  );
  return header;
}

async function extractRecordDetails(page) {
  console.log("  📋 Extracting record details...");

  await clickAccelaLink(
    page,
    [
      'a:has-text("Record Info")',
      'a[id*="RecordInfo"]',
      '#ctl00_PlaceHolderMain_TabDataList a:has-text("Record")',
    ],
    "Record Info",
  );

  await clickAccelaLink(
    page,
    [
      'a:has-text("Record Details")',
      'a:has-text("Record Detail")',
      'a[id*="RecordDetail"]',
    ],
    "Record Details",
  );

  const moreDetailsBtn = await page.$(
    'a:has-text("More Details"), a:has-text("Show More"), [id*="MoreDetail"]',
  );
  if (moreDetailsBtn && (await moreDetailsBtn.isVisible().catch(() => false))) {
    await moreDetailsBtn.click().catch(() => {});
    await waitForAccelaLoad(page);
  }

  const details = await page.evaluate(() => {
    const tables = [];
    const fields = {};

    document
      .querySelectorAll(
        "table.ACA_TBody tr, table[id*='Detail'] tr, .aca_table_row, div.ACA_TabRow",
      )
      .forEach((row) => {
        const cells = row.querySelectorAll(
          "td, th, span.ACA_Label, span.ACA_Value",
        );
        if (cells.length >= 2) {
          const label = cells[0].textContent.trim().replace(/:$/, "").trim();
          const value = cells[1].textContent.trim();
          if (label && value && label.length < 60) {
            fields[label] = value;
          }
        }
      });

    document
      .querySelectorAll("span.ACA_Label, label, td.ACA_AlignLeftOrRightTop")
      .forEach((labelEl) => {
        const label = labelEl.textContent.trim().replace(/:$/, "").trim();
        if (!label || label.length > 60) return;
        const next = labelEl.nextElementSibling;
        if (next) {
          const val = next.textContent.trim();
          if (val && !fields[label]) fields[label] = val;
        }
      });

    const rows = Object.entries(fields).map(([key, value]) => ({ key, value }));
    if (rows.length > 0) {
      tables.push({
        title: "Record Details",
        headers: ["Field", "Value"],
        rows,
      });
    }

    return { tables, fields };
  });

  const detailScreenshot = await page
    .screenshot({ fullPage: true })
    .catch(() => null);
  details.screenshot = detailScreenshot
    ? detailScreenshot.toString("base64")
    : null;

  console.log(
    `     Extracted ${Object.keys(details.fields).length} detail fields`,
  );
  return details;
}

async function extractProcessingStatus(page) {
  console.log("  📋 Extracting processing status...");

  const found = await clickAccelaLink(
    page,
    [
      'a:has-text("Processing Status")',
      'a[id*="ProcessingStatus"]',
      'a:has-text("Workflow")',
    ],
    "Processing Status",
  );

  if (!found) {
    return { departments: [], screenshot: null };
  }

  const expandButtons = await page.$$(
    '[id*="expand"], .collapse-icon, a[onclick*="expand"], img[src*="expand"], .aca_expand',
  );
  for (const btn of expandButtons) {
    await btn.click().catch(() => {});
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(2000);

  const departments = await page.evaluate(() => {
    const depts = [];
    const rows = document.querySelectorAll(
      '[id*="WorkflowTask"], [id*="ProcessStatus"] tr, .workflow-task, li[id*="task"]',
    );

    rows.forEach((row) => {
      const nameEl = row.querySelector(
        '[id*="TaskName"], .task-name, td:first-child, span.ACA_SmLabel',
      );
      const statusEl = row.querySelector(
        '[id*="TaskStatus"], .task-status, [class*="status"]',
      );
      const dateEl = row.querySelector(
        '[id*="DueDate"], [id*="Date"], .task-date',
      );
      const detailEl = row.querySelector(
        '[id*="Comment"], [id*="Detail"], .task-detail',
      );

      const name = nameEl ? nameEl.textContent.trim() : "";
      const statusText = statusEl ? statusEl.textContent.trim() : "";

      const checkImg = row.querySelector(
        'img[src*="check"], img[src*="complete"], img[src*="green"]',
      );
      const clockImg = row.querySelector(
        'img[src*="clock"], img[src*="pending"], img[src*="yellow"], img[src*="wait"]',
      );
      let statusIcon = "";
      if (checkImg) statusIcon = "complete";
      else if (clockImg) statusIcon = "pending";

      if (name && name.length < 100) {
        depts.push({
          name,
          status: statusText,
          statusIcon,
          date: dateEl ? dateEl.textContent.trim() : "",
          details: detailEl ? detailEl.textContent.trim() : "",
        });
      }
    });

    if (depts.length === 0) {
      const allTables = document.querySelectorAll("table");
      for (const table of allTables) {
        const headerRow = table.querySelector("tr");
        if (!headerRow) continue;
        const headers = Array.from(headerRow.querySelectorAll("th, td")).map(
          (h) => h.textContent.trim().toLowerCase(),
        );
        if (
          headers.some(
            (h) =>
              h.includes("task") ||
              h.includes("department") ||
              h.includes("step"),
          )
        ) {
          const dataRows = table.querySelectorAll("tr:not(:first-child)");
          dataRows.forEach((dr) => {
            const cells = dr.querySelectorAll("td");
            if (cells.length >= 2) {
              const checkImg = dr.querySelector(
                'img[src*="check"], img[src*="complete"], img[src*="green"]',
              );
              const clockImg = dr.querySelector(
                'img[src*="clock"], img[src*="pending"], img[src*="yellow"]',
              );
              depts.push({
                name: cells[0].textContent.trim(),
                status: cells.length > 1 ? cells[1].textContent.trim() : "",
                statusIcon: checkImg ? "complete" : clockImg ? "pending" : "",
                date: cells.length > 2 ? cells[2].textContent.trim() : "",
                details: cells.length > 3 ? cells[3].textContent.trim() : "",
              });
            }
          });
          break;
        }
      }
    }

    return depts;
  });

  const screenshot = await page
    .screenshot({ fullPage: true })
    .catch(() => null);
  const screenshotBase64 = screenshot ? screenshot.toString("base64") : null;

  console.log(`     Found ${departments.length} departments/tasks`);
  return { departments, screenshot: screenshotBase64 };
}

async function extractPlanReview(page) {
  console.log("  📋 Extracting plan review comments...");

  const found = await clickAccelaLink(
    page,
    ['a:has-text("Plan Review")', 'a[id*="PlanReview"]'],
    "Plan Review",
  );

  if (!found) {
    return { comments: [], text: "", screenshot: null };
  }

  const comments = await page.evaluate(() => {
    const results = [];

    document
      .querySelectorAll(
        '[id*="ReviewComment"] tr, [id*="PlanReview"] tr, table[id*="Comment"] tr',
      )
      .forEach((row) => {
        const cells = row.querySelectorAll("td");
        if (cells.length >= 2) {
          const commentText = Array.from(cells)
            .map((c) => c.textContent.trim())
            .join(" | ");
          if (commentText.length > 20) {
            results.push({
              reviewer: cells.length > 0 ? cells[0].textContent.trim() : "",
              department: cells.length > 1 ? cells[1].textContent.trim() : "",
              comment:
                cells.length > 2
                  ? cells[2].textContent.trim()
                  : cells[1].textContent.trim(),
              date: cells.length > 3 ? cells[3].textContent.trim() : "",
            });
          }
        }
      });

    if (results.length === 0) {
      const container = document.querySelector(
        '[id*="ReviewComment"], [id*="PlanReview"], [id*="Comment"]',
      );
      if (container) {
        const text = container.textContent.trim();
        if (text.length > 20) {
          results.push({
            reviewer: "",
            department: "",
            comment: text.slice(0, 5000),
            date: "",
          });
        }
      }
    }

    return results;
  });

  const pageText = await page.evaluate(() => {
    const container = document.querySelector(
      '[id*="ReviewComment"], [id*="PlanReview"], main, #mainContent',
    );
    return container
      ? container.textContent.trim().slice(0, 50000)
      : document.body.innerText.slice(0, 50000);
  });

  const screenshot = await page
    .screenshot({ fullPage: true })
    .catch(() => null);
  const screenshotBase64 = screenshot ? screenshot.toString("base64") : null;

  console.log(`     Found ${comments.length} review comments`);
  return { comments, text: pageText, screenshot: screenshotBase64 };
}

async function extractRelatedRecords(page) {
  console.log("  📋 Extracting related records...");

  const found = await clickAccelaLink(
    page,
    ['a:has-text("Related Records")', 'a[id*="RelatedRecord"]'],
    "Related Records",
  );

  if (!found) {
    return { records: [], screenshot: null };
  }

  const viewTree = await page.$(
    'a:has-text("View Entire Tree"), a:has-text("Entire Tree")',
  );
  if (viewTree && (await viewTree.isVisible().catch(() => false))) {
    await viewTree.click().catch(() => {});
    await waitForAccelaLoad(page);
  }

  const records = await page.evaluate(() => {
    const results = [];
    document
      .querySelectorAll('[id*="RelatedRecord"] tr, [id*="Related"] table tr')
      .forEach((row) => {
        const cells = row.querySelectorAll("td");
        if (cells.length >= 2) {
          const recordNum = cells[0].textContent.trim();
          if (recordNum && !recordNum.toLowerCase().includes("record number")) {
            results.push({
              record_number: recordNum,
              record_type: cells.length > 1 ? cells[1].textContent.trim() : "",
              status: cells.length > 2 ? cells[2].textContent.trim() : "",
              project_name: cells.length > 3 ? cells[3].textContent.trim() : "",
              date: cells.length > 4 ? cells[4].textContent.trim() : "",
            });
          }
        }
      });
    return results;
  });

  const relScreenshot = await page
    .screenshot({ fullPage: true })
    .catch(() => null);
  console.log(`     Found ${records.length} related records`);
  return {
    records,
    screenshot: relScreenshot ? relScreenshot.toString("base64") : null,
  };
}

async function extractAttachments(
  page,
  session,
  supabaseProjectId,
  supabase,
  uploadFn,
  sanitizeFn,
) {
  console.log("  📋 Extracting attachments...");

  const found = await clickAccelaLink(
    page,
    [
      'a:has-text("Attachments")',
      'a:has-text("Attachment")',
      'a[id*="Attachment"]',
      'a:has-text("Documents")',
      'a[id*="Document"]',
    ],
    "Attachments",
  );

  if (!found) {
    return { attachments: [], screenshot: null };
  }

  const attachments = await page.evaluate(() => {
    const results = [];
    document
      .querySelectorAll('[id*="Attachment"] tr, [id*="Document"] tr')
      .forEach((row) => {
        const cells = row.querySelectorAll("td");
        if (cells.length >= 2) {
          const name = cells[0].textContent.trim();
          if (
            name &&
            name.length < 200 &&
            !name.toLowerCase().includes("file name") &&
            !name.toLowerCase().includes("document name")
          ) {
            const actionLinks = row.querySelectorAll("a");
            let hasDownload = false;
            for (const a of actionLinks) {
              const t = a.textContent.trim().toLowerCase();
              if (t.includes("download") || t.includes("view"))
                hasDownload = true;
            }
            results.push({
              name,
              record_id: cells.length > 1 ? cells[1].textContent.trim() : "",
              record_type: cells.length > 2 ? cells[2].textContent.trim() : "",
              entity_type: cells.length > 3 ? cells[3].textContent.trim() : "",
              type: cells.length > 4 ? cells[4].textContent.trim() : "",
              size: cells.length > 5 ? cells[5].textContent.trim() : "",
              latest_update:
                cells.length > 6 ? cells[6].textContent.trim() : "",
              rowIndex: Array.from(row.parentElement.children).indexOf(row),
              hasDownload,
            });
          }
        }
      });
    return results;
  });

  console.log(
    `     Found ${attachments.length} attachments, attempting downloads...`,
  );

  const DOWNLOADS_DIR = path.join(__dirname, "downloads");
  if (!fs.existsSync(DOWNLOADS_DIR))
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

  const downloadedHashes = new Map();

  for (let ai = 0; ai < attachments.length; ai++) {
    const att = attachments[ai];
    if (session)
      session.message = `Attachments → downloading ${ai + 1}/${attachments.length}: ${att.name}`;
    console.log(
      `       📥 [${ai + 1}/${attachments.length}] Downloading: ${att.name}`,
    );

    try {
      const rows = await page.$$('[id*="Attachment"] tr, [id*="Document"] tr');
      let targetRow = null;
      const dataRows = [];
      for (const row of rows) {
        const firstCell = await row.$("td");
        if (firstCell) dataRows.push(row);
      }
      if (att.rowIndex !== undefined && att.rowIndex < dataRows.length) {
        targetRow = dataRows[att.rowIndex];
      } else {
        for (const row of dataRows) {
          const firstCell = await row.$("td");
          if (!firstCell) continue;
          const text = (await firstCell.textContent().catch(() => "")).trim();
          if (text === att.name) {
            targetRow = row;
            break;
          }
        }
      }

      if (!targetRow) {
        console.log(
          `       ⚠️ Could not re-locate row for "${att.name}" (index ${att.rowIndex}), skipping download`,
        );
        att.downloadStatus = "failed";
        att.downloadError = "row_not_found";
        continue;
      }

      const actionsLink = await targetRow.$(
        'a:has-text("Actions"), a:has-text("View"), a[id*="Action"]',
      );
      if (!actionsLink) {
        const downloadLink = await targetRow.$(
          'a[href*="Download"], a[href*="download"], a[onclick*="download"]',
        );
        if (downloadLink) {
          try {
            const [download] = await Promise.all([
              page.waitForEvent("download", { timeout: 30000 }),
              downloadLink.click(),
            ]);
            const safeDlName = (
              download.suggestedFilename() || att.name
            ).replace(/[^a-zA-Z0-9._-]/g, "_");
            const filePath = path.join(DOWNLOADS_DIR, safeDlName);
            await download.saveAs(filePath);

            const viewUrl = await tryUploadAccelaFile(
              filePath,
              safeDlName,
              supabaseProjectId,
              uploadFn,
              sanitizeFn,
              downloadedHashes,
            );
            att.viewUrl = viewUrl;
            att.downloadStatus = viewUrl ? "success" : "uploaded_no_url";
            console.log(
              `       ✅ Downloaded: ${att.name} → ${viewUrl || "(local)"}`,
            );
          } catch (dlErr) {
            console.log(
              `       ⚠️ Download failed for ${att.name}: ${dlErr.message}`,
            );
            att.downloadStatus = "failed";
            att.downloadError = dlErr.message;
          }
          continue;
        }

        console.log(
          `       ⚠️ No Actions/Download link found for "${att.name}"`,
        );
        att.downloadStatus = "failed";
        att.downloadError = "no_download_link";
        continue;
      }

      await actionsLink.click().catch(() => {});
      await page.waitForTimeout(1000);

      const viewDetailsLink = await page.$(
        'a:has-text("View Details"), a:has-text("Detail"), [id*="ViewDetail"]',
      );
      if (
        viewDetailsLink &&
        (await viewDetailsLink.isVisible().catch(() => false))
      ) {
        await viewDetailsLink.click().catch(() => {});
        await waitForAccelaLoad(page);
      }

      const downloadBtn = await page.$(
        'a:has-text("Download"), input[value*="Download"], button:has-text("Download"), a[href*="Download"]',
      );

      if (downloadBtn && (await downloadBtn.isVisible().catch(() => false))) {
        try {
          const [download] = await Promise.all([
            page.waitForEvent("download", { timeout: 30000 }),
            downloadBtn.click(),
          ]);
          const suggestedName = download.suggestedFilename() || att.name;
          const safeName = suggestedName.replace(/[^a-zA-Z0-9._-]/g, "_");
          const filePath = path.join(DOWNLOADS_DIR, safeName);
          await download.saveAs(filePath);

          const viewUrl = await tryUploadAccelaFile(
            filePath,
            safeName,
            supabaseProjectId,
            uploadFn,
            sanitizeFn,
            downloadedHashes,
          );
          att.viewUrl = viewUrl;
          att.downloadStatus = viewUrl ? "success" : "uploaded_no_url";
          console.log(
            `       ✅ Downloaded: ${safeName} → ${viewUrl || "(local)"}`,
          );
        } catch (dlErr) {
          console.log(
            `       ⚠️ Download failed for ${att.name}: ${dlErr.message}`,
          );
          att.downloadStatus = "failed";
          att.downloadError = dlErr.message;
        }
      } else {
        console.log(`       ⚠️ No Download button found for "${att.name}"`);
        att.downloadStatus = "failed";
        att.downloadError = "no_download_button";
      }

      const backLink = await page.$(
        'a:has-text("Back"), a:has-text("Return"), a:has-text("Attachments")',
      );
      if (backLink && (await backLink.isVisible().catch(() => false))) {
        await backLink.click().catch(() => {});
        await waitForAccelaLoad(page);
      } else {
        await page.goBack().catch(() => {});
        await waitForAccelaLoad(page);
      }
    } catch (err) {
      console.log(
        `       ❌ Attachment error for "${att.name}": ${err.message}`,
      );
      att.downloadStatus = "failed";
      att.downloadError = err.message;
    }
  }

  for (const att of attachments) {
    delete att.rowIndex;
    delete att.hasDownload;
  }

  const attScreenshot = await page
    .screenshot({ fullPage: true })
    .catch(() => null);
  const successCount = attachments.filter(
    (a) => a.downloadStatus === "success",
  ).length;
  console.log(
    `     Attachments: ${attachments.length} found, ${successCount} downloaded`,
  );
  return {
    attachments,
    screenshot: attScreenshot ? attScreenshot.toString("base64") : null,
  };
}

async function tryUploadAccelaFile(
  filePath,
  fileName,
  projectId,
  uploadFn,
  sanitizeFn,
  downloadedHashes,
) {
  if (!fs.existsSync(filePath)) return "";
  const fileBuffer = fs.readFileSync(filePath);
  const sizeMB = fileBuffer.length / (1024 * 1024);

  if (fileBuffer.length < 1024) {
    console.log(
      `       ⚠️ File too small (${fileBuffer.length} bytes), skipping upload`,
    );
    try {
      fs.unlinkSync(filePath);
    } catch (_) {}
    return "";
  }

  const contentHash = crypto.createHash("md5").update(fileBuffer).digest("hex");
  const prev = downloadedHashes.get(contentHash);
  if (prev) {
    console.log(
      `       ⚠️ DUPLICATE: "${fileName}" same as "${prev.fileName}", aliasing URL`,
    );
    try {
      fs.unlinkSync(filePath);
    } catch (_) {}
    return prev.viewUrl || "";
  }

  if (!projectId || !uploadFn) {
    try {
      fs.unlinkSync(filePath);
    } catch (_) {}
    downloadedHashes.set(contentHash, { fileName, viewUrl: "" });
    return "";
  }

  const storagePath = `drawings/${projectId}/${fileName}`;
  const publicUrl = await uploadFn(filePath, storagePath);
  try {
    fs.unlinkSync(filePath);
  } catch (_) {}
  downloadedHashes.set(contentHash, { fileName, viewUrl: publicUrl || "" });
  return publicUrl || "";
}

async function extractInspections(page) {
  console.log("  📋 Extracting inspections...");

  const found = await clickAccelaLink(
    page,
    [
      'a:has-text("Inspections")',
      'a:has-text("Inspection")',
      'a[id*="Inspection"]',
    ],
    "Inspections",
  );

  if (!found) {
    return { inspections: [], upcoming: [], completed: [], screenshot: null };
  }

  const inspData = await page.evaluate(() => {
    const upcoming = [];
    const completed = [];
    const all = [];

    function parseInspectionTable(container, category) {
      const rows = container.querySelectorAll("tr");
      rows.forEach((row) => {
        const cells = row.querySelectorAll("td");
        if (cells.length >= 2) {
          const type = cells[0].textContent.trim();
          if (
            type &&
            type.length < 200 &&
            !type.toLowerCase().includes("inspection type") &&
            !type.toLowerCase().includes("type")
          ) {
            const entry = {
              type,
              status: cells.length > 1 ? cells[1].textContent.trim() : "",
              date: cells.length > 2 ? cells[2].textContent.trim() : "",
              inspector: cells.length > 3 ? cells[3].textContent.trim() : "",
              result: cells.length > 4 ? cells[4].textContent.trim() : "",
              category,
            };
            all.push(entry);
            if (category === "upcoming") upcoming.push(entry);
            else completed.push(entry);
          }
        }
      });
    }

    const upcomingSection = document.querySelector(
      '[id*="Upcoming"], [id*="upcoming"], [id*="Scheduled"], [id*="scheduled"]',
    );
    const completedSection = document.querySelector(
      '[id*="Completed"], [id*="completed"], [id*="History"], [id*="history"]',
    );

    if (upcomingSection) {
      const table =
        upcomingSection.closest("table") ||
        upcomingSection.querySelector("table") ||
        upcomingSection;
      parseInspectionTable(table, "upcoming");
    }
    if (completedSection) {
      const table =
        completedSection.closest("table") ||
        completedSection.querySelector("table") ||
        completedSection;
      parseInspectionTable(table, "completed");
    }

    if (all.length === 0) {
      document
        .querySelectorAll('[id*="Inspection"] tr, [id*="inspection"] tr')
        .forEach((row) => {
          const cells = row.querySelectorAll("td");
          if (cells.length >= 2) {
            const type = cells[0].textContent.trim();
            if (
              type &&
              type.length < 200 &&
              !type.toLowerCase().includes("inspection type")
            ) {
              const statusText =
                cells.length > 1
                  ? cells[1].textContent.trim().toLowerCase()
                  : "";
              const category =
                statusText.includes("pass") ||
                statusText.includes("fail") ||
                statusText.includes("approved") ||
                statusText.includes("completed")
                  ? "completed"
                  : "upcoming";
              const entry = {
                type,
                status: cells.length > 1 ? cells[1].textContent.trim() : "",
                date: cells.length > 2 ? cells[2].textContent.trim() : "",
                inspector: cells.length > 3 ? cells[3].textContent.trim() : "",
                result: cells.length > 4 ? cells[4].textContent.trim() : "",
                category,
              };
              all.push(entry);
              if (category === "upcoming") upcoming.push(entry);
              else completed.push(entry);
            }
          }
        });
    }

    return { all, upcoming, completed };
  });

  const inspScreenshot = await page
    .screenshot({ fullPage: true })
    .catch(() => null);
  console.log(
    `     Found ${inspData.all.length} inspections (${inspData.upcoming.length} upcoming, ${inspData.completed.length} completed)`,
  );
  return {
    inspections: inspData.all,
    upcoming: inspData.upcoming,
    completed: inspData.completed,
    screenshot: inspScreenshot ? inspScreenshot.toString("base64") : null,
  };
}

async function extractPayments(page) {
  console.log("  📋 Extracting payments...");

  const found = await clickAccelaLink(
    page,
    [
      'a:has-text("Payments")',
      'a:has-text("Payment")',
      'a:has-text("Fees")',
      'a[id*="Payment"]',
    ],
    "Payments",
  );

  if (!found) {
    return { payments: [], screenshot: null };
  }

  const payments = await page.evaluate(() => {
    const results = [];
    document
      .querySelectorAll('[id*="Payment"] tr, [id*="Fee"] tr')
      .forEach((row) => {
        const cells = row.querySelectorAll("td");
        if (cells.length >= 2) {
          const desc = cells[0].textContent.trim();
          if (
            desc &&
            desc.length < 200 &&
            !desc.toLowerCase().includes("description")
          ) {
            results.push({
              description: desc,
              amount: cells.length > 1 ? cells[1].textContent.trim() : "",
              status: cells.length > 2 ? cells[2].textContent.trim() : "",
              date: cells.length > 3 ? cells[3].textContent.trim() : "",
            });
          }
        }
      });
    return results;
  });

  const payScreenshot = await page
    .screenshot({ fullPage: true })
    .catch(() => null);
  console.log(`     Found ${payments.length} payment records`);
  return {
    payments,
    screenshot: payScreenshot ? payScreenshot.toString("base64") : null,
  };
}

async function scrapeAccelaRecord(
  session,
  permitNumber,
  supabaseProjectId,
  userId,
  supabase,
  hashPortalData,
  uploadToSupabaseStorage,
  sanitizeStorageKey,
) {
  const { context, portalUrl } = session;
  const page = await context.newPage();
  const TIMEOUT = 600000;
  const startTime = Date.now();

  const checkTimeout = () => {
    if (Date.now() - startTime > TIMEOUT)
      throw new Error("Accela scraping timed out (10 minute limit)");
  };

  try {
    session.message = `${permitNumber} → Searching...`;
    await searchPermit(page, portalUrl, permitNumber);
    checkTimeout();

    session.message = `${permitNumber} → Record Header`;
    const header = await extractRecordHeader(page);
    checkTimeout();

    const headerScreenshot = await page
      .screenshot({ fullPage: true })
      .catch(() => null);
    const headerScreenshotBase64 = headerScreenshot
      ? headerScreenshot.toString("base64")
      : null;

    session.message = `${permitNumber} → Record Details`;
    const details = await extractRecordDetails(page);
    checkTimeout();

    session.message = `${permitNumber} → Processing Status`;
    const processingStatus = await extractProcessingStatus(page);
    checkTimeout();

    session.message = `${permitNumber} → Plan Review`;
    const planReview = await extractPlanReview(page);
    checkTimeout();

    session.message = `${permitNumber} → Related Records`;
    const relatedRecords = await extractRelatedRecords(page);
    checkTimeout();

    session.message = `${permitNumber} → Attachments`;
    const attachments = await extractAttachments(
      page,
      session,
      supabaseProjectId,
      supabase,
      uploadToSupabaseStorage,
      sanitizeStorageKey,
    );
    checkTimeout();

    session.message = `${permitNumber} → Inspections`;
    const inspections = await extractInspections(page);
    checkTimeout();

    session.message = `${permitNumber} → Payments`;
    const payments = await extractPayments(page);

    const portalData = {
      portalType: "accela",
      name: header.record_number || permitNumber,
      projectNum: permitNumber,
      description: header.record_type || "",
      location:
        details.fields["Work Location"] ||
        details.fields["Address"] ||
        details.fields["Location"] ||
        "",
      dashboardStatus: header.record_status || "",
      tabs: {
        info: {
          tables: details.tables,
          fields: header,
          keyValues: Object.entries(details.fields).map(([key, value]) => ({
            key,
            value,
          })),
          screenshot: details.screenshot,
        },
        status: {
          departments: processingStatus.departments,
          tables:
            processingStatus.departments.length > 0
              ? [
                  {
                    title: "Processing Status",
                    headers: ["Department", "Status", "Due Date", "Details"],
                    rows: processingStatus.departments,
                  },
                ]
              : [],
          keyValues: [],
          screenshot: processingStatus.screenshot,
        },
        reports: {
          pdfs: [
            ...(processingStatus.screenshot
              ? [
                  {
                    fileName: "Processing Status",
                    text: processingStatus.departments
                      .map(
                        (d) => `${d.name}: ${d.status} ${d.date} ${d.details}`,
                      )
                      .join("\n"),
                    screenshot: processingStatus.screenshot,
                    source: "accela",
                  },
                ]
              : []),
            ...(planReview.text
              ? [
                  {
                    fileName: "Plan Review - Review Comments",
                    text: planReview.text,
                    screenshot: planReview.screenshot,
                    source: "accela",
                    comments: planReview.comments,
                  },
                ]
              : []),
            ...(headerScreenshotBase64
              ? [
                  {
                    fileName: "Record Overview",
                    text: Object.entries(header)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join("\n"),
                    screenshot: headerScreenshotBase64,
                    source: "accela",
                  },
                ]
              : []),
          ],
          keyValues: [],
          tables: [],
        },
        attachments: {
          tables:
            attachments.attachments.length > 0
              ? [
                  {
                    title: "Attachments",
                    headers: [
                      "Name",
                      "Record ID",
                      "Record Type",
                      "Entity Type",
                      "Type",
                      "Size",
                      "Last Updated",
                    ],
                    rows: attachments.attachments,
                  },
                ]
              : [],
          keyValues: [],
          screenshot: attachments.screenshot,
        },
        inspections: {
          tables: [
            ...(inspections.upcoming.length > 0
              ? [
                  {
                    title: "Upcoming Inspections",
                    headers: ["Type", "Status", "Date", "Inspector", "Result"],
                    rows: inspections.upcoming,
                  },
                ]
              : []),
            ...(inspections.completed.length > 0
              ? [
                  {
                    title: "Completed Inspections",
                    headers: ["Type", "Status", "Date", "Inspector", "Result"],
                    rows: inspections.completed,
                  },
                ]
              : []),
            ...(inspections.inspections.length > 0 &&
            inspections.upcoming.length === 0 &&
            inspections.completed.length === 0
              ? [
                  {
                    title: "Inspections",
                    headers: ["Type", "Status", "Date", "Inspector", "Result"],
                    rows: inspections.inspections,
                  },
                ]
              : []),
          ],
          keyValues: [],
          screenshot: inspections.screenshot,
        },
        payments: {
          tables:
            payments.payments.length > 0
              ? [
                  {
                    title: "Payments",
                    headers: ["Description", "Amount", "Status", "Date"],
                    rows: payments.payments,
                  },
                ]
              : [],
          keyValues: [],
          screenshot: payments.screenshot,
        },
        relatedRecords: {
          tables:
            relatedRecords.records.length > 0
              ? [
                  {
                    title: "Related Records",
                    headers: [
                      "Record Number",
                      "Record Type",
                      "Status",
                      "Project Name",
                      "Date",
                    ],
                    rows: relatedRecords.records,
                  },
                ]
              : [],
          keyValues: [],
          screenshot: relatedRecords.screenshot,
        },
      },
    };

    session.data[permitNumber] = portalData;

    if (supabase && userId) {
      session.message = `${permitNumber} → Syncing to database...`;
      console.log(`\n  💾 Syncing ${permitNumber} to Supabase...`);
      const newHash = hashPortalData(portalData);

      const { data: existingRows } = await supabase
        .from("projects")
        .select("id, portal_data_hash")
        .eq("permit_number", permitNumber)
        .eq("user_id", userId);

      const existingRow =
        existingRows && existingRows.length > 0 ? existingRows[0] : null;

      if (existingRow && existingRow.portal_data_hash === newHash) {
        console.log(`  ⏭️ Data unchanged (hash match), skipping update`);
        await supabase
          .from("projects")
          .update({ last_checked_at: new Date().toISOString() })
          .eq("id", existingRow.id);
      } else {
        const updatePayload = {
          portal_status: header.record_status || "Scraped",
          last_checked_at: new Date().toISOString(),
          portal_data: portalData,
          portal_data_hash: newHash,
          permit_number: permitNumber,
        };

        let { data, error } = await supabase
          .from("projects")
          .update(updatePayload)
          .eq("permit_number", permitNumber)
          .eq("user_id", userId)
          .select();

        if (error) {
          console.error("  ❌ Supabase error:", error.message);
        } else if (data && data.length > 0) {
          console.log("  ✅ Updated existing project:", data[0].id);
        } else {
          const { data: created, error: createError } = await supabase
            .from("projects")
            .insert({
              user_id: userId,
              name: header.record_number || permitNumber,
              permit_number: permitNumber,
              description: header.record_type || "",
              address: portalData.location || "",
              jurisdiction: "Baltimore",
              status: "draft",
              portal_status: header.record_status || "Unknown",
              last_checked_at: new Date().toISOString(),
              portal_data: portalData,
              portal_data_hash: newHash,
            })
            .select();
          if (createError) {
            console.error("  ❌ Supabase create error:", createError.message);
          } else if (created && created.length > 0) {
            console.log("  📝 Created new project:", created[0].id);
          }
        }
      }
    }

    console.log(`  ✅ Accela scrape complete for ${permitNumber}`);
    return portalData;
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = {
  accelaLogin,
  scrapeAccelaRecord,
};
