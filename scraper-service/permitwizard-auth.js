const crypto = require("crypto");

const PERMITWIZARD_URL = "https://permitwizard.dcra.dc.gov";
const ACCESS_DC_SSO_URL = "https://login.dc.gov";
const SESSION_TTL_MS = 25 * 60 * 1000;
const MAX_LOGIN_TIMEOUT = 60000;

const activeSessions = {};

function generateSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

function detectCaptcha(page) {
  return page.evaluate(() => {
    const hasCaptchaFrame = !!document.querySelector(
      'iframe[src*="recaptcha"], iframe[src*="captcha"], iframe[src*="hcaptcha"]'
    );
    const hasCaptchaDiv = !!document.querySelector(
      '.g-recaptcha, [data-sitekey], .h-captcha, #captcha, [id*="captcha" i], [class*="captcha" i]'
    );
    const hasCaptchaText = document.body.innerText
      .toLowerCase()
      .includes("verify you are human");
    return hasCaptchaFrame || hasCaptchaDiv || hasCaptchaText;
  });
}

async function handleAccessDCSSOLogin(page, username, password) {
  const url = page.url().toLowerCase();

  if (
    url.includes("login.dc.gov") ||
    url.includes("b2clogin") ||
    url.includes("access.dc.gov") ||
    url.includes("okta") ||
    url.includes("signin") ||
    url.includes("login")
  ) {
    console.log("  [PermitWizard Auth] Detected SSO login page");

    const hasCaptcha = await detectCaptcha(page);
    if (hasCaptcha) {
      return { success: false, error: "captcha_detected" };
    }

    if (url.includes("b2clogin.com")) {
      const oktaExchange = await page.$("#OktaExchange");
      if (oktaExchange) {
        await oktaExchange.click();
      } else {
        const submitBtn = await page.$('button[type="submit"]');
        if (submitBtn) await submitBtn.click();
      }
      await page
        .waitForNavigation({ waitUntil: "networkidle", timeout: 30000 })
        .catch(() => {});
      await page.waitForTimeout(3000);
    }

    const usernameSelectors = [
      'input[name="identifier"]',
      'input[name="username"]',
      'input[name="email"]',
      "#okta-signin-username",
      'input[type="email"]',
      'input[id*="user" i]',
      'input[id*="email" i]',
      'input[type="text"]',
    ];

    let usernameField = null;
    for (const sel of usernameSelectors) {
      usernameField = await page.$(sel);
      if (
        usernameField &&
        (await usernameField.isVisible().catch(() => false))
      ) {
        break;
      }
      usernameField = null;
    }

    if (!usernameField) {
      return { success: false, error: "cannot_find_username_field" };
    }

    await usernameField.fill(username);
    console.log("  [PermitWizard Auth] Filled username");

    const passwordSelectors = [
      'input[name="credentials.passcode"]',
      'input[name="password"]',
      "#okta-signin-password",
      'input[type="password"]',
    ];

    let passwordField = null;
    for (const sel of passwordSelectors) {
      passwordField = await page.$(sel);
      if (
        passwordField &&
        (await passwordField.isVisible().catch(() => false))
      ) {
        break;
      }
      passwordField = null;
    }

    if (!passwordField) {
      console.log("  [PermitWizard Auth] Two-step login flow detected");
      const nextBtn = await page.$(
        'input[type="submit"], button[type="submit"]'
      );
      if (nextBtn) await nextBtn.click();
      else await page.keyboard.press("Enter");

      await page
        .waitForNavigation({ waitUntil: "networkidle", timeout: 15000 })
        .catch(() => {});
      await page.waitForTimeout(2000);

      const hasCaptchaStep2 = await detectCaptcha(page);
      if (hasCaptchaStep2) {
        return { success: false, error: "captcha_detected" };
      }

      for (const sel of passwordSelectors) {
        passwordField = await page.$(sel);
        if (
          passwordField &&
          (await passwordField.isVisible().catch(() => false))
        ) {
          break;
        }
        passwordField = null;
      }

      if (!passwordField) {
        return { success: false, error: "cannot_find_password_field" };
      }
    }

    await passwordField.fill(password);
    console.log("  [PermitWizard Auth] Filled password");

    const hasCaptchaBeforeSubmit = await detectCaptcha(page);
    if (hasCaptchaBeforeSubmit) {
      return { success: false, error: "captcha_detected" };
    }

    const submitBtn = await page.$(
      'input[type="submit"], button[type="submit"]'
    );
    if (submitBtn) await submitBtn.click();
    else await page.keyboard.press("Enter");

    await page
      .waitForNavigation({ waitUntil: "networkidle", timeout: 30000 })
      .catch(() => {});
    await page.waitForTimeout(3000);

    const postLoginUrl = page.url();
    console.log(`  [PermitWizard Auth] After login URL: ${postLoginUrl}`);

    if (
      postLoginUrl.includes("SSOLanding") ||
      postLoginUrl.includes("Home/SSO")
    ) {
      const continueBtn = await page.$(
        'button:has-text("Continue"), a:has-text("Continue"), input[value="Continue"]'
      );
      if (continueBtn) {
        await continueBtn.click();
        await page
          .waitForNavigation({ waitUntil: "networkidle", timeout: 15000 })
          .catch(() => {});
        await page.waitForTimeout(2000);
      }
    }

    return { success: true };
  }

  return { success: true };
}

