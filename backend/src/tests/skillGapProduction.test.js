'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fork } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { startMongo } = require('./fixtures/disposableRequestMongo');
const controls = require('../services/skillGapGovernanceService');
const State = require('../models/integrationGovernanceState');
test(
  'Skill Gap real Mongo: HTTP, two workers, budgets, fencing, ownership, TTL and query plans',
  { timeout: 120000 },
  async (t) => {
    const output = path.join(__dirname, '../../verification/skillgap');
    fs.mkdirSync(output, { recursive: true });
    const runtime = await startMongo({ replicaSet: 'skillgap-acceptance', temporaryRoot: output });
    const workers = [];
    const evidence = { productionDataUsed: false, liveProviders: false, checks: [] };
    t.after(async () => {
      for (const worker of workers) {
        if (worker.exitCode === null) {
          worker.send('stop');
          await new Promise((resolve) => {
            worker.once('exit', resolve);
            setTimeout(() => {
              worker.kill();
              resolve();
            }, 5000).unref();
          });
        }
      }
      await mongoose.disconnect();
      evidence.cleanup = await runtime.stop();
      fs.writeFileSync(
        path.join(output, 'production-results.json'),
        JSON.stringify(evidence, null, 2) + '\n'
      );
    });
    await mongoose.connect(runtime.uri, { autoIndex: false });
    const User = require('../models/user'),
      File = require('../models/resumeFile'),
      Resume = require('../models/resumeAnalysis'),
      Cache = require('../models/analysisCache'),
      Notification = require('../models/notification');
    for (const Model of [
      User,
      File,
      Resume,
      Cache,
      Notification,
      require('../models/notificationReceipt'),
      require('../models/notificationState'),
      require('../models/aiVersion')
    ]) {
      await Model.createCollection();
      await Model.createIndexes();
    }
    await require('../services/integrationMongoGovernanceService').initialize();
    const owner = await User.create({
      name: 'Skill Gap Synthetic Owner',
      email: 'owner@skillgap.test',
      providers: ['github'],
      authProvider: 'github',
      activeGithubUsername: 'fixture',
      activeCareerStack: 'Backend',
      activeExperienceLevel: 'Student'
    });
    const other = await User.create({
      name: 'Other Synthetic Owner',
      email: 'other@skillgap.test',
      providers: ['github'],
      authProvider: 'github',
      activeGithubUsername: 'fixture',
      activeCareerStack: 'Backend',
      activeExperienceLevel: 'Student'
    });
    const file = await File.create({
      userId: owner._id,
      fileName: 'synthetic.pdf',
      fileUrl: '/synthetic/fixture',
      fileSize: 1
    });
    await Resume.create({
      userId: owner._id,
      fileId: file._id,
      fileName: 'synthetic.pdf',
      fileSize: 1,
      analyzedAt: new Date(),
      resumeSignals: { skills: ['Node.js', 'SQL', 'Docker'] }
    });
    owner.activeResumeFileId = file._id;
    await owner.save();
    const secret = randomBytes(32).toString('hex');
    const startWorker = () =>
      new Promise((resolve, reject) => {
        const worker = fork(path.join(__dirname, 'fixtures/skillGapWorker.js'), [], {
          env: {
            ...process.env,
            SKILL_GAP_TEST_MONGO: runtime.uri,
            JWT_SECRET: secret,
            NODE_ENV: 'test'
          },
          stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
          windowsHide: true
        });
        workers.push(worker);
        worker.stderr.on('data', (chunk) => process.stderr.write(chunk));
        worker.once('error', reject);
        worker.once('message', (message) =>
          message.port ? resolve(`http://127.0.0.1:${message.port}`) : reject(Error(message.error))
        );
      });
    const [left, right] = await Promise.all([startWorker(), startWorker()]);
    const tokenFor = (user) =>
      jwt.sign(
        { id: String(user._id), sessionRevision: Number(user.sessionRevision || 0) },
        secret,
        { issuer: 'devinsight-api', audience: 'devinsight-web', expiresIn: '5m' }
      );
    const token = tokenFor(owner);
    const post = async (host, body = {}, auth = token) => {
      const started = performance.now();
      const response = await fetch(host + '/api/skillgap/skill-gap', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(auth ? { Authorization: `Bearer ${auth}` } : {})
        },
        body: JSON.stringify(body)
      });
      return {
        status: response.status,
        retryAfter: response.headers.get('retry-after'),
        body: await response.json(),
        ms: performance.now() - started
      };
    };
    await t.test(
      'two HTTP workers share one calculation/AI/write for an identical active source snapshot',
      async () => {
        const results = await Promise.all([post(left), post(right)]);
        assert.ok(
          results.every((r) => r.status === 200),
          JSON.stringify(
            results.map((r) => ({ status: r.status, body: r.status === 200 ? undefined : r.body }))
          )
        );
        assert.equal(
          await Cache.countDocuments({
            userId: owner._id,
            analysisVersion: 'v9-skill-evidence-governance'
          }),
          1
        );
        const counter = await State.findById('test:skillgap:ai-calls').lean();
        assert.equal(counter.count, 1);
        assert.equal(
          results[0].body.cacheMetadata.signalHash,
          results[1].body.cacheMetadata.signalHash
        );
        assert.equal(results[0].body.evidencePolicyVersion, 'skill-gap-evidence-policy-v2');
        assert.ok(results[0].body.missingSkills.every((s) => s.status !== 'UNKNOWN'));
        evidence.coldConcurrent = results.map((r) => r.ms);
        evidence.checks.push('two-process duplicate analysis prevention');
      }
    );
    await t.test(
      'warm requests validate sources without another AI call and owner contexts are isolated',
      async () => {
        const samples = [];
        for (let i = 0; i < 8; i++) {
          const result = await post(i % 2 ? left : right);
          assert.equal(result.status, 200);
          assert.equal(result.body.fromCache, true);
          samples.push(result.ms);
        }
        assert.equal((await State.findById('test:skillgap:ai-calls')).count, 1);
        const foreign = await post(left, {}, tokenFor(other));
        assert.equal(foreign.status, 200);
        assert.equal(foreign.body.evidenceCompleteness.resumeAvailable, false);
        assert.equal(foreign.body.claimedOnlySkills.length, 0);
        const sorted = samples.slice().sort((a, b) => a - b);
        evidence.warm = {
          samples: samples.length,
          p50: sorted[3],
          p95: sorted[7],
          note: 'small local synthetic fixture, not deployed capacity'
        };
        evidence.checks.push('owner isolation and warm AI budget');
      }
    );
    await t.test(
      'guest username rotation cannot bypass the IP quota or persist user analyses',
      async () => {
        const before = await Cache.countDocuments();
        for (let i = 0; i < 5; i++) {
          const response = await post(
            left,
            {
              isTemporary: true,
              username: `guest${i}`,
              careerStack: 'Backend',
              experienceLevel: 'Student'
            },
            null
          );
          assert.equal(response.status, 200);
        }
        const denied = await post(
          right,
          {
            isTemporary: true,
            username: 'anotherguest',
            careerStack: 'Backend',
            experienceLevel: 'Student'
          },
          null
        );
        assert.equal(denied.status, 429);
        assert.ok(Number(denied.retryAfter) >= 1);
        assert.equal(await Cache.countDocuments(), before);
        evidence.checks.push('cross-process anonymous IP quota');
      }
    );
    await t.test(
      'refresh windows, malformed payloads and mandatory governance failure are explicit',
      async () => {
        for (let i = 0; i < controls.budgets.refresh; i++)
          await controls.consume('fixture-refresh', 'fixture-ip', ['refresh']);
        await assert.rejects(
          controls.consume('fixture-refresh', 'fixture-ip', ['refresh']),
          (error) => error.status === 429 && error.retryAfter >= 1
        );
        assert.equal(
          (
            await post(
              left,
              {
                isTemporary: true,
                username: [],
                careerStack: 'Backend',
                experienceLevel: 'Student'
              },
              null
            )
          ).status,
          400
        );
        assert.equal(
          (
            await post(
              left,
              {
                isTemporary: true,
                username: 'fixture',
                careerStack: 'Backend',
                experienceLevel: 'Student',
                resumeText: 'a'.repeat(12001)
              },
              null
            )
          ).status,
          413
        );
        await mongoose.disconnect();
        await assert.rejects(
          controls.consume('offline', 'ip', ['profile']),
          (error) => error.status === 503
        );
        await mongoose.connect(runtime.uri, { autoIndex: false });
        evidence.checks.push('fail-closed governance, payload limits, refresh exhaustion');
      }
    );
    await t.test(
      'expired/crashed work is recoverable and a superseded worker cannot commit',
      async () => {
        const stale = await controls.acquire('crashed', 'same-snapshot');
        await State.updateMany(
          { _id: { $in: stale.keys } },
          { $set: { 'leases.0.until': new Date(0), expiresAt: new Date(0) } }
        );
        const current = await controls.acquire('crashed', 'same-snapshot');
        await assert.rejects(
          require('../services/notificationPersistenceService').transaction((session) =>
            controls.fence(stale, session)
          ),
          (error) => error.status === 503
        );
        await require('../services/notificationPersistenceService').transaction((session) =>
          controls.fence(current, session)
        );
        await controls.release(stale);
        const row = await State.findById(current.keys[2]).lean();
        assert.ok(row.leases.some((l) => l.token === current.token));
        await controls.release(current);
        evidence.checks.push('lease expiry, fencing and stale release isolation');
      }
    );
    await t.test(
      'existing exact lookup index and seven-day cache-only TTL remain usable',
      async () => {
        const row = await Cache.findOne({ userId: owner._id }).lean();
        const query = Object.fromEntries(
          [
            'userId',
            'githubUsername',
            'careerStack',
            'experienceLevel',
            'analysisVersion',
            'resumeHash',
            'resumeAnalysisId',
            'signalHash'
          ].map((k) => [k, row[k]])
        );
        const plan = await Cache.collection.find(query).explain('executionStats');
        assert.ok(JSON.stringify(plan.queryPlanner).includes('IXSCAN'));
        assert.ok(plan.executionStats.totalDocsExamined <= 1);
        evidence.exactLookup = {
          documentsExamined: plan.executionStats.totalDocsExamined,
          keysExamined: plan.executionStats.totalKeysExamined
        };
        const indexes = await Cache.collection.indexes();
        assert.equal(indexes.find((i) => i.key.createdAt === 1).expireAfterSeconds, 604800);
        for (const Model of [User, File, Resume])
          assert.ok(
            !(await Model.collection.indexes()).some((i) => i.expireAfterSeconds !== undefined)
          );
        evidence.indexes = indexes.map((i) => ({
          name: i.name,
          key: i.key,
          expireAfterSeconds: i.expireAfterSeconds
        }));
        evidence.checks.push('cache query plan and durable history TTL isolation');
      }
    );
    await t.test(
      'market evidence is fresh, deduplicated, attributed cached data with disclosed sample limits',
      async () => {
        const Job = require('../models/jobCache');
        await Job.createCollection();
        await Job.createIndexes();
        const fresh = new Date(Date.now() + 3600000),
          expired = new Date(0);
        const base = {
          title: 'Synthetic developer role',
          company: 'Synthetic company',
          applyUrl: 'https://jobs.example.test/synthetic',
          expiresAt: fresh,
          freshUntil: fresh
        };
        await Job.create([
          {
            ...base,
            jobId: 'sample-a',
            source: 'fixture-one',
            externalJobId: 'same',
            skills: ['TypeScript', 'ts']
          },
          {
            ...base,
            jobId: 'sample-b',
            source: 'fixture-one',
            externalJobId: 'same',
            skills: ['TypeScript']
          },
          {
            ...base,
            jobId: 'sample-c',
            source: 'fixture-two',
            externalJobId: 'same',
            skills: ['Python']
          },
          {
            ...base,
            jobId: 'sample-hidden',
            source: 'fixture-one',
            hidden: true,
            skills: ['Docker']
          },
          {
            ...base,
            jobId: 'sample-stale',
            source: 'fixture-one',
            freshUntil: expired,
            skills: ['Java']
          },
          {
            ...base,
            jobId: 'sample-expired-posting',
            source: 'fixture-one',
            validThrough: expired,
            skills: ['React']
          }
        ]);
        const market =
          await require('../services/developerSignalService').getPublicJobMarketSignal();
        assert.equal(market.sampledJobs, 2);
        assert.equal(market.duplicatesRemoved, 1);
        assert.equal(market.live, false);
        assert.equal(market.kind, 'cached-provider-sample');
        assert.equal(market.topSkills.find((skill) => skill.name === 'TypeScript').postings, 1);
        assert.equal(market.topSkills.find((skill) => skill.name === 'Python').postings, 1);
        assert.ok(
          !market.topSkills.some((skill) => ['Docker', 'Java', 'React'].includes(skill.name))
        );
        assert.ok(market.limitations.length);
        evidence.market = market;
        evidence.checks.push('cached market provenance, aliases, expiry and deduplication');
      }
    );
    await t.test(
      'developer signal consumers use the current owned career and resume context',
      async () => {
        const signals = require('../services/developerSignalService');
        const current = await signals.summarizeSkillGapSignal(owner._id);
        assert.equal(current.present, true);
        assert.equal(current.ruleVersion, 'skill-evidence-coverage-v1');
        await User.updateOne({ _id: owner._id }, { $set: { activeExperienceLevel: 'Intern' } });
        const changed = await signals.summarizeSkillGapSignal(owner._id);
        assert.equal(changed.present, false);
        assert.equal(changed.coverage, null);
        await User.updateOne({ _id: owner._id }, { $set: { activeExperienceLevel: 'Student' } });
        evidence.checks.push('downstream career context invalidation');
      }
    );
  }
);
