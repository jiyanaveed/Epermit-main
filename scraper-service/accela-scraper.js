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

async function waitForAccelaLoad(pageOrFrame, timeoutMs = 30000) {
  if (typeof pageOrFrame.waitForLoadState === "function") {
    await pageOrFrame
      .waitForLoadState("networkidle", { timeout: timeoutMs })
      .catch(() => {});
  }
  await pageOrFrame
    .waitForSelector(".aca_loading, .ACA_Loading, .loading-mask", {
      state: "detached",
      timeout: 10000,
    })
    .catch(() => {});
  if (typeof pageOrFrame.waitForTimeout === "function") {
    await pageOrFrame.waitForTimeout(1500);
  } else {
    await new Promise((r) => setTimeout(r, 1500));
  }
}

async function clickAccelaLink(pageOrFrame, selectors, label) {
  for (const sel of selectors) {
    try {
      const link = await pageOrFrame.$(sel);
      if (link && (await link.isVisible().catch(() => false))) {
        console.log(`     Clicking "${label}" via ${sel}...`);
        await link.click({ force: true }).catch(async () => {
          await pageOrFrame.evaluate((selector) => {
            const el = document.querySelector(selector);
            if (el) el.click();
          }, sel);
        });
        await waitForAccelaLoad(pageOrFrame);
        return true;
      }
    } catch (clickErr) {
      console.log(
        `     ⚠️ Click failed for "${label}" (${sel}): ${clickErr.message}`,
      );
    }
  }

  console.log(`     "${label}" link not found — skipping`);
  return false;
}

async function dumpPageDiagnostics(page, label) {
  const url = page.url();
  const title = await page.title().catch(() => "(unknown)");
  const loginFormVisible = !!(await findFieldInFrames(page, [
    'input[type="password"]',
  ]));
  const logoutVisible = !!(await findFieldInFrames(page, [
    'a:has-text("Logout")',
    'a:has-text("Log Out")',
    'a:has-text("Sign Out")',
  ]));
  const welcomeVisible = !!(await findFieldInFrames(page, [
    "#ctl00_HeaderNavigation_lblWelcome",
    '[id*="lblWelcome"]',
  ]));
  const frames = page.frames();
  const frameInfo = frames.map(
    (f, i) => `${i}:${f.name() || "(unnamed)"}@${f.url().substring(0, 80)}`,
  );
  console.log(`  [DIAG:${label}] url=${url}`);
  console.log(`  [DIAG:${label}] title=${title}`);
  console.log(
    `  [DIAG:${label}] loginFormVisible=${loginFormVisible} logoutVisible=${logoutVisible} welcomeVisible=${welcomeVisible}`,
  );
  console.log(
    `  [DIAG:${label}] frames(${frames.length}): ${frameInfo.join(" | ")}`,
  );
}

