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

async function dumpPageDiagnostics(page, label) {
  const url = page.url();
  const title = await page.title().catch(() => "(unknown)");
  const loginFormVisible = !!(await findFieldInFrames(page, ['input[type="password"]']));
  const logoutVisible = !!(await findFieldInFrames(page, [
    'a:has-text("Logout")', 'a:has-text("Log Out")', 'a:has-text("Sign Out")',
  ]));
  const welcomeVisible = !!(await findFieldInFrames(page, [
    '#ctl00_HeaderNavigation_lblWelcome', '[id*="lblWelcome"]',
  ]));
  const frames = page.frames();
  const frameInfo = frames.map((f, i) => `${i}:${f.name() || "(unnamed)"}@${f.url().substring(0, 80)}`);
  console.log(`  [DIAG:${label}] url=${url}`);
  console.log(`  [DIAG:${label}] title=${title}`);
  console.log(`  [DIAG:${label}] loginFormVisible=${loginFormVisible} logoutVisible=${logoutVisible} welcomeVisible=${welcomeVisible}`);
  console.log(`  [DIAG:${label}] frames(${frames.length}): ${frameInfo.join(" | ")}`);
}

async function findAuthLandmark(page) {
  const selectors = [
    'a:has-text("Logout")', 'a:has-text("Log Out")', 'a:has-text("Sign Out")',
    '#ctl00_HeaderNavigation_lblWelcome',
    'a:has-text("My Account")', 'a:has-text("My Records")',
    '[id*="lblWelcome"]',
  ];
  return !!(await findFieldInFrames(page, selectors));
}

async function findLoginFrame(page) {
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    const nameMatch = (frame.name() || "").toLowerCase().includes("login");
    const urlMatch = frame.url().toLowerCase().includes("login");
    if (nameMatch || urlMatch) {
      console.log(`  Found LoginFrame: name="${frame.name()}" url=${frame.url().substring(0, 100)}`);
      return frame;
    }
  }
  return null;
}

async function findFieldInContext(context, selectors) {
  for (const sel of selectors) {
    try {
      const el = await context.$(sel);
      if (el && (await el.isVisible().catch(() => false))) return el;
    } catch (_) {}
  }
  return null;
}

async function dumpLoginFrameDiagnostics(frame, label) {
  if (!frame) {
    console.log(`  [DIAG:${label}] LoginFrame not available`);
    return;
  }
  const url = frame.url();
  const userStillVisible = !!(await findFieldInContext(frame, [
    'input[name*="txtUserId"]', 'input[name*="UserName"]', 'input[id*="UserId"]',
    'input[type="text"][id*="User"]', 'input[type="email"]',
  ]));
  const passStillVisible = !!(await findFieldInContext(frame, ['input[type="password"]']));
  const btnDisabled = await frame.evaluate(() => {
    const btn = document.querySelector('button[type="submit"], input[type="submit"], a[id*="btnLogin"]');
    return btn ? btn.disabled || btn.getAttribute("disabled") !== null : "no_btn";
  }).catch(() => "eval_error");
  const errorText = await frame.evaluate(() => {
    const errorSels = ['.ACA_Error', '.error-message', '[id*="Error"]', '[id*="error"]',
      '.font11px', '.validation-summary-errors', '[class*="alert"]', '[class*="error"]'];
    for (const sel of errorSels) {
      const el = document.querySelector(sel);
      if (el && el.offsetWidth > 0 && el.textContent.trim()) return el.textContent.trim().substring(0, 200);
    }
    return "";
  }).catch(() => "");
  console.log(`  [DIAG:${label}] LoginFrame url=${url}`);
  console.log(`  [DIAG:${label}] userFieldVisible=${userStillVisible} passFieldVisible=${passStillVisible} btnDisabled=${btnDisabled}`);
  if (errorText) console.log(`  [DIAG:${label}] errorText="${errorText}"`);
}

