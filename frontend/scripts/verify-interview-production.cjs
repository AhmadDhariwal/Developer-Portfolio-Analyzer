// Synthetic browser journeys against the production bundle. Backend/JWT/Mongo
// contracts are verified separately by the real local integration suites.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { fork } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const origin = 'http://127.0.0.1:4316';
const output = path.resolve(__dirname, '../verification/interview-prep/production-final');
const report = { fixture: true, checks: [], errors: [], screenshots: [] };

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const server = fork(path.join(__dirname, 'interview-prep-preview.cjs'), [], {
    env: { ...process.env, INTERVIEW_PREVIEW_DIST: '1' },
    stdio: 'ignore',
  });
  let browser;
  try {
    for (let i = 0; i < 30; i++) {
      try {
        if ((await fetch(`${origin}/__interview_preview`)).ok) break;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    browser = await chromium.launch({
      headless: true,
      executablePath:
        process.env.INTERVIEW_CHROMIUM_PATH ||
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', (error) => report.errors.push(error.message));
    await page.goto(`${origin}/__interview_preview`);
    await page.goto(`${origin}/app/interview-prep`);
    await page
      .getByRole('heading', { name: /Interview Prep/i })
      .first()
      .waitFor();
    await page.getByRole('button', { name: /Practice studio/i }).click();
    await page.getByRole('button', { name: /Start a saved personalized session/ }).click();
    await page.getByRole('heading', { name: /Question 1 of/ }).waitFor();
    const heading = await page.getByRole('heading', { name: /Question 1 of/ }).innerText();
    const count = Number(heading.match(/of (\d+)/)[1]);
    for (let i = 0; i < count; i++) {
      const response = page.waitForResponse(
        (response) =>
          response.url().endsWith('/progress') && response.request().method() === 'PATCH',
      );
      await page.getByRole('button', { name: 'Review later', exact: true }).click();
      assert.equal((await response).status(), 200);
      await page
        .getByRole('button', { name: 'Review later', exact: true })
        .waitFor({ state: 'visible' });
      if (i < count - 1) await page.getByRole('button', { name: 'Next →', exact: true }).click();
    }
    const complete = page.waitForResponse((response) => response.url().endsWith('/complete'));
    await page.getByRole('button', { name: 'Complete session', exact: true }).click();
    assert.equal((await complete).status(), 200);
    await page.getByRole('button', { name: 'Session completed', exact: true }).waitFor();
    assert.equal(
      await page.getByRole('button', { name: 'Comfortable', exact: true }).isDisabled(),
      true,
    );
    report.checks.push(
      `create → ${count} persisted self-checks → complete; completion locks progress`,
    );
    await page.screenshot({ path: path.join(output, 'desktop-completed.png'), fullPage: true });
    report.screenshots.push('desktop-completed.png');
    await page.getByRole('button', { name: /Sessions & history/ }).click();
    await page
      .getByRole('button', { name: /Practice this session/ })
      .first()
      .waitFor();
    await page
      .getByRole('button', { name: /Practice this session/ })
      .first()
      .click();
    await page.getByRole('button', { name: 'Session completed', exact: true }).waitFor();
    report.checks.push('history → resume preserves completed status and snapshots');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(output, 'mobile-completed.png'), fullPage: true });
    report.screenshots.push('mobile-completed.png');
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1),
      false,
    );
    report.checks.push('390px mobile: no horizontal overflow');
    assert.deepEqual(report.errors, []);
    report.status = 'PASS';
  } catch (error) {
    report.status = 'FAIL';
    report.errors.push(error.stack);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    server.kill();
    fs.writeFileSync(path.join(output, 'browser-results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  }
})();
