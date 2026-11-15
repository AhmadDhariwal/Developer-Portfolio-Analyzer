const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

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
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

const VIEWPORTS = [
  { name: 'mobile-320', width: 320, height: 568, category: 'Mobile' },
  { name: 'mobile-375', width: 375, height: 812, category: 'Mobile' },
  { name: 'mobile-390', width: 390, height: 844, category: 'Mobile' },
  { name: 'mobile-430', width: 430, height: 932, category: 'Mobile' },
  { name: 'tablet-768', width: 768, height: 1024, category: 'Tablet' },
  { name: 'tablet-820', width: 820, height: 1180, category: 'Tablet' },
  { name: 'tablet-1024', width: 1024, height: 1366, category: 'Tablet' },
  { name: 'laptop-1280', width: 1280, height: 800, category: 'Laptop' },
  { name: 'laptop-1366', width: 1366, height: 768, category: 'Laptop' },
  { name: 'desktop-1440', width: 1440, height: 900, category: 'Desktop' },
  { name: 'desktop-1920', width: 1920, height: 1080, category: 'Desktop' },
  { name: 'ultrawide-2560', width: 2560, height: 1440, category: 'Ultra-wide' },
];

const LANDSCAPE_VIEWPORTS = [
  { name: 'mobile-landscape-667x375', width: 667, height: 375, category: 'Mobile Landscape' },
  { name: 'tablet-landscape-1024x768', width: 1024, height: 768, category: 'Tablet Landscape' },
];

const THEMES = ['dark', 'light', 'system'];

const ROUTES = [
  { key: 'landing', path: '/' },
  { key: 'api-docs', path: '/api-docs' },
  { key: 'blog', path: '/blog' },
  { key: 'contact', path: '/contact' },
  { key: 'privacy', path: '/privacy' },
  { key: 'terms', path: '/terms' },
  { key: 'login', path: '/auth/login' },
  { key: 'signup', path: '/auth/signup' },
  { key: 'forgot-password', path: '/auth/forgot-password' },
  {
    key: 'otp-verification',
    path: '/auth/otp-verification?purpose=signup&type=email&email=ahmad%40example.com',
  },
  { key: 'reset-password', path: '/auth/reset-password' },
  { key: 'oauth-callback', path: '/auth/oauth/callback?oauthError=oauth_failed' },
];

