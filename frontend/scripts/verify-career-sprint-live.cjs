// Real loopback Express/JWT/Mongo flows. No HTTP route interception.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const sessionPath = path.resolve(
  __dirname,
  '../../backend/verification/career-sprint/final-e2e/browser-session.json',
);
const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
assert.match(session.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
const output = path.resolve(__dirname, '../verification/career-sprint/final-e2e');
fs.mkdirSync(output, { recursive: true });
const report = { checks: [], screenshots: [], failures: [] };
const call = async (route, method = 'GET', body) => {
  const response = await fetch(`${session.origin}/api${route}`, {
    method,
    headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
};
const check = async (name, work) => {
  try {
    report.checks.push({ name, status: 'PASS', detail: await work() });
  } catch (error) {
    report.checks.push({ name, status: 'FAIL', message: error.message });
  }
};
const main = async () => {
  await check('real deterministic/AI fallback and persisted selective/bulk imports', async () => {
    const current = (await call('/career-sprints/current')).body;
    const input = { stack: 'Frontend', technology: 'React', experienceLevel: 'Intern' };
    const deterministic = await call('/career-sprints/generate-plan', 'POST', input);
    assert.equal(deterministic.status, 200);
    assert.ok(deterministic.body.tasks.length >= 6);
    const existingTitles = new Set(current.tasks.map((task) => task.title.toLowerCase()));
    assert.ok(
      deterministic.body.tasks.every((task) => !existingTitles.has(task.title.toLowerCase())),
    );
    const ai = await call('/career-sprints/generate-ai-plan', 'POST', input);
    assert.equal(ai.status, 200);
    const planName = `Real persisted preview ${Date.now()}`;
    const saved = await call(`/career-sprints/${current._id}/ai-plans`, 'POST', {
      name: planName,
      tasks: deterministic.body.tasks,
    });
    report.planningStages = {
      deterministicCount: deterministic.body.tasks.length,
      save: saved.status,
    };
    assert.equal(saved.status, 200);
    const plan = saved.body.aiPlans.find((p) => p.name === planName);
    const route = `/career-sprints/${current._id}/ai-plans/${plan._id}/tasks`;
    let selective = await call(route, 'POST', { taskIndexes: [0] });
    report.planningStages.selective = selective;
    const acknowledgement = {};
    if (selective.status === 409) {
      const fresh = (await call('/career-sprints/current')).body.aiPlans.find(
        (p) => p._id === plan._id,
      );
      assert.equal(fresh.compatibility.requiresAcknowledgement, true);
      assert.equal(
        (await call(route, 'POST', { taskIndexes: [0], acknowledgeContextFingerprint: 'stale' }))
          .status,
        409,
      );
      acknowledgement.acknowledgeContextFingerprint = fresh.compatibility.currentFingerprint;
      selective = await call(route, 'POST', { taskIndexes: [0], ...acknowledgement });
      report.planningStages.acknowledgedSelective = selective.status;
    }
    assert.equal(selective.status, 200);
    const bulkIndexes = deterministic.body.tasks.slice(0, 3).map((_, index) => index);
    const bulk = await call(route, 'POST', { taskIndexes: bulkIndexes, ...acknowledgement });
    report.planningStages.bulk = bulk.status;
    assert.equal(bulk.status, 200);
    const count = bulk.body.tasks.length;
    const replay = await call(route, 'POST', { taskIndexes: bulkIndexes, ...acknowledgement });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.tasks.length, count);
    assert.equal(replay.body.xpPoints, current.xpPoints);
    return {
      deterministic: deterministic.body.planMeta,
      ai: ai.body.planMeta,
      importedTaskCount: count - current.tasks.length,
    };
  });
  await check('real Recommendations context and handoff replay', async () => {
    const recommendations = await call('/recommendations', 'POST', {});
    report.recommendationRead = recommendations;
    assert.equal(recommendations.status, 200);
    const item = recommendations.body.recommendations[0];
    assert.ok(item?.id, 'A current owned recommendation must be available');
    const body = { signalHash: recommendations.body.cacheMetadata.signalHash };
    const route = `/recommendations/${encodeURIComponent(item.id)}/career-sprint`;
    const first = await call(route, 'POST', body);
    report.recommendationFirst = first;
    assert.equal(first.status, 200);
    const refreshed = await call('/recommendations', 'POST', {});
    const replay = await call(route, 'POST', {
      signalHash: refreshed.body.cacheMetadata.signalHash,
    });
    report.recommendationReplay = replay;
    assert.equal(replay.status, 200);
    assert.equal(replay.body.alreadyAdded, true);
    return { first: first.body, replay: replay.body };
  });
  const browser = await chromium.launch({
    executablePath: process.env.SPRINT_CHROMIUM_PATH,
    headless: true,
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
    await context.addInitScript(({ token, user }) => {
      // The checked-in development index sets localhost:5000. Bind this isolated
      // browser's runtime configuration to its own real verification API instead.
      Object.defineProperty(window, '__DEVINSIGHT_API_ORIGIN__', {
        get: () => location.origin,
        set: () => {},
      });
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
      if (!localStorage.getItem('devinsight_theme'))
        localStorage.setItem('devinsight_theme', 'light');
      localStorage.setItem(
        'devinsight_career_profile',
        JSON.stringify({
          careerStack: 'Backend',
          activeCareerStack: 'Backend',
          experienceLevel: 'Intern',
          activeExperienceLevel: 'Intern',
          isConfigured: true,
        }),
      );
    }, session);
    const page = await context.newPage();
    report.httpErrors = [];
    page.on('response', (response) => {
      if (response.status() >= 400) {
        const url = new URL(response.url());
        report.httpErrors.push({ status: response.status(), url: url.origin + url.pathname });
      }
    });
    page.on('pageerror', (error) => report.failures.push(error.message));
    await page.goto(`${session.origin}/app/career-sprint`);
    const app = page.locator('app-career-sprint');
    try {
      await app
        .getByRole('button', { name: '+ Add task', exact: true })
        .first()
        .waitFor({ timeout: 30000 });
    } catch (error) {
      report.initialPage = {
        url: page.url(),
        browserNow: await page.evaluate(() => new Date().toISOString()),
        text: (await page.locator('body').innerText()).slice(0, 5000),
      };
      await page.screenshot({ path: path.join(output, 'live-initial-state.png') });
      throw error;
    }
    await check('real browser task CRUD, completion, reversal and reload persistence', async () => {
      await app.getByRole('button', { name: '+ Add task', exact: true }).first().click();
      const editor = app.getByRole('form', { name: 'Task editor' });
      await editor.getByLabel('Task title', { exact: true }).fill('Real browser persistence check');
      await editor
        .getByLabel('Description', { exact: true })
        .fill('Created by isolated Chromium against real MongoDB.');
      await editor.getByLabel('Points', { exact: true }).fill('5');
      await editor.getByRole('button', { name: 'Create task', exact: true }).click();
      const row = app.locator('.task-row').filter({
        has: page.getByRole('heading', { name: 'Real browser persistence check', exact: true }),
      });
      await row.waitFor();
      await row.getByRole('button', { name: /^Edit / }).click();
      await editor
        .getByLabel('Description', { exact: true })
        .fill('Updated and persisted by real API.');
      await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
      await editor.waitFor({ state: 'hidden' });
      await row.getByRole('button', { name: /^Complete / }).click();
      await row.getByRole('button', { name: /^Reopen / }).waitFor();
      await page.reload();
      await row.getByRole('button', { name: /^Reopen / }).waitFor();
      let persisted = (await call('/career-sprints/current')).body;
      assert.equal(
        persisted.tasks.find((t) => t.title === 'Real browser persistence check').isCompleted,
        true,
      );
      await row.getByRole('button', { name: /^Reopen / }).click();
      await row.getByRole('button', { name: /^Complete / }).waitFor();
      await row.getByRole('button', { name: /^Delete / }).click();
      await row.getByRole('button', { name: 'Confirm delete task', exact: true }).click();
      await row.waitFor({ state: 'detached' });
      persisted = (await call('/career-sprints/current')).body;
      assert.equal(
        persisted.tasks.some((t) => t.title === 'Real browser persistence check'),
        false,
      );
      return { persistedAcrossReload: true, deletedInMongo: true };
    });
    await check('real API dashboard and Weekly Reports freshness after mutation', async () => {
      const sprint = (await call('/career-sprints/current')).body;
      const task = sprint.tasks.find((t) => !t.isCompleted);
      const before = await call('/dashboard/summary');
      assert.equal(before.status, 200);
      const weeklyBefore = await call('/weekly-reports/generate', 'POST', { forceRefresh: true });
      assert.equal(weeklyBefore.status, 200);
      assert.equal(
        (
          await call(`/career-sprints/${sprint._id}/tasks/${task._id}`, 'PUT', {
            isCompleted: true,
          })
        ).status,
        200,
      );
      const after = await call('/dashboard/summary');
      const weeklyAfter = await call('/weekly-reports/generate', 'POST', { forceRefresh: true });
      assert.equal(after.status, 200);
      assert.equal(weeklyAfter.status, 200);
      report.freshness = {
        dashboardBefore: before.body,
        dashboardAfter: after.body,
        weeklyBefore: weeklyBefore.body.meta?.sprint,
        weeklyAfter: weeklyAfter.body.meta?.sprint,
      };
      assert.notDeepEqual(
        before.body,
        after.body,
        'Dashboard response must change after completion',
      );
      assert.equal(
        weeklyAfter.body.meta.sprint.tasksCompleted,
        weeklyBefore.body.meta.sprint.tasksCompleted + 1,
      );
      return { refreshed: true };
    });
    await page.reload();
    await app.getByRole('button', { name: '+ Add task', exact: true }).first().waitFor();
    for (const [name, width, theme] of [
      ['live-desktop-light', 1440, 'light'],
      ['live-mobile-light', 375, 'light'],
      ['live-mobile-dark', 375, 'dark'],
      ['live-desktop-dark', 1440, 'dark'],
    ]) {
      await page.setViewportSize({ width, height: 1050 });
      await page.evaluate((theme) => {
        localStorage.setItem('devinsight_theme', theme);
      }, theme);
      await page.reload();
      await app.getByRole('button', { name: '+ Add task', exact: true }).first().waitFor();
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all(
          document
            .getAnimations()
            .filter((a) => a.effect?.getTiming().iterations !== Infinity)
            .map((a) => a.finished.catch(() => {})),
        );
      });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        true,
      );
      const file = path.join(output, `${name}.png`);
      await page.screenshot({ path: file });
      report.screenshots.push(path.basename(file));
    }
    await context.close();
  } finally {
    await browser.close();
  }
};
main()
  .catch((error) => report.failures.push(error.stack))
  .finally(() => {
    report.status =
      report.failures.length || report.checks.some((c) => c.status === 'FAIL')
        ? 'BLOCKED'
        : 'VERIFIED';
    fs.writeFileSync(
      path.join(output, 'live-results.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
    console.log(
      JSON.stringify(
        { status: report.status, checks: report.checks, errors: report.failures },
        null,
        2,
      ),
    );
    process.exitCode = report.status === 'VERIFIED' ? 0 : 1;
  });
