'use strict';

// Opt-in live acceptance. Uses the configured Redis controls and a disposable local Mongo replica.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { MongoClient } = require('mongodb');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const selection = process.argv.find((arg) => arg.startsWith('--providers='));
const selected = (
  selection?.split('=')[1] || 'leetcode,stackoverflow,portfolio,certifications,devblogs'
).split(',');
const inputs = {
  leetcode: 'lee215',
  stackoverflow: '22656',
  portfolio: 'https://leerob.com/',
  certifications: 'AWS Certified Solutions Architect',
  devblogs: 'devto@swyx'
};
for (const provider of selected) assert.ok(Object.hasOwn(inputs, provider), 'Unknown provider');
const outputName =
  process.argv.find((arg) => arg.startsWith('--output='))?.split('=')[1] ||
  'real-provider-live-results.json';
assert.match(outputName, /^[a-z0-9-]+\.json$/);
const output = path.resolve(__dirname, '../../verification/integrations', outputName);
const reuseLiveEvidence = process.argv.includes('--reuse-live-evidence');
const reusableEvidence = reuseLiveEvidence
  ? ['real-provider-live-followup.json', 'real-provider-live-results.json'].map((filename) => ({
      filename,
      data: JSON.parse(fs.readFileSync(path.resolve(path.dirname(output), filename), 'utf8'))
    }))
  : [];
const results = { startedAt: new Date().toISOString(), infrastructure: {}, providers: [] };
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function startMongo() {
  const binary =
    process.env.INTEGRATION_TEST_MONGOD ||
    'C:\\Program Files\\MongoDB\\Server\\8.2\\bin\\mongod.exe';
  assert.ok(fs.existsSync(binary), 'Installed MongoDB server binary is required');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'devinsight-real-integrations-'));
  const root = fs.realpathSync(directory);
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const child = spawn(
    binary,
    [
      '--dbpath',
      root,
      '--bind_ip',
      '127.0.0.1',
      '--port',
      String(port),
      '--replSet',
      'integration-live',
      '--wiredTigerCacheSizeGB',
      '0.25',
      '--quiet'
    ],
    { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] }
  );
  let launchError;
  child.on('error', (error) => {
    launchError = error;
  });
  let direct;
  async function stop() {
    await direct?.close();
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      const stopped = new Promise((resolve) => child.once('exit', resolve));
      child.kill();
      await Promise.race([stopped, delay(5000)]);
    }
    assert.ok(
      child.exitCode !== null || child.signalCode !== null || launchError,
      'Disposable Mongo process must stop before cleanup'
    );
    const removed = [];
    function clean(directoryPath) {
      for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
        const target = path.resolve(directoryPath, entry.name);
        assert.ok(target.startsWith(root + path.sep) && !entry.isSymbolicLink());
        if (entry.isDirectory()) clean(target);
        else {
          fs.unlinkSync(target);
          removed.push(path.relative(root, target));
        }
      }
      fs.rmdirSync(directoryPath); // Exact, verified empty task-owned directory; never recursive removal.
    }
    clean(root);
    return { mongoStopped: true, temporaryFilesRemoved: removed.length, productionDataUsed: false };
  }
  try {
    for (let attempt = 0; attempt < 50; attempt++) {
      if (launchError) throw launchError;
      if (child.exitCode !== null) throw Error('Disposable Mongo exited before readiness');
      direct = new MongoClient(`mongodb://127.0.0.1:${port}/?directConnection=true`, {
        serverSelectionTimeoutMS: 300
      });
      try {
        await direct.connect();
        break;
      } catch {
        await direct.close();
        direct = null;
        await delay(150);
      }
    }
    assert.ok(direct, 'Disposable Mongo readiness deadline');
    await direct.db('admin').command({
      replSetInitiate: {
        _id: 'integration-live',
        members: [{ _id: 0, host: `127.0.0.1:${port}` }]
      }
    });
    let primary = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      primary = (await direct.db('admin').command({ hello: 1 })).isWritablePrimary;
      if (primary) break;
      await delay(150);
    }
    assert.ok(primary, 'Replica primary election deadline');
    return {
      uri: `mongodb://127.0.0.1:${port}/integration_live_acceptance?replicaSet=integration-live`,
      stop
    };
  } catch (error) {
    await stop();
    throw error;
  }
}