async function accelaLogin(page, username, password, portalUrl) {
  const cleanUrl = portalUrl.replace(/\/$/, "").replace(/\/Login\.aspx$/i, "");
  const loginUrl = cleanUrl + "/Login.aspx";
  console.log(`  Navigating to Accela login: ${loginUrl}`);
  await page.goto(loginUrl, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(3000);

  const loginFrame = await findLoginFrame(page);

  const contexts = loginFrame ? [loginFrame, page] : [page];
  console.log(`  Login context: ${loginFrame ? "LoginFrame (primary)" : "main page (no LoginFrame found)"}`);

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

  let userField = null;
  let activeContext = null;
  for (const ctx of contexts) {
    userField = await findFieldInContext(ctx, userSelectors);
    if (!userField) {
      const textInputs = await ctx.$$('input[type="text"]').catch(() => []);
      for (const inp of textInputs) {
        if (await inp.isVisible().catch(() => false)) {
          userField = inp;
          break;
        }
      }
    }
    if (userField) {
      activeContext = ctx;
      break;
    }
  }
  if (!userField) {
    await dumpPageDiagnostics(page, "NO_USER_FIELD");
    await dumpLoginFrameDiagnostics(loginFrame, "NO_USER_FIELD");
    throw new Error("Cannot find Accela username field in LoginFrame or main page");
  }
  console.log(`  Found username field in ${activeContext === loginFrame ? "LoginFrame" : "main page"}`);
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

  const passField = await findFieldInContext(activeContext, passSelectors);
  if (!passField) {
    await dumpLoginFrameDiagnostics(loginFrame, "NO_PASS_FIELD");
    throw new Error("Cannot find Accela password field");
  }
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

  let loginBtn = await findFieldInContext(activeContext, loginBtnSelectors);
  if (!loginBtn) {
    const allAnchors = await activeContext.$$("a").catch(() => []);
    for (const a of allAnchors) {
      const text = (await a.textContent().catch(() => "")).trim().toUpperCase();
      const visible = await a.isVisible().catch(() => false);
      if (visible && (text === "SIGN IN" || text === "LOG IN" || text === "LOGIN")) {
        loginBtn = a;
        break;
      }
    }
  }

  if (loginBtn) {
    console.log("  Clicking login button...");
    await loginBtn.click();
  } else {
    console.log("  No login button found, pressing Enter in active context");
    if (passField) await passField.press("Enter");
    else await page.keyboard.press("Enter");
  }

  console.log("  ⏳ Waiting for login to complete...");

  let loginSucceeded = false;

  for (let elapsed = 0; elapsed < 35000; elapsed += 2000) {
    await page.waitForTimeout(2000);

    if (loginFrame) {
      const frameStillExists = page.frames().some(f => f === loginFrame);
      if (!frameStillExists) {
        console.log("  ✅ LoginFrame detached — login succeeded");
        loginSucceeded = true;
        break;
      }

      const loginFormGone = !(await findFieldInContext(loginFrame, ['input[type="password"]']));
      if (loginFormGone) {
        console.log("  ✅ Login form disappeared from LoginFrame — login succeeded");
        loginSucceeded = true;
        break;
      }
    }

    const authFound = await findAuthLandmark(page);
    if (authFound) {
      console.log("  ✅ Authenticated landmark found — login succeeded");
      loginSucceeded = true;
      break;
    }
  }

  if (loginSucceeded) {
    await page.waitForTimeout(2000);
    const url = page.url();
    console.log(`  ✅ Login confirmed. URL: ${url}`);
    return url;
  }

  if (loginFrame) {
    const errorText = await loginFrame.evaluate(() => {
      const errorSels = ['.ACA_Error', '.error-message', '[id*="Error"]', '[id*="error"]',
        '.font11px', '.validation-summary-errors', '[class*="alert"]', '[class*="error"]'];
      for (const sel of errorSels) {
        const el = document.querySelector(sel);
        if (el && el.offsetWidth > 0 && el.textContent.trim()) return el.textContent.trim().substring(0, 300);
      }
      return "";
    }).catch(() => "");

    if (errorText) {
      console.log(`  ❌ LoginFrame error: "${errorText}"`);
      await dumpLoginFrameDiagnostics(loginFrame, "LOGIN_ERROR");
      await dumpPageDiagnostics(page, "LOGIN_ERROR");
      await page.screenshot({ path: "login_failed.png", fullPage: true }).catch(() => {});
      throw new Error(`Accela login failed — portal error: ${errorText}`);
    }
  }

  await dumpLoginFrameDiagnostics(loginFrame, "LOGIN_TIMEOUT");
  await dumpPageDiagnostics(page, "LOGIN_TIMEOUT");
  await page.screenshot({ path: "login_failed.png", fullPage: true }).catch(() => {});
  throw new Error("Accela login failed — timed out waiting for authenticated state (login form persisted in LoginFrame)");
}

async function searchPermit(page, portalUrl, permitNumber) {
  console.log(`  Searching for permit: ${permitNumber}`);

  // Step 1: Verify we are still authenticated
  const isAuth = await findAuthLandmark(page);
  if (!isAuth) {
    await dumpPageDiagnostics(page, "SEARCH_AUTH_CHECK");
    throw new Error("AUTHENTICATION_LOST: No authenticated landmarks found before permit search.");
  }
  console.log("  ✅ Authentication verified");

  // Step 2: Navigate to Permits and Inspections tab
  const permitsTab = await findFieldInFrames(page, [
    "#Tab_Building",
    'a:has-text("Permits and Inspections")',
    'a:has-text("Permits & Inspections")',
    'a[title*="Permits"]',
    '#header_main_menu a:has-text("Permits")',
  ]);

  if (permitsTab) {
    console.log("  Clicking Permits tab...");
    await permitsTab.click();
    await waitForAccelaLoad(page);
    await page.waitForTimeout(3000);
  } else {
    const isPublicPage = await page.$('a:has-text("Sign In"), a:has-text("Create an Account")');
    if (isPublicPage) {
      throw new Error("Session dropped — redirected to public page.");
    }
    console.log("  ⚠️ Permits tab not found, attempting to proceed on current page...");
  }

  // Step 3: Wait for the records grid to appear
  console.log("  ⏳ Waiting for records grid...");
  const gridAppeared = await page.waitForSelector(
    'table[id*="PermitList"] tr, table[id*="Record"] tr, .aca_grid_container tr td a, [id*="gview_List"] tr',
    { visible: true, timeout: 15000 }
  ).catch(() => null);

  if (!gridAppeared) {
    let gridInFrame = false;
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      const frameGrid = await frame.$('table tr td a, .aca_grid_container').catch(() => null);
      if (frameGrid) {
        console.log(`  ✅ Grid found in frame: ${frame.name() || frame.url().substring(0, 60)}`);
        gridInFrame = true;
        break;
      }
    }
    if (!gridInFrame) {
      await dumpPageDiagnostics(page, "NO_GRID");
      const anchorCount = await page.evaluate(() => document.querySelectorAll("a").length);
      console.log(`  [DIAG:NO_GRID] Total anchors on page: ${anchorCount}`);
    }
  }

  // Step 4: Find and click the permit link (3-tier approach)
  console.log("  Scanning for permit link...");

  // Try 1: Playwright has-text selector
  const permitLink = await page.$(`a:has-text("${permitNumber}")`);
  if (permitLink && (await permitLink.isVisible().catch(() => false))) {
    console.log("  ✅ Found permit via has-text selector");
    await Promise.all([
      page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {}),
      permitLink.click(),
    ]);
    await waitForAccelaLoad(page);
    return;
  }

  // Try 2: Scan all anchors with normalized text (handles whitespace/newlines)
  const allLinks = await page.$$("a");
  for (const link of allLinks) {
    const text = (await link.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    if (text === permitNumber || text.includes(permitNumber)) {
      const visible = await link.isVisible().catch(() => false);
      if (visible) {
        console.log("  ✅ Found permit by scanning anchors:", text);
        await Promise.all([
          page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {}),
          link.click(),
        ]);
        await waitForAccelaLoad(page);
        return;
      }
    }
  }

  // Try 3: Frame-aware evaluate scan (searches all frames)
  for (const frame of page.frames()) {
    const found = await frame.evaluate((target) => {
      const anchors = Array.from(document.querySelectorAll("a"));
      const match = anchors.find((a) => {
        const text = (a.textContent || "").replace(/\s+/g, " ").trim();
        return text.includes(target) && a.offsetWidth > 0;
      });
      if (match) { match.click(); return true; }
      return false;
    }, permitNumber).catch(() => false);

    if (found) {
      console.log("  ✅ Found permit via frame evaluate");
      await waitForAccelaLoad(page);
      return;
    }
  }

  // All attempts failed — capture diagnostics
  const visibleTexts = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("a"))
      .filter((a) => a.offsetWidth > 0)
      .slice(0, 25)
      .map((a) => a.textContent.replace(/\s+/g, " ").trim().substring(0, 80));
  });
  console.log("  Visible anchor texts:", JSON.stringify(visibleTexts.filter(t => t.length > 0)));
  await dumpPageDiagnostics(page, "PERMIT_NOT_FOUND");
  await page.screenshot({ path: "grid_not_found.png", fullPage: true }).catch(() => {});
  throw new Error(`Permit ${permitNumber} not found in the records list.`);
}
// ==============================================================================

