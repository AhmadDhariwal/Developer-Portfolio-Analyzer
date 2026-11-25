const assert = require('node:assert/strict');
const test = require('node:test');
const { randomBytes } = require('node:crypto');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const mongoose = require('mongoose');
const { startMongo } = require('../fixtures/disposableRequestMongo');
const {
  seedAnalyticsFixture,
  referenceCards,
  referenceMetrics,
  sourceModels
} = require('../fixtures/recruiterAnalyticsFixture');
const User = require('../../modules/auth/models/user');
const Job = require('../../modules/recruiter/models/Job');
const Organization = require('../../modules/admin/models/organization');
const Membership = require('../../modules/admin/models/membership');
const Settings = require('../../modules/super-admin/models/platformSettings');
const settingsService = require('../../modules/super-admin/services/platformSettingsService');
const { sign } = require('../../modules/auth/utils/authSessionToken');
const {
  readCandidateAnalytics
} = require('../../modules/recruiter/services/hub/candidateAnalyticsService');
const {
  listCandidatePage
} = require('../../modules/recruiter/services/hub/candidateDiscoveryService');
const {
  buildAnalyticsPipeline,
  selectDemandSkills
} = require('../../modules/recruiter/utils/hub/candidateAnalyticsPipeline');
const { buildPipeline } = require('../../modules/recruiter/utils/hub/candidateDiscoveryPipeline');
const { parse } = require('../../modules/recruiter/utils/hub/candidateDiscoveryQuery');
const hub = require('../../modules/recruiter/routes/hub/recruiterHubRoutes');
const json = (value) => JSON.parse(JSON.stringify(value));

function planSummary(plan) {
  const cursor = plan.stages?.find((stage) => stage.$cursor)?.$cursor || plan;
  const joins = new Map();
  const indexes = new Set();
  const walk = (value) => {
    if (!value || typeof value !== 'object') return;
    if (value.stage === 'EQ_LOOKUP')
      joins.set(value.foreignCollection, {
        collection: value.foreignCollection,
        strategy: value.strategy,
        index: value.indexName
      });
    if (value.indexName) indexes.add(value.indexName);
    Object.values(value).forEach(walk);
  };
  walk(cursor.queryPlanner?.winningPlan);
  return {
    serverVersion: plan.serverInfo?.version,
    executionTimeMillis: cursor.executionStats?.executionTimeMillis,
    documentsExamined: cursor.executionStats?.totalDocsExamined,
    keysExamined: cursor.executionStats?.totalKeysExamined,
    joins: [...joins.values()],
    indexes: [...indexes],
    stages: plan.stages?.map((stage) => ({
      stage: Object.keys(stage)[0],
      elapsedEstimateMs: stage.executionTimeMillisEstimate,
      usedDisk: stage.usedDisk,
      spills: stage.spills
    }))
  };
}

async function measure(run) {
  global.gc?.();
  const before = process.memoryUsage();
  const peak = { rss: before.rss, heapUsed: before.heapUsed };
  const sample = () => {
    const m = process.memoryUsage();
    peak.rss = Math.max(peak.rss, m.rss);
    peak.heapUsed = Math.max(peak.heapUsed, m.heapUsed);
  };
  const timer = setInterval(sample, 10);
  const start = performance.now();
  try {
    const result = await run();
    sample();
    return {
      durationMs: Math.round(performance.now() - start),
      rssBefore: before.rss,
      peakRss: peak.rss,
      peakHeapDelta: peak.heapUsed - before.heapUsed,
      resultBytes: Buffer.byteLength(JSON.stringify(result))
    };
  } finally {
    clearInterval(timer);
  }
}

