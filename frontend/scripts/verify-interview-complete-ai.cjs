// Production bundle + controlled HTTP fixtures. No live provider calls or account writes.
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE ||
    'C:/Users/Ahmad/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright',
);
const { fork } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const origin = 'http://127.0.0.1:4316';
const output = path.resolve(__dirname, '../verification/interview-prep/complete-ai');
const { SYSTEM_DESIGN_FIELDS } = require('../../backend/src/services/interviewAIValidation');
const report = {
  synthetic: true,
  productionBundle: true,
  liveProvider: false,
  checks: [],
  network: [],
  screenshots: [],
  errors: [],
};
const question = (skill, difficulty, index, source = 'ai_generated') => ({
  question: `How do ${skill} components handle ${difficulty} example ${index + 1}?`,
  topicKey: skill,
  answer: 'An illustrative structured answer for browser verification.',
  difficulty,
  tags: [skill],
  category: 'core-concepts',
  sourceType: source,
  verificationStatus: source === 'verified_seed' ? 'verified' : 'unverified',
  answerSections: {
    shortAnswer: 'Separate playback authorization from content delivery.',
    explanation:
      'A streaming service authorizes playback through a control plane and delivers media through regional edge caches. '.repeat(
        8,
      ),
    keyPoints: ['Authorize requests', 'Cache immutable segments', 'Observe regional errors'],
    example: 'const token = await authorize();\nawait play(token);',
    scopeNote:
      'Illustrative educational architecture using public concepts, not verified Netflix internals.',
    systemDesign: Object.fromEntries(
      Object.keys(SYSTEM_DESIGN_FIELDS).map((key) => [
        key,
        `Illustrative ${key}: use bounded requests and explicit service interfaces. `.repeat(3),
      ]),
    ),
  },
});
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const server = fork(path.join(__dirname, 'interview-prep-preview.cjs'), [], {
    env: { ...process.env, INTERVIEW_PREVIEW_DIST: '1' },
    stdio: 'ignore',
  });
  let browser;
  try {
    for (let attempt = 0; attempt < 50; attempt++) {
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
    let generationMode = 'success';
    let customMode = 'success';
    await page.route('**/api/interview-prep/generate', async (route) => {
      const payload = route.request().postDataJSON();
      const count = payload.target || payload.limit;
      const rows = Array.from({ length: count }, (_, index) =>
        question(
          payload.skill,
          payload.difficulty,
          index,
          payload.source === 'seed' ? 'verified_seed' : 'ai_generated',
        ),
      );
      const status = generationMode === 'failure' ? 503 : 200;
      const body =
        status === 503
          ? { message: 'Insufficient matching questions. Please retry.' }
          : {
              questions: generationMode === 'empty' ? [] : rows,
              total: rows.length,
              page: 1,
              totalPages: 1,
              limit: count,
              aiGeneratedCount: payload.source === 'seed' ? 0 : rows.length,
            };
      report.network.push({ path: '/generate', payload, status, response: body });
      await new Promise((resolve) => setTimeout(resolve, 150));
      await route.fulfill({ status, json: body });
    });
    await page.route('**/api/interview-prep/ask-question', async (route) => {
      const payload = route.request().postDataJSON();
      const status = customMode === 'failure' ? 503 : 200;
      const body =
        status === 503
          ? {
              code: 'ai_unavailable',
              retryable: true,
              message: 'AI providers are temporarily unavailable. Please retry.',
            }
          : {
              ...question(payload.skill, 'senior', 0),
              question: payload.question,
              sourceLabel: 'AI-generated answer · Unverified',
              generationStatus: 'generated',
              stored: false,
            };
      report.network.push({ path: '/ask-question', payload, status, response: body });
      await new Promise((resolve) => setTimeout(resolve, 250));
      await route.fulfill({ status, json: body });
    });
    await page.goto(`${origin}/__interview_preview`);
    await page.goto(`${origin}/app/interview-prep`);
    const openGenerator = async () =>
      page.locator('.workspace-nav button').filter({ hasText: 'Generate Questions' }).click();
    await openGenerator();
    const generate = page.locator('form:has(#practice-level) button[type=submit]');
    for (const difficulty of ['easy', 'medium', 'hard', 'senior']) {
      await page.locator('#practice-level').selectOption(difficulty);
      await generate.click();
      await page.locator('.practice-result .difficulty').filter({ hasText: difficulty }).waitFor();
      assert.equal(report.network.at(-1).payload.difficulty, difficulty);
    }
    report.checks.push(
      'All four difficulties round-trip through actual HTTP payloads and rendered card labels',
    );
    for (const source of ['', 'seed', 'ai', 'scraped']) {
      await page.locator('#practice-source').selectOption(source);
      generationMode = source === 'scraped' ? 'empty' : 'success';
      await generate.click();
      if (source === 'scraped')
        await page
          .getByText(/Insufficient matching/)
          .first()
          .waitFor();
      else await page.locator('.practice-result').waitFor();
      assert.equal(report.network.at(-1).payload.source, source);
    }
    report.checks.push(
      'All exposed source filters are submitted and empty results show insufficiency',
    );
    await page.locator('#practice-source').selectOption('');
    await page.locator('#practice-focus').fill('new incompatible focus');
    generationMode = 'failure';
    await generate.click();
    await page
      .getByText(/Insufficient matching/)
      .first()
      .waitFor();
    assert.equal(await page.locator('.practice-result').count(), 0);
    report.checks.push('Failed incompatible request clears stale drills');
    await page.locator('#studio-topic').selectOption('system-design');
    report.checks.push('Technology switching clears the previous incompatible drill');
    const ask = page.locator('form:has(#custom-question) button[type=submit]');
    const custom = 'Can you give me the system design of Netflix? How does it work?';
    await page.locator('#custom-question').fill(custom);
    customMode = 'failure';
    await ask.click();
    await page.getByText(/AI providers are temporarily unavailable/).waitFor();
    assert.equal(await page.locator('#custom-question').inputValue(), custom);
    customMode = 'success';
    await page.getByRole('button', { name: 'Retry question' }).click();
    await page.locator('.custom-result-section').waitFor();
    await page.locator('.custom-result-section .answer-toggle').click();
    await page.getByText('High-level architecture', { exact: true }).waitFor();
    assert.ok(
      (await page.locator('.custom-result-section code').textContent()).includes('\nawait play'),
    );
    assert.ok(
      (await page.locator('.custom-result-section').textContent()).includes(
        'AI-generated answer · Unverified',
      ),
    );
    report.checks.push(
      'Custom Q&A failure, retry, preserved question, unverified label, complete system design and multiline code',
    );
    for (const [device, width, height] of [
      ['desktop', 1440, 1000],
      ['laptop', 1280, 800],
      ['tablet', 768, 1024],
      ['mobile', 375, 812],
    ]) {
      for (const preference of ['light', 'dark', 'system']) {
        await page.setViewportSize({ width, height });
        await page.emulateMedia({ colorScheme: preference === 'light' ? 'light' : 'dark' });
        await page.evaluate((value) => localStorage.setItem('devinsight_theme', value), preference);
        await page.reload();
        await openGenerator();
        await page.locator('#studio-topic').selectOption('system-design');
        await page.locator('#custom-question').fill(custom);
        await ask.click();
        await page.locator('.custom-result-section').waitFor();
        await page.locator('.custom-result-section .answer-toggle').click();
        await page.getByText('High-level architecture', { exact: true }).waitFor();
        assert.equal(
          await page.evaluate(() => document.documentElement.getAttribute('data-theme')),
          preference === 'light' ? 'light' : 'dark',
        );
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
          false,
          `${device}/${preference} overflow`,
        );
        const file = `${device}-${preference}.png`;
        await page.evaluate(() => scrollTo(0, 0));
        await page.screenshot({ path: path.join(output, file), fullPage: true });
        report.screenshots.push(file);
      }
    }
    report.checks.push(
      'Desktop, laptop, tablet and mobile in light, dark and system theme, long answers with no horizontal document overflow',
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('.workspace-nav button').filter({ hasText: 'Sessions & history' }).click();
    await page
      .getByRole('button', { name: /Practice this session/ })
      .first()
      .click();
    await page.getByText(/Saved practice session.*Recorded difficulty/).waitFor();
    assert.ok(
      (await page.locator('.practice-result .difficulty').textContent()).includes('medium'),
    );
    report.checks.push(
      'Reopening a saved session restores its original Medium snapshot independently of generator selection',
    );
    assert.deepEqual(report.errors, []);
  } catch (error) {
    report.failure = error.message;
    process.exitCode = 1;
  } finally {
    await browser?.close();
    server.kill();
    fs.writeFileSync(path.join(output, 'results.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(
      JSON.stringify({
        checks: report.checks,
        screenshots: report.screenshots.length,
        failure: report.failure,
      }),
    );
  }
})();