async function waitForRecordDetail(page) {
  const containerSelectors = [
    '#ctl00_PlaceHolderMain_PermitDetailList',
    '#ctl00_PlaceHolderMain_CAPDetail',
    '[id*="PlaceHolderMain"][id*="Detail"]',
    '[id*="PlaceHolderMain"][id*="Permit"]',
    '[id*="PlaceHolderMain"][id*="Record"]',
    '[id*="PlaceHolderMain"][id*="Cap"]',
    '#ctl00_PlaceHolderMain_TabDataList',
    '#ctl00_PlaceHolderMain_pnlContent',
    '#ctl00_PlaceHolderMain',
  ];

  for (const sel of containerSelectors) {
    const el = await page.waitForSelector(sel, { timeout: 8000 }).catch(() => null);
    if (el) {
      const text = await el.evaluate(e => e.textContent.substring(0, 120)).catch(() => "");
      console.log(`  [DIAG:RECORD_CONTAINER] matched="${sel}" preview="${text.replace(/\s+/g, ' ').trim().substring(0, 100)}"`);
      return sel;
    }
  }

  console.log("  ⚠️ No record detail container found, will attempt extraction on full page");
  return null;
}

async function extractRecordHeader(page) {
  console.log("  📋 Extracting record header...");

  await waitForRecordDetail(page);

  const header = await page.evaluate(() => {
    const _cSels = [
      '#ctl00_PlaceHolderMain_PermitDetailList',
      '#ctl00_PlaceHolderMain_CAPDetail',
      '[id*="PlaceHolderMain"][id*="Detail"]',
      '[id*="PlaceHolderMain"][id*="Permit"]',
      '[id*="PlaceHolderMain"][id*="Record"]',
      '[id*="PlaceHolderMain"][id*="Cap"]',
      '#ctl00_PlaceHolderMain_TabDataList',
      '#ctl00_PlaceHolderMain_pnlContent',
      '#ctl00_PlaceHolderMain',
    ];
    let container = document.body;
    for (const s of _cSels) {
      const e = document.querySelector(s);
      if (e && e.textContent.trim().length > 10) { container = e; break; }
    }

    const fields = {};
    const diag = { containerSelector: container === document.body ? "body" : (container.id || container.className || container.tagName) };

    const capNumEl = container.querySelector(
      '[id*="lblPermitNumber"], [id*="capNumber"], [id*="PermitNumber"], [id*="recordNumber"], .aca_page_title'
    );
    if (capNumEl) {
      fields.record_number = capNumEl.textContent.trim();
      diag.record_number_sel = capNumEl.id || capNumEl.className || capNumEl.tagName;
    }

    const typeEl = container.querySelector(
      '[id*="lblPermitType"], [id*="lblCapType"], [id*="RecordType"]'
    );
    if (typeEl) {
      fields.record_type = typeEl.textContent.trim();
      diag.record_type_sel = typeEl.id || typeEl.className;
    }

    const statusEl = container.querySelector(
      '[id*="lblPermitStatus"], [id*="lblCapStatus"], [id*="PermitStatus"], [id*="RecordStatus"]'
    );
    if (statusEl) {
      fields.record_status = statusEl.textContent.trim();
      diag.record_status_sel = statusEl.id || statusEl.className;
    }

    const spans = container.querySelectorAll("span, td");
    for (const el of spans) {
      const text = el.textContent.trim();
      if (text.includes("Expiration") || text.includes("Expire")) {
        const next = el.nextElementSibling;
        if (next) {
          const val = next.textContent.trim();
          if (val && val.length < 30) fields.expiration_date = val;
        }
      }
    }

    fields._diag = diag;
    return fields;
  });

  const diag = header._diag || {};
  delete header._diag;
  console.log(`     Record: ${header.record_number || "unknown"} | Status: ${header.record_status || "unknown"}`);
  console.log(`     [DIAG:HEADER] container=${diag.containerSelector} number=${diag.record_number_sel || "none"} type=${diag.record_type_sel || "none"} status=${diag.record_status_sel || "none"}`);
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
    const _cSels = ['#ctl00_PlaceHolderMain_PermitDetailList','#ctl00_PlaceHolderMain_CAPDetail','[id*="PlaceHolderMain"][id*="Detail"]','[id*="PlaceHolderMain"][id*="Permit"]','[id*="PlaceHolderMain"][id*="Record"]','[id*="PlaceHolderMain"][id*="Cap"]','#ctl00_PlaceHolderMain_TabDataList','#ctl00_PlaceHolderMain_pnlContent','#ctl00_PlaceHolderMain'];
    let container = document.body;
    for (const s of _cSels) { const e = document.querySelector(s); if (e && e.textContent.trim().length > 10) { container = e; break; } }

    const tables = [];
    const fields = {};

    container
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

    container
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
    const _cSels = ['#ctl00_PlaceHolderMain_PermitDetailList','#ctl00_PlaceHolderMain_CAPDetail','[id*="PlaceHolderMain"][id*="Detail"]','[id*="PlaceHolderMain"][id*="Permit"]','[id*="PlaceHolderMain"][id*="Record"]','[id*="PlaceHolderMain"][id*="Cap"]','#ctl00_PlaceHolderMain_TabDataList','#ctl00_PlaceHolderMain_pnlContent','#ctl00_PlaceHolderMain'];
    let container = document.body;
    for (const s of _cSels) { const e = document.querySelector(s); if (e && e.textContent.trim().length > 10) { container = e; break; } }

    const depts = [];
    const rows = container.querySelectorAll(
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
      const allTables = container.querySelectorAll("table");
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
    const _cSels = ['#ctl00_PlaceHolderMain_PermitDetailList','#ctl00_PlaceHolderMain_CAPDetail','[id*="PlaceHolderMain"][id*="Detail"]','[id*="PlaceHolderMain"][id*="Permit"]','[id*="PlaceHolderMain"][id*="Record"]','[id*="PlaceHolderMain"][id*="Cap"]','#ctl00_PlaceHolderMain_TabDataList','#ctl00_PlaceHolderMain_pnlContent','#ctl00_PlaceHolderMain'];
    let container = document.body;
    for (const s of _cSels) { const e = document.querySelector(s); if (e && e.textContent.trim().length > 10) { container = e; break; } }

    const results = [];

    container
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
      const fallback = container.querySelector(
        '[id*="ReviewComment"], [id*="PlanReview"], [id*="Comment"]',
      );
      if (fallback) {
        const text = fallback.textContent.trim();
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
    const _cSels = ['#ctl00_PlaceHolderMain_PermitDetailList','#ctl00_PlaceHolderMain_CAPDetail','[id*="PlaceHolderMain"][id*="Detail"]','[id*="PlaceHolderMain"][id*="Permit"]','[id*="PlaceHolderMain"][id*="Record"]','[id*="PlaceHolderMain"][id*="Cap"]','#ctl00_PlaceHolderMain_TabDataList','#ctl00_PlaceHolderMain_pnlContent','#ctl00_PlaceHolderMain'];
    let container = document.body;
    for (const s of _cSels) { const e = document.querySelector(s); if (e && e.textContent.trim().length > 10) { container = e; break; } }

    const results = [];
    container
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
    const _cSels = ['#ctl00_PlaceHolderMain_PermitDetailList','#ctl00_PlaceHolderMain_CAPDetail','[id*="PlaceHolderMain"][id*="Detail"]','[id*="PlaceHolderMain"][id*="Permit"]','[id*="PlaceHolderMain"][id*="Record"]','[id*="PlaceHolderMain"][id*="Cap"]','#ctl00_PlaceHolderMain_TabDataList','#ctl00_PlaceHolderMain_pnlContent','#ctl00_PlaceHolderMain'];
    let container = document.body;
    for (const s of _cSels) { const e = document.querySelector(s); if (e && e.textContent.trim().length > 10) { container = e; break; } }

    const results = [];
    container
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
    const _cSels = ['#ctl00_PlaceHolderMain_PermitDetailList','#ctl00_PlaceHolderMain_CAPDetail','[id*="PlaceHolderMain"][id*="Detail"]','[id*="PlaceHolderMain"][id*="Permit"]','[id*="PlaceHolderMain"][id*="Record"]','[id*="PlaceHolderMain"][id*="Cap"]','#ctl00_PlaceHolderMain_TabDataList','#ctl00_PlaceHolderMain_pnlContent','#ctl00_PlaceHolderMain'];
    let mainContainer = document.body;
    for (const s of _cSels) { const e = document.querySelector(s); if (e && e.textContent.trim().length > 10) { mainContainer = e; break; } }

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

    const upcomingSection = mainContainer.querySelector(
      '[id*="Upcoming"], [id*="upcoming"], [id*="Scheduled"], [id*="scheduled"]',
    );
    const completedSection = mainContainer.querySelector(
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
      mainContainer
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
    const _cSels = ['#ctl00_PlaceHolderMain_PermitDetailList','#ctl00_PlaceHolderMain_CAPDetail','[id*="PlaceHolderMain"][id*="Detail"]','[id*="PlaceHolderMain"][id*="Permit"]','[id*="PlaceHolderMain"][id*="Record"]','[id*="PlaceHolderMain"][id*="Cap"]','#ctl00_PlaceHolderMain_TabDataList','#ctl00_PlaceHolderMain_pnlContent','#ctl00_PlaceHolderMain'];
    let container = document.body;
    for (const s of _cSels) { const e = document.querySelector(s); if (e && e.textContent.trim().length > 10) { container = e; break; } }

    const results = [];
    container
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
  const { portalUrl } = session;
  const page = session.page || (session.context ? session.context.pages()[0] : null);
  if (!page) {
    throw new Error("No authenticated page found in session — cannot start Accela scrape");
  }
  const currentUrl = page.url();
  console.log(`  [GUARD] Starting scrape on existing page. URL: ${currentUrl}`);
  if (currentUrl === "about:blank" || !currentUrl || currentUrl === "") {
    throw new Error(`Authenticated page is blank (url=${currentUrl}) — session may be corrupt`);
  }
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
  } catch (err) {
    throw err;
  }
}

module.exports = {
  accelaLogin,
  scrapeAccelaRecord,
};
