// Production bundle and explicit deterministic HTTP fixtures only. No live AI,
// credentials, account writes, installation commands or external service calls.
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE ||
    'C:/Users/Ahmad/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright',
);
const { fork } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const origin = 'http://127.0.0.1:4322';
const output = path.resolve(__dirname, '../../backend/verification/interview-prep/answer-coverage');
const report = {
  synthetic: true,
  liveProvider: false,
  productionBundle: true,
  checks: [],
  network: [],
  screenshots: [],
  errors: [],
};
const text = 'Tell me about Redis and also tell me how to use local Redis.';
const answer = {
  question: text,
  answer: 'Deterministic practical Redis guide for UI verification.',
  topicKey: 'redis',
  difficulty: 'medium',
  category: 'core-concepts',
  tags: ['redis'],
  sourceType: 'ai_generated',
  verificationStatus: 'unverified',
  sessionId: 'coverage-private',
  sourceMeta: { mode: 'custom-question', answerQuality: { version: 1 } },
  answerSections: {
    shortAnswer:
      'Redis is an in-memory data store used for caching and other fast data access patterns.',
    explanation:
      '# Prerequisites\nUse an Ubuntu/WSL terminal for this general example; service status is not verified.\n# Install locally\n1. Install the package.\n2. Start the server.\n3. Verify a client connection.\n```sh\nsudo apt update\nsudo apt install redis-server\nsudo service redis-server start\nredis-cli ping\n# Expected output: PONG\n```\n# Try CLI operations\n```sh\nredis-cli SET demo hello\nredis-cli GET demo\n# Expected output: hello\n```',
    keyPoints: [
      'Install and start the server',
      'Verify a connection',
      'Configure and test the application client',
    ],
    example:
      '## Application integration\nInstall the declared client dependency and adapt the endpoint to your environment.\n```js\nimport { createClient } from "redis";\nconst client = createClient({ url: "redis://127.0.0.1:6379" });\nclient.on("error", console.error);\nawait client.connect();\nconsole.log(await client.ping()); // PONG\nawait client.quit();\n```',
    realWorldUseCase:
      'Use a local cache while developing an application; this fixture does not execute or verify the commands.',
    commonMistakes: [
      'Connection refused: check the server, address and port.',
      'Check the network boundary between the application and WSL/container.',
    ],
    interviewTip: 'Separate the server lifecycle from application client integration.',
  },
};
(async () => {
  let browser;
  const server = fork(path.join(__dirname, 'interview-prep-preview.cjs'), [], {
    env: { ...process.env, INTERVIEW_PREVIEW_DIST: '1', INTERVIEW_PREVIEW_PORT: '4322' },
    stdio: 'ignore',
  });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        ready = (await fetch(`${origin}/__interview_preview`)).ok;
      } catch {}
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(ready);
    browser = await chromium.launch({
      headless: true,
      executablePath:
        process.env.INTERVIEW_CHROMIUM_PATH ||
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', (error) => report.errors.push(error.message));
    let mode = 'failure';
    await page.route('**/api/interview-prep/ask-question', async (route) => {
      const request = route.request().postDataJSON();
      const status = mode === 'failure' ? 503 : 200;
      const response =
        status === 503
          ? {
              code: 'invalid_ai_answer',
              generationStatus: 'invalid_response',
              retryable: true,
              message:
                'The answer could not cover every part of your request. Please retry or narrow the question.',
            }
          : answer;
      report.network.push({ request, status, response });
      await new Promise((resolve) => setTimeout(resolve, 150));
      await route.fulfill({ status, json: response });
    });
    const session = {
      _id: 'coverage-private',
      kind: 'custom',
      topicKey: 'redis',
      questions: [answer],
      createdAt: new Date().toISOString(),
    };
    await page.route('**/api/interview-prep/history*', (route) =>
      route.fulfill({ json: { sessions: [session] } }),
    );
    await page.route('**/api/interview-prep/sessions/coverage-private', (route) =>
      route.fulfill({ json: session }),
    );
    await page.goto(`${origin}/__interview_preview`);
    await page.goto(`${origin}/app/interview-prep`);
    await page.locator('.workspace-nav button').filter({ hasText: 'Generate Questions' }).click();
    await page.locator('#studio-topic').selectOption('redis');
    await page.locator('#custom-question').fill(text);
    const ask = page.locator('form:has(#custom-question) button[type=submit]');
    await ask.click();
    await page
      .getByText(
        'The answer could not cover every part of your request. Please retry or narrow the question.',
        { exact: true },
      )
      .waitFor();
    assert.equal(await page.locator('.custom-result-section').count(), 0);
    mode = 'complete';
    await page.getByRole('button', { name: 'Retry question' }).click();
    const card = page.locator('.custom-result-section app-interview-question-card');
    await card.waitFor();
    await card.getByRole('button', { name: 'Reveal answer', exact: false }).click();
    await card.locator('h5').filter({ hasText: 'Install locally' }).waitFor();
    const code = await card.locator('code').allTextContents();
    assert.ok(code.some((value) => value.includes('redis-cli ping\n# Expected output: PONG')));
    assert.ok(code.some((value) => value.includes('await client.connect();\n')));
    assert.match(await card.locator('.source').innerText(), /unverified/i);
    assert.equal(report.network.at(-1).request.skill, 'redis');
    assert.equal(report.network.at(-1).request.question, text);
    await page.screenshot({ path: path.join(output, 'coverage-desktop.png'), fullPage: true });
    report.screenshots.push('coverage-desktop.png');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(
      () => document.querySelector('.shell-body')?.getBoundingClientRect().left === 0,
    );
    report.mobile = await page.evaluate(() => ({
      viewport: innerWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    assert.ok(report.mobile.scroll <= report.mobile.viewport + 1);
    await page.screenshot({ path: path.join(output, 'coverage-mobile.png'), fullPage: true });
    report.screenshots.push('coverage-mobile.png');
    await page.locator('.workspace-nav button').filter({ hasText: 'Sessions' }).click();
    await page.getByText(text, { exact: true }).first().click();
    await page.locator('.session-detail').waitFor();
    await page.locator('.session-detail .answer-toggle').first().click();
    await page.locator('.session-detail h5').filter({ hasText: 'Install locally' }).waitFor();
    report.checks = [
      'Exact selected technology and custom text submitted',
      'Incomplete coverage shows honest error and retry',
      'All command/code/expected-output lines rendered safely',
      'Private saved answer reopens with full structured content',
      'Desktop and 390px mobile fit without page overflow',
    ];
    assert.deepEqual(report.errors, []);
    report.passed = true;
  } catch (error) {
    report.passed = false;
    report.failure = error.message;
    process.exitCode = 1;
  } finally {
    await browser?.close();
    server.kill();
    fs.writeFileSync(
      path.join(output, 'browser-fixtures.json'),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    console.log(
      JSON.stringify({ passed: report.passed, failure: report.failure, checks: report.checks }),
    );
  }
})();