async function permitWizardLogin(browser, username, password) {
  console.log("  [PermitWizard Auth] Starting Access DC SSO login flow");

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  const page = await context.newPage();

  try {
    console.log(`  [PermitWizard Auth] Navigating to ${PERMITWIZARD_URL}`);
    await page.goto(PERMITWIZARD_URL, {
      waitUntil: "networkidle",
      timeout: MAX_LOGIN_TIMEOUT,
    });
    await page.waitForTimeout(3000);

    let currentUrl = page.url();
    console.log(`  [PermitWizard Auth] Landed on: ${currentUrl}`);

    if (currentUrl.includes("SessionEnded")) {
      const loginLink = await page.$(
        'a:has-text("Log in again"), a:has-text("Login"), a[href*="Login"]'
      );
      if (loginLink) {
        await loginLink.click();
        await page
          .waitForNavigation({ waitUntil: "networkidle", timeout: 15000 })
          .catch(() => {});
        await page.waitForTimeout(2000);
        currentUrl = page.url();
      }
    }

    const ssoResult = await handleAccessDCSSOLogin(page, username, password);

    if (!ssoResult.success) {
      if (ssoResult.error === "captcha_detected") {
        console.log(
          "  [PermitWizard Auth] CAPTCHA detected — pausing for human intervention"
        );
        await context.close();
        return {
          success: false,
          error: "captcha_detected",
          message:
            "CAPTCHA detected during login. Please complete login manually or try again later.",
          requiresHumanIntervention: true,
        };
      }
      await context.close();
      return {
        success: false,
        error: ssoResult.error,
        message: `Login failed: ${ssoResult.error}`,
      };
    }

    const finalUrl = page.url();
    console.log(`  [PermitWizard Auth] Final URL: ${finalUrl}`);

    const isLoginPage =
      finalUrl.includes("b2clogin") ||
      finalUrl.includes("SessionEnded") ||
      finalUrl.includes("okta.com/signin") ||
      finalUrl.includes("login.dc.gov");

    if (isLoginPage) {
      const errorEl = await page.$(
        ".error-message, [id*='Error'], [id*='error'], .alert-danger, .ACA_Error"
      );
      const errorText = errorEl
        ? await errorEl.textContent().catch(() => "")
        : "";

      await context.close();
      return {
        success: false,
        error: "login_failed",
        message:
          "Login failed — invalid credentials or account locked" +
          (errorText ? `: ${errorText.trim()}` : ""),
        doNotRetry: true,
      };
    }

    const sessionToken = generateSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    activeSessions[sessionToken] = {
      context,
      page,
      username,
      password,
      createdAt: new Date(),
      expiresAt,
      lastActivity: new Date(),
      portalUrl: PERMITWIZARD_URL,
    };

    console.log(
      `  [PermitWizard Auth] Login successful — session ${sessionToken.substring(0, 8)}... expires at ${expiresAt.toISOString()}`
    );

    return {
      success: true,
      sessionToken,
      expiresAt: expiresAt.toISOString(),
      portalUrl: finalUrl,
    };
  } catch (err) {
    console.error(`  [PermitWizard Auth] Login error: ${err.message}`);
    await context.close().catch(() => {});
    return {
      success: false,
      error: "login_error",
      message: err.message,
    };
  }
}

function getSession(sessionToken) {
  const session = activeSessions[sessionToken];
  if (!session) return null;

  if (new Date() > session.expiresAt) {
    console.log(
      `  [PermitWizard Auth] Session ${sessionToken.substring(0, 8)}... expired`
    );
    destroySession(sessionToken);
    return null;
  }

  session.lastActivity = new Date();
  return session;
}

async function checkSessionAlive(sessionToken) {
  const session = getSession(sessionToken);
  if (!session) return { alive: false, reason: "session_not_found_or_expired" };

  try {
    const currentUrl = session.page.url();

    const isSessionExpired =
      currentUrl.includes("SessionEnded") ||
      currentUrl.includes("Login") ||
      currentUrl.includes("b2clogin") ||
      currentUrl.includes("login.dc.gov");

    if (isSessionExpired) {
      console.log(
        `  [PermitWizard Auth] Portal session expired (URL: ${currentUrl})`
      );
      return { alive: false, reason: "portal_session_expired" };
    }

    return {
      alive: true,
      expiresAt: session.expiresAt.toISOString(),
      lastActivity: session.lastActivity.toISOString(),
    };
  } catch (err) {
    console.log(
      `  [PermitWizard Auth] Session check failed: ${err.message}`
    );
    return { alive: false, reason: "session_check_error" };
  }
}

async function reAuthenticate(browser, sessionToken) {
  const session = activeSessions[sessionToken];
  if (!session) return null;

  console.log(
    `  [PermitWizard Auth] Re-authenticating session ${sessionToken.substring(0, 8)}...`
  );

  await destroySession(sessionToken);

  const result = await permitWizardLogin(
    browser,
    session.username,
    session.password
  );
  return result;
}

async function destroySession(sessionToken) {
  const session = activeSessions[sessionToken];
  if (session) {
    try {
      await session.context.close();
    } catch (err) {
      console.log(
        `  [PermitWizard Auth] Error closing context: ${err.message}`
      );
    }
    delete activeSessions[sessionToken];
    console.log(
      `  [PermitWizard Auth] Session ${sessionToken.substring(0, 8)}... destroyed`
    );
  }
}

function getActiveSessionCount() {
  return Object.keys(activeSessions).length;
}

setInterval(() => {
  const now = new Date();
  for (const [token, session] of Object.entries(activeSessions)) {
    if (now > session.expiresAt) {
      console.log(
        `  [PermitWizard Auth] Cleaning up expired session ${token.substring(0, 8)}...`
      );
      destroySession(token);
    }
  }
}, 60 * 1000);

module.exports = {
  permitWizardLogin,
  getSession,
  checkSessionAlive,
  reAuthenticate,
  destroySession,
  getActiveSessionCount,
  PERMITWIZARD_URL,
  SESSION_TTL_MS,
};