test(
  'exact Recruiter Analytics over authoritative multi-thousand population',
  { timeout: 300000 },
  async (t) => {
    const evidence = {
      phase: 'P1.3B.1',
      fixtureEligible: 5200,
      status: 'running',
      accuracy: {},
      security: {},
      measurements: {}
    };
    const plans = {};
    const savedEnv = {
      JWT_SECRET: process.env.JWT_SECRET,
      RECRUITER_SUMMARY_CACHE_TTL_SECONDS: process.env.RECRUITER_SUMMARY_CACHE_TTL_SECONDS
    };
    process.env.JWT_SECRET = randomBytes(32).toString('hex');
    process.env.RECRUITER_SUMMARY_CACHE_TTL_SECONDS = '0';
    const mongo = await startMongo({
      replicaSet: 'recruiter-analytics',
      temporaryRoot: path.resolve(__dirname, '../../../verification')
    });
    let server;
    t.after(async () => {
      if (evidence.status === 'running') evidence.status = 'failed';
      if (server) await new Promise((resolve) => server.close(resolve));
      settingsService.stopSettingsSynchronization();
      await mongoose.disconnect();
      evidence.cleanup = await mongo.stop();
      for (const [key, value] of Object.entries(savedEnv))
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      if (process.env.RECRUITER_ANALYTICS_EVIDENCE === '1') {
        const root = path.resolve(__dirname, '../../../verification/jobs-hub');
        await fs.writeFile(
          path.join(root, 'p1.3b.1-analytics.json'),
          JSON.stringify(evidence, null, 2) + '\n'
        );
        await fs.writeFile(
          path.join(root, 'p1.3b.1-query-plans.json'),
          JSON.stringify(plans, null, 2) + '\n'
        );
      }
    });
    await mongoose.connect(mongo.uri, { monitorCommands: true });
    await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
    await settingsService.startSettingsSynchronization();
    const fixture = await seedAnalyticsFixture();
    const { org, recruiter, peer, users } = fixture;
    const jobs = await Job.find({ recruiterId: recruiter, organizationId: org }).lean();
    const scope = {
      organizationId: String(org),
      recruiterId: String(recruiter),
      sessionRevision: 0,
      jobs
    };
    const app = express();
    app.use(express.json());
    app.use('/api/recruiter-hub', hub);
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const request = async (route = '/analytics', actor = recruiter) => {
      const res = await fetch(
        `http://127.0.0.1:${server.address().port}/api/recruiter-hub${route}`,
        { headers: actor ? { Authorization: `Bearer ${sign({ _id: actor })}` } : {} }
      );
      return {
        status: res.status,
        body: await res.json(),
        cacheControl: res.headers.get('cache-control')
      };
    };
    const oracleCards = await referenceCards({ organizationId: org });
    const expected = referenceMetrics(oracleCards, jobs);
    assert.equal(expected.total, 5200);
    let actual;
    await t.test(
      'all affected metrics agree with independent complete-source reference, not 240 cards',
      async () => {
        const commands = [];
        const track = (event) => {
          if (event.commandName === 'aggregate' && event.command.aggregate === 'users')
            commands.push(event.command.pipeline);
        };
        mongoose.connection.getClient().on('commandStarted', track);
        try {
          actual = await readCandidateAnalytics(scope);
        } finally {
          mongoose.connection.getClient().off('commandStarted', track);
        }
        const { candidates, ...population } = actual;
        assert.deepEqual(json(population), json(expected));
        assert.equal(candidates.length, 240);
        assert.deepEqual(
          candidates.map((c) => c.id),
          oracleCards.slice(0, 240).map((c) => c.id)
        );
        assert.equal(
          commands.length,
          2,
          'one population aggregation plus one bounded hydration, no N+1'
        );
        assert.equal(commands[1][0].$match._id.$in.length, 240);
        const old = referenceMetrics(oracleCards.slice(0, 240), jobs);
        assert.notDeepEqual(old.scoreDistribution, expected.scoreDistribution);
        assert.equal(expected.supplyVsDemand.find((row) => row.label === 'Beyond240').supply, 1);
        assert.equal(old.supplyVsDemand.find((row) => row.label === 'Beyond240').supply, 0);
        assert.equal(
          expected.supplyVsDemand.find((row) => row.label === 'PRIVATE_SUPPLY_SECRET').supply,
          0
        );
        for (const index of [0, 1]) {
          const card = oracleCards.find((c) => c.id === String(users[index]._id));
          assert.ok(card.score > 0);
          assert.equal(card.readinessScore, index === 0 ? null : 0);
        }
        evidence.accuracy = {
          exact: json(expected),
          previousSample: json(old),
          independentComparison: 'all six candidate population outputs equal',
          populationQueries: 1,
          hydrationQueries: 1,
          maximumCardsHydrated: candidates.length
        };
      }
    );
    await t.test(
      'skill case, literal values, absent demand and encounter-order ties are preserved',
      async () => {
        for (const testJobs of [
          [],
          [{ requiredSkills: ['TypeScript', 'typescript', '$literal-skill'] }],
          [{ requiredSkills: ['WRONG_RESUME_TIE', 'OLD_PRIVATE_SKILL', 'INACTIVE_ALIAS_SECRET'] }]
        ]) {
          const { candidates, ...population } = await readCandidateAnalytics({
            ...scope,
            jobs: testJobs
          });
          assert.deepEqual(json(population), json(referenceMetrics(oracleCards, testJobs)));
          assert.equal(candidates.length, 240);
        }
      }
    );
    await t.test('HTTP contract, bounded widgets, no private evidence and no-store', async () => {
      const res = await request();
      assert.equal(res.status, 200);
      assert.equal(res.cacheControl, 'private, no-store');
      assert.equal(res.body.metrics.totalCandidates, expected.total);
      assert.equal(res.body.metrics.avgCandidateScore, expected.avgCandidateScore);
      for (const key of [
        'scoreDistribution',
        'experienceDistribution',
        'candidatesByStack',
        'supplyVsDemand'
      ])
        assert.deepEqual(res.body.charts[key], json(expected[key]));
      assert.equal(res.body.meta.candidatePopulation.mode, 'exact');
      assert.equal(res.body.meta.topCandidates.mode, 'bounded');
      assert.equal(res.body.widgets.topCandidates.length, 5);
      const oldTop = oracleCards
        .slice(0, 240)
        .sort(
          (a, b) =>
            Number(b.readinessScore || b.score || 0) - Number(a.readinessScore || a.score || 0)
        )
        .slice(0, 5)
        .map((c) => c.id);
      assert.deepEqual(
        res.body.widgets.topCandidates.map((c) => c.id),
        oldTop
      );
      const encoded = JSON.stringify(res.body);
      for (const forbidden of [
        '@fixture.test',
        'FOREIGN_DEMAND_SECRET',
        'PRIVATE_STACK_SECRET',
        'INACTIVE_ALIAS_SECRET',
        'OLD_PRIVATE_SKILL'
      ])
        assert.ok(!encoded.includes(forbidden), forbidden);
      evidence.security.httpContract = true;
    });
    await t.test(
      'consent, profile/privacy, organization policy and active eligibility stay live',
      async () => {
        const target = users.at(-1)._id;
        await User.updateOne({ _id: target }, { $set: { isPublic: false } });
        let res = await request();
        assert.equal(res.body.metrics.totalCandidates, 5199);
        assert.equal(res.body.charts.supplyVsDemand.find((r) => r.label === 'Beyond240').supply, 0);
        await User.updateOne({ _id: target }, { $set: { isPublic: true, isActive: false } });
        assert.equal((await request()).body.metrics.totalCandidates, 5199);
        await User.updateOne({ _id: target }, { $set: { isActive: true } });
        const profile = await sourceModels[2].findOne({ userId: users[2]._id }).sort({ _id: -1 });
        await sourceModels[2].updateOne({ _id: profile._id }, { $set: { isPublic: false } });
        assert.equal((await request()).body.metrics.totalCandidates, 5199);
        await sourceModels[2].updateOne(
          { _id: profile._id },
          { $set: { isPublic: true, 'sections.visibility.projects': false } }
        );
        assert.equal((await request()).body.metrics.totalCandidates, 5199);
        await sourceModels[2].updateOne(
          { _id: profile._id },
          { $set: { 'sections.visibility.projects': true } }
        );
        await Settings.updateOne(
          { scope: 'global' },
          { $set: { 'recruiter.candidateVisibility': 'organization' } }
        );
        const orgExpected = referenceMetrics(
          await referenceCards({ organizationId: org, mode: 'organization' }),
          jobs
        );
        res = await request();
        assert.equal(res.body.metrics.totalCandidates, orgExpected.total);
        for (const key of [
          'scoreDistribution',
          'experienceDistribution',
          'candidatesByStack',
          'supplyVsDemand'
        ])
          assert.deepEqual(res.body.charts[key], json(orgExpected[key]));
        await Settings.updateOne(
          { scope: 'global' },
          { $set: { 'recruiter.candidateVisibility': 'private' } }
        );
        res = await request();
        assert.equal(res.body.metrics.totalCandidates, 0);
        assert.equal(res.body.metrics.avgCandidateScore, 0);
        assert.deepEqual(res.body.widgets.topCandidates, []);
        assert.ok(res.body.charts.supplyVsDemand.every((r) => r.supply === 0));
        await Settings.updateOne(
          { scope: 'global' },
          { $set: { 'recruiter.candidateVisibility': 'public' } }
        );
        evidence.security.liveConsentProfileActivityAndOrganization = true;
      }
    );
    await t.test(
      'actor, membership, suspension, durable settings and session revision fail closed',
      async () => {
        assert.equal((await request('/analytics', null)).status, 401);
        assert.equal((await request('/analytics', users[3]._id)).status, 403);
        await assert.rejects(readCandidateAnalytics({ ...scope, recruiterId: null }), {
          statusCode: 401
        });
        await assert.rejects(readCandidateAnalytics({ ...scope, sessionRevision: 1 }), {
          statusCode: 403
        });
        await assert.rejects(readCandidateAnalytics({ ...scope, recruiterId: String(peer) }), {
          statusCode: 403
        });
        await Membership.create({
          userId: recruiter,
          organizationId: org,
          teamId: null,
          role: 'member',
          status: 'disabled'
        });
        assert.equal((await request()).status, 403);
        await Membership.updateOne(
          { userId: recruiter, organizationId: org, teamId: null },
          { $set: { status: 'active' } }
        );
        await User.updateOne({ _id: recruiter }, { $set: { isActive: false } });
        assert.ok([401, 403].includes((await request()).status));
        await User.updateOne({ _id: recruiter }, { $set: { isActive: true } });
        await Organization.updateOne({ _id: org }, { $set: { isSuspended: true } });
        assert.equal((await request()).status, 403);
        await Organization.updateOne({ _id: org }, { $set: { isSuspended: false } });
        await Settings.updateOne(
          { scope: 'global' },
          { $set: { 'recruiter.enableRecruiterAccess': false } }
        );
        await assert.rejects(readCandidateAnalytics(scope), { statusCode: 403 });
        await Settings.updateOne(
          { scope: 'global' },
          { $set: { 'recruiter.enableRecruiterAccess': true } }
        );
        const stored = await Settings.findOne({ scope: 'global' }).lean();
        await Settings.deleteOne({ _id: stored._id });
        await assert.rejects(readCandidateAnalytics(scope), { statusCode: 503 });
        await Settings.collection.insertOne(stored);
        evidence.security.actorMembershipSuspensionSettingsAndSession = true;
      }
    );
    await t.test(
      'operation timeout is an explicit error, never a partial successful population',
      async (st) => {
        st.mock.method(User, 'aggregate', () => {
          throw Object.assign(Error('fixture timeout'), { code: 50 });
        });
        const res = await request();
        assert.equal(res.status, 503);
        assert.equal(res.body.metrics, undefined);
        evidence.security.queryBudgetFailsClosed = true;
      }
    );
    await t.test(
      'zero and absent readiness tie ordering matches discovery on a small eligible pool',
      async () => {
        const smallOrg = new mongoose.Types.ObjectId();
        const actor = new mongoose.Types.ObjectId();
        await Organization.create({
          _id: smallOrg,
          name: 'Zero-tie fixture',
          slug: 'zero-tie-fixture',
          ownerId: actor,
          createdBy: actor
        });
        await User.collection.insertOne({
          _id: actor,
          name: 'Zero-tie recruiter',
          email: 'zero-tie@fixture.test',
          role: 'recruiter',
          organizationId: smallOrg,
          isActive: true,
          sessionRevision: 0
        });
        const selected = [0, 1, 19, 38].map((index) => users[index]);
        for (const user of selected)
          await User.updateOne({ _id: user._id }, { $set: { organizationId: smallOrg } });
        await Settings.updateOne(
          { scope: 'global' },
          { $set: { 'recruiter.candidateVisibility': 'organization' } }
        );
        try {
          const options = {
            organizationId: String(smallOrg),
            recruiterId: String(actor),
            sessionRevision: 0
          };
          const result = await readCandidateAnalytics(options);
          const page = await listCandidatePage({ ...options, query: { limit: 240 } });
          assert.deepEqual(
            result.candidates.map((c) => c.id),
            page.candidates.map((c) => c.id)
          );
          assert.deepEqual(
            result.candidates.map((c) => c.id),
            selected.map((user) => String(user._id))
          );
          const cards = await referenceCards({ organizationId: smallOrg, mode: 'organization' });
          const { candidates, ...population } = result;
          assert.equal(candidates.length, 4);
          assert.deepEqual(json(population), json(referenceMetrics(cards, [])));
        } finally {
          for (const user of selected)
            await User.updateOne(
              { _id: user._id },
              { $set: { organizationId: user.organizationId } }
            );
          await Settings.updateOne(
            { scope: 'global' },
            { $set: { 'recruiter.candidateVisibility': 'public' } }
          );
        }
        evidence.accuracy.zeroMissingOrderAndFallback = true;
      }
    );
    await t.test(
      'actual plans, bounded memory and same-fixture before/after candidate calculations',
      async () => {
        const visible = {
          isPublic: true,
          role: { $in: ['developer', 'user'] },
          isActive: { $ne: false }
        };
        plans.before = await User.aggregate(buildPipeline(visible, parse({ limit: 240 }), null))
          .collation({ locale: 'en' })
          .allowDiskUse(true)
          .option({ maxTimeMS: 15000 })
          .explain('executionStats');
        plans.after = await User.aggregate(
          buildAnalyticsPipeline(visible, selectDemandSkills(jobs))
        )
          .collation({ locale: 'simple' })
          .allowDiskUse(true)
          .option({ maxTimeMS: 15000 })
          .explain('executionStats');
        for (const plan of Object.values(plans)) {
          const summary = planSummary(plan);
          assert.equal(summary.joins.length, 6);
          for (const join of summary.joins)
            assert.ok(['IndexedLoopJoin', 'HashJoin'].includes(join.strategy));
        }
        const before = async () => {
          const page = await listCandidatePage({ ...scope, query: { limit: 240 } });
          return { metrics: referenceMetrics(page.candidates, jobs), candidates: page.candidates };
        };
        const after = () => readCandidateAnalytics(scope);
        await before();
        await after();
        const runs = { before: [], after: [] };
        for (let i = 0; i < 3; i++) {
          runs.before.push(await measure(before));
          runs.after.push(await measure(after));
        }
        evidence.measurements = {
          scope:
            'Candidate calculation only, same fixture/process/hardware; warm interleaved runs. Before metrics sample 240, after metrics exact 5200. No latency improvement claim.',
          memory:
            '10ms process RSS/heap polling; retained fixture/reference and driver/GC affect absolute memory. Not server RSS.',
          runs,
          beforePlan: planSummary(plans.before),
          afterPlan: planSummary(plans.after)
        };
        t.diagnostic(
          JSON.stringify({
            eligible: 5200,
            beforeMs: runs.before.map((r) => r.durationMs),
            afterMs: runs.after.map((r) => r.durationMs),
            afterPlan: planSummary(plans.after)
          })
        );
      }
    );
    evidence.status = 'passed';
  }
);
