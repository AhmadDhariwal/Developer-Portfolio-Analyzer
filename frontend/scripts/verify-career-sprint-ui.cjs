// Production-bundle UI verification with isolated synthetic HTTP responses.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {
  profile,
  NOW,
  clone,
  proposed,
  draft,
  state,
} = require('./career-sprint-browser-fixture.cjs');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { sprintWindow } = require('../../backend/src/utils/sprintCalendar');
const root = path.resolve(__dirname, '../dist/frontend/browser');
const output = path.resolve(
  process.env.SPRINT_UI_OUTPUT || path.resolve(__dirname, '../verification/career-sprint'),
);
const origin = 'http://127.0.0.1:4326';
const server = http.createServer((req, res) => {
  let file = path.resolve(root, '.' + new URL(req.url, origin).pathname);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory())
    file = path.join(root, 'index.html');
  res.setHeader(
    'Content-Type',
    {
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.html': 'text/html',
      '.ttf': 'font/ttf',
      '.woff2': 'font/woff2',
      '.svg': 'image/svg+xml',
    }[path.extname(file)] || 'application/octet-stream',
  );
  fs.createReadStream(file).pipe(res);
});
async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(requestAnimationFrame);
    await Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => {})),
    );
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
}
async function session(browser, theme = 'light', mode = 'normal') {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
    colorScheme: theme === 'system' ? 'dark' : theme,
  });
  await context.addInitScript(
    ({ theme, profile }) => {
      const payload = btoa(
        JSON.stringify({
          exp: Math.floor(Date.now() / 1000) + 36000,
          iss: 'devinsight-api',
          aud: 'devinsight-web',
        }),
      );
      localStorage.setItem('token', `fixture.${payload}.fixture`);
      localStorage.setItem(
        'user',
        JSON.stringify({
          _id: 'fixture',
          name: 'Alex Morgan',
          role: 'developer',
          activeGithubUsername: 'fixture',
        }),
      );
      localStorage.setItem(
        'devinsight_career_profile',
        JSON.stringify({ ...profile, isConfigured: true }),
      );
      localStorage.setItem('devinsight_theme', theme);
    },
    { theme, profile },
  );
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date(NOW));
  const controls = state(mode),
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      endpoint = url.pathname,
      method = request.method();
    const data = request.postDataJSON?.() || {};
    const recordId = endpoint.split('/')[3];
    const target =
      recordId === controls.current._id
        ? controls.current
        : controls.history.find((item) => item._id === recordId) || controls.current;
    const send = (json, status = 200) => route.fulfill({ status, json: clone(json) });
    if (method === 'GET') controls.reads.push(endpoint);
    else controls.writes.push({ endpoint, method, data });
    const sync = () => {
      target.__v++;
      controls.history = controls.history.map((item) =>
        item._id === target._id ? clone(target) : item,
      );
      return target;
    };
    if (endpoint === '/api/career-sprints/current') {
      if (controls.delay) await new Promise((resolve) => setTimeout(resolve, controls.delay));
      return controls.mode === 'unavailable'
        ? send({ message: 'Sprint temporarily unavailable.' }, 503)
        : send(controls.current);
    }
    if (endpoint === '/api/career-sprints/history')
      return controls.failHistory
        ? send({ message: 'History unavailable.' }, 503)
        : send({ history: controls.history });
    if (endpoint === '/api/career-sprints/preferences') {
      if (method === 'PUT') {
        try {
          new Intl.DateTimeFormat('en', { timeZone: data.timeZone });
        } catch {
          return send({ message: 'A valid IANA time zone is required.' }, 400);
        }
        controls.preference = data.timeZone;
      }
      return send({ timeZone: controls.preference });
    }
    if (endpoint === '/api/simulator/history')
      return send({
        history: [{ _id: 'scenario-fixture', name: 'Explore a full-stack direction' }],
      });
    if (/\/career-sprints\/generate-(plan|ai-plan)$/.test(endpoint)) {
      if (controls.failPlan) return send({ message: 'Planning service unavailable.' }, 503);
      return send({
        tasks: proposed,
        planMeta: {
          summary: 'Build clearer project evidence through small, measurable steps.',
          confidenceScore: 68,
          consistencyScore: 52,
          signalsUsed: ['Career profile', 'Current recommendations'],
          generationMode:
            endpoint.endsWith('ai-plan') && !controls.aiFallback ? 'llm' : 'deterministic',
          limitations: ['Proposed work only; completion does not establish proficiency.'],
        },
      });
    }
    if (endpoint.startsWith('/api/career-sprints') && method !== 'GET') {
      if (controls.failMutation)
        return send({ message: 'Sprint changed. Review current data before retrying.' }, 409);
      if (target.legacyAccess.readOnly && endpoint !== '/api/career-sprints')
        return send({ message: 'Historical Sprint is read-only.' }, 409);
      if (endpoint === '/api/career-sprints') {
        const pinned = sprintWindow(controls.preference, data.sprintStartDate, data.sprintEndDate);
        const future = {
          ...clone(controls.current),
          ...pinned,
          _id: 'future-sprint',
          title: data.title,
          legacyAccess: {
            readOnly: false,
            calendarStatus: 'recorded',
            timeZone: controls.preference,
            reason: null,
          },
          weekStartDate: pinned.sprintStartDate,
          weekEndDate: pinned.sprintEndDate,
          xpPoints: 0,
          level: 1,
          currentStreak: 0,
          longestStreak: 0,
          streak: 0,
          tasks: [],
          aiPlans: [],
        };
        controls.history.unshift(future);
        return send(future, 201);
      }
      if (endpoint.endsWith('/restore-streak')) {
        if (!target.restoreMeta.canRestore)
          return send({ message: 'Recovery window expired.' }, 400);
        target.restoreMeta.canRestore = false;
        target.streakStatus = 'active';
        return send(sync());
      }
      if (endpoint.endsWith('/dates')) {
        target.sprintStartDate = data.sprintStartDate + 'T19:00:00Z';
        target.sprintEndDate = data.sprintEndDate + 'T18:59:59.999Z';
        return send(sync());
      }
      if (endpoint.endsWith('/import-scenario')) {
        const plan = draft('scenario-plan');
        plan.source = plan.generatorType = 'scenario';
        plan.name = 'Full-stack scenario draft';
        target.aiPlans.push(plan);
        return send(sync());
      }
      if (endpoint.endsWith('/ai-plans')) {
        const plan = { ...draft('saved-draft-' + ++controls.serial), ...data };
        target.aiPlans.push(plan);
        return send(sync());
      }
      const draftMatch = endpoint.match(/\/ai-plans\/([^/]+)(\/tasks)?$/);
      if (draftMatch) {
        const plan = target.aiPlans.find((item) => item._id === draftMatch[1]);
        if (method === 'DELETE') {
          target.aiPlans = target.aiPlans.filter((item) => item !== plan);
          return send(sync());
        }
        if (
          plan.compatibility.requiresAcknowledgement &&
          data.acknowledgeContextFingerprint !== plan.compatibility.currentFingerprint
        )
          return send({ message: 'Draft context differs. Acknowledge the current context.' }, 409);
        for (const index of data.taskIndexes) {
          const task = plan.tasks[index];
          if (
            !target.tasks.some(
              (item) =>
                item.title === task.title ||
                (task.sourceRecommendationId &&
                  item.sourceRecommendationId === task.sourceRecommendationId),
            )
          )
            target.tasks.push({ ...clone(task), _id: 'imported-' + ++controls.serial });
        }
        return send(sync());
      }
      const taskMatch = endpoint.match(/\/tasks(?:\/([^/]+))?$/);
      if (taskMatch) {
        if (method === 'POST') {
          target.tasks.push({
            ...data,
            _id: 'created-' + ++controls.serial,
            isCompleted: false,
            taskType: 'manual',
          });
          return send(sync());
        }
        const task = target.tasks.find((item) => item._id === taskMatch[1]);
        if (method === 'DELETE') {
          target.tasks = target.tasks.filter((item) => item !== task);
          return send(sync());
        }
        if (Object.hasOwn(data, 'isCompleted')) {
          task.isCompleted = data.isCompleted;
          target.xpPoints += data.isCompleted ? 19 : -19;
        } else
          Object.assign(task, data, {
            description: String(data.description || '')
              .replace(/[\u0000-\u001f\u007f]/g, ' ')
              .trim()
              .replace(/\s+/g, ' '),
          });
        return send(sync());
      }
    }
    if (endpoint.includes('/profile/me'))
      return send({
        ...profile,
        _id: 'fixture',
        name: 'Alex Morgan',
        role: 'developer',
        careerStack: 'Frontend',
        experienceLevel: 'Junior',
        isConfigured: true,
      });
    if (endpoint.includes('/profile/career')) return send({ ...profile, isConfigured: true });
    if (endpoint.includes('active-username')) return send({ username: 'fixture' });
    return send({
      data: [],
      notifications: [],
      resumes: [],
      integrations: [],
      organizations: [],
      teams: [],
      user: { _id: 'fixture', role: 'developer' },
    });
  });
  await page.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({ body: '', contentType: 'text/css' }),
  );
  await page.goto(origin + '/app/career-sprint', { waitUntil: 'domcontentloaded' });
  return { context, page, controls, errors };
}
async function screenshot(page, results, name, locator) {
  if (locator)
    await locator.evaluate((element) => {
      element.scrollIntoView({ block: 'start' });
      const scroller = element.closest('.main-content');
      if (scroller && scroller.scrollHeight > scroller.clientHeight) scroller.scrollTop -= 84;
      else window.scrollBy(0, -84);
    });
  await settle(page);
  await page.screenshot({ path: path.join(output, name) });
  results.screenshots.push(name);
}
async function contrast(page) {
  return page.locator('.sprint-page').evaluate((root) => {
    const rgba = (color) => {
      const parts = (color.match(/[\d.]+/g) || []).map(Number);
      return color.startsWith('color(srgb') ? parts.map((p, i) => (i < 3 ? p * 255 : p)) : parts;
    };
    const blend = (fg, bg) =>
      [0, 1, 2].map((i) => fg[i] * (fg[3] ?? 1) + bg[i] * (1 - (fg[3] ?? 1)));
    const bg = (el) => {
      const layers = [];
      for (let p = el; p; p = p.parentElement)
        layers.push(rgba(getComputedStyle(p).backgroundColor));
      return layers.reverse().reduce((b, a) => blend(a, b), [255, 255, 255]);
    };
    const lum = (rgb) =>
      rgb
        .map((v) => v / 255)
        .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
        .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
    const failures = [];
    let checked = 0;
    for (const el of root.querySelectorAll(
      'h1,h2,h3,p,small,strong,span,button,a,label,select,summary',
    )) {
      if (
        !el.checkVisibility() ||
        !el.textContent.trim() ||
        el.closest('[aria-hidden="true"]') ||
        el.matches(':disabled') ||
        el.closest('button:disabled')
      )
        continue;
      const style = getComputedStyle(el),
        background = bg(el),
        values = [lum(background), lum(blend(rgba(style.color), background))].sort((a, b) => a - b),
        ratio = (values[1] + 0.05) / (values[0] + 0.05);
      const large =
        parseFloat(style.fontSize) >= 24 ||
        (parseFloat(style.fontSize) >= 18.66 && Number(style.fontWeight) >= 700);
      checked++;
      if (ratio < (large ? 3 : 4.5))
        failures.push({ text: el.textContent.trim().slice(0, 70), ratio });
    }
    return { checked, failures };
  });
}
async function assertText(locator, text) {
  await locator.getByText(text, { exact: false }).first().waitFor();
}
async function interactions(session, results, theme) {
  const { page, controls } = session;
  await page.setViewportSize({ width: 1440, height: 1050 });
  const app = page.locator('app-career-sprint');
  await app.getByRole('button', { name: '+ Add task', exact: true }).first().click();
  const editor = app.getByRole('form', { name: 'Task editor' });
  await editor
    .getByLabel('Task title', { exact: true })
    .fill('Ship a keyboard-accessible portfolio menu');
  await editor
    .getByLabel('Description', { exact: true })
    .fill('Test focus, Escape, and retry states.');
  await editor.getByLabel('Points', { exact: true }).fill('5');
  await editor.getByLabel('Start date', { exact: true }).fill('2026-10-16');
  await editor.getByLabel('End date', { exact: true }).fill('2026-10-17');
  await editor.getByRole('button', { name: 'Create task', exact: true }).click();
  await app
    .getByRole('heading', { name: 'Ship a keyboard-accessible portfolio menu', exact: true })
    .waitFor();
  const row = app.locator('.task-row').filter({
    has: page.getByRole('heading', {
      name: 'Ship a keyboard-accessible portfolio menu',
      exact: true,
    }),
  });
  await row.getByRole('button', { name: /^Edit / }).click();
  await editor.getByLabel('Task title', { exact: true }).fill('Ship the accessible menu');
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
  const updatedRow = app
    .locator('.task-row')
    .filter({ has: page.getByRole('heading', { name: 'Ship the accessible menu', exact: true }) });
  await updatedRow.getByRole('button', { name: /^Complete / }).click();
  await updatedRow.getByRole('button', { name: /^Reopen / }).waitFor();
  assert.equal(await updatedRow.getByRole('button', { name: /^Edit / }).isDisabled(), true);
  await updatedRow.getByRole('button', { name: /^Reopen / }).click();
  await updatedRow.getByRole('button', { name: /^Complete / }).waitFor();
  await updatedRow.getByRole('button', { name: /^Delete / }).click();
  await updatedRow.getByRole('button', { name: 'Confirm delete task', exact: true }).click();
  await app
    .getByRole('heading', { name: 'Ship the accessible menu', exact: true })
    .waitFor({ state: 'hidden' });
  await app
    .getByRole('button', { name: 'Edit Study the saved TypeScript course', exact: true })
    .click();
  assert.equal(
    await editor.getByLabel('Task title', { exact: true }).evaluate((el) => el.readOnly),
    true,
  );
  assert.equal(
    (await editor.getByLabel('Description', { exact: true }).inputValue()).includes('Course:'),
    false,
  );
  await editor
    .getByLabel('Description', { exact: true })
    .fill('Study the TypeScript course and apply one idea to a project.');
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
  await editor.waitFor({ state: 'hidden' });
  assert.ok(
    controls.current.tasks
      .find((task) => task._id === 'task-five')
      .description.includes('Course: course-fixture Skill: TypeScript '),
  );
  assert.equal(
    controls.current.tasks.find((task) => task._id === 'task-five').title,
    'Study the saved TypeScript course',
  );
  await app.getByLabel('Search tasks', { exact: true }).fill('does not exist');
  await assertText(app, 'No tasks match these filters');
  await app.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await app.getByLabel('Status', { exact: true }).selectOption('completed');
  await page.waitForFunction(
    () => document.querySelectorAll('app-career-sprint .task-row').length === 2,
  );
  assert.equal(await app.locator('.task-row').count(), 2);
  await app.getByRole('button', { name: 'Reset filters', exact: true }).click();
  await app.getByLabel('Schedule', { exact: true }).selectOption('today');
  await settle(page);
  assert.ok((await app.locator('.task-row').count()) > 0);
  await app.getByRole('button', { name: 'Reset filters', exact: true }).click();
  controls.failMutation = true;
  await app
    .getByRole('button', { name: 'Complete Polish the portfolio case study', exact: true })
    .click();
  await assertText(app, 'Your saved data is preserved.');
  assert.equal(controls.current.tasks[0].isCompleted, false);
  controls.failMutation = false;
  await app.getByRole('button', { name: 'Refresh Sprint', exact: true }).click();
  await app
    .getByRole('button', { name: 'Complete Polish the portfolio case study', exact: true })
    .waitFor({ state: 'visible' });
  await page.waitForFunction(
    () => !document.querySelector('app-career-sprint .sprint-page[aria-busy="true"]'),
  );
  controls.mode = 'unavailable';
  await app.getByRole('button', { name: 'Refresh', exact: true }).click();
  await assertText(app, 'Could not refresh your Sprint');
  assert.ok((await app.locator('.task-row').count()) > 0);
  controls.mode = 'normal';
  await app.getByRole('button', { name: 'Retry loading Sprint', exact: true }).click();
  await page.waitForFunction(
    () => !document.querySelector('app-career-sprint .sprint-page[aria-busy="true"]'),
  );
  await app.getByRole('button', { name: /^Sprint studio/ }).click();
  const studio = app.locator('app-sprint-planner');
  await studio.getByRole('button', { name: 'Build signal-based plan', exact: true }).click();
  await assertText(studio, 'Your next steps, ready for review');
  controls.failPlan = true;
  await studio.getByRole('button', { name: 'Try AI planning', exact: true }).click();
  await assertText(studio, 'Planning service unavailable.');
  assert.equal(await studio.locator('.preview-tasks li').count(), 2);
  controls.failPlan = false;
  controls.aiFallback = true;
  await studio.getByRole('button', { name: 'Try AI planning', exact: true }).click();
  await assertText(studio, 'deterministic fallback');
  await studio.getByLabel('Draft name', { exact: true }).fill('Reviewed UI verification plan');
  await studio.getByRole('button', { name: 'Save as draft', exact: true }).click();
  await assertText(studio, 'Draft saved.');
  await studio
    .getByRole('checkbox', { name: 'Select Build an accessible command palette', exact: true })
    .check();
  await studio.getByRole('button', { name: 'Add selected to Sprint', exact: true }).click();
  await assertText(studio, 'Selected tasks imported.');
  const afterFirst = controls.current.tasks.length;
  await studio.getByRole('button', { name: 'Select all tasks', exact: true }).click();
  await studio.getByRole('button', { name: 'Add selected to Sprint', exact: true }).click();
  await assertText(studio, 'Selected tasks imported.');
  await page.waitForFunction(
    () => !document.querySelector('app-sprint-planner [aria-busy="true"]'),
  );
  assert.equal(controls.current.tasks.length, afterFirst + 1);
  const plan = controls.current.aiPlans.find(
    (item) => item.name === 'Reviewed UI verification plan',
  );
  plan.compatibility = {
    ...plan.compatibility,
    status: 'different-context',
    requiresAcknowledgement: true,
    currentFingerprint: 'context-two',
  };
  await app.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.waitForFunction(
    () => !document.querySelector('app-career-sprint .sprint-page[aria-busy="true"]'),
  );
  await studio.getByRole('button', { name: 'Select all tasks', exact: true }).click();
  assert.equal(
    await studio.getByRole('button', { name: 'Add selected to Sprint', exact: true }).isDisabled(),
    true,
  );
  await studio
    .getByRole('checkbox', {
      name: 'I reviewed this draft for my current career context.',
      exact: true,
    })
    .check();
  await studio.getByRole('button', { name: 'Add selected to Sprint', exact: true }).click();
  await assertText(studio, 'Selected tasks imported.');
  assert.equal(
    controls.writes
      .filter((item) => item.endpoint.endsWith('/ai-plans/' + plan._id + '/tasks'))
      .at(-1).data.acknowledgeContextFingerprint,
    'context-two',
  );
  if (theme === 'light') await screenshot(page, results, 'light-desktop-planner.png', studio);
  await studio.getByLabel('Saved scenario', { exact: true }).selectOption('scenario-fixture');
  await studio.getByRole('button', { name: 'Import scenario draft', exact: true }).click();
  await assertText(studio, 'Scenario saved as a draft.');
  await studio.getByRole('button', { name: 'Delete draft…', exact: true }).click();
  await studio.getByRole('button', { name: 'Confirm delete draft', exact: true }).click();
  await assertText(studio, 'Draft deleted.');
  await app.getByRole('button', { name: 'Calendar settings', exact: true }).click();
  await app
    .getByLabel('IANA timezone for future Sprints', { exact: true })
    .fill('America/New_York');
  await app.getByRole('button', { name: 'Save timezone', exact: true }).click();
  await assertText(app, 'Timezone preference saved');
  assert.equal(controls.current.timeZone, 'Asia/Karachi');
  await app.getByRole('button', { name: '+ New Sprint', exact: true }).click();
  assert.ok(await app.getByLabel('New Sprint start', { exact: true }).inputValue());
  await app.getByLabel('New Sprint start', { exact: true }).fill('2026-10-16');
  await app.getByLabel('New Sprint end', { exact: true }).fill('2026-10-17');
  assert.equal(
    await app.getByRole('button', { name: 'Create Sprint', exact: true }).isDisabled(),
    true,
  );
  await assertText(app, 'Refreshing alone will not remove an overlap.');
  if (theme === 'light')
    await screenshot(page, results, 'sprint-overlap-guidance.png', app.locator('#new-sprint'));
  await app.getByRole('button', { name: 'Use next available dates', exact: true }).click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('app-career-sprint button')].some(
      (button) => button.textContent.trim() === 'Create Sprint' && !button.disabled,
    ),
  );
  assert.equal(
    await app.getByRole('button', { name: 'Create Sprint', exact: true }).isEnabled(),
    true,
  );
  results.overlapChecks ||= [];
  results.overlapChecks.push({ theme, passed: true });
  if (theme === 'light')
    await screenshot(page, results, 'sprint-available-dates.png', app.locator('#new-sprint'));
  await app.getByLabel('Sprint title', { exact: true }).fill('A new focused Sprint');
  await app.getByLabel('New Sprint start', { exact: true }).fill('2026-12-01');
  await app.getByLabel('New Sprint end', { exact: true }).fill('2026-12-07');
  await app.getByRole('button', { name: 'Create Sprint', exact: true }).click();
  await assertText(app, 'Sprint saved.');
  await app.getByRole('button', { name: /^Sprint history/ }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('app-career-sprint .history-entry').length === 4,
  );
  assert.equal(await app.locator('.history-entry').count(), 4);
  await app
    .locator('.history-entry')
    .filter({ hasText: 'Preserved overlapping Sprint' })
    .locator(':scope > summary')
    .click();
  await app
    .locator('.history-entry')
    .filter({ hasText: 'Preserved Sprint · July' })
    .locator(':scope > summary')
    .focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () => document.querySelectorAll('app-career-sprint .history-entry[open]').length === 2,
  );
  assert.equal(await app.locator('.history-entry[open]').count(), 2);
  if (theme === 'dark')
    await screenshot(page, results, 'dark-desktop-history.png', app.locator('.history-list'));
  await app.getByRole('button', { name: /^Tasks/ }).click();
  await page.setViewportSize({ width: 375, height: 1000 });
  await settle(page);
  await app.getByLabel('Search tasks', { exact: true }).fill('TypeScript');
  await settle(page);
  assert.equal(await app.locator('.task-row').count(), 1);
  if (theme !== 'system')
    await screenshot(page, results, `${theme}-mobile-tasks.png`, app.locator('.task-workspace'));
  await app.getByLabel('Search tasks', { exact: true }).focus();
  await page.keyboard.press('Tab');
  assert.equal(
    await app
      .getByLabel('Status', { exact: true })
      .evaluate(
        (el) => document.activeElement === el && getComputedStyle(el).outlineStyle !== 'none',
      ),
    true,
  );
  await app.getByRole('button', { name: 'Reset filters', exact: true }).click();
  await app.getByRole('button', { name: '+ Add task', exact: true }).first().click();
  await app
    .getByRole('form', { name: 'Task editor' })
    .getByLabel('Task title', { exact: true })
    .fill('Mobile form draft');
  await app
    .getByRole('form', { name: 'Task editor' })
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  await page.setViewportSize({ width: 1440, height: 1050 });
  await settle(page);
  if (theme === 'system') {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  }
  const initialTheme = await page.locator('html').getAttribute('data-theme');
  await page.getByRole('button', { name: /Current theme is/ }).click();
  assert.notEqual(await page.locator('html').getAttribute('data-theme'), initialTheme);
  results.interactions.push({
    theme,
    taskCreateEditDelete: true,
    completeReopen: true,
    filters: true,
    conflictPreservation: true,
    refreshRetry: true,
    deterministicAndAiFallback: true,
    savedDrafts: true,
    selectiveBulkImports: true,
    duplicateProtection: true,
    contextAcknowledgement: true,
    scenarioImportAndDelete: true,
    prospectiveTimezone: true,
    futureSprint: true,
    overlappingHistory: true,
    themeSwitch: true,
    mobileSearchAndEditor: true,
    keyboardFocusAndHistoryDisclosure: true,
  });
}
(async () => {
  fs.mkdirSync(output, { recursive: true });
  await new Promise((resolve) => server.listen(4326, '127.0.0.1', resolve));
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.SPRINT_CHROMIUM_PATH
      ? { executablePath: process.env.SPRINT_CHROMIUM_PATH }
      : {}),
  });
  const results = {
    verifiedAt: new Date().toISOString(),
    synthetic: true,
    scope:
      'Career Sprint frontend; production bundle with synthetic intercepted HTTP, no production data or backend writes',
    bundle: fs.readdirSync(root).find((name) => /^main-.*\.js$/.test(name)),
    layouts: [],
    interactions: [],
    states: [],
    screenshots: [],
  };
  try {
    for (const theme of ['light', 'dark', 'system']) {
      const s = await session(browser, theme);
      const { page } = s;
      await page.getByRole('heading', { name: s.controls.current.title, exact: true }).waitFor();
      for (const width of [320, 375, 425, 768, 1024, 1280, 1440, 1600]) {
        await page.setViewportSize({ width, height: width <= 768 ? 900 : 1050 });
        await settle(page);
        const measured = await page.locator('.sprint-page').evaluate((root) => ({
          overflow:
            document.documentElement.scrollWidth > innerWidth ||
            root.scrollWidth > root.clientWidth + 1,
          font: getComputedStyle(root).fontFamily,
          title: getComputedStyle(root.querySelector('h1')).fontSize,
          padding: getComputedStyle(root).padding,
          theme: document.documentElement.dataset.theme,
          offenders: [...root.querySelectorAll('*')]
            .filter(
              (el) =>
                el.checkVisibility() &&
                el.getBoundingClientRect().right > root.getBoundingClientRect().right + 1,
            )
            .map((el) => ({
              tag: el.tagName,
              className: el.className,
              text: el.textContent.slice(0, 60),
              right: el.getBoundingClientRect().right,
              rootRight: root.getBoundingClientRect().right,
            }))
            .slice(0, 15),
        }));
        if (measured.overflow) {
          await screenshot(page, results, 'diagnostic-layout.png');
          results.failedLayout = measured;
        }
        const measuredContrast = await contrast(page);
        const failures = [];
        // Preserve every assertion and threshold, but collect failures so one bad
        // viewport cannot prevent verification of the other 23 combinations.
        for (const validate of [
          () => assert.equal(measured.overflow, false, `${theme}/${width}: horizontal overflow`),
          () => assert.match(measured.font, /Manrope/),
          () => assert.equal(measured.title, '28px'),
          () => assert.equal(measured.padding, '0px'),
          () => assert.deepEqual(measuredContrast.failures, [], `${theme}/${width}: text contrast`),
        ]) {
          try {
            validate();
          } catch (error) {
            failures.push(error.message);
          }
        }
        results.layouts.push({
          theme,
          width,
          ...measured,
          contrast: measuredContrast,
          passed: failures.length === 0,
          failures,
        });
        if (theme !== 'system' && [375, 1440].includes(width))
          await screenshot(page, results, `${theme}-${width}-dashboard.png`);
      }
      try {
        await interactions(s, results, theme);
        assert.deepEqual(s.errors, []);
      } catch (error) {
        results.interactionFailures ||= [];
        results.interactionFailures.push({ theme, error: error.stack });
      } finally {
        await s.context.close();
      }
    }
    for (const mode of [
      'legacy',
      'empty',
      'unavailable',
      'loading',
      'history-error',
      'restore',
      'expired',
      'boundary',
    ]) {
      const s = await session(browser, 'light', mode),
        app = s.page.locator('app-career-sprint');
      if (mode === 'loading') {
        await assertText(app, 'Loading your Sprint and progress…');
        await screenshot(s.page, results, 'light-loading.png');
      }
      if (mode === 'unavailable') {
        await assertText(app, 'Let’s reconnect');
        s.controls.mode = 'normal';
        await app.getByRole('button', { name: 'Retry loading Sprint', exact: true }).click();
        await app.getByRole('heading', { name: s.controls.current.title, exact: true }).waitFor();
      } else
        await app.getByRole('heading', { name: s.controls.current.title, exact: true }).waitFor();
      if (mode === 'legacy') {
        await assertText(app, 'History preserved.');
        await assertText(app, 'Unavailable');
        assert.equal(
          await app
            .getByRole('button', { name: 'Complete Polish the portfolio case study', exact: true })
            .isDisabled(),
          true,
        );
        await app.getByRole('button', { name: /^Sprint studio/ }).click();
        assert.equal(
          await app
            .getByRole('button', { name: 'Build signal-based plan', exact: true })
            .isDisabled(),
          true,
        );
        assert.equal(s.controls.writes.length, 0);
        await app.getByRole('button', { name: /^Tasks/ }).click();
        await s.page.setViewportSize({ width: 375, height: 1000 });
        await screenshot(s.page, results, 'light-mobile-legacy.png');
        const preservedLegacy = clone(s.controls.current);
        await app.getByRole('button', { name: /^Sprint studio/ }).click();
        await app.getByRole('button', { name: 'Create writable Sprint', exact: true }).click();
        await app.getByLabel('Sprint title', { exact: true }).fill('AI planning Sprint');
        await app.getByRole('button', { name: 'Create Sprint', exact: true }).click();
        await assertText(app, 'Sprint studio is open for the new Sprint');
        const planner = app.locator('app-sprint-planner');
        await s.page.waitForFunction(() =>
          Boolean(document.querySelector('app-sprint-planner input:not(:disabled)')),
        );
        await planner.getByLabel('Focus technology', { exact: true }).fill('Angular');
        await planner.getByRole('button', { name: 'Try AI planning', exact: true }).click();
        await planner.getByRole('button', { name: 'Save as draft', exact: true }).waitFor();
        await planner.getByRole('button', { name: 'Save as draft', exact: true }).click();
        await assertText(app, 'Draft saved.');
        assert.equal(
          s.controls.history.find((record) => record._id === 'future-sprint').aiPlans.length,
          1,
        );
        await planner.getByRole('button', { name: 'Select all tasks', exact: true }).click();
        await planner.getByRole('button', { name: 'Add selected to Sprint', exact: true }).click();
        await assertText(app, 'Selected tasks imported.');
        assert.equal(
          s.controls.history.find((record) => record._id === 'future-sprint').tasks.length,
          proposed.length,
        );
        assert.deepEqual(s.controls.current, preservedLegacy);
        await screenshot(s.page, results, 'legacy-to-writable-planner.png', planner);
        results.writablePlannerHandoff = {
          passed: true,
          legacyUnchanged: true,
          previewSaveAndImport: true,
        };
      }
      if (mode === 'empty') await assertText(app, 'A little focus goes a long way');
      if (mode === 'history-error') {
        await app.getByRole('button', { name: /^Sprint history/ }).click();
        await assertText(app, 'History is unavailable.');
        s.controls.failHistory = false;
        await app.getByRole('button', { name: 'Refresh history', exact: true }).click();
        await app.locator('.history-entry').first().waitFor();
      }
      if (mode === 'restore') {
        const xp = s.controls.current.xpPoints;
        await app.getByRole('button', { name: 'Restore streak', exact: true }).click();
        await assertText(app, 'No activity or XP was created.');
        assert.equal(s.controls.current.xpPoints, xp);
      }
      if (mode === 'expired')
        assert.equal(
          await app.getByRole('button', { name: 'Restore streak', exact: true }).isDisabled(),
          true,
        );
      if (mode === 'boundary') {
        assert.equal(
          await app.getByRole('button', { name: 'Restore streak', exact: true }).isEnabled(),
          true,
        );
        await s.page.clock.setFixedTime(new Date('2026-10-16T13:00:00Z'));
        await s.page.waitForFunction(() =>
          [...document.querySelectorAll('app-career-sprint button')].some(
            (button) => button.textContent.trim() === 'Restore streak' && button.disabled,
          ),
        );
        assert.equal(s.controls.writes.length, 0);
      }
      assert.deepEqual(s.errors, []);
      results.states.push({ mode, passed: true });
      await s.context.close();
    }
    results.status =
      results.layouts.some((layout) => !layout.passed) || results.interactionFailures?.length
        ? 'BLOCKED'
        : 'VERIFIED';
    if (results.status === 'BLOCKED') process.exitCode = 1;
  } catch (error) {
    results.status = 'BLOCKED';
    results.error = error.stack;
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(
      path.join(output, 'browser-results.json'),
      JSON.stringify(results, null, 2) + '\n',
    );
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
  console.log(
    JSON.stringify(
      {
        status: results.status,
        layouts: results.layouts.length,
        interactions: results.interactions.length,
        states: results.states.length,
        error: results.error,
      },
      null,
      2,
    ),
  );
})();
