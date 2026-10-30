'use strict';

// Standalone verification owns a new mongod process and temporary directory.
// It never loads .env or accepts a production database URI.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const mongoose = require('mongoose');
const express = require('express');
const jwt = require('jsonwebtoken');
const fixture = require('../tests/fixtures/scenarioMongo');
const engine = require('../services/scoring/scenarioPlanningScore');
const User = require('../models/user');
const Scenario = require('../models/scenarioSimulation');
const Sprint = require('../models/careerSprint');
const { sprintWindow } = require('../utils/sprintCalendar');
const output = path.resolve(__dirname, '../../verification/scenario-simulator');
const input = {
  ruleVersion: engine.RULE_VERSION,
  baselineHiringScore: 40,
  baselineJobMatch: 35,
  baselineConfirmed: true,
  baselineAuthority: 'user-assumption',
  role: 'frontend',
  experienceLevel: 'mid',
  durationWeeks: 6,
  skills: ['React'],
  projects: [],
};
const percentile = (values, p) =>
  [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))] || 0;

const main = async () => {
  fs.mkdirSync(output, { recursive: true });
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'disposable-scenario-verification-secret';
  const mongo = await fixture.start();
  let server;
  let browser;
  const report = {
    database: 'disposable loopback MongoDB',
    productionDataModified: false,
    checks: [],
    latency: {},
    screenshots: [],
    runtime: { node: process.version },
    limitations: [
      'Short local mixed load; production 15-minute capacity and 60-minute soak targets remain unverified.',
      'Live distributed Redis quota verification requires an isolated Redis test service.',
    ],
  };
  try {
    await mongoose.connect(mongo.uri);
    await Promise.all([User.init(), Scenario.init(), Sprint.init()]);
    report.indexes = await Scenario.collection.indexes();
    const users = await User.insertMany(
      Array.from({ length: 100 }, (_, index) => ({
        name: 'Scenario fixture ' + index,
        email: `scenario-${index}@example.invalid`,
        authProvider: 'github',
        providers: ['github'],
        careerStack: 'Frontend',
        experienceLevel: 'Student',
        isActive: true,
      })),
    );
    const tokens = users.map((user) =>
      jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET, {
        algorithm: 'HS256',
        issuer: 'devinsight-api',
        audience: 'devinsight-web',
        expiresIn: '1h',
      }),
    );
    const saved = await Promise.all(
      users.map((user) =>
        require('../services/scenarioSimulatorService').saveScenarioForUser(user._id, {
          ...input,
          evaluation: engine.calculate(input).evaluation,
        }),
      ),
    );
    const window = sprintWindow('Asia/Karachi');
    await Sprint.insertMany(
      users.map((user) => ({
        userId: user._id,
        ...window,
        weekStartDate: window.sprintStartDate,
        weekEndDate: window.sprintEndDate,
        goalTechnology: 'Kubernetes',
      })),
    );
    const app = express();
    app.use(express.json({ limit: '100kb' }));
    app.use('/api/simulator', require('../routes/scenarioSimulator.routes'));
    app.use('/api/profile', require('../routes/profile.routes'));
    app.use('/api/career-sprints', require('../routes/careerSprint.routes'));
    const dist = path.resolve(__dirname, '../../../frontend/dist/frontend/browser');
    app.use(express.static(dist));
    app.get('/app/{*route}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const call = async (route, { method = 'GET', body, index = 0, token = tokens[index] } = {}) => {
      const response = await fetch(origin + '/api/simulator' + route, {
        signal: AbortSignal.timeout(5000),
        method,
        headers: {
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
          'Content-Type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, body: await response.json() };
    };
    assert.equal((await call('/history', { token: null })).status, 401);
    assert.equal((await call('/' + saved[0]._id, { method: 'DELETE', index: 1 })).status, 404);
    assert.equal((await call('/save', { method: 'POST', body: { ...input, evaluation: {} } })).status, 409);
    const context = (await call('/context')).body.context;
    assert.equal(context.sources.length, 8);
    assert(!context.sources.some((source) => source.status === 'error'));
    assert.equal(context.profile.baselineHiringScore, 55);
    report.checks.push(
      'JWT protection, foreign delete isolation, stale evaluation rejection and real eight-source context',
    );
    const signals = await require('../services/developerSignalService').getDeveloperSignals(users[0]._id);
    assert.deepEqual(signals.careerSprintSignal.completedSkillSignals, []);
    assert.deepEqual(signals.careerSprintSignal.recordedActivitySkills, []);
    assert.equal(signals.scenarioSimulatorSignal.evidenceClass, 'planned-intent');
    report.checks.push('Goal-only/incomplete Sprint and saved simulations do not establish completed skills');
    if (process.env.SCENARIO_BROWSER === 'true') {
      const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
      browser = await chromium.launch({ headless: true, executablePath: process.env.SCENARIO_CHROMIUM_PATH });
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.addInitScript(
        ({ token, user }) => {
          localStorage.setItem('token', token);
          localStorage.setItem('user', JSON.stringify({ ...user, token }));
          if (!localStorage.getItem('devinsight_theme')) localStorage.setItem('devinsight_theme', 'light');
        },
        {
          token: tokens[0],
          user: {
            _id: String(users[0]._id),
            name: 'Scenario fixture',
            role: 'developer',
            careerStack: 'Frontend',
            experienceLevel: 'Student',
          },
        },
      );
      await page.goto(origin + '/app/scenario-simulator');
      await page.getByRole('heading', { name: 'Scenario Simulator', exact: true }).waitFor();
      await page.locator('#baselineHiring').fill('40');
      await page.locator('#baselineMatch').fill('35');
      await page.getByRole('checkbox').check();
      const skillInput = page.locator('input[placeholder*="Add a skill"]').first();
      await skillInput.fill('React');
      await skillInput.press('Enter');
      const evaluate = page.getByRole('button', { name: /Run Simulation/i }).first();
      await evaluate.click();
      await page.getByText('Hypothetical planning score', { exact: true }).waitFor();
      await page.locator('#baselineHiring').fill('41');
      assert(await page.getByRole('button', { name: 'Save Scenario', exact: true }).first().isDisabled());
      await evaluate.click();
      await page.getByText('Hypothetical planning score', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Save Scenario', exact: true }).first().click();
      await page.getByText('Scenario saved to your personal history.').waitFor();
      await page.getByRole('button', { name: /Create Sprint Draft/i }).click();
      await page.getByText('Scenario saved as a reviewable draft.').waitFor();
      const persisted = await Sprint.findOne({ userId: users[0]._id }).lean();
      assert.equal(persisted.aiPlans.length, 1);
      assert.equal(persisted.xpPoints, 0);
      for (const [theme, width] of [
        ['light', 1440],
        ['dark', 375],
      ]) {
        await page.evaluate((value) => {
          localStorage.setItem('devinsight_theme', value);
        }, theme);
        await page.setViewportSize({ width, height: 1000 });
        await page.reload();
        await page.getByRole('heading', { name: 'Scenario Simulator', exact: true }).waitFor();
        await page.waitForFunction(() => {
          const element = document.querySelector('.sim-page');
          const bounds = element?.getBoundingClientRect();
          return bounds && bounds.width >= Math.min(innerWidth - 40, 900) && bounds.right <= innerWidth;
        });
        await page.evaluate(() => {
          window.scrollTo(0, 0);
          const main = document.querySelector('.main-content');
          if (main) main.scrollTop = 0;
        });
        await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(output, `browser-${theme}-${width}.png`) });
        report.screenshots.push(`browser-${theme}-${width}.png`);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      }
      assert.deepEqual(errors, []);
      report.checks.push(
        'Authenticated production-bundle browser: evaluate, dirty guard, save, draft export, desktop/mobile screenshots and no runtime errors',
      );
    }
    const payload = { ...input, evaluation: engine.calculate(input).evaluation };
    let sequence = 0;
    const load = async (seconds, rps) => {
      const durations = { context: [], evaluate: [], history: [], save: [], export: [] };
      const statuses = {};
      const failures = [];
      const pending = [];
      const started = performance.now();
      for (let tick = 0; tick < seconds * rps; tick++) {
        const number = sequence++;
        const index = (number * 37 + Math.floor(number / 100)) % users.length;
        const mode = number % 100;
        const operation =
          mode < 40
            ? 'context'
            : mode < 75
              ? 'evaluate'
              : mode < 90
                ? 'history'
                : mode < 98
                  ? 'save'
                  : 'export';
        const task = (async () => {
          const begin = performance.now();
          const route = {
            context: '/context',
            evaluate: '/what-if',
            history: '/history',
            save: '/save',
            export: '/create-sprint',
          }[operation];
          const result = await call(route, {
            index,
            method: ['evaluate', 'save', 'export'].includes(operation) ? 'POST' : 'GET',
            body:
              operation === 'export'
                ? { scenarioId: String(saved[index]._id), mode: 'active-tasks' }
                : ['evaluate', 'save'].includes(operation)
                  ? payload
                  : undefined,
          });
          durations[operation].push(performance.now() - begin);
          statuses[result.status] = (statuses[result.status] || 0) + 1;
        })();
        pending.push(task.catch((error) => failures.push(error.message)));
        const remaining = started + ((tick + 1) * 1000) / rps - performance.now();
        if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
      }
      await Promise.all(pending);
      assert.deepEqual(failures, [], 'Every scheduled load request must complete successfully.');
      return {
        seconds,
        rps,
        requests: pending.length,
        statuses,
        elapsedMs: performance.now() - started,
        latency: Object.fromEntries(
          Object.entries(durations).map(([key, values]) => [
            key,
            { count: values.length, p95: percentile(values, 0.95), p99: percentile(values, 0.99) },
          ]),
        ),
      };
    };
    report.latency.steady = await load(Number(process.env.SCENARIO_LOAD_SECONDS) || 60, 20);
    report.latency.burst = await load(10, 100);
    for (const measured of Object.values(report.latency))
      assert(!Object.keys(measured.statuses).some((status) => Number(status) >= 500));
    const quota = await Promise.all(
      Array.from({ length: 65 }, () => call('/what-if', { method: 'POST', body: input })),
    );
    assert(quota.some((result) => result.status === 429));
    report.checks.push('Authenticated local quota rejects excess requests');
    report.status = 'PASS_WITH_PRODUCTION_GATES';
  } catch (error) {
    report.status = 'FAIL';
    report.error = error.stack;
    throw error;
  } finally {
    fs.writeFileSync(path.join(output, 'integrated-results.json'), JSON.stringify(report, null, 2) + '\n');
    if (browser) await browser.close();
    if (server) await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    await mongo.stop();
  }
  console.log(JSON.stringify({ status: report.status, checks: report.checks, latency: report.latency }));
};
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
