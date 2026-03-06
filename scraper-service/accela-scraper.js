const path = require("path");

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
    if (id || name) console.log(`    input: id="${id}" name="${name}" type="${type}" visible=${visible}`);
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
      if (visible && (text === "SIGN IN" || text === "LOG IN" || text === "LOGIN")) {
        loginBtn = a;
        console.log(`  Found login anchor by text: "${text}"`);
        break;
      }
    }
  }

  if (loginBtn) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle", timeout: 30000 }).catch(() => {}),
      loginBtn.click(),
    ]);
  } else {
    console.log("  No login button found, pressing Enter");
    await page.keyboard.press("Enter");
    await page.waitForNavigation({ waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
  }
  await page.waitForTimeout(3000);

  const url = page.url();
  console.log(`  After login URL: ${url}`);

  const logoutLink = await page.$('a[href*="Logout"], a:has-text("Logout"), a:has-text("Log Out"), a:has-text("Sign Out")');
  const myAccountLink = await page.$('a:has-text("My Account"), a:has-text("My Records"), a:has-text("Dashboard")');
  const welcomeText = await page.$('[id*="Welcome"], [class*="welcome"], [id*="loggedIn"]');

  if (logoutLink || myAccountLink || welcomeText) {
    console.log(`  Login confirmed (found post-login elements)`);
    return url;
  }

  if (url.includes("Login.aspx") || url.includes("login")) {
    const errorEl = await page.$(".ACA_Error, .error-message, [id*='Error'], [id*='error'], .font11px");
    const errorText = errorEl ? await errorEl.textContent().catch(() => "") : "";
    throw new Error("Accela login failed" + (errorText ? `: ${errorText.trim()}` : ""));
  }

  console.log(`  After login: ${url}`);
  return url;
}

async function searchPermit(page, portalUrl, permitNumber) {
  console.log(`  🔍 Searching for permit: ${permitNumber}`);

  const cleanPortal = portalUrl.replace(/\/$/, "").replace(/\/Login\.aspx$/i, "");
  const searchUrl = cleanPortal + "/Cap/CapHome.aspx?module=Building&TabName=Building";
  console.log(`  Navigating to search: ${searchUrl}`);
  await page.goto(searchUrl, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3000);

  const searchTabSelectors = [
    '#ctl00_PlaceHolderMain_TabDataList_TabsDataList a:has-text("Search Applications")',
    'a.TabSelected_Font:has-text("Search")',
    'a.NotSelected_Font:has-text("Search")',
  ];

  for (const sel of searchTabSelectors) {
    const tab = await page.$(sel);
    if (tab && (await tab.isVisible().catch(() => false))) {
      console.log(`  Clicking search tab: ${sel}`);
      await tab.click().catch(() => {});
      await page.waitForTimeout(2000);
      await page.waitForLoadState("networkidle").catch(() => {});
      break;
    }
  }

  console.log(`  Current URL after search tab: ${page.url()}`);

  const permitFieldSelectors = [
    "#ctl00_PlaceHolderMain_generalSearchForm_txtGSPermitNumber",
    'input[id*="txtGSPermitNumber"]',
    'input[id*="PermitNumber"]',
    'input[name*="PermitNumber"]',
    'input[id*="txtPermitNumber"]',
  ];

  let permitField = null;
  for (const sel of permitFieldSelectors) {
    permitField = await page.$(sel);
    if (permitField && (await permitField.isVisible().catch(() => false))) {
      console.log(`  Found permit field with selector: ${sel}`);
      break;
    }
    permitField = null;
  }

  if (!permitField) {
    console.log("  Permit field not found via ID selectors, trying global search...");
    const globalSearch = await page.$('#txtSearchCondition, input[id="txtSearchCondition"]');
    if (globalSearch && (await globalSearch.isVisible().catch(() => false))) {
      console.log("  Using global search bar instead");
      await globalSearch.fill(permitNumber);
      const globalSearchBtn = await page.$('img[id*="btnSearch"], a[id*="btnSearch"], #btnGlobalSearch');
      if (globalSearchBtn) {
        await Promise.all([
          page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {}),
          globalSearchBtn.click(),
        ]);
        await page.waitForTimeout(3000);
      }
    } else {
      const allVisibleInputs = await page.$$('input[type="text"]');
      const visibleInputs = [];
      for (const inp of allVisibleInputs) {
        if (await inp.isVisible().catch(() => false)) {
          const id = await inp.getAttribute("id").catch(() => "");
          const name = await inp.getAttribute("name").catch(() => "");
          visibleInputs.push({ id, name });
        }
      }
      console.log(`  Visible text inputs: ${JSON.stringify(visibleInputs)}`);
      throw new Error("Cannot find permit number search field");
    }
  } else {
    await permitField.fill(permitNumber);
    console.log(`  Entered permit number: ${permitNumber}`);

    const searchBtnSelectors = [
      "#ctl00_PlaceHolderMain_btnNewSearch",
      'a[id*="btnNewSearch"]',
      'input[id*="btnSearch"]',
      'a[id*="btnSearch"]',
      'input[value="Search"]',
      'button:has-text("Search")',
    ];

    let searchBtn = null;
    for (const sel of searchBtnSelectors) {
      searchBtn = await page.$(sel);
      if (searchBtn && (await searchBtn.isVisible().catch(() => false))) {
        console.log(`  Found search button: ${sel}`);
        break;
      }
      searchBtn = null;
    }
    if (searchBtn) {
      await Promise.all([
        page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {}),
        searchBtn.click(),
      ]);
    } else {
      console.log("  No search button found, pressing Enter");
      await permitField.press("Enter");
      await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    }
    await page.waitForTimeout(3000);
  }

  console.log(`  After search URL: ${page.url()}`);

  const noResultsEl = await page.$('[id*="NoDataMessage"], .ACA_NoDataMessage, td:has-text("No record found")');
  if (noResultsEl && (await noResultsEl.isVisible().catch(() => false))) {
    throw new Error(`Permit not found in Accela: ${permitNumber}`);
  }

  const allLinks = await page.$$("a");
  let resultLink = null;
  for (const link of allLinks) {
    const text = (await link.textContent().catch(() => "")).trim();
    if (text.includes(permitNumber) || text === permitNumber) {
      const visible = await link.isVisible().catch(() => false);
      if (visible) {
        console.log(`  Found result link with text: "${text}"`);
        resultLink = link;
        break;
      }
    }
  }

  if (!resultLink) {
    resultLink = await page.$(`td a[href*="CapDetail"], a[href*="CapDetail"]`);
    if (resultLink) {
      const linkText = (await resultLink.textContent().catch(() => "")).trim();
      console.log(`  Found CapDetail link: "${linkText}"`);
    }
  }

  if (!resultLink) {
    const gridLinks = await page.$$('table a, div[id*="grid"] a, div[id*="Grid"] a, div[id*="result"] a, div[id*="Result"] a');
    console.log(`  Grid/table links found: ${gridLinks.length}`);
    for (const gl of gridLinks.slice(0, 5)) {
      const t = (await gl.textContent().catch(() => "")).trim();
      const h = (await gl.getAttribute("href").catch(() => "")) || "";
      console.log(`    link: "${t}" href="${h.substring(0, 80)}"`);
    }
    if (gridLinks.length > 0) {
      resultLink = gridLinks[0];
    }
  }

  if (!resultLink) {
    throw new Error(`No clickable result found for permit: ${permitNumber}`);
  }

  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle", timeout: 30000 }).catch(() => {}),
    resultLink.click(),
  ]);
  await page.waitForTimeout(3000);
  console.log(`  Opened record detail: ${page.url()}`);
}