async function findAuthLandmark(page) {
  const selectors = [
    'a:has-text("Logout")',
    'a:has-text("Log Out")',
    'a:has-text("Sign Out")',
    "#ctl00_HeaderNavigation_lblWelcome",
    'a:has-text("My Account")',
    'a:has-text("My Records")',
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
      console.log(
        `  Found LoginFrame: name="${frame.name()}" url=${frame.url().substring(0, 100)}`,
      );
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
    'input[name*="txtUserId"]',
    'input[name*="UserName"]',
    'input[id*="UserId"]',
    'input[type="text"][id*="User"]',
    'input[type="email"]',
  ]));
  const passStillVisible = !!(await findFieldInContext(frame, [
    'input[type="password"]',
  ]));
  const btnDisabled = await frame
    .evaluate(() => {
      const btn = document.querySelector(
        'button[type="submit"], input[type="submit"], a[id*="btnLogin"]',
      );
      return btn
        ? btn.disabled || btn.getAttribute("disabled") !== null
        : "no_btn";
    })
    .catch(() => "eval_error");
  const errorText = await frame
    .evaluate(() => {
      const errorSels = [
        ".ACA_Error",
        ".error-message",
        '[id*="Error"]',
        '[id*="error"]',
        ".font11px",
        ".validation-summary-errors",
        '[class*="alert"]',
        '[class*="error"]',
      ];
      for (const sel of errorSels) {
        const el = document.querySelector(sel);
        if (el && el.offsetWidth > 0 && el.textContent.trim())
          return el.textContent.trim().substring(0, 200);
      }
      return "";
    })
    .catch(() => "");
  console.log(`  [DIAG:${label}] LoginFrame url=${url}`);
  console.log(
    `  [DIAG:${label}] userFieldVisible=${userStillVisible} passFieldVisible=${passStillVisible} btnDisabled=${btnDisabled}`,
  );
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
  console.log(
    `  Login context: ${loginFrame ? "LoginFrame (primary)" : "main page (no LoginFrame found)"}`,
  );

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
    throw new Error(
      "Cannot find Accela username field in LoginFrame or main page",
    );
  }
  console.log(
    `  Found username field in ${activeContext === loginFrame ? "LoginFrame" : "main page"}`,
  );
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
      if (
        visible &&
        (text === "SIGN IN" || text === "LOG IN" || text === "LOGIN")
      ) {
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
      const frameStillExists = page.frames().some((f) => f === loginFrame);
      if (!frameStillExists) {
        console.log("  ✅ LoginFrame detached — login succeeded");
        loginSucceeded = true;
        break;
      }

      const loginFormGone = !(await findFieldInContext(loginFrame, [
        'input[type="password"]',
      ]));
      if (loginFormGone) {
        console.log(
          "  ✅ Login form disappeared from LoginFrame — login succeeded",
        );
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
    const errorText = await loginFrame
      .evaluate(() => {
        const errorSels = [
          ".ACA_Error",
          ".error-message",
          '[id*="Error"]',
          '[id*="error"]',
          ".font11px",
          ".validation-summary-errors",
          '[class*="alert"]',
          '[class*="error"]',
        ];
        for (const sel of errorSels) {
          const el = document.querySelector(sel);
          if (el && el.offsetWidth > 0 && el.textContent.trim())
            return el.textContent.trim().substring(0, 300);
        }
        return "";
      })
      .catch(() => "");

    if (errorText) {
      console.log(`  ❌ LoginFrame error: "${errorText}"`);
      await dumpLoginFrameDiagnostics(loginFrame, "LOGIN_ERROR");
      await dumpPageDiagnostics(page, "LOGIN_ERROR");
      await page
        .screenshot({ path: "login_failed.png", fullPage: true })
        .catch(() => {});
      throw new Error(`Accela login failed — portal error: ${errorText}`);
    }
  }

  await dumpLoginFrameDiagnostics(loginFrame, "LOGIN_TIMEOUT");
  await dumpPageDiagnostics(page, "LOGIN_TIMEOUT");
  await page
    .screenshot({ path: "login_failed.png", fullPage: true })
    .catch(() => {});
  throw new Error(
    "Accela login failed — timed out waiting for authenticated state (login form persisted in LoginFrame)",
  );
}

