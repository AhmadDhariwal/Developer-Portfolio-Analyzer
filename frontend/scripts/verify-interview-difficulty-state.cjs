const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE ||
    'C:/Users/Ahmad/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright',
);
const { fork } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const origin = 'http://127.0.0.1:4316';
const output = path.resolve(
  __dirname,
  '../verification/interview-prep/difficulty-state-2026-11-15',
);
const report = {
  synthetic: true,
  authenticatedAccount: false,
  checks: [],
  network: [],
  screenshots: [],
};
(async () => {
  fs.mkdirSync(output, { recursive: true });
  let server, browser;
  try {
    try {
      assert.ok((await fetch(`${origin}/__interview_preview`)).ok);
    } catch {
      server = fork(path.join(__dirname, 'interview-prep-preview.cjs'), [], {
        env: { ...process.env, INTERVIEW_PREVIEW_DIST: '1' },
        stdio: 'ignore',
      });
    }
    for (let i = 0; i < 50; i++) {
      try {
        if ((await fetch(`${origin}/__interview_preview`)).ok) break;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    browser = await chromium.launch({
      headless: true,
      executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${origin}/__interview_preview`);
    const row = (level, skill) => ({
      question: `Explain React state at ${level} level?`,
      answer:
        'State tracks component data. Updates schedule a render, and React applies the resulting changes to the DOM.',
      difficulty: level,
      topicKey: skill,
      sourceType: 'verified_seed',
      verificationStatus: 'verified',
      tags: ['react'],
    });
    let mode = 'medium';
    await page.route('**/api/interview-prep/generate', async (route) => {
      const payload = route.request().postDataJSON();
      const questions = mode === 'empty' ? [] : [row(mode, payload.skill)];
      report.network.push({
        url: route.request().url(),
        method: 'POST',
        payload,
        response: { questions },
      });
      await route.fulfill({
        json: {
          questions,
          total: questions.length,
          page: 1,
          limit: payload.target,
          totalPages: 1,
          aiGeneratedCount: 0,
        },
      });
    });
    await page.goto(`${origin}/app/interview-prep`);
    await page.locator('.workspace-nav button').filter({ hasText: 'Generate Questions' }).click();
    const generate = page.locator('form:has(#practice-level) button[type=submit]');
    await generate.click();
    await page.locator('.practice-result .difficulty').filter({ hasText: 'medium' }).waitFor();
    await page.screenshot({ path: path.join(output, 'before-medium-drill.png'), fullPage: true });
    report.screenshots.push('before-medium-drill.png');
    await page.locator('#practice-level').selectOption('easy');
    await page.getByText(/Previous drill cleared/).waitFor();
    assert.equal(await page.locator('.practice-result').count(), 0);
    report.checks.push('Easy selection clears previously loaded Medium library drill');
    await page.screenshot({
      path: path.join(output, 'easy-selection-cleared.png'),
      fullPage: true,
    });
    report.screenshots.push('easy-selection-cleared.png');
    await generate.click();
    await page.getByText(/returned questions did not match/).waitFor();
    assert.equal(await page.locator('.practice-result').count(), 0);
    assert.equal(report.network.at(-1).payload.difficulty, 'easy');
    assert.equal(report.network.at(-1).response.questions[0].difficulty, 'medium');
    report.checks.push(
      'Actual Easy HTTP payload with deliberately Medium fixture response is rejected',
    );
    await page.screenshot({
      path: path.join(output, 'easy-medium-response-rejected.png'),
      fullPage: true,
    });
    report.screenshots.push('easy-medium-response-rejected.png');
    mode = 'easy';
    await generate.click();
    await page.locator('.practice-result .difficulty').filter({ hasText: 'easy' }).waitFor();
    await page.getByText(/Existing library question set · Recorded difficulty: easy/).waitFor();
    report.checks.push(
      'Easy response retains actual Easy difficulty and Verified library metadata',
    );
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.screenshot({
        path: path.join(output, `easy-result-${width}.png`),
        fullPage: true,
      });
      report.screenshots.push(`easy-result-${width}.png`);
    }
    await page.locator('#practice-level').selectOption('medium');
    const savedResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/interview-prep',
    );
    await page.getByRole('button', { name: /Start a saved personalized session/ }).click();
    const saved = await savedResponse;
    report.network.push({
      url: saved.url(),
      method: 'POST',
      payload: saved.request().postDataJSON(),
      response: await saved.json(),
    });
    await page.getByText(/Saved practice session · Recorded difficulty: medium/).waitFor();
    await page.locator('#practice-level').selectOption('easy');
    assert.equal(await page.locator('.practice-result').count(), 0);
    report.checks.push(
      'Saved Medium session is explicitly labeled and cleared before Easy generation',
    );
    mode = 'empty';
    await generate.click();
    await page.getByText(/Insufficient matching easy questions/).waitFor();
    assert.equal(await page.locator('.practice-result').count(), 0);
    report.checks.push(
      'Empty Easy response shows explicit insufficient-results state without restoring the saved Medium drill',
    );
    assert.deepEqual(errors, []);
    report.status = 'PASS';
  } catch (error) {
    report.status = 'FAIL';
    report.error = error.stack;
    process.exitCode = 1;
  } finally {
    await browser?.close();
    if (server) server.kill();
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
    console.log(
      JSON.stringify({ status: report.status, checks: report.checks, error: report.error, output }),
    );
  }
})();
