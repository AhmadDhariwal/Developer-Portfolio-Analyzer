'use strict';

// Uses only a newly created disposable MongoDB and local fixture accounts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const fixture = require('../tests/fixtures/scenarioMongo');
const engine = require('../services/scoring/scenarioPlanningScore');
const output = path.resolve(__dirname, '../../../frontend/verification/scenario-templates');

async function main() {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'disposable-template-verification';
  const mongo = await fixture.start();
  let server;
  let browser;
  const report = { checks: [], calculations: [], layouts: [], errors: [] };
  try {
    await mongoose.connect(mongo.uri);
    const User = require('../models/user');
    const Scenario = require('../models/scenarioSimulation');
    const Sprint = require('../models/careerSprint');
    await Promise.all([User.init(), Scenario.init(), Sprint.init()]);
    const users = await User.insertMany(
      ['owner', 'other'].map((name) => ({
        name,
        email: `${name}@templates.invalid`,
        authProvider: 'github',
        providers: ['github'],
        githubUsername: name,
        careerStack: 'Frontend',
        activeCareerStack: 'Frontend',
        experienceLevel: 'Student',
        isActive: true,
      })),
    );
    await require('../models/analysisCache').create({
      userId: users[0]._id,
      githubUsername: 'owner',
      careerStack: 'Frontend',
      experienceLevel: 'Student',
      resumeHash: 'no-resume',
      resumeAnalysisId: 'no-resume',
      analysisData: {
        ruleVersion: 'skill-evidence-coverage-v1',
        skills: ['Docker', 'TypeScript', 'Testing'].map((name) => ({
          name,
          status: 'NOT_EVIDENCED',
        })),
        sourceReferences: [
          { type: 'github', available: false },
          { type: 'resume', available: false },
        ],
      },
    });
    await require('../models/publicProfile').create({
      userId: users[0]._id,
      slug: 'template-owner',
      projects: [{ title: 'Shipped project', status: 'completed' }],
      upcomingProjects: [
        { title: 'Shipped project', techStack: ['Docker'] },
        { title: 'Docker showcase', techStack: ['Docker', 'TypeScript'] },
      ],
    });
    const tokens = users.map((user) =>
      jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET, {
        algorithm: 'HS256',
        issuer: 'devinsight-api',
        audience: 'devinsight-web',
        expiresIn: '1h',
      }),
    );
    const app = express();
    app.use(express.json());
    app.use('/api/simulator', require('../routes/scenarioSimulator.routes'));
    app.use('/api/profile', require('../routes/profile.routes'));
    app.use('/api', (_req, res) =>
      res.json({ notifications: [], data: [], integrations: [], resumes: [] }),
    );
    const dist = path.resolve(__dirname, '../../../frontend/dist/frontend/browser');
    app.use(express.static(dist));
    app.get('/app/{*route}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const call = async (route, body, index = 0) => {
      const response = await fetch(`${origin}/api/simulator${route}`, {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${tokens[index]}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, body: await response.json() };
    };
    const context = (await call('/context')).body.context;
    assert.deepEqual(context.signals.missingSkills, ['Docker', 'TypeScript', 'Testing']);
    assert.deepEqual(context.signals.portfolioCandidates, [
      { name: 'Docker showcase', skills: ['Docker', 'TypeScript'] },
    ]);
    assert.deepEqual(
      (await call('/context', null, 1)).body.context.signals.portfolioCandidates,
      [],
    );
    const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.SCENARIO_CHROMIUM_PATH,
    });
    fs.mkdirSync(output, { recursive: true });
    for (const mobile of [false, true]) {
      const session = await browser.newContext({
        viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
      });
      await session.addInitScript(
        ({ token, user }) => {
          localStorage.setItem('token', token);
          localStorage.setItem('user', JSON.stringify({ ...user, token, role: 'developer' }));
          localStorage.setItem('devinsight_theme', 'light');
        },
        {
          token: tokens[0],
          user: {
            _id: String(users[0]._id),
            name: 'Template owner',
            githubUsername: 'owner',
            careerStack: 'Frontend',
            activeCareerStack: 'Frontend',
            experienceLevel: 'Student',
          },
        },
      );
      const page = await session.newPage();
      page.on('pageerror', (error) => report.errors.push(error.message));
      let writes = 0;
      page.on('request', (request) => {
        if (/simulator\/(save|create-sprint)/.test(request.url())) writes++;
      });
      for (const [index, label] of [
        'Focused Upskill',
        'Portfolio Push',
        'Balanced Plan',
      ].entries()) {
        const loadedContext = page.waitForResponse((response) =>
          response.url().includes('/simulator/context'),
        );
        await page.goto(`${origin}/app/scenario-simulator`);
        await page.getByRole('button', { name: new RegExp(label) }).waitFor();
        await loadedContext;
        const card = page.locator('.template-card').nth(index);
        await card.click();
        const dialog = page.getByRole('dialog');
        await dialog.waitFor();
        if (index === 0) assert.equal(await dialog.getByLabel('Skill 1').inputValue(), 'Docker');
        if (index > 0)
          assert.equal(await dialog.getByLabel('Project name').inputValue(), 'Docker showcase');
        const box = await dialog.boundingBox();
        assert(box.width <= (mobile ? 390 : 1440));
        if (mobile) {
          assert.equal(box.x, 0);
          assert.equal(box.y, 0);
          assert.equal(box.height, 844);
        } else {
          assert(Math.abs(box.x - (1440 - box.width) / 2) < 2, 'Desktop dialog is centered.');
        }
        const footer = await dialog.locator('footer').boundingBox();
        assert(
          footer.y + footer.height <= (mobile ? 844 : 1000),
          'Actions stay visible while fields scroll.',
        );
        report.layouts.push({ mobile, label, box });
        await page.screenshot({
          path: path.join(output, `${mobile ? 'mobile' : 'desktop'}-${index}.png`),
        });
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        assert.equal(await dialog.count(), 0);
        await card.click();
        await dialog.getByRole('checkbox', { name: /confirm the planning baselines/i }).check();
        const evaluation = page.waitForResponse((response) =>
          response.url().includes('/simulator/what-if'),
        );
        await dialog.getByRole('button', { name: 'Evaluate Scenario', exact: true }).click();
        const response = await evaluation;
        assert.equal(response.status(), 200);
        const input = response.request().postDataJSON();
        const result = (await response.json()).result;
        // Compare the wire representation: JSON deliberately serializes -0 as 0.
        assert.deepEqual(result, JSON.parse(JSON.stringify(engine.calculate(input))));
        assert.equal(writes, 0, 'Applying/evaluating never saves or exports.');
        report.calculations.push({
          mobile,
          label,
          improvements: result.improvements,
          breakdown: result.breakdown,
        });
        await page.locator('.result-top-grid').waitFor();
        await page.locator('#baselineHiring').fill('41');
        await page.locator('.result-top-grid').waitFor({ state: 'detached' });
        await card.waitFor();
        await card.click();
        const apply = dialog.getByRole('button', { name: 'Apply to Scenario', exact: true });
        assert.equal(await apply.isDisabled(), true);
        await dialog.getByRole('checkbox', { name: /Replace my current draft/ }).check();
        await apply.click();
        assert.equal(await dialog.count(), 0);
      }
      await session.close();
    }
    const fallbackSession = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await fallbackSession.addInitScript(
      ({ token, userId }) => {
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify({ _id: userId, role: 'developer' }));
        localStorage.setItem('devinsight_theme', 'dark');
      },
      { token: tokens[1], userId: String(users[1]._id) },
    );
    const fallbackPage = await fallbackSession.newPage();
    const fallbackLoaded = fallbackPage.waitForResponse((response) =>
      response.url().includes('/simulator/context'),
    );
    await fallbackPage.goto(`${origin}/app/scenario-simulator`);
    await fallbackLoaded;
    for (const [index, label] of ['Focused Upskill', 'Portfolio Push', 'Balanced Plan'].entries()) {
      await fallbackPage.locator('.template-card').nth(index).click();
      const dialog = fallbackPage.getByRole('dialog');
      await dialog.waitFor();
      if (index !== 1) assert.equal(await dialog.getByLabel('Skill 1').inputValue(), '');
      if (index !== 0) assert.equal(await dialog.getByLabel('Project name').inputValue(), '');
      assert.equal(
        await dialog.getByRole('button', { name: 'Apply to Scenario', exact: true }).isDisabled(),
        true,
      );
      if (index === 2)
        await fallbackPage.screenshot({ path: path.join(output, 'mobile-dark-fallback.png') });
      await fallbackPage.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });
      assert(fallbackPage.url().endsWith('/app/scenario-simulator'));
      report.checks.push(
        `${label}: second account has empty editable fallback; Escape cancels without navigation`,
      );
    }
    // Both supported theme markers must preserve the same existing dark override.
    const darkColor = await fallbackPage
      .locator('.sim-page')
      .evaluate((element) =>
        getComputedStyle(element).getPropertyValue('--sim-success-text').trim(),
      );
    assert.equal(darkColor, '#34d399');
    await fallbackPage.evaluate(() => {
      document.documentElement.removeAttribute('data-theme');
      document.documentElement.classList.add('dark');
    });
    assert.equal(
      await fallbackPage
        .locator('.sim-page')
        .evaluate((element) =>
          getComputedStyle(element).getPropertyValue('--sim-success-text').trim(),
        ),
      darkColor,
    );
    await fallbackSession.close();
    const input = {
      ruleVersion: engine.RULE_VERSION,
      baselineAuthority: 'user-assumption',
      baselineConfirmed: true,
      baselineHiringScore: 40,
      baselineJobMatch: 35,
      role: 'frontend',
      experienceLevel: 'junior',
      durationWeeks: 6,
      skills: ['Docker', 'TypeScript'],
      projects: [{ name: 'Docker showcase', impact: 70, complexity: 'medium', weeks: 3 }],
    };
    const payload = { ...input, evaluation: engine.calculate(input).evaluation };
    const saved = await call('/save', payload);
    assert.equal(saved.status, 201);
    const exported = { ...payload, scenarioId: saved.body.scenario._id, mode: 'draft' };
    assert.equal((await call('/create-sprint', exported)).status, 200);
    const receipt = await call('/create-sprint', exported);
    assert.equal(receipt.status, 200);
    assert.equal((await call('/create-sprint', exported, 1)).status, 404);
    assert.equal((await call('/history', null, 1)).body.history.length, 0);
    assert.deepEqual(report.errors, []);
    report.checks.push(
      'Real compatible source context; completed-project exclusion; account isolation',
      'All three templates at desktop/mobile: cancellation, dirty consent, explicit baseline, real HTTP V2 equality and stale-result invalidation',
      'Apply/evaluate never persist; immutable save and idempotent Sprint export; foreign snapshot rejected',
    );
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser?.close();
    if (server) await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    await mongo.stop();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
