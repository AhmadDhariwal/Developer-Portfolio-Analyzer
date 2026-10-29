'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  crypto = require('node:crypto'),
  fs = require('node:fs'),
  path = require('node:path');
const mongoose = require('mongoose');
test(
  'authenticated Integrations local API acceptance and persisted downstream propagation',
  { timeout: 120000 },
  async (t) => {
    const oldEnv = { ...process.env };
    const runtime = await require('./fixtures/integrationsRuntime').start();
    Object.assign(process.env, {
      NODE_ENV: 'test',
      REDIS_URL: runtime.redisUrl,
      JWT_SECRET: crypto.randomBytes(32).toString('hex'),
      INTEGRATION_TOKEN_ACTIVE_KEY: 'local',
      INTEGRATION_TOKEN_KEYS: JSON.stringify({ local: crypto.randomBytes(32).toString('base64') }),
      INTEGRATION_ACTIONS_PER_MIN: '100',
      GITHUB_INTEGRATION_CLIENT_ID: 'local-fixture',
      GITHUB_INTEGRATION_CLIENT_SECRET: 'local-fixture-secret',
      GITHUB_INTEGRATION_CALLBACK_URL: 'http://localhost:5000/api/integrations/github/callback',
      FRONTEND_URL: 'http://localhost:4200'
    });
    for (const key of [
      'GROQ_API_KEY',
      'OPENAI_API_KEY',
      'GEMINI_API_KEY',
      'ANTHROPIC_API_KEY',
      'OPENROUTER_API_KEY',
      'SENDGRID_API_KEY',
      'SMTP_PASS'
    ])
      delete process.env[key];
    const cache = require('../services/redisCacheService'),
      Connection = require('../models/integrationConnection'),
      Insight = require('../models/integrationInsight'),
      Log = require('../models/integrationSyncLog'),
      User = require('../models/user');
    const { getAdapter } = require('../services/integrations');
    const leet = getAdapter('leetcode'),
      github = getAdapter('github');
    const originals = {
      leet: leet.ingestData,
      exchange: github.exchangeCodeForToken,
      identity: github.getExternalIdentity,
      refresh: github.refreshAccessToken,
      ingest: github.ingestData,
      revoke: github.revokeToken
    };
    let failed = false,
      refreshes = 0,
      updatedGitHub = false;
    leet.ingestData = async () => {
      if (failed) throw Error('fixture upstream failure');
      return {
        profile: { solvedProblems: 120 },
        activity: { easy: 50, medium: 50, hard: 20 },
        inferredSkills: ['Algorithms']
      };
    };
    github.exchangeCodeForToken = async () => ({
      accessToken: 'local-access',
      refreshToken: 'local-refresh',
      expiresIn: 1,
      scope: 'read:user'
    });
    github.getExternalIdentity = async () => ({ id: 42, username: 'local-owner' });
    github.refreshAccessToken = async () => {
      refreshes++;
      return {
        accessToken: 'local-rotated',
        refreshToken: 'local-refresh-rotated',
        expiresIn: 3600
      };
    };
    github.ingestData = async () => ({
      profile: updatedGitHub
        ? { publicRepos: 5, followers: 5 }
        : { publicRepos: 80, followers: 500 },
      activity: updatedGitHub
        ? { starsReceived: 1, forksReceived: 0 }
        : { starsReceived: 500, forksReceived: 200 },
      inferredSkills: updatedGitHub ? ['Testing'] : ['TypeScript']
    });
    github.revokeToken = async () => {};
    const ai = require('../services/aiservice');
    const originalAI = ai.runAIAnalysis;
    ai.runAIAnalysis = async (_prompt, fallback) => fallback;
    let server;
    const results = { requests: [], assertions: [] };
    t.after(async () => {
      if (server) await new Promise((resolve) => server.close(resolve));
      leet.ingestData = originals.leet;
      Object.assign(github, {
        exchangeCodeForToken: originals.exchange,
        getExternalIdentity: originals.identity,
        refreshAccessToken: originals.refresh,
        ingestData: originals.ingest,
        revokeToken: originals.revoke
      });
      ai.runAIAnalysis = originalAI;
      await cache.closeRedisCache();
      await mongoose.disconnect();
      results.cleanup = await runtime.stop();
      for (const k of Object.keys(process.env)) if (!(k in oldEnv)) delete process.env[k];
      Object.assign(process.env, oldEnv);
      const dir = process.env.INTEGRATION_ACCEPTANCE_OUTPUT_DIR
        ? path.resolve(process.env.INTEGRATION_ACCEPTANCE_OUTPUT_DIR)
        : path.resolve(__dirname, '../../verification/integrations/local-acceptance');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'api-results.json'), JSON.stringify(results, null, 2));
    });
    await mongoose.connect(runtime.uri, { autoIndex: false });
    await cache.initRedisCache({ silent: true });
    await Promise.all([
      Connection.createCollection(),
      Insight.createCollection(),
      Log.createCollection(),
      User.createCollection()
    ]);
    await Connection.collection.createIndex({ userId: 1, provider: 1 }, { unique: true });
    await Insight.collection.createIndex({ userId: 1 }, { unique: true });
    const owner = new mongoose.Types.ObjectId(),
      foreign = new mongoose.Types.ObjectId();
    await User.collection.insertMany(
      [owner, foreign].map((id, index) => ({
        _id: id,
        name: 'Local fixture',
        email: 'fixture' + index + '@invalid.test',
        role: 'developer',
        careerStack: 'Frontend',
        activeCareerStack: 'Frontend',
        experienceLevel: 'Mid-level',
        activeExperienceLevel: 'Mid-level',
        notifications: { weeklyScoreReport: false },
        isActive: true
      }))
    );
    const express = require('express'),
      jwt = require('jsonwebtoken'),
      app = express();
    app.use(express.json({ verify: require('../middleware/integrationWebhookBody') }));
    for (const [p, r] of [
      ['integrations', 'integrations.routes'],
      ['dashboard', 'dashboard.routes'],
      ['simulator', 'scenarioSimulator.routes'],
      ['career-sprint', 'careerSprint.routes'],
      ['weekly-reports', 'weeklyReport.routes'],
      ['analysis', 'analysis.routes']
    ])
      app.use('/api/' + p, require('../routes/' + r));
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    const signed = (id) =>
      jwt.sign({ id: String(id) }, process.env.JWT_SECRET, {
        issuer: 'devinsight-api',
        audience: 'devinsight-web'
      });
    async function call(method, url, body, actor = owner) {
      const res = await fetch(origin + '/api/' + url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(actor ? { Authorization: 'Bearer ' + signed(actor) } : {})
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      const json = await res.json();
      results.requests.push({ method, url, status: res.status });
      return { status: res.status, body: json };
    }
    const assertOK = (result) => {
      assert.equal(result.status, 200, JSON.stringify(result.body));
      return result.body;
    };
    assert.equal((await call('GET', 'integrations/connections', undefined, null)).status, 401);
    const initial = assertOK(await call('GET', 'career-sprint/current'));
    assert.deepEqual(initial.signalsUsed?.integrations?.usedProviders || [], []);
    assertOK(
      await call('POST', 'integrations/manual/connect', {
        provider: 'leetcode',
        externalUsername: 'fixture-handle'
      })
    );
    let insight = assertOK(await call('GET', 'integrations/insights'));
    assert.equal(insight.providers[0].ownershipVerified, false);
    assert.ok(insight.mergedSkills.includes('Algorithms'));
    assert.equal(
      assertOK(await call('GET', 'integrations/insights', undefined, foreign)).providers.length,
      0
    );
    assert.equal(
      (await call('POST', 'integrations/sync-now', { provider: 'leetcode' }, foreign)).status,
      409
    );
    assertOK(await call('DELETE', 'integrations/connections/leetcode', undefined, foreign));
    assert.equal(
      (await Connection.findOne({ userId: owner, provider: 'leetcode' }).lean()).status,
      'connected'
    );
    const dashboard = assertOK(await call('GET', 'dashboard/integration-analytics'));
    assert.ok(JSON.stringify(dashboard).includes('leetcode'));
    const scenario = assertOK(await call('GET', 'simulator/context'));
    assert.ok(JSON.stringify(scenario).includes('Algorithms'));
    const sprint = assertOK(await call('GET', 'career-sprint/current'));
    assert.ok(JSON.stringify(sprint).includes('leetcode'));
    assertOK(await call('POST', 'integrations/sync-now', { provider: 'leetcode' }));
    failed = true;
    assert.equal(
      (await call('POST', 'integrations/sync-now', { provider: 'leetcode' })).status,
      502
    );
    failed = false;
    assert.equal(
      assertOK(await call('GET', 'integrations/insights')).integrationScore,
      insight.integrationScore
    );
    const started = assertOK(
      await call('POST', 'integrations/oauth/start', { provider: 'github' })
    );
    assertOK(
      await call('POST', 'integrations/oauth/callback', {
        provider: 'github',
        state: started.state,
        code: 'fixture-code',
        username: 'untrusted-handle'
      })
    );
    assert.equal(
      (
        await call('POST', 'integrations/oauth/callback', {
          provider: 'github',
          state: started.state,
          code: 'fixture-code'
        })
      ).status,
      400
    );
    assertOK(await call('POST', 'integrations/ingest', { provider: 'github' }));
    assert.equal(refreshes, 1);
    const stored = await Connection.findOne({ userId: owner, provider: 'github' }).lean();
    assert.ok(stored.accessToken.startsWith('enc:v1:'));
    assert.equal(stored.externalUsername, 'local-owner');
    const signal = await require('../services/developerSignalService').summarizeIntegrationSignal(
      owner
    );
    assert.deepEqual(signal.verifiedSkills, ['TypeScript']);
    const portfolioBody = {
      username: 'fixture-owner',
      githubAnalysis: {
        scores: { codeQuality: 70, skillCoverage: 70, industryReadiness: 70, projectImpact: 70 },
        healthScore: 70,
        repoCount: 3,
        languages: ['TypeScript']
      },
      resumeAnalysis: { skills: ['TypeScript'], atsScore: 70 }
    };
    const portfolio = assertOK(await call('POST', 'analysis/portfolio-score', portfolioBody));
    assert.ok(Number.isFinite(portfolio.overallScore));
    const weekly = assertOK(await call('POST', 'weekly-reports/generate', { forceRefresh: true }));
    assert.ok(JSON.stringify(weekly).includes('github'));
    const stableCache = assertOK(await call('POST', 'analysis/portfolio-score', portfolioBody));
    assert.equal(
      stableCache.fromCache,
      true,
      'Unchanged insight must reuse the owned Portfolio cache'
    );
    const beforeUpdate = assertOK(await call('GET', 'integrations/insights'));
    updatedGitHub = true;
    assertOK(await call('POST', 'integrations/sync-now', { provider: 'github' }));
    const afterUpdate = assertOK(await call('GET', 'integrations/insights'));
    assert.notEqual(afterUpdate.integrationScore, beforeUpdate.integrationScore);
    assert.ok(afterUpdate.mergedSkills.includes('Testing'));
    assert.ok(!afterUpdate.mergedSkills.includes('TypeScript'));
    assert.equal(afterUpdate.providers.filter((entry) => entry.provider === 'github').length, 1);
    const adopted = assertOK(await call('POST', 'analysis/portfolio-score', portfolioBody));
    assert.notEqual(adopted.fromCache, true, 'Changed insight must invalidate the Portfolio cache');
    assert.equal(adopted.scoring.evidence.inputs.integration, afterUpdate.integrationScore);
    const adoptedCache = assertOK(await call('POST', 'analysis/portfolio-score', portfolioBody));
    assert.equal(adoptedCache.fromCache, true);
    assert.ok(JSON.stringify(assertOK(await call('GET', 'simulator/context'))).includes('Testing'));
    const updatedSignal =
      await require('../services/developerSignalService').summarizeIntegrationSignal(owner);
    assert.deepEqual(updatedSignal.verifiedSkills, ['Testing']);
    assert.equal(
      assertOK(await call('GET', 'integrations/insights', undefined, foreign)).providers.length,
      0
    );
    results.insightUpdate = {
      beforeIntegration: beforeUpdate.integrationScore,
      afterIntegration: afterUpdate.integrationScore,
      adoptedIntegration: adopted.scoring.evidence.inputs.integration,
      stableCacheHit: stableCache.fromCache,
      changedRevisionCacheHit: adopted.fromCache === true,
      adoptedRevisionCacheHit: adoptedCache.fromCache,
      normalizedProviders: afterUpdate.providers.map((entry) => entry.provider),
      verifiedSkills: updatedSignal.verifiedSkills
    };
    assertOK(await call('DELETE', 'integrations/connections/github'));
    assertOK(await call('DELETE', 'integrations/connections/leetcode'));
    insight = assertOK(await call('GET', 'integrations/insights'));
    assert.equal(insight.providers.length, 0);
    assert.equal(insight.integrationScore, 0);
    const cleared = assertOK(await call('GET', 'career-sprint/current'));
    assert.deepEqual(cleared.signalsUsed?.integrations?.usedProviders || [], []);
    const disconnected = await Connection.findOne({ userId: owner, provider: 'github' }).lean();
    assert.equal(disconnected.accessToken, '');
    const portfolioAfter = assertOK(await call('POST', 'analysis/portfolio-score', portfolioBody));
    results.portfolioCache = {
      before: portfolio.overallScore,
      after: portfolioAfter.overallScore,
      cached: portfolioAfter.fromCache || false,
      beforeIntegration: portfolio.scoring.evidence.inputs.integration,
      afterIntegration: portfolioAfter.scoring.evidence.inputs.integration
    };
    assert.equal(
      portfolioAfter.scoring.evidence.inputs.integration,
      null,
      'Disconnected integration must not survive in cached Portfolio inputs'
    );
    results.assertions = [
      'JWT authorization',
      'manual observations',
      'owner isolation including foreign sync/disconnect',
      'changed insight replaces provider snapshot and downstream caches adopt revision',
      'OAuth identity/state',
      'encrypted rotating refresh',
      'sync and ingest API',
      'sanitized failure preserves insight',
      'Dashboard analytics',
      'Scenario persisted suggestions',
      'Sprint revision cache',
      'Portfolio score API',
      'Weekly report API without email',
      'disconnect clears credentials and downstream state'
    ];
  }
);