async function searchPermit(page, portalUrl, permitNumber) {
  console.log(`  Searching for permit: ${permitNumber}`);

  const isAuth = await findAuthLandmark(page);
  if (!isAuth) {
    await dumpPageDiagnostics(page, "SEARCH_AUTH_CHECK");
    throw new Error(
      "AUTHENTICATION_LOST: No authenticated landmarks found before permit search.",
    );
  }
  console.log("  ✅ Authentication verified");

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
    const isPublicPage = await page.$(
      'a:has-text("Sign In"), a:has-text("Create an Account")',
    );
    if (isPublicPage) {
      throw new Error("Session dropped — redirected to public page.");
    }
    console.log(
      "  ⚠️ Permits tab not found, attempting to proceed on current page...",
    );
  }

  console.log("  ⏳ Waiting for records grid...");
  const gridAppeared = await page
    .waitForSelector(
      'table[id*="PermitList"] tr, table[id*="Record"] tr, .aca_grid_container tr td a, [id*="gview_List"] tr',
      { visible: true, timeout: 15000 },
    )
    .catch(() => null);

  if (!gridAppeared) {
    let gridInFrame = false;
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      const frameGrid = await frame
        .$("table tr td a, .aca_grid_container")
        .catch(() => null);
      if (frameGrid) {
        console.log(
          `  ✅ Grid found in frame: ${frame.name() || frame.url().substring(0, 60)}`,
        );
        gridInFrame = true;
        break;
      }
    }
    if (!gridInFrame) {
      await dumpPageDiagnostics(page, "NO_GRID");
      const anchorCount = await page.evaluate(
        () => document.querySelectorAll("a").length,
      );
      console.log(`  [DIAG:NO_GRID] Total anchors on page: ${anchorCount}`);
    }
  }

  console.log("  Scanning for permit link...");

  let foundLink = null;
  let foundFrame = null;
  let foundInfo = {};

  const permitLink = await page.$(`a:has-text("${permitNumber}")`);
  if (permitLink && (await permitLink.isVisible().catch(() => false))) {
    foundLink = permitLink;
    foundFrame = page;
    const href = (await permitLink.getAttribute("href").catch(() => "")) || "";
    const text = (await permitLink.innerText().catch(() => ""))
      .replace(/\s+/g, " ")
      .trim();
    foundInfo = {
      method: "has-text",
      text,
      href,
      frameName: "main",
      frameUrl: page.url(),
    };
  }

  if (!foundLink) {
    const allLinks = await page.$$("a");
    for (const link of allLinks) {
      const text = (await link.innerText().catch(() => ""))
        .replace(/\s+/g, " ")
        .trim();
      if (text === permitNumber || text.includes(permitNumber)) {
        const visible = await link.isVisible().catch(() => false);
        if (visible) {
          const href = (await link.getAttribute("href").catch(() => "")) || "";
          foundLink = link;
          foundFrame = page;
          foundInfo = {
            method: "anchor-scan",
            text,
            href,
            frameName: "main",
            frameUrl: page.url(),
          };
          break;
        }
      }
    }
  }

  if (!foundLink) {
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      const linkData = await frame
        .evaluate((target) => {
          const anchors = Array.from(document.querySelectorAll("a"));
          const match = anchors.find((a) => {
            const text = (a.textContent || "").replace(/\s+/g, " ").trim();
            return text.includes(target) && a.offsetWidth > 0;
          });
          if (match) {
            return {
              text: match.textContent.replace(/\s+/g, " ").trim(),
              href: match.href || "",
            };
          }
          return null;
        }, permitNumber)
        .catch(() => null);

      if (linkData) {
        foundFrame = frame;
        foundInfo = {
          method: "frame-evaluate",
          text: linkData.text,
          href: linkData.href,
          frameName: frame.name() || "(unnamed)",
          frameUrl: frame.url().substring(0, 100),
        };
        break;
      }
    }
  }

  if (!foundLink && !foundInfo.method) {
    const visibleTexts = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("a"))
        .filter((a) => a.offsetWidth > 0)
        .slice(0, 25)
        .map((a) =>
          (a.textContent || "").replace(/\s+/g, " ").trim().substring(0, 80),
        );
    });
    console.log(
      "  Visible anchor texts:",
      JSON.stringify(visibleTexts.filter((t) => t.length > 0)),
    );
    await dumpPageDiagnostics(page, "PERMIT_NOT_FOUND");
    await page
      .screenshot({ path: "grid_not_found.png", fullPage: true })
      .catch(() => {});
    throw new Error(`Permit ${permitNumber} not found in the records list.`);
  }

  console.log(
    `  ✅ Found permit link: method=${foundInfo.method} text="${foundInfo.text}" href="${(foundInfo.href || "").substring(0, 100)}" frame=${foundInfo.frameName}`,
  );

  const urlBefore = page.url();

  if (foundLink) {
    await Promise.all([
      page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {}),
      foundLink.click(),
    ]);
  } else if (foundFrame && foundInfo.method === "frame-evaluate") {
    await foundFrame
      .evaluate((target) => {
        const anchors = Array.from(document.querySelectorAll("a"));
        const match = anchors.find((a) => {
          const text = (a.textContent || "").replace(/\s+/g, " ").trim();
          return text.includes(target) && a.offsetWidth > 0;
        });
        if (match) match.click();
      }, permitNumber)
      .catch(() => {});
    await page
      .waitForLoadState("networkidle", { timeout: 30000 })
      .catch(() => {});
  }

  await waitForAccelaLoad(page);

  console.log("  ⏳ Verifying record detail loaded...");
  const urlAfter = page.url();
  console.log(`  [DIAG:POST_CLICK] urlBefore=${urlBefore.substring(0, 100)}`);
  console.log(`  [DIAG:POST_CLICK] urlAfter=${urlAfter.substring(0, 100)}`);

  const allFrames = page.frames();
  let recordFrame = null;
  for (let i = 0; i < allFrames.length; i++) {
    const f = allFrames[i];
    const fUrl = f.url();
    const fName = f.name() || "(unnamed)";
    const preview = await f
      .evaluate(() => {
        return document.body
          ? document.body.innerText
              .substring(0, 300)
              .replace(/\s+/g, " ")
              .trim()
          : "";
      })
      .catch(() => "(inaccessible)");
    console.log(
      `  [DIAG:FRAME ${i}] name="${fName}" url=${fUrl.substring(0, 120)}`,
    );
    console.log(`  [DIAG:FRAME ${i}] preview="${preview.substring(0, 200)}"`);

    if (
      fUrl.includes("Cap/CapDetail") ||
      fUrl.includes("capDetail") ||
      fUrl.includes("Record") ||
      fUrl.includes("permit")
    ) {
      recordFrame = f;
      console.log(`  ✅ Record detail frame identified: ${fName}`);
    }
  }

  if (!recordFrame) {
    for (const f of allFrames) {
      const hasPermit = await f
        .evaluate((pn) => {
          return document.body ? document.body.innerText.includes(pn) : false;
        }, permitNumber)
        .catch(() => false);
      if (hasPermit && f !== page.mainFrame()) {
        recordFrame = f;
        console.log(
          `  ✅ Record frame found by permit number match: ${f.name() || f.url().substring(0, 80)}`,
        );
        break;
      }
      if (hasPermit && f === page.mainFrame()) {
        console.log(`  ✅ Permit number found in main frame`);
      }
    }
  }

  await waitForRecordDetailStrong(page, recordFrame, permitNumber);
  page._recordFrame = recordFrame;
}