async function extractRecordHeader(page) {
  console.log("  📋 Extracting record header...");
  const header = await page.evaluate(() => {
    const fields = {};

    const capNumEl = document.querySelector('[id*="lblPermitNumber"], [id*="capNumber"], .aca_page_title, h1');
    if (capNumEl) fields.record_number = capNumEl.textContent.trim();

    const typeEl = document.querySelector('[id*="lblPermitType"], [id*="lblCapType"]');
    if (typeEl) fields.record_type = typeEl.textContent.trim();

    const statusEl = document.querySelector('[id*="lblPermitStatus"], [id*="lblCapStatus"], [id*="Status"]');
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
  console.log(`     Record: ${header.record_number || "unknown"} | Status: ${header.record_status || "unknown"}`);
  return header;
}

async function extractRecordDetails(page) {
  console.log("  📋 Extracting record details...");

  const recordInfoSelectors = [
    'a:has-text("Record Info")',
    'a[id*="RecordInfo"]',
    '#ctl00_PlaceHolderMain_TabDataList a:has-text("Record")',
  ];
  for (const sel of recordInfoSelectors) {
    const link = await page.$(sel);
    if (link && (await link.isVisible().catch(() => false))) {
      await link.click().catch(() => {});
      await page.waitForTimeout(2000);
      break;
    }
  }

  const recordDetailSelectors = [
    'a:has-text("Record Details")',
    'a:has-text("Record Detail")',
    'a[id*="RecordDetail"]',
  ];
  for (const sel of recordDetailSelectors) {
    const link = await page.$(sel);
    if (link && (await link.isVisible().catch(() => false))) {
      await link.click().catch(() => {});
      await page.waitForTimeout(2000);
      await page.waitForLoadState("networkidle").catch(() => {});
      break;
    }
  }

  const moreDetailsBtn = await page.$('a:has-text("More Details"), a:has-text("Show More"), [id*="MoreDetail"]');
  if (moreDetailsBtn && (await moreDetailsBtn.isVisible().catch(() => false))) {
    await moreDetailsBtn.click().catch(() => {});
    await page.waitForTimeout(2000);
  }

  const details = await page.evaluate(() => {
    const tables = [];
    const fields = {};

    document.querySelectorAll("table.ACA_TBody tr, table[id*='Detail'] tr, .aca_table_row, div.ACA_TabRow").forEach((row) => {
      const cells = row.querySelectorAll("td, th, span.ACA_Label, span.ACA_Value");
      if (cells.length >= 2) {
        const label = cells[0].textContent.trim().replace(/:$/, "").trim();
        const value = cells[1].textContent.trim();
        if (label && value && label.length < 60) {
          fields[label] = value;
        }
      }
    });

    document.querySelectorAll("span.ACA_Label, label, td.ACA_AlignLeftOrRightTop").forEach((labelEl) => {
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
      tables.push({ title: "Record Details", headers: ["Field", "Value"], rows });
    }

    return { tables, fields };
  });

  const detailScreenshot = await page.screenshot({ fullPage: true }).catch(() => null);
  details.screenshot = detailScreenshot ? detailScreenshot.toString("base64") : null;

  console.log(`     Extracted ${Object.keys(details.fields).length} detail fields`);
  return details;
}

async function extractProcessingStatus(page) {
  console.log("  📋 Extracting processing status...");

  const statusSelectors = [
    'a:has-text("Processing Status")',
    'a[id*="ProcessingStatus"]',
    'a:has-text("Workflow")',
  ];
  for (const sel of statusSelectors) {
    const link = await page.$(sel);
    if (link && (await link.isVisible().catch(() => false))) {
      await link.click().catch(() => {});
      await page.waitForTimeout(3000);
      await page.waitForLoadState("networkidle").catch(() => {});
      break;
    }
  }

  const expandButtons = await page.$$('[id*="expand"], .collapse-icon, a[onclick*="expand"], img[src*="expand"], .aca_expand');
  for (const btn of expandButtons) {
    await btn.click().catch(() => {});
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(2000);

  const departments = await page.evaluate(() => {
    const depts = [];
    const rows = document.querySelectorAll('[id*="WorkflowTask"], [id*="ProcessStatus"] tr, .workflow-task, li[id*="task"]');

    rows.forEach((row) => {
      const nameEl = row.querySelector('[id*="TaskName"], .task-name, td:first-child, span.ACA_SmLabel');
      const statusEl = row.querySelector('[id*="TaskStatus"], .task-status, [class*="status"]');
      const dateEl = row.querySelector('[id*="DueDate"], [id*="Date"], .task-date');
      const detailEl = row.querySelector('[id*="Comment"], [id*="Detail"], .task-detail');

      const name = nameEl ? nameEl.textContent.trim() : "";
      const status = statusEl ? statusEl.textContent.trim() : "";

      if (name && name.length < 100) {
        depts.push({
          name,
          status,
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
        const headers = Array.from(headerRow.querySelectorAll("th, td")).map(h => h.textContent.trim().toLowerCase());
        if (headers.some(h => h.includes("task") || h.includes("department") || h.includes("step"))) {
          const dataRows = table.querySelectorAll("tr:not(:first-child)");
          dataRows.forEach(dr => {
            const cells = dr.querySelectorAll("td");
            if (cells.length >= 2) {
              depts.push({
                name: cells[0].textContent.trim(),
                status: cells.length > 1 ? cells[1].textContent.trim() : "",
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

  const screenshot = await page.screenshot({ fullPage: true }).catch(() => null);
  const screenshotBase64 = screenshot ? screenshot.toString("base64") : null;

  console.log(`     Found ${departments.length} departments/tasks`);
  return { departments, screenshot: screenshotBase64 };
}

async function extractPlanReview(page) {
  console.log("  📋 Extracting plan review comments...");

  const planReviewSelectors = [
    'a:has-text("Plan Review")',
    'a[id*="PlanReview"]',
    'a:has-text("Review")',
  ];

  let found = false;
  for (const sel of planReviewSelectors) {
    const link = await page.$(sel);
    if (link && (await link.isVisible().catch(() => false))) {
      const text = await link.textContent().catch(() => "");
      if (text.toLowerCase().includes("plan review") || text.toLowerCase() === "review") {
        await link.click().catch(() => {});
        await page.waitForTimeout(3000);
        await page.waitForLoadState("networkidle").catch(() => {});
        found = true;
        break;
      }
    }
  }

  if (!found) {
    console.log("     Plan Review tab not found — skipping");
    return { comments: [], text: "", screenshot: null };
  }

  const comments = await page.evaluate(() => {
    const results = [];

    document.querySelectorAll('[id*="ReviewComment"] tr, [id*="PlanReview"] tr, table[id*="Comment"] tr').forEach((row) => {
      const cells = row.querySelectorAll("td");
      if (cells.length >= 2) {
        const commentText = Array.from(cells).map(c => c.textContent.trim()).join(" | ");
        if (commentText.length > 20) {
          results.push({
            reviewer: cells.length > 0 ? cells[0].textContent.trim() : "",
            department: cells.length > 1 ? cells[1].textContent.trim() : "",
            comment: cells.length > 2 ? cells[2].textContent.trim() : cells[1].textContent.trim(),
            date: cells.length > 3 ? cells[3].textContent.trim() : "",
          });
        }
      }
    });

    if (results.length === 0) {
      const container = document.querySelector('[id*="ReviewComment"], [id*="PlanReview"], [id*="Comment"]');
      if (container) {
        const text = container.textContent.trim();
        if (text.length > 20) {
          results.push({ reviewer: "", department: "", comment: text.slice(0, 5000), date: "" });
        }
      }
    }

    return results;
  });

  const pageText = await page.evaluate(() => {
    const container = document.querySelector('[id*="ReviewComment"], [id*="PlanReview"], main, #mainContent');
    return container ? container.textContent.trim().slice(0, 50000) : document.body.innerText.slice(0, 50000);
  });

  const screenshot = await page.screenshot({ fullPage: true }).catch(() => null);
  const screenshotBase64 = screenshot ? screenshot.toString("base64") : null;

  console.log(`     Found ${comments.length} review comments`);
  return { comments, text: pageText, screenshot: screenshotBase64 };
}

async function extractRelatedRecords(page) {
  console.log("  📋 Extracting related records...");

  const relatedSelectors = [
    'a:has-text("Related Records")',
    'a[id*="RelatedRecord"]',
  ];
  for (const sel of relatedSelectors) {
    const link = await page.$(sel);
    if (link && (await link.isVisible().catch(() => false))) {
      await link.click().catch(() => {});
      await page.waitForTimeout(3000);
      await page.waitForLoadState("networkidle").catch(() => {});
      break;
    }
  }

  const viewTree = await page.$('a:has-text("View Entire Tree"), a:has-text("Entire Tree")');
  if (viewTree && (await viewTree.isVisible().catch(() => false))) {
    await viewTree.click().catch(() => {});
    await page.waitForTimeout(2000);
  }

  const records = await page.evaluate(() => {
    const results = [];
    document.querySelectorAll('[id*="RelatedRecord"] tr, [id*="Related"] table tr').forEach((row) => {
      const cells = row.querySelectorAll("td");
      if (cells.length >= 2) {
        const recordNum = cells[0].textContent.trim();
        if (recordNum && !recordNum.toLowerCase().includes("record number")) {
          results.push({
            record_number: recordNum,
            record_type: cells.length > 1 ? cells[1].textContent.trim() : "",
            project_name: cells.length > 2 ? cells[2].textContent.trim() : "",
            date: cells.length > 3 ? cells[3].textContent.trim() : "",
          });
        }
      }
    });
    return results;
  });

  const relScreenshot = await page.screenshot({ fullPage: true }).catch(() => null);
  console.log(`     Found ${records.length} related records`);
  return { records, screenshot: relScreenshot ? relScreenshot.toString("base64") : null };
}

async function extractAttachments(page) {
  console.log("  📋 Extracting attachments...");

  const attachSelectors = [
    'a:has-text("Attachments")',
    'a:has-text("Attachment")',
    'a[id*="Attachment"]',
  ];
  for (const sel of attachSelectors) {
    const link = await page.$(sel);
    if (link && (await link.isVisible().catch(() => false))) {
      await link.click().catch(() => {});
      await page.waitForTimeout(3000);
      await page.waitForLoadState("networkidle").catch(() => {});
      break;
    }
  }

  const attachments = await page.evaluate(() => {
    const results = [];
    document.querySelectorAll('[id*="Attachment"] tr, [id*="Document"] tr').forEach((row) => {
      const cells = row.querySelectorAll("td");
      if (cells.length >= 2) {
        const name = cells[0].textContent.trim();
        if (name && name.length < 200 && !name.toLowerCase().includes("file name")) {
          results.push({
            name,
            record_id: cells.length > 1 ? cells[1].textContent.trim() : "",
            record_type: cells.length > 2 ? cells[2].textContent.trim() : "",
            entity_type: cells.length > 3 ? cells[3].textContent.trim() : "",
            type: cells.length > 4 ? cells[4].textContent.trim() : "",
            size: cells.length > 5 ? cells[5].textContent.trim() : "",
            latest_update: cells.length > 6 ? cells[6].textContent.trim() : "",
          });
        }
      }
    });
    return results;
  });

  const attScreenshot = await page.screenshot({ fullPage: true }).catch(() => null);
  console.log(`     Found ${attachments.length} attachments`);
  return { attachments, screenshot: attScreenshot ? attScreenshot.toString("base64") : null };
}

async function extractInspections(page) {
  console.log("  📋 Extracting inspections...");

  const inspSelectors = [
    'a:has-text("Inspections")',
    'a:has-text("Inspection")',
    'a[id*="Inspection"]',
  ];
  for (const sel of inspSelectors) {
    const link = await page.$(sel);
    if (link && (await link.isVisible().catch(() => false))) {
      await link.click().catch(() => {});
      await page.waitForTimeout(3000);
      await page.waitForLoadState("networkidle").catch(() => {});
      break;
    }
  }

  const inspections = await page.evaluate(() => {
    const results = [];
    document.querySelectorAll('[id*="Inspection"] tr, [id*="inspection"] tr').forEach((row) => {
      const cells = row.querySelectorAll("td");
      if (cells.length >= 2) {
        const type = cells[0].textContent.trim();
        if (type && type.length < 200 && !type.toLowerCase().includes("inspection type")) {
          results.push({
            type,
            status: cells.length > 1 ? cells[1].textContent.trim() : "",
            date: cells.length > 2 ? cells[2].textContent.trim() : "",
            inspector: cells.length > 3 ? cells[3].textContent.trim() : "",
            result: cells.length > 4 ? cells[4].textContent.trim() : "",
          });
        }
      }
    });
    return results;
  });

  const inspScreenshot = await page.screenshot({ fullPage: true }).catch(() => null);
  console.log(`     Found ${inspections.length} inspections`);
  return { inspections, screenshot: inspScreenshot ? inspScreenshot.toString("base64") : null };
}

async function extractPayments(page) {
  console.log("  📋 Extracting payments...");

  const paySelectors = [
    'a:has-text("Payments")',
    'a:has-text("Payment")',
    'a:has-text("Fees")',
    'a[id*="Payment"]',
  ];
  for (const sel of paySelectors) {
    const link = await page.$(sel);
    if (link && (await link.isVisible().catch(() => false))) {
      await link.click().catch(() => {});
      await page.waitForTimeout(3000);
      await page.waitForLoadState("networkidle").catch(() => {});
      break;
    }
  }

  const payments = await page.evaluate(() => {
    const results = [];
    document.querySelectorAll('[id*="Payment"] tr, [id*="Fee"] tr').forEach((row) => {
      const cells = row.querySelectorAll("td");
      if (cells.length >= 2) {
        const desc = cells[0].textContent.trim();
        if (desc && desc.length < 200 && !desc.toLowerCase().includes("description")) {
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

  const payScreenshot = await page.screenshot({ fullPage: true }).catch(() => null);
  console.log(`     Found ${payments.length} payment records`);
  return { payments, screenshot: payScreenshot ? payScreenshot.toString("base64") : null };
}

async function scrapeAccelaRecord(session, permitNumber, supabaseProjectId, userId, supabase, hashPortalData) {
  const { context, portalUrl } = session;
  const page = await context.newPage();
  const TIMEOUT = 180000;
  const startTime = Date.now();

  const checkTimeout = () => {
    if (Date.now() - startTime > TIMEOUT) throw new Error("Accela scraping timed out (3 minute limit)");
  };

  try {
    await searchPermit(page, portalUrl, permitNumber);
    checkTimeout();

    const header = await extractRecordHeader(page);
    checkTimeout();

    const headerScreenshot = await page.screenshot({ fullPage: true }).catch(() => null);
    const headerScreenshotBase64 = headerScreenshot ? headerScreenshot.toString("base64") : null;

    const details = await extractRecordDetails(page);
    checkTimeout();

    const processingStatus = await extractProcessingStatus(page);
    checkTimeout();

    const planReview = await extractPlanReview(page);
    checkTimeout();

    const relatedRecords = await extractRelatedRecords(page);
    checkTimeout();

    const attachments = await extractAttachments(page);
    checkTimeout();

    const inspections = await extractInspections(page);
    checkTimeout();

    const payments = await extractPayments(page);

    const portalData = {
      portalType: "accela",
      name: header.record_number || permitNumber,
      projectNum: permitNumber,
      description: header.record_type || "",
      location: details.fields["Work Location"] || details.fields["Address"] || details.fields["Location"] || "",
      dashboardStatus: header.record_status || "",
      tabs: {
        info: {
          tables: details.tables,
          fields: header,
          keyValues: Object.entries(details.fields).map(([key, value]) => ({ key, value })),
          screenshot: details.screenshot,
        },
        status: {
          departments: processingStatus.departments,
          tables: processingStatus.departments.length > 0 ? [{
            title: "Processing Status",
            headers: ["Department", "Status", "Due Date", "Details"],
            rows: processingStatus.departments,
          }] : [],
          keyValues: [],
          screenshot: processingStatus.screenshot,
        },
        reports: {
          pdfs: [
            ...(processingStatus.screenshot ? [{
              fileName: "Processing Status",
              text: processingStatus.departments.map(d => `${d.name}: ${d.status} ${d.date} ${d.details}`).join("\n"),
              screenshot: processingStatus.screenshot,
              source: "accela",
            }] : []),
            ...(planReview.text ? [{
              fileName: "Plan Review - Review Comments",
              text: planReview.text,
              screenshot: planReview.screenshot,
              source: "accela",
              comments: planReview.comments,
            }] : []),
            ...(headerScreenshotBase64 ? [{
              fileName: "Record Overview",
              text: Object.entries(header).map(([k, v]) => `${k}: ${v}`).join("\n"),
              screenshot: headerScreenshotBase64,
              source: "accela",
            }] : []),
          ],
          keyValues: [],
          tables: [],
        },
        attachments: {
          tables: attachments.attachments.length > 0 ? [{
            title: "Attachments",
            headers: ["Name", "Record ID", "Record Type", "Entity Type", "Type", "Size", "Last Updated"],
            rows: attachments.attachments,
          }] : [],
          keyValues: [],
          screenshot: attachments.screenshot,
        },
        inspections: {
          tables: inspections.inspections.length > 0 ? [{
            title: "Inspections",
            headers: ["Type", "Status", "Date", "Inspector", "Result"],
            rows: inspections.inspections,
          }] : [],
          keyValues: [],
          screenshot: inspections.screenshot,
        },
        payments: {
          tables: payments.payments.length > 0 ? [{
            title: "Payments",
            headers: ["Description", "Amount", "Status", "Date"],
            rows: payments.payments,
          }] : [],
          keyValues: [],
          screenshot: payments.screenshot,
        },
        relatedRecords: {
          tables: relatedRecords.records.length > 0 ? [{
            title: "Related Records",
            headers: ["Record Number", "Record Type", "Project Name", "Date"],
            rows: relatedRecords.records,
          }] : [],
          keyValues: [],
          screenshot: relatedRecords.screenshot,
        },
      },
    };

    session.data[permitNumber] = portalData;

    if (supabase && userId) {
      console.log(`\n  💾 Syncing ${permitNumber} to Supabase...`);
      const newHash = hashPortalData(portalData);

      const { data: existingRows } = await supabase
        .from("projects")
        .select("id, portal_data_hash")
        .eq("permit_number", permitNumber)
        .eq("user_id", userId);

      const existingRow = existingRows && existingRows.length > 0 ? existingRows[0] : null;

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