function sourceSample(url, data) {
  const host = new URL(url).hostname;
  if (host === 'leetcode.com')
    return data?.data?.matchedUser || { errors: data?.errors?.map((e) => e.message) };
  if (host === 'api.stackexchange.com')
    return {
      items: data?.items?.map((item) =>
        Object.fromEntries(
          [
            'user_id',
            'reputation',
            'answer_count',
            'question_count',
            'badge_counts',
            'tag_name',
            'name'
          ]
            .filter((key) => item[key] !== undefined)
            .map((key) => [key, item[key]])
        )
      ),
      quotaRemaining: data?.quota_remaining,
      backoff: data?.backoff
    };
  if (host === 'dev.to')
    return {
      articles: Array.isArray(data)
        ? data.map((item) => ({
            id: item.id,
            reactions: item.positive_reactions_count,
            views: item.page_views_count,
            publishedAt: item.published_at,
            tags: item.tag_list
          }))
        : undefined
    };
  if (host === 'gql.hashnode.com')
    return {
      data: data?.data,
      errors: data?.errors?.map((e) => ({
        message: e.message,
        code: e.extensions?.code
      }))
    };
  if (host === 'leerob.com')
    return {
      htmlBytes: Buffer.byteLength(String(data)),
      hasMeta: /<meta\s+name=["']description["']/i.test(String(data)),
      hasViewport: /<meta\s+name=["']viewport["']/i.test(String(data)),
      hasOgTags: /<meta\s+property=["']og:/i.test(String(data))
    };
  return {};
}

function compareExtraction(provider, stored, responses) {
  const profile = stored.normalized.profile;
  const activity = stored.normalized.activity;
  if (provider === 'leetcode') {
    const user = responses.map((r) => r.sample).findLast((sample) => sample?.username);
    assert.ok(user, 'Public GraphQL user data is required');
    const counts = (user.submitStats || user.submitStatsGlobal).acSubmissionNum;
    for (const name of ['Easy', 'Medium', 'Hard'])
      assert.equal(activity[name.toLowerCase()], counts.find((v) => v.difficulty === name).count);
    assert.equal(profile.solvedProblems, activity.easy + activity.medium + activity.hard);
    assert.equal(profile.ranking, user.profile.ranking);
    assert.equal(profile.reputation, user.profile.reputation);
  } else if (provider === 'stackoverflow') {
    const user = responses.flatMap((r) => r.sample?.items || []).find((item) => item.user_id);
    assert.equal(profile.reputation, user.reputation);
    assert.equal(profile.answerCount, user.answer_count);
    assert.equal(profile.questionCount, user.question_count);
    assert.equal(
      profile.totalBadges,
      Object.values(user.badge_counts).reduce((a, b) => a + b, 0)
    );
  } else if (provider === 'portfolio') {
    const source = responses.find((r) => r.sample?.htmlBytes)?.sample;
    assert.ok(source);
    assert.equal(profile.statusCode, 200);
    for (const field of ['hasMeta', 'hasViewport', 'hasOgTags'])
      assert.equal(activity[field], source[field]);
  } else if (provider === 'certifications') {
    assert.equal(profile.totalCertifications, 1);
    assert.deepEqual(activity.certifications, [inputs.certifications]);
    assert.equal(stored.evidenceKind, 'self-reported');
  } else if (provider === 'devblogs') {
    const articles = responses.find((r) => r.url.includes('dev.to') && r.status === 200)?.sample
      .articles;
    assert.ok(articles?.length);
    assert.equal(profile.totalArticles, articles.length);
    assert.equal(
      profile.totalReactions,
      articles.reduce((sum, article) => sum + article.reactions, 0)
    );
    assert.equal(profile.totalViews, null);
    assert.equal(activity.recentArticles[0].publishedAt, articles[0].publishedAt);
    assert.ok(!responses.some((r) => r.url.includes('hashnode')));
  }
  assert.equal(stored.ownershipVerified, false);
  assert.ok(Number.isFinite(stored.profileScore) && Number.isFinite(stored.activityScore));
  assert.ok(new Date(stored.syncedAt).getTime() >= new Date(results.startedAt).getTime());
}

async function main() {
  const originalKeyringConfigured = Boolean(
    process.env.INTEGRATION_TOKEN_KEYS && process.env.INTEGRATION_TOKEN_ACTIVE_KEY
  );
  results.oauthConfiguration = Object.fromEntries(
    ['github', 'linkedin'].map((provider) => {
      const keys =
        provider === 'github'
          ? [
              'GITHUB_INTEGRATION_CLIENT_ID',
              'GITHUB_INTEGRATION_CLIENT_SECRET',
              'GITHUB_INTEGRATION_CALLBACK_URL'
            ]
          : ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET', 'LINKEDIN_OAUTH_REDIRECT_URI'];
      const redirect = process.env[keys[2]];
      let redirectValid = false;
      try {
        const parsed = new URL(redirect);
        redirectValid =
          !parsed.username &&
          !parsed.password &&
          !parsed.hash &&
          (parsed.protocol === 'https:' ||
            (parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname)));
      } catch {
        /* Invalid/missing redirects remain blocked. */
      }
      return [
        provider,
        {
          credentialsPresent: keys.slice(0, 2).every((key) => Boolean(process.env[key])),
          redirectConfigured: Boolean(redirect),
          redirectValid,
          consentAvailable: false
        }
      ];
    })
  );
  Object.assign(process.env, {
    NODE_ENV: 'test',
    JWT_SECRET: crypto.randomBytes(32).toString('hex'),
    INTEGRATION_TOKEN_ACTIVE_KEY: 'disposable-live',
    INTEGRATION_TOKEN_KEYS: JSON.stringify({
      'disposable-live': crypto.randomBytes(32).toString('base64')
    })
  });
  for (const key of [
    'GITHUB_TOKEN',
    'GROQ_API_KEY',
    'OPENAI_API_KEY',
    'GEMINI_API_KEY',
    'ANTHROPIC_API_KEY',
    'OPENROUTER_API_KEY',
    'SENDGRID_API_KEY',
    'SMTP_PASS'
  ])
    delete process.env[key];
  const mongoose = require('mongoose');
  const cache = require('../services/redisCacheService');
  const Connection = require('../models/integrationConnection');
  const Insight = require('../models/integrationInsight');
  const Log = require('../models/integrationSyncLog');
  const User = require('../models/user');
  let runtime;
  let server;
  let current;
  const axios = require('axios');
  const requestInterceptor = axios.interceptors.request.use((config) => {
    if (current) config.acceptanceIndex = results.providers.indexOf(current);
    return config;
  });
  const interceptor = axios.interceptors.response.use(
    (response) => {
      const owner = results.providers[response.config.acceptanceIndex];
      if (owner)
        owner.requests.push({
          url: response.config.url,
          status: response.status,
          sample: sourceSample(response.config.url, response.data)
        });
      return response;
    },
    (error) => {
      const owner = results.providers[error.config?.acceptanceIndex];
      if (owner)
        owner.requests.push({
          url: error.config?.url,
          status: error.response?.status || null,
          code: error.code,
          sample: error.response ? sourceSample(error.config.url, error.response.data) : {}
        });
      return Promise.reject(error);
    }
  );
  try {
    const redis = await cache.initRedisCache({ silent: true, probeOnly: true });
    assert.ok(redis, 'Configured application Redis client must be ready');
    results.infrastructure.redisPing = await cache
      .getRedisCacheClient({ commandTimeoutMs: 500 })
      .ping();
    results.infrastructure.redisCommandTimeoutMs = 500;
    assert.equal(results.infrastructure.redisPing, 'PONG');
    runtime = await startMongo();
    await mongoose.connect(runtime.uri, { autoIndex: false });
    await Promise.all([
      Connection.createCollection(),
      Insight.createCollection(),
      Log.createCollection(),
      User.createCollection()
    ]);
    await Connection.collection.createIndex({ userId: 1, provider: 1 }, { unique: true });
    await Insight.collection.createIndex({ userId: 1 }, { unique: true });
    await mongoose.connection.db.createCollection('transaction_probe');
    await mongoose.connection.transaction(async (session) => {
      await mongoose.connection.db
        .collection('transaction_probe')
        .insertOne({ disposable: true }, { session });
    });
    const mongoBuild = await mongoose.connection.db.admin().command({ buildInfo: 1 });
    results.infrastructure.mongo = {
      version: mongoBuild.version,
      replicaSet: 'integration-live',
      transactionCommitted: true,
      isolation: 'ephemeral port and task-owned temporary directory',
      originalKeyringConfigured,
      temporaryKeyring: 'process-only; disposable test database only'
    };
    const express = require('express');
    const jwt = require('jsonwebtoken');
    const app = express();
    app.use(express.json());
    // Narrative AI is outside provider acceptance; use its existing deterministic fallback.
    require('../services/aiservice').runAIAnalysis = async (_prompt, fallback) => fallback;
    for (const [prefix, route] of [
      ['integrations', 'integrations.routes'],
      ['dashboard', 'dashboard.routes'],
      ['simulator', 'scenarioSimulator.routes'],
      ['career-sprint', 'careerSprint.routes'],
      ['weekly-reports', 'weeklyReport.routes'],
      ['analysis', 'analysis.routes'],
      ['skillgap', 'skillGap.routes']
    ])
      app.use('/api/' + prefix, require('../routes/' + route));
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port + '/api/';
    for (const provider of selected) {
      current = {
        provider,
        publicInput: inputs[provider],
        requests: [],
        status: 'BLOCKED',
        stages: {}
      };
      results.providers.push(current);
      const owner = new mongoose.Types.ObjectId();
      await User.collection.insertOne({
        _id: owner,
        name: 'Disposable acceptance fixture',
        email: owner + '@invalid.test',
        role: 'developer',
        isActive: true,
        careerStack: 'Frontend',
        activeCareerStack: 'Frontend',
        experienceLevel: 'Mid-level',
        activeExperienceLevel: 'Mid-level',
        notifications: { weeklyScoreReport: false }
      });
      const token = jwt.sign({ id: String(owner) }, process.env.JWT_SECRET, {
        issuer: 'devinsight-api',
        audience: 'devinsight-web'
      });
      async function call(method, url, body) {
        const response = await fetch(origin + url, {
          method,
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          ...(body === undefined ? {} : { body: JSON.stringify(body) })
        });
        const data = await response.json();
        assert.equal(response.status, 200, `${url}: ${response.status} ${data.message || ''}`);
        return data;
      }
      const portfolioBody = {
        username: 'disposable-integration-fixture',
        githubAnalysis: {
          scores: { codeQuality: 0, skillCoverage: 0, industryReadiness: 0, projectImpact: 0 },
          healthScore: 0,
          repoCount: 0,
          languages: []
        },
        resumeAnalysis: { skills: [], atsScore: 0 }
      };
      try {
        const beforePortfolio = await call('POST', 'analysis/portfolio-score', portfolioBody);
        await call('GET', 'career-sprint/current');
        let replay;
        if (reuseLiveEvidence) {
          const evidence = reusableEvidence.find((entry) =>
            entry.data.providers.some(
              (row) =>
                row.provider === provider &&
                row.stages.extractionPersistence === 'PASS' &&
                row.stages.syncDuplicatePrevention === 'PASS'
            )
          );
          assert.ok(evidence, 'Previously verified live extraction and sync evidence is required');
          replay = evidence.data.providers.find((row) => row.provider === provider);
          const persistence = require('../services/integrationPersistenceService');
          const operation = await persistence.beginManual(owner, provider);
          await persistence.connect(
            owner,
            provider,
            {
              status: 'connected',
              externalUsername: inputs[provider],
              externalAccountId: '',
              ownershipVerified: false,
              accessToken: '',
              refreshToken: '',
              tokenType: 'Bearer',
              tokenExpiresAt: null,
              scopes: ['public_profile'],
              metadata: {},
              lastSyncedAt: new Date(replay.persisted.syncedAt)
            },
            replay.persisted,
            operation.oauthAttempt
          );
          current.sourceEvidence = {
            file: evidence.filename,
            provider,
            liveStagesReused: ['connect', 'extractionPersistence', 'syncDuplicatePrevention'],
            downstreamUsesRehydratedRealSnapshot: true
          };
        } else {
          await call('POST', 'integrations/manual/connect', {
            provider,
            externalUsername: inputs[provider]
          });
        }
        current.stages.connect = 'PASS';
        let insight = await call('GET', 'integrations/insights');
        const stored = insight.providers.find((row) => row.provider === provider);
        if (!replay) compareExtraction(provider, stored, current.requests);
        current.stages.extractionPersistence = 'PASS';
        current.persisted = stored;
        const revisionBeforeSync = insight.updatedAt;
        const connected = await Connection.findOne({ userId: owner, provider }).lean();
        assert.ok(connected.lastSyncedAt && connected.nextSyncAt);
        if (!replay) {
          await call('POST', 'integrations/sync-now', { provider });
          insight = await call('GET', 'integrations/insights');
          assert.notEqual(insight.updatedAt, revisionBeforeSync);
        }
        assert.equal(insight.providers.filter((row) => row.provider === provider).length, 1);
        assert.equal(await Connection.countDocuments({ userId: owner, provider }), 1);
        current.stages.syncDuplicatePrevention = 'PASS';
        if (replay?.stages.backgroundSync)
          current.stages.backgroundSync = replay.stages.backgroundSync;
        if (provider === 'certifications') {
          if (replay) await call('POST', 'integrations/sync-now', { provider });
          await Connection.updateOne(
            { userId: owner, provider },
            { $set: { nextSyncAt: new Date(0) } }
          );
          await require('../services/integrationSyncService').syncDueConnections();
          assert.ok(
            await Log.exists({ userId: owner, provider, reason: 'polling', status: 'success' })
          );
          assert.ok(
            (await Connection.findOne({ userId: owner, provider }).lean()).nextSyncAt > new Date()
          );
          current.stages.backgroundSync = 'PASS';
        }
        const dashboard = await call('GET', 'dashboard/integration-analytics');
        assert.ok(dashboard.cards.some((card) => card.provider === provider));
        const scenario = (await call('GET', 'simulator/context')).context;
        const sprint = await call('GET', 'career-sprint/current');
        const weekly = await call('POST', 'weekly-reports/generate', { forceRefresh: true });
        const skillGap = await call('POST', 'skillgap/skill-gap', {});
        const adopted = await call('POST', 'analysis/portfolio-score', portfolioBody);
        const cached = await call('POST', 'analysis/portfolio-score', portfolioBody);
        assert.equal(adopted.scoring.evidence.inputs.integration, insight.integrationScore);
        assert.notEqual(adopted.fromCache, true);
        assert.equal(cached.fromCache, true);
        const signal =
          await require('../services/developerSignalService').summarizeIntegrationSignal(owner);
        assert.deepEqual(signal.verifiedSkills, []);
        assert.ok(signal.usedProviders.includes(provider));
        assert.deepEqual(sprint.signalsUsed.integrations.usedProviders, [provider]);
        assert.deepEqual(weekly.meta.snapshot.integrations.connectedProviders, [provider]);
        assert.equal(weekly.meta.snapshot.integrations.integrationScore, insight.integrationScore);
        assert.deepEqual(skillGap.signalsUsed.integrations.providers, [provider]);
        assert.equal(skillGap.signalsUsed.integrations.score, insight.integrationScore);
        assert.deepEqual(skillGap.provenSkills, []);
        current.downstream = {
          dashboard: true,
          scenario: stored.inferredSkills.every((skill) =>
            scenario.signals?.inferredSkills?.includes(skill)
          ),
          scenarioInferredSkills: scenario.signals?.inferredSkills,
          scenarioDemonstratedSkills: scenario.signals?.demonstratedSkills,
          sprint: true,
          sprintProviders: sprint.signalsUsed.integrations.usedProviders,
          weeklyReport: true,
          weeklyIntegrationSnapshot: weekly.meta.snapshot.integrations,
          skillGap: true,
          skillGapIntegration: skillGap.signalsUsed.integrations,
          skillGapProvenSkills: skillGap.provenSkills,
          verifiedSkills: signal.verifiedSkills,
          observedSkills: signal.detectedSkills,
          portfolioBefore: beforePortfolio.scoring.evidence.inputs.integration,
          portfolioAfter: adopted.scoring.evidence.inputs.integration,
          cacheInvalidated: adopted.fromCache !== true,
          cacheReused: cached.fromCache === true,
          revisionBeforeSync: replay ? replay.downstream.revisionBeforeSync : revisionBeforeSync,
          revisionAfterSync: replay ? replay.downstream.revisionAfterSync : insight.updatedAt,
          ...(replay ? { rehydratedRevision: insight.updatedAt } : {})
        };
        assert.ok(
          current.downstream.scenario &&
            current.downstream.sprint &&
            current.downstream.weeklyReport &&
            current.downstream.skillGap,
          'All downstream consumers must expose source provenance'
        );
        current.stages.downstream = 'PASS';
        await call('DELETE', 'integrations/connections/' + provider);
        const disconnected = await call('GET', 'integrations/insights');
        assert.equal(disconnected.providers.length, 0);
        assert.equal(disconnected.integrationScore, 0);
        const after = await call('POST', 'analysis/portfolio-score', portfolioBody);
        assert.equal(after.scoring.evidence.inputs.integration, null);
        const cleared = await call('GET', 'career-sprint/current');
        assert.deepEqual(cleared.signalsUsed?.integrations?.usedProviders || [], []);
        const row = await Connection.findOne({ userId: owner, provider }).lean();
        assert.equal(row.status, 'disconnected');
        assert.equal(row.accessToken, '');
        current.stages.disconnect = 'PASS';
        const clearedScenario = (await call('GET', 'simulator/context')).context;
        assert.deepEqual(clearedScenario.signals.inferredSkills, []);
        current.downstream.disconnectedPortfolioInput = after.scoring.evidence.inputs.integration;
        current.downstream.disconnectedScenarioSkills = clearedScenario.signals.inferredSkills;
        current.downstream.disconnectedSprintProviders =
          cleared.signalsUsed?.integrations?.usedProviders || [];
        current.status = 'PASS';
      } catch (error) {
        current.status = 'FAIL';
        current.failure = String(error.message).slice(0, 500);
        current.downstreamStoppedAtFailedPrerequisite = !current.stages.extractionPersistence;
      }
      console.log(
        provider + ': ' + current.status + (current.failure ? ' — ' + current.failure : '')
      );
      current = null;
    }
  } finally {
    axios.interceptors.request.eject(requestInterceptor);
    axios.interceptors.response.eject(interceptor);
    if (server) await new Promise((resolve) => server.close(resolve));
    await cache.closeRedisCache();
    await mongoose.disconnect();
    if (runtime) results.cleanup = await runtime.stop();
  }
}

main()
  .catch((error) => {
    results.fatal = String(error.message).slice(0, 500);
    process.exitCode = 1;
  })
  .finally(() => {
    results.finishedAt = new Date().toISOString();
    fs.writeFileSync(output, JSON.stringify(results, null, 2) + '\n');
    console.log('Sanitized evidence: ' + output);
  });