async function waitForRecordDetailStrong(page, recordFrame, permitNumber) {
  const contexts = recordFrame ? [recordFrame, page] : [page];
  const detailSignals = [
    '[id*="lblPermitNumber"]',
    '[id*="capNumber"]',
    '[id*="PermitNumber"]',
    '[id*="lblPermitType"]',
    '[id*="lblCapType"]',
    '[id*="lblPermitStatus"]',
    '[id*="lblCapStatus"]',
    '[id*="PermitDetailList"]',
    '[id*="CAPDetail"]',
    ".aca_page_title",
    '[id*="TabDataList"]',
  ];

  for (let elapsed = 0; elapsed < 20000; elapsed += 2000) {
    for (const ctx of contexts) {
      for (const sel of detailSignals) {
        const el = await ctx.$(sel).catch(() => null);
        if (el) {
          const text = await el
            .evaluate((e) => (e.textContent || "").trim().substring(0, 80))
            .catch(() => "");
          const ctxName =
            ctx === page ? "main" : ctx.name ? ctx.name() || "frame" : "frame";
          console.log(
            `  ✅ Record detail signal found: sel="${sel}" text="${text}" in ${ctxName}`,
          );
          return ctx;
        }
      }
      const hasPermitText = await ctx
        .evaluate((pn) => {
          return document.body ? document.body.innerText.includes(pn) : false;
        }, permitNumber)
        .catch(() => false);
      if (hasPermitText) {
        const ctxName =
          ctx === page ? "main" : ctx.name ? ctx.name() || "frame" : "frame";
        console.log(
          `  ✅ Permit number "${permitNumber}" found in ${ctxName} body text`,
        );
        return ctx;
      }
    }
    await page.waitForTimeout(2000);
  }

  console.log(
    "  ⚠️ No strong record detail signals found after 20s, proceeding with best-effort extraction",
  );
  await page
    .screenshot({ path: "record_not_loaded.png", fullPage: true })
    .catch(() => {});
  return contexts[0];
}