function startStaticServer(rootDir) {
  const indexPath = path.join(rootDir, 'index.html');
  if (!fs.existsSync(indexPath)) {
    throw new Error(`Built frontend not found at ${indexPath}`);
  }

  const server = http.createServer((req, res) => {
    const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
    let pathname = decodeURIComponent(reqUrl.pathname);

    if (pathname.startsWith('/api/')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Not mocked in static audit server' }));
      return;
    }

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

async function applyThemePreference(page, theme) {
  const colorScheme = theme === 'dark' ? 'dark' : theme === 'light' ? 'light' : 'dark';
  await page.emulateMedia({ colorScheme });
  await page.addInitScript((pref) => {
    try {
      localStorage.setItem('devinsight_theme', pref);
      localStorage.setItem('landing-theme', pref);
    } catch {
      // ignore storage errors
    }
  }, theme);
}

async function collectLayoutMetrics(page) {
  return page.evaluate(() => {
    const docEl = document.documentElement;
    const body = document.body;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const scrollW = docEl.scrollWidth;
    const clientW = docEl.clientWidth;
    const horizontalOverflow = scrollW - clientW;

    const overflowOffenders = [];
    const clippedOrSmallControls = [];
    const primaryControls = document.querySelectorAll(
      'button:not([hidden]), a.btn-primary, a.btn-secondary, a.btn-nav-primary, a.btn-nav-ghost, a.nav-cta, input, select',
    );

    for (const el of primaryControls) {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')
        continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;

      if (rect.right > vw + 1 || rect.left < -1) {
        overflowOffenders.push({
          tag: el.tagName,
          className: el.className?.toString().slice(0, 60) || '',
          text: (el.textContent || '').trim().slice(0, 40),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          vw,
        });
      }

      const inputType =
        el.tagName === 'INPUT' ? (el.getAttribute('type') || 'text').toLowerCase() : '';
      const isTextOrSelectInput =
        (el.tagName === 'INPUT' && inputType !== 'checkbox' && inputType !== 'radio') ||
        el.tagName === 'SELECT';

      const isDesktopHeaderLink = vw >= 1024 && !!el.closest('header');
      const isPrimaryAction =
        !isDesktopHeaderLink &&
        (isTextOrSelectInput ||
          el.classList.contains('btn-primary') ||
          el.classList.contains('btn-secondary') ||
          el.classList.contains('oauth-btn') ||
          el.classList.contains('submit-btn') ||
          el.classList.contains('mobile-menu-toggle'));

      if (isPrimaryAction && rect.height < 44) {
        clippedOrSmallControls.push({
          tag: el.tagName,
          className: el.className?.toString().slice(0, 60) || '',
          text: (el.textContent || '').trim().slice(0, 40),
          height: Math.round(rect.height),
          width: Math.round(rect.width),
        });
      }
    }

    const header = document.querySelector('header, .landing-nav, .auth-topbar');
    const headerRect = header ? header.getBoundingClientRect() : null;

    return {
      vw,
      vh,
      scrollW,
      clientW,
      horizontalOverflow,
      dataTheme: docEl.getAttribute('data-theme'),
      bodyThemeClass: body.className,
      overflowOffendersCount: overflowOffenders.length,
      overflowOffenders: overflowOffenders.slice(0, 5),
      smallPrimaryControlsCount: clippedOrSmallControls.length,
      smallPrimaryControls: clippedOrSmallControls.slice(0, 5),
      headerHeight: headerRect ? Math.round(headerRect.height) : null,
    };
  });
}

async function runAudit(mode) {
  const phase = mode === 'before' ? 'before' : 'after';
  const outDir = path.resolve(__dirname, `../verification/public-auth/${phase}`);
  fs.mkdirSync(outDir, { recursive: true });

  const { server, baseUrl } = await startStaticServer(DIST_DIR);
  const browser = await chromium.launch({
    headless: true,
    executablePath: fs.existsSync(CHROME_PATH) ? CHROME_PATH : undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  const results = [];
  const consoleErrors = [];
  const pageErrors = [];

  try {
    const viewportsToRun =
      phase === 'before'
        ? [
            { name: 'mobile-375', width: 375, height: 812, category: 'Mobile' },
            { name: 'desktop-1440', width: 1440, height: 900, category: 'Desktop' },
          ]
        : [...VIEWPORTS, ...LANDSCAPE_VIEWPORTS];

    const themesToRun = phase === 'before' ? ['dark', 'light'] : THEMES;

    for (const theme of themesToRun) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();

      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          consoleErrors.push({ theme, text: msg.text() });
        }
      });
      page.on('pageerror', (err) => {
        pageErrors.push({ theme, text: err.message });
      });

      await applyThemePreference(page, theme);

      for (const route of ROUTES) {
        for (const vp of viewportsToRun) {
          await page.setViewportSize({ width: vp.width, height: vp.height });
          await page.goto(`${baseUrl}${route.path}`, { waitUntil: 'networkidle' });
          await page.waitForTimeout(200);

          const metrics = await collectLayoutMetrics(page);
          results.push({
            route: route.key,
            path: route.path,
            theme,
            viewport: vp.name,
            width: vp.width,
            height: vp.height,
            ...metrics,
          });

          const shouldCapture =
            (vp.name === 'desktop-1440' && (theme === 'light' || theme === 'dark')) ||
            (vp.name === 'mobile-375' && (theme === 'light' || theme === 'dark')) ||
            (phase === 'after' && vp.name === 'mobile-320' && theme === 'light') ||
            (phase === 'after' &&
              vp.name === 'ultrawide-2560' &&
              theme === 'dark' &&
              route.key === 'landing');

          if (shouldCapture) {
            const shotPath = path.join(outDir, `${route.key}__${vp.name}__${theme}.png`);
            await page.screenshot({
              path: shotPath,
              fullPage: route.key === 'landing' && vp.name === 'desktop-1440' ? false : true,
            });
          }
        }
      }

      if (phase === 'after' && theme === 'light') {
        // Test 200% zoom on mobile-390 & desktop-1280 for Login & Landing
        for (const vp of [
          { name: 'zoom200-390', width: 390, height: 844 },
          { name: 'zoom200-1280', width: 1280, height: 800 },
        ]) {
          await page.setViewportSize({ width: vp.width, height: vp.height });
          for (const r of [ROUTES[0], ROUTES[1], ROUTES[2], ROUTES[5]]) {
            await page.goto(`${baseUrl}${r.path}`, { waitUntil: 'networkidle' });
            await page.evaluate(() => {
              document.documentElement.style.zoom = '2';
            });
            await page.waitForTimeout(150);
            const metrics = await collectLayoutMetrics(page);
            results.push({
              route: r.key,
              path: r.path,
              theme: `${theme}-zoom200`,
              viewport: vp.name,
              width: vp.width,
              height: vp.height,
              ...metrics,
            });
            await page.evaluate(() => {
              document.documentElement.style.zoom = '';
            });
          }
        }
      }

      await context.close();
    }

    const overflowFailures = results.filter((r) => r.horizontalOverflow > 1);
    const smallTouchFailures = results.filter((r) => r.smallPrimaryControlsCount > 0);

    const summary = {
      phase,
      totalChecks: results.length,
      overflowFailuresCount: overflowFailures.length,
      overflowFailures: overflowFailures.slice(0, 20),
      smallTouchFailuresCount: smallTouchFailures.length,
      smallTouchFailures: smallTouchFailures.slice(0, 20),
      consoleErrorsCount: consoleErrors.length,
      consoleErrors: consoleErrors.slice(0, 10),
      pageErrorsCount: pageErrors.length,
      pageErrors: pageErrors.slice(0, 10),
      results,
    };

    fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(summary, null, 2));
    console.log(
      JSON.stringify(
        {
          phase,
          totalChecks: summary.totalChecks,
          overflowFailuresCount: summary.overflowFailuresCount,
          smallTouchFailuresCount: summary.smallTouchFailuresCount,
          consoleErrorsCount: summary.consoleErrorsCount,
          pageErrorsCount: summary.pageErrorsCount,
          reportPath: path.join(outDir, 'report.json'),
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }
    server.close();
  }
}

const mode = process.argv[2] || 'after';
runAudit(mode).catch((err) => {
  console.error(err);
  process.exit(1);
});
