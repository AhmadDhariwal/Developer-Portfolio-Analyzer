const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');

function loadPlaywright() {
  const candidates = [
    path.resolve(__dirname, '../node_modules/playwright'),
    path.resolve(__dirname, '../../node_modules/playwright'),
    'C:/Users/Ahmad/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright',
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return require(candidate);
    }
  }
  return require('playwright');
}

const { chromium } = loadPlaywright();

const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const DIST_DIR = path.resolve(__dirname, '../dist/frontend/browser');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

function makeFakeJwt(userId = 'user-e2e-1', role = 'developer') {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      id: userId,
      role,
      iss: 'devinsight-api',
      aud: 'devinsight-web',
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  ).toString('base64url');
  return `${header}.${payload}.e2e-signature`;
}

function makeOAuthHash(user) {
  return Buffer.from(JSON.stringify(user), 'utf8').toString('base64url');
}

function startStaticServer(rootDir) {
  const indexPath = path.join(rootDir, 'index.html');
  if (!fs.existsSync(indexPath)) {
    throw new Error(`Built frontend not found at ${indexPath}`);
  }

  const server = http.createServer((req, res) => {
    const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
    let pathname = decodeURIComponent(reqUrl.pathname);

    if (pathname === '/') pathname = '/index.html';
    const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
    let filePath = path.join(rootDir, safePath);

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = indexPath;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(filePath).pipe(res);
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}` });
    });
  });
}

async function runTests() {
  const { server, baseUrl } = await startStaticServer(DIST_DIR);
  const browser = await chromium.launch({
    headless: true,
    executablePath: fs.existsSync(CHROME_PATH) ? CHROME_PATH : undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  const report = [];
  const record = (name, fn) => ({ name, fn });

  const testUser = {
    _id: 'user-e2e-1',
    name: 'Ahmad Developer',
    email: 'ahmad@example.com',
    role: 'developer',
    githubUsername: 'ahmaddev',
    profileCompleted: true,
    isActive: true,
    isPublic: false,
    token: makeFakeJwt('user-e2e-1', 'developer'),
  };

  async function installApiMocks(page, overrides = {}) {
    await page.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();
      const body = route.request().postDataJSON?.() || null;

      if (overrides.handler) {
        const handled = await overrides.handler(route, url, method, body);
        if (handled) return;
      }

      if (url.pathname.endsWith('/api/auth/login') && method === 'POST') {
        if (body?.password === 'wrongpass') {
          return route.fulfill({
            status: 401,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'Invalid email or password.' }),
          });
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(testUser),
        });
      }

      if (url.pathname.endsWith('/api/auth/register') && method === 'POST') {
        if (body?.email === 'exists@example.com') {
          return route.fulfill({
            status: 409,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'An account with this email already exists.' }),
          });
        }
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            pendingId: 'pending-e2e-1',
            email: body?.email || 'ahmad@example.com',
            otpType: body?.phoneNumber ? 'phone' : 'email',
            expiresAt: new Date(Date.now() + 600_000).toISOString(),
            requiresOtp: true,
          }),
        });
      }

      if (url.pathname.endsWith('/api/auth/forgot-password') && method === 'POST') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            message: 'If the account is eligible, a password reset code has been sent.',
            userId: 'reset-v1.mockchallenge',
            expiresAt: new Date(Date.now() + 600_000).toISOString(),
          }),
        });
      }

      if (url.pathname.endsWith('/api/auth/verify-otp') && method === 'POST') {
        if (body?.otp === '000000') {
          return route.fulfill({
            status: 400,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'Invalid OTP code.' }),
          });
        }
        if (body?.purpose === 'forgot-password') {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              message: 'OTP verified successfully.',
              resetToken: 'reset-jwt-valid-1',
            }),
          });
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(testUser),
        });
      }

      if (url.pathname.endsWith('/api/auth/reset-password') && method === 'POST') {
        if (body?.resetToken === 'expired-token') {
          return route.fulfill({
            status: 400,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'Reset token expired or invalid.' }),
          });
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Password reset successful.' }),
        });
      }

      if (url.pathname.endsWith('/api/users/me')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(testUser),
        });
      }

      // Return harmless empty JSON for dashboard/other app shell endpoints during redirects
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({}),
      });
    });
  }

  const cases = [
    record('1. Landing -> Sign Up CTA, mobile drawer, tabs & theme toggle', async () => {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await context.newPage();
      await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });

      // Mobile menu open & Escape close
      const toggle = page.locator('.mobile-menu-toggle');
      await toggle.click();
      await assert.doesNotReject(() =>
        page.locator('#mobile-nav-drawer').waitFor({ state: 'visible' }),
      );
      await page.keyboard.press('Escape');
      await assert.doesNotReject(() =>
        page.locator('#mobile-nav-drawer').waitFor({ state: 'hidden' }),
      );

      // Desktop tabs + CTA navigation
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.getByRole('tab', { name: 'Resume Intelligence' }).click();
      await page
        .locator('.analysis-panel h3', { hasText: /alignment between what you built/i })
        .waitFor({ state: 'visible', timeout: 5000 });

      await page
        .locator('.nav-actions')
        .getByRole('button', { name: /Color theme/i })
        .click();
      await page.getByRole('menuitemradio', { name: /Switch to Light theme/i }).click();
      assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');

      await page.locator('.hero-actions a[href="/auth/signup"]').click();
      await page.waitForURL('**/auth/signup');
      await context.close();
    }),

    record('2. Landing -> Login CTA & keyboard focus visibility', async () => {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });
      await page.keyboard.press('Tab');
      const activeTag = await page.evaluate(() => document.activeElement?.tagName);
      assert.equal(activeTag, 'A');

      await page.locator('.hero-actions a[href="/auth/login"]').click();
      await page.waitForURL('**/auth/login');
      await context.close();
    }),

    record(
      '3. Unsuccessful & Successful Registration + OTP completion (Mocked Backend)',
      async () => {
        const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const page = await context.newPage();
        await installApiMocks(page);
        await page.goto(`${baseUrl}/auth/signup`, { waitUntil: 'networkidle' });

        // Empty submit triggers per-field validation
        await page.locator('button[type="submit"]').click();
        assert.ok((await page.locator('.field-error').count()) >= 5);

        // Server 409 error
        await page.fill('#signup-name', 'Ahmad Dev');
        await page.fill('#signup-email', 'exists@example.com');
        await page.fill('#signup-github', 'ahmaddev');
        await page.fill('#signup-password', 'Passw0rd!');
        await page.fill('#signup-confirm-password', 'Passw0rd!');
        await page.check('#signup-terms');
        await page.locator('button[type="submit"]').click();
        await page.locator('.auth-alert--error').waitFor({ state: 'visible' });
        assert.match(
          (await page.locator('.auth-alert--error').textContent()) || '',
          /already exists/i,
        );

        // Successful signup -> OTP -> Dashboard
        await page.fill('#signup-email', 'ahmad@example.com');
        await page.locator('button[type="submit"]').click();
        await page.waitForURL('**/auth/otp-verification');

        const otpInputs = page.locator('.otp-cell');
        for (let i = 0; i < 6; i++) {
          await otpInputs.nth(i).fill(String(i + 1));
        }
        await page.locator('button[type="submit"]').click();
        await page.waitForURL('**/app/dashboard');
        await context.close();
      },
    ),

    record(
      '4. Unsuccessful & Successful Login + Password visibility toggle (Mocked Backend)',
      async () => {
        const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const page = await context.newPage();
        await installApiMocks(page);
        await page.goto(`${baseUrl}/auth/login`, { waitUntil: 'networkidle' });

        // Toggle password visibility
        assert.equal(await page.locator('#login-password').getAttribute('type'), 'password');
        await page.locator('.password-toggle-btn').click();
        assert.equal(await page.locator('#login-password').getAttribute('type'), 'text');

        // Wrong password -> error alert
        await page.fill('#login-email', 'ahmad@example.com');
        await page.fill('#login-password', 'wrongpass');
        await page.locator('button[type="submit"]').click();
        await page.locator('.auth-alert--error').waitFor({ state: 'visible' });
        assert.match(
          (await page.locator('.auth-alert--error').textContent()) || '',
          /invalid email or password/i,
        );

        // Correct password -> dashboard
        await page.fill('#login-password', 'correctpass');
        await page.locator('button[type="submit"]').click();
        await page.waitForURL('**/app/dashboard');
        await context.close();
      },
    ),

    record(
      '5 & 6. Forgot Password -> OTP -> Reset Password -> Success view (Mocked Backend)',
      async () => {
        const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const page = await context.newPage();
        await installApiMocks(page);
        await page.goto(`${baseUrl}/auth/forgot-password`, { waitUntil: 'networkidle' });

        await page.fill('#forgot-email', 'ahmad@example.com');
        await page.locator('button[type="submit"]').click();
        await page.waitForURL('**/auth/otp-verification');

        const otpInputs = page.locator('.otp-cell');
        for (let i = 0; i < 6; i++) {
          await otpInputs.nth(i).fill(String(i + 1));
        }
        await page.locator('button[type="submit"]').click();
        await page.waitForURL('**/auth/reset-password');

        await page.fill('#reset-new-password', 'StrongPass1');
        await page.fill('#reset-confirm-password', 'StrongPass1');
        await page.locator('button[type="submit"]').click();
        await page.locator('.status-panel h2').waitFor({ state: 'visible' });
        assert.match(
          (await page.locator('.status-panel h2').textContent()) || '',
          /password updated/i,
        );
        await context.close();
      },
    ),

    record('7. Invalid & Expired Reset Token states', async () => {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await context.newPage();
      await installApiMocks(page);

      // Direct load without token -> invalid state
      await page.goto(`${baseUrl}/auth/reset-password`, { waitUntil: 'networkidle' });
      assert.match((await page.locator('.status-panel h2').textContent()) || '', /invalid/i);

      // Expired status param
      await page.goto(`${baseUrl}/auth/reset-password?status=expired`, {
        waitUntil: 'networkidle',
      });
      assert.match((await page.locator('.status-panel h2').textContent()) || '', /expired/i);

      // Expired token returned on submit
      await page.goto(`${baseUrl}/auth/reset-password?token=expired-token`, {
        waitUntil: 'networkidle',
      });
      await page.fill('#reset-new-password', 'StrongPass1');
      await page.fill('#reset-confirm-password', 'StrongPass1');
      await page.locator('button[type="submit"]').click();
      await page.locator('.status-panel h2').waitFor({ state: 'visible' });
      assert.match((await page.locator('.status-panel h2').textContent()) || '', /expired/i);

      await context.close();
    }),

    record(
      '8 & 9. Google & GitHub OAuth initiation, callback success, cancellation & errors (Mocked Callback)',
      async () => {
        const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const page = await context.newPage();
        await installApiMocks(page);

        // Intercept external redirect initiation so browser doesn't leave test server
        let interceptedGoogleUrl = '';
        let interceptedGithubUrl = '';
        await page.route('**/api/auth/google', async (route) => {
          interceptedGoogleUrl = route.request().url();
          await route.fulfill({ status: 200, body: 'mocked google redirect' });
        });
        await page.route('**/api/auth/github', async (route) => {
          interceptedGithubUrl = route.request().url();
          await route.fulfill({ status: 200, body: 'mocked github redirect' });
        });

        await page.goto(`${baseUrl}/auth/login`, { waitUntil: 'networkidle' });
        await page.getByRole('button', { name: /Continue with Google/i }).click();
        await page.waitForTimeout(100);
        assert.match(interceptedGoogleUrl, /\/api\/auth\/google$/);

        await page.goto(`${baseUrl}/auth/login`, { waitUntil: 'networkidle' });
        await page.getByRole('button', { name: /Continue with GitHub/i }).click();
        await page.waitForTimeout(100);
        assert.match(interceptedGithubUrl, /\/api\/auth\/github$/);

        // Cancellation on callback
        await page.goto(`${baseUrl}/auth/oauth/callback?error=access_denied`, {
          waitUntil: 'networkidle',
        });
        assert.match((await page.locator('.status-panel h2').textContent()) || '', /cancelled/i);

        // Account unavailable on callback
        await page.goto(`${baseUrl}/auth/oauth/callback?oauthError=account_unavailable`, {
          waitUntil: 'networkidle',
        });
        assert.match((await page.locator('.status-panel h2').textContent()) || '', /unavailable/i);

        // Success #oauth hash callback -> strips hash + navigates to /app/dashboard
        const oauthHash = makeOAuthHash(testUser);
        await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
        await page.goto(`${baseUrl}/auth/oauth/callback#oauth=${oauthHash}`, {
          waitUntil: 'domcontentloaded',
        });
        await page.waitForURL('**/app/dashboard', { timeout: 10000 });
        const storedToken = await page.evaluate(() => localStorage.getItem('token'));
        assert.equal(storedToken, testUser.token);

        await context.close();
      },
    ),

    record(
      '10, 11 & 12. Direct navigation, publicGuard for signed-in user & returnUrl preservation',
      async () => {
        const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const page = await context.newPage();
        await installApiMocks(page);

        // Unauthenticated protected URL -> login?returnUrl -> login -> back to returnUrl
        await page.goto(`${baseUrl}/app/resume-analyzer`, { waitUntil: 'domcontentloaded' });
        await page.waitForURL('**/auth/login**', { timeout: 10000 });
        assert.ok(
          page.url().includes('returnUrl=%2Fapp%2Fresume-analyzer') ||
            page.url().includes('returnUrl=/app/resume-analyzer'),
        );

        await page.fill('#login-email', 'ahmad@example.com');
        await page.fill('#login-password', 'correctpass');
        await page.locator('button[type="submit"]').click();
        await page.waitForURL('**/app/resume-analyzer', { timeout: 10000 });

        // Already-authenticated user navigating to /auth/login is redirected away by publicGuard
        await page.goto(`${baseUrl}/auth/login`, { waitUntil: 'domcontentloaded' });
        await page.waitForURL('**/app/dashboard', { timeout: 10000 });

        await context.close();
      },
    ),

    record(
      '13. Public subpages (/api-docs, /blog, /contact, /privacy, /terms) navigation, theme menu & interactions',
      async () => {
        const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const page = await context.newPage();

        // API Docs domain tabs + theme menu
        await page.goto(`${baseUrl}/api-docs`, { waitUntil: 'networkidle' });
        await page
          .locator('.pub-nav-actions')
          .getByRole('button', { name: /Color theme/i })
          .click();
        await page.getByRole('menuitemradio', { name: /Switch to Light theme/i }).click();
        assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');

        await page.getByRole('tab', { name: 'Developer Intelligence' }).click();
        assert.match(
          (await page.locator('.pub-terminal-body').textContent()) || '',
          /skillCoverage/,
        );

        // Blog filter
        await page.locator('.pub-nav-links a[href="/blog"]').click();
        await page.waitForURL('**/blog');
        await page.getByRole('button', { name: 'Recruiting' }).click();
        assert.equal(await page.locator('.blog-card').count(), 1);

        // Contact, Privacy & Terms navigation
        await page.locator('.pub-nav-links a[href="/contact"]').click();
        await page.waitForURL('**/contact');
        assert.match(
          (await page.locator('.pub-hero-title').textContent()) || '',
          /Contact DevInsight AI/i,
        );

        await page.locator('.pub-nav-links a[href="/privacy"]').click();
        await page.waitForURL('**/privacy');
        assert.equal(await page.locator('.pub-toc-link').count(), 4);

        await page.locator('.pub-nav-links a[href="/terms"]').click();
        await page.waitForURL('**/terms');
        assert.equal(await page.locator('.pub-toc-link').count(), 4);

        await context.close();
      },
    ),
  ];

  try {
    for (const tc of cases) {
      const start = Date.now();
      try {
        await tc.fn();
        report.push({ name: tc.name, status: 'PASS', durationMs: Date.now() - start });
      } catch (err) {
        report.push({
          name: tc.name,
          status: 'FAIL',
          durationMs: Date.now() - start,
          error: err?.message || String(err),
        });
      }
    }

    const outPath = path.resolve(__dirname, '../verification/public-auth/e2e-report.json');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(
      outPath,
      JSON.stringify(
        { passed: report.filter((r) => r.status === 'PASS').length, total: report.length, report },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify(
        { passed: report.filter((r) => r.status === 'PASS').length, total: report.length, report },
        null,
        2,
      ),
    );

    if (report.some((r) => r.status === 'FAIL')) {
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }
    server.close();
  }
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