function getExtractionContext(page) {
  return page._recordFrame || page;
}

async function extractRecordHeader(page) {
  console.log("  📋 Extracting record header...");

  const ctx = getExtractionContext(page);
  const ctxLabel = ctx === page ? "main page" : "record frame";
  console.log(`  Extracting header from: ${ctxLabel}`);

  const header = await ctx.evaluate(() => {
    const result = {
      record_number: "",
      record_type: "",
      record_status: "",
      expiration_date: "",
      _diag: {},
    };

    const root =
      document.querySelector(".rec-left") ||
      document.querySelector('[id*="PlaceHolderMain"]') ||
      document.body;

    const preview = (root.innerText || "").replace(/\s+/g, " ").trim();
    result._diag.container =
      root.id || root.className || root.tagName || "unknown";
    result._diag.preview = preview.slice(0, 300);

    const permitEl =
      root.querySelector('[id*="lblPermitNumber"]') ||
      root.querySelector('[id*="PermitNumber"]');

    if (permitEl) {
      result.record_number = (permitEl.textContent || "").trim();
      result._diag.permit =
        permitEl.id || permitEl.className || permitEl.tagName;
    }

    const typeMatch = preview.match(
      /Record\s+[A-Z0-9-]+:\s*(.*?)\s+Record Status:/i,
    );
    if (typeMatch) {
      result.record_type = typeMatch[1].trim();
    }

    const statusMatch = preview.match(
      /Record Status:\s*(.*?)\s+Expiration Date:/i,
    );
    if (statusMatch) {
      result.record_status = statusMatch[1].trim();
    }

    const expMatch = preview.match(/Expiration Date:\s*([0-9/]+)/i);
    if (expMatch) {
      result.expiration_date = expMatch[1].trim();
    }

    return result;
  });

  const diag = header._diag || {};
  delete header._diag;

  console.log(
    `     Record: ${header.record_number || "unknown"} | Status: ${header.record_status || "unknown"}`,
  );
  console.log(
    `     [DIAG:HEADER] permit=${diag.permit || "none"} container=${diag.container || "none"}`,
  );
  console.log(`     [DIAG:HEADER] preview="${diag.preview || ""}"`);

  return header;
}

