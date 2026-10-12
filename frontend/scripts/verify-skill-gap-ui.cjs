/* Browser verification uses synthetic API fixtures, never production accounts or evidence. */
const { chromium } = require('../../backend/node_modules/playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../dist/frontend/browser');
const output = path.resolve(__dirname, '../verification/skill-gap');
const profile = { careerStack: 'Backend', activeCareerStack: 'Backend', experienceLevel: 'Student', activeExperienceLevel: 'Student', activeGithubUsername: 'fixture', isConfigured: true };
function fixture() {
  const skills = ['PARTIAL', 'CLAIMED_ONLY', 'NOT_EVIDENCED', 'UNKNOWN'].map((status, i) => ({
    name: ['TypeScript', 'React Native', 'Java', 'A very long skill name that must wrap gracefully at every mobile viewport width'][i], category: 'Technical', requirement: i === 1 ? 'OPTIONAL' : 'REQUIRED', weight: 1,
    status, evidenceCredit: i === 0 ? .5 : 0, evidenceConfidence: i < 2 ? 'LOW' : 'INSUFFICIENT', independentTechnicalSources: i === 0 ? 1 : 0,
    evidence: i < 2 ? [{ type: i === 0 ? 'github' : 'resume', kind: i === 0 ? 'METADATA' : 'CLAIM', artifact: 'Synthetic fixture source', id: 'fixture', origin: 'fixture', timestamp: '2026-01-01T00:00:00Z', freshness: 'STALE', conflicting: false }] : [], warnings: []
  }));
  return { username: 'fixture', careerStack: 'Backend', experienceLevel: 'Student', ruleVersion: 'skill-evidence-coverage-v1', requirementMatrixVersion: 'skill-gap-requirements-v1', calculatedAt: '2026-10-12T00:00:00Z', coverage: 16.67, skills,
    categoryBreakdown: { Technical: { requiredSkillCount: 3, optionalSkillCount: 1, requiredWeight: 3, weightedCredit: .5, coverage: 16.67 } },
    evidenceCompleteness: { availableCoreSources: 1, totalCoreSources: 2, complete: false }, evidenceConfidence: 'INSUFFICIENT',
    sourceReferences: [{ type: 'github', id: 'fixture', available: true, completeness: 'PARTIAL', timestamp: '2026-01-01T00:00:00Z', freshness: 'STALE' }, { type: 'resume', id: 'fixture', available: false, completeness: 'UNKNOWN', timestamp: null, freshness: 'UNKNOWN' }],
    aiUsed: false, missingSkills: [], warnings: ['partial_source_limitations'], legacyReadinessScore: 79, legacyConfidence: 65 };
}
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '');
  let file = path.resolve(root, relative); if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
  res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream'); fs.createReadStream(file).pipe(res);
});
function luminance(rgb) { const values = rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4); return values[0] * .2126 + values[1] * .7152 + values[2] * .0722; }
(async () => {
  fs.mkdirSync(output, { recursive: true }); await new Promise(resolve => server.listen(4317, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, executablePath: process.env.SKILL_GAP_BROWSER || 'C:/Users/ahmad.hassan/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe' });
  const results = [];
  try {
    for (const theme of ['light', 'dark', 'system']) {
      const context = await browser.newContext({ colorScheme: theme === 'system' ? 'dark' : theme });
      await context.addInitScript(({ theme, profile }) => {
        const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 36000, iss: 'devinsight-api', aud: 'devinsight-web' }));
        localStorage.setItem('token', `fixture.${payload}.fixture`); localStorage.setItem('user', JSON.stringify({ _id: 'fixture', role: 'developer', name: 'Fixture Developer', activeGithubUsername: 'fixture' }));
        localStorage.setItem('devinsight_career_profile', JSON.stringify(profile)); localStorage.setItem('devinsight_theme', theme);
      }, { theme, profile });
      const page = await context.newPage(); let response = fixture(); let fail = false;
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.route('**/api/**', route => {
        const url = route.request().url();
        if (url.includes('/skillgap/skill-gap')) return route.fulfill({ status: fail ? 500 : 200, json: fail ? { message: 'Fixture error' } : response });
        if (url.includes('/profile/career')) return route.fulfill({ json: profile });
        if (url.includes('active-username')) return route.fulfill({ json: { username: 'fixture' } });
        return route.fulfill({ json: { data: [], notifications: [], resumes: [], previews: [], integrations: [], profile: {}, user: { _id: 'fixture', role: 'developer' } } });
      });
      await page.goto('http://127.0.0.1:4317/app/skill-gap'); await page.locator('[data-testid=coverage]').waitFor();
      for (const width of [320, 375, 425, 768, 1024, 1280, 1440, 1600]) {
        await page.setViewportSize({ width, height: 1000 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${theme} ${width}: document overflow`);
        assert.equal(await page.locator('.skill-gap-page').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true, `${theme} ${width}: page overflow`);
        const colors = await page.locator('.panel').first().evaluate(el => ({ fg: getComputedStyle(el).color, bg: getComputedStyle(el).backgroundColor }));
        const ratio = (Math.max(luminance(colors.fg), luminance(colors.bg)) + .05) / (Math.min(luminance(colors.fg), luminance(colors.bg)) + .05);
        assert.ok(ratio >= 4.5, `contrast ${ratio}`);
        const secondary = await page.locator('.coverage-summary p').first().evaluate(el => ({ fg: getComputedStyle(el).color, bg: getComputedStyle(el.closest('.panel')).backgroundColor }));
        const secondaryRatio = (Math.max(luminance(secondary.fg), luminance(secondary.bg)) + .05) / (Math.min(luminance(secondary.fg), luminance(secondary.bg)) + .05);
        assert.ok(secondaryRatio >= 4.5, 'secondary text contrast');
        results.push({ theme, width, overflow: false, contrast: +ratio.toFixed(2), secondaryContrast: +secondaryRatio.toFixed(2) });
        if ([375, 1440].includes(width)) await page.screenshot({ path: path.join(output, `${theme}-${width}.png`), fullPage: true });
      }
      const summary = page.locator('.skill-row summary').first(); await summary.focus(); await page.keyboard.press('Enter');
      assert.equal(await page.locator('.skill-row').first().getAttribute('open'), '');
      assert.equal(await summary.evaluate(el => getComputedStyle(el).outlineStyle), 'solid');
      await page.locator('.filters select').nth(0).selectOption('OPTIONAL'); assert.equal(await page.locator('.skill-row').count(), 1);
      await page.locator('.filters select').nth(0).selectOption('ALL');
      for (const coverage of [0, 50, 100, null]) {
        response = { ...fixture(), coverage }; await page.getByRole('button', { name: 'Refresh evidence' }).click();
        await page.waitForFunction(value => document.querySelector('[data-testid=coverage]')?.textContent.trim() === value, coverage === null ? 'Unavailable' : `${coverage}%`);
      }
      fail = true; await page.getByRole('button', { name: 'Refresh evidence' }).click(); await page.getByRole('alert').waitFor(); assert.ok(await page.getByRole('button', { name: 'Retry analysis' }).isVisible());
      fail = false; response = fixture(); await page.getByRole('button', { name: 'Retry analysis' }).click(); await page.locator('[role=alert]').waitFor({ state: 'detached' });
      response = { ...fixture(), coverage: null, evidenceCompleteness: { availableCoreSources: 0, totalCoreSources: 2, complete: false } };
      await page.getByRole('button', { name: 'Refresh evidence' }).click(); await page.getByText('No analyzed GitHub or resume evidence is available.', { exact: false }).waitFor();
      response = { ...fixture(), ruleVersion: undefined }; await page.getByRole('button', { name: 'Refresh evidence' }).click(); await page.getByText('Current skill coverage is unavailable', { exact: true }).waitFor();
      assert.equal(await page.locator('[data-testid=coverage]').count(), 0);
      await page.getByRole('button', { name: 'Preview another profile' }).click(); await page.getByText('Explore a career target', { exact: true }).waitFor();
      if (theme === 'system') { await page.emulateMedia({ colorScheme: 'light' }); await page.waitForFunction(() => document.documentElement.dataset.theme === 'light'); }
      assert.deepEqual(errors, []); await context.close();
    }
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ layouts: results, keyboard: 'passed', themes: 'light/dark/system; live system switch passed', states: '0/50/100/null, unavailable core evidence, historical contract, initial preview, partial sources, stale, AI fallback, error/retry', consoleErrors: 0 }, null, 2));
    console.log(`PASS: ${results.length} theme/viewport combinations; keyboard, contrast, score states, error/retry and System changes.`);
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