async function extractRecordDetails(page) {
  console.log("  📋 Extracting record details...");
  const ctx = getExtractionContext(page);

  await clickAccelaLink(
    ctx,
    [
      'a:has-text("Record Info")',
      'a[id*="RecordInfo"]',
      '#ctl00_PlaceHolderMain_TabDataList a:has-text("Record")',
    ],
    "Record Info",
  );

  await clickAccelaLink(
    ctx,
    [
      'a:has-text("Record Details")',
      'a:has-text("Record Detail")',
      'a[id*="RecordDetail"]',
    ],
    "Record Details",
  );

  await page.waitForTimeout(1500);

  const details = await ctx.evaluate(() => {
    const fields = {};

    const badLabels = new Set([
      "add",
      "cancel",
      "*name",
      "name",
      "name:",
      "description:",
      "record status:",
      "expiration date:",
    ]);

    const candidateTables = Array.from(
      document.querySelectorAll("table"),
    ).filter((table) => {
      const text = (table.innerText || "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
      return (
        text.includes("application name") ||
        text.includes("work location") ||
        text.includes("address") ||
        text.includes("parcel") ||
        text.includes("description") ||
        text.includes("job value")
      );
    });

    const target = candidateTables[0] || null;

    if (target) {
      const rows = target.querySelectorAll("tr");
      rows.forEach((row) => {
        const cells = Array.from(row.querySelectorAll("td"))
          .map((c) => (c.textContent || "").replace(/\s+/g, " ").trim())
          .filter(Boolean);

        if (cells.length < 2) return;

        const label = cells[0].replace(/:$/, "").trim();
        const value = cells[1].trim();

        if (!label || !value) return;
        if (label.length > 60) return;
        if (value.length > 300) return;
        if (badLabels.has(label.toLowerCase())) return;
        if (value.toLowerCase() === label.toLowerCase()) return;
        if (/^(add|cancel)$/i.test(value)) return;

        fields[label] = value;
      });
    }

    const rowsOut = Object.entries(fields).map(([key, value]) => ({
      key,
      value,
    }));

    return {
      tables: rowsOut.length
        ? [
            {
              title: "Record Details",
              headers: ["Field", "Value"],
              rows: rowsOut,
            },
          ]
        : [],
      fields,
    };
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
  const ctx = getExtractionContext(page);

  const found = await clickAccelaLink(
    ctx,
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

  const expandButtons = await ctx
    .$$(
      '[id*="expand"], .collapse-icon, a[onclick*="expand"], img[src*="expand"], .aca_expand',
    )
    .catch(() => []);
  for (const btn of expandButtons) {
    await btn.click().catch(() => {});
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(2000);

  const departments = await ctx.evaluate(() => {
    const _cSels = [
      "#ctl00_PlaceHolderMain_PermitDetailList",
      "#ctl00_PlaceHolderMain_CAPDetail",
      '[id*="PlaceHolderMain"][id*="Detail"]',
      '[id*="PlaceHolderMain"][id*="Permit"]',
      '[id*="PlaceHolderMain"][id*="Record"]',
      '[id*="PlaceHolderMain"][id*="Cap"]',
      "#ctl00_PlaceHolderMain_TabDataList",
      "#ctl00_PlaceHolderMain_pnlContent",
      "#ctl00_PlaceHolderMain",
    ];
    let container = document.body;
    for (const s of _cSels) {
      const e = document.querySelector(s);
      if (e && e.textContent.trim().length > 10) {
        container = e;
        break;
      }
    }

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
  const ctx = getExtractionContext(page);

  const found = await clickAccelaLink(
    ctx,
    ['a:has-text("Plan Review")', 'a[id*="PlanReview"]'],
    "Plan Review",
  );

  if (!found) {
    return { comments: [], text: "", screenshot: null };
  }

  await page.waitForTimeout(1500);

  const data = await ctx.evaluate(() => {
    const comments = [];

    const candidateTables = Array.from(
      document.querySelectorAll("table"),
    ).filter((table) => {
      const text = (table.innerText || "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
      return (
        text.includes("reviewer") ||
        text.includes("department") ||
        text.includes("comment") ||
        text.includes("review status")
      );
    });

    const root = candidateTables[0] || null;

    if (!root) {
      return { comments: [], text: "" };
    }

    const rows = root.querySelectorAll("tr");
    rows.forEach((row) => {
      const cells = Array.from(row.querySelectorAll("td"))
        .map((c) => (c.textContent || "").replace(/\s+/g, " ").trim())
        .filter(Boolean);

      if (cells.length >= 3) {
        comments.push({
          reviewer: cells[0] || "",
          department: cells[1] || "",
          comment: cells[2] || "",
          date: cells[3] || "",
        });
      }
    });

    const text = comments.length
      ? comments
          .map((c) =>
            [
              c.reviewer ? `Reviewer: ${c.reviewer}` : "",
              c.department ? `Department: ${c.department}` : "",
              c.comment ? `Comment: ${c.comment}` : "",
              c.date ? `Date: ${c.date}` : "",
            ]
              .filter(Boolean)
              .join("\n"),
          )
          .join("\n\n")
      : "";

    return { comments, text };
  });

  const screenshot = await page
    .screenshot({ fullPage: true })
    .catch(() => null);
  const screenshotBase64 = screenshot ? screenshot.toString("base64") : null;

  console.log(`     Found ${data.comments.length} review comments`);
  return {
    comments: data.comments,
    text: data.text,
    screenshot: screenshotBase64,
  };
}

async function extractRelatedRecords(page) {
  console.log("  📋 Extracting related records...");
  const ctx = getExtractionContext(page);

  const found = await clickAccelaLink(
    ctx,
    ['a:has-text("Related Records")', 'a[id*="RelatedRecord"]'],
    "Related Records",
  );

  if (!found) {
    return { records: [], screenshot: null };
  }

  const viewTree = await ctx.$(
    'a:has-text("View Entire Tree"), a:has-text("Entire Tree")',
  );
  if (viewTree && (await viewTree.isVisible().catch(() => false))) {
    await viewTree.click().catch(() => {});
    await waitForAccelaLoad(page);
  }

  const records = await ctx.evaluate(() => {
    const _cSels = [
      "#ctl00_PlaceHolderMain_PermitDetailList",
      "#ctl00_PlaceHolderMain_CAPDetail",
      '[id*="PlaceHolderMain"][id*="Detail"]',
      '[id*="PlaceHolderMain"][id*="Permit"]',
      '[id*="PlaceHolderMain"][id*="Record"]',
      '[id*="PlaceHolderMain"][id*="Cap"]',
      "#ctl00_PlaceHolderMain_TabDataList",
      "#ctl00_PlaceHolderMain_pnlContent",
      "#ctl00_PlaceHolderMain",
    ];
    let container = document.body;
    for (const s of _cSels) {
      const e = document.querySelector(s);
      if (e && e.textContent.trim().length > 10) {
        container = e;
        break;
      }
    }

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
  const ctx = getExtractionContext(page);

  const found = await clickAccelaLink(
    ctx,
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

  const attachments = await ctx.evaluate(() => {
    const _cSels = [
      "#ctl00_PlaceHolderMain_PermitDetailList",
      "#ctl00_PlaceHolderMain_CAPDetail",
      '[id*="PlaceHolderMain"][id*="Detail"]',
      '[id*="PlaceHolderMain"][id*="Permit"]',
      '[id*="PlaceHolderMain"][id*="Record"]',
      '[id*="PlaceHolderMain"][id*="Cap"]',
      "#ctl00_PlaceHolderMain_TabDataList",
      "#ctl00_PlaceHolderMain_pnlContent",
      "#ctl00_PlaceHolderMain",
    ];
    let container = document.body;
    for (const s of _cSels) {
      const e = document.querySelector(s);
      if (e && e.textContent.trim().length > 10) {
        container = e;
        break;
      }
    }

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
  const ctx = getExtractionContext(page);

  const found = await clickAccelaLink(
    ctx,
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

  const inspData = await ctx.evaluate(() => {
    const _cSels = [
      "#ctl00_PlaceHolderMain_PermitDetailList",
      "#ctl00_PlaceHolderMain_CAPDetail",
      '[id*="PlaceHolderMain"][id*="Detail"]',
      '[id*="PlaceHolderMain"][id*="Permit"]',
      '[id*="PlaceHolderMain"][id*="Record"]',
      '[id*="PlaceHolderMain"][id*="Cap"]',
      "#ctl00_PlaceHolderMain_TabDataList",
      "#ctl00_PlaceHolderMain_pnlContent",
      "#ctl00_PlaceHolderMain",
    ];
    let mainContainer = document.body;
    for (const s of _cSels) {
      const e = document.querySelector(s);
      if (e && e.textContent.trim().length > 10) {
        mainContainer = e;
        break;
      }
    }

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
  const ctx = getExtractionContext(page);

  const found = await clickAccelaLink(
    ctx,
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

  const payments = await ctx.evaluate(() => {
    const _cSels = [
      "#ctl00_PlaceHolderMain_PermitDetailList",
      "#ctl00_PlaceHolderMain_CAPDetail",
      '[id*="PlaceHolderMain"][id*="Detail"]',
      '[id*="PlaceHolderMain"][id*="Permit"]',
      '[id*="PlaceHolderMain"][id*="Record"]',
      '[id*="PlaceHolderMain"][id*="Cap"]',
      "#ctl00_PlaceHolderMain_TabDataList",
      "#ctl00_PlaceHolderMain_pnlContent",
      "#ctl00_PlaceHolderMain",
    ];
    let container = document.body;
    for (const s of _cSels) {
      const e = document.querySelector(s);
      if (e && e.textContent.trim().length > 10) {
        container = e;
        break;
      }
    }

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
  const page =
    session.page || (session.context ? session.context.pages()[0] : null);
  if (!page) {
    throw new Error(
      "No authenticated page found in session — cannot start Accela scrape",
    );
  }
  const currentUrl = page.url();
  console.log(`  [GUARD] Starting scrape on existing page. URL: ${currentUrl}`);
  if (currentUrl === "about:blank" || !currentUrl || currentUrl === "") {
    throw new Error(
      `Authenticated page is blank (url=${currentUrl}) — session may be corrupt`,
    );
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
          keyValues: [
            ...(header.record_number
              ? [{ key: "Record Number", value: header.record_number }]
              : []),
            ...(header.record_type
              ? [{ key: "Record Type", value: header.record_type }]
              : []),
            ...(header.record_status
              ? [{ key: "Record Status", value: header.record_status }]
              : []),
            ...(header.expiration_date
              ? [{ key: "Expiration Date", value: header.expiration_date }]
              : []),
            ...Object.entries(details.fields).map(([key, value]) => ({
              key,
              value,
            })),
          ],
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
      console.log(
        `  📌 supabaseProjectId=${supabaseProjectId || "(none)"}, userId=${userId}, portalType=${portalData.portalType}`,
      );
      const newHash = hashPortalData(portalData);

      let existingRow = null;
      if (supabaseProjectId) {
        const { data: rows } = await supabase
          .from("projects")
          .select("id, portal_data_hash")
          .eq("id", supabaseProjectId);
        existingRow = rows && rows.length > 0 ? rows[0] : null;
      }
      if (!existingRow) {
        const { data: rows } = await supabase
          .from("projects")
          .select("id, portal_data_hash")
          .eq("permit_number", permitNumber)
          .eq("user_id", userId);
        existingRow = rows && rows.length > 0 ? rows[0] : null;
      }

      if (existingRow && existingRow.portal_data_hash === newHash) {
        console.log(
          `  ⏭️ Data unchanged (hash match), skipping update for row ${existingRow.id}`,
        );
        await supabase
          .from("projects")
          .update({ last_checked_at: new Date().toISOString() })
          .eq("id", existingRow.id);
      } else if (existingRow) {
        const updatePayload = {
          portal_status: header.record_status || "Scraped",
          last_checked_at: new Date().toISOString(),
          portal_data: portalData,
          portal_data_hash: newHash,
          permit_number: permitNumber,
        };

        const { data, error } = await supabase
          .from("projects")
          .update(updatePayload)
          .eq("id", existingRow.id)
          .select("id, portal_data");

        if (error) {
          console.error("  ❌ Supabase error:", error.message);
        } else if (data && data.length > 0) {
          const writtenType = data[0].portal_data?.portalType || "(none)";
          console.log(
            `  ✅ Updated project row=${data[0].id}, written portalType=${writtenType}`,
          );
        }
      } else {
        const { data: created, error: createError } = await supabase
          .from("projects")
          .insert({
            user_id: userId,
            name: header.record_number || permitNumber,
            permit_number: permitNumber,
            description: header.record_type || "",
            address: portalData.location || "",
            jurisdiction: portalData.jurisdiction || "Unknown",
            status: "draft",
            portal_status: header.record_status || "Unknown",
            last_checked_at: new Date().toISOString(),
            portal_data: portalData,
            portal_data_hash: newHash,
          })
          .select("id, portal_data");
        if (createError) {
          console.error("  ❌ Supabase create error:", createError.message);
        } else if (created && created.length > 0) {
          const writtenType = created[0].portal_data?.portalType || "(none)";
          console.log(
            `  📝 Created new project row=${created[0].id}, written portalType=${writtenType}`,
          );
        }
      }

      if (existingRow || supabaseProjectId) {
        const verifyId = existingRow?.id || supabaseProjectId;
        const { data: verify } = await supabase
          .from("projects")
          .select("id, permit_number, credential_id, portal_data")
          .eq("id", verifyId)
          .maybeSingle();
        if (verify) {
          console.log(
            `  🔍 DB verify: row=${verify.id}, permit=${verify.permit_number}, credential=${verify.credential_id || "(none)"}, portalType=${verify.portal_data?.portalType || "(none)"}`,
          );
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
