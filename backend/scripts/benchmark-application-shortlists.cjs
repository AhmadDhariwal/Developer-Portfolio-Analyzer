// Sequential disposable baseline/current comparison. Never loads .env or a live URI.
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { execFileSync } = require('node:child_process');
const Module = require('node:module');
const mongoose = require('mongoose');
const fs = require('node:fs');
const path = require('node:path');
const { startApplicationFixture } = require('../src/tests/fixtures/applicationPerformanceFixture');
const Shortlist = require('../src/modules/recruiter/models/RecruiterShortlist');
const { buildPipeline } = require('../src/modules/recruiter/utils/hub/applicationShortlistQuery');
const {
  verifyApplicationIdentities
} = require('../src/modules/recruiter/utils/hub/applicationIdentityValidation');
const { withAccess } = require('../src/modules/recruiter/utils/hub/recruiterJobAccess');
const current = require('../src/modules/recruiter/services/hub/applicationShortlistService');
const { protect } = require('../src/core/middleware/authmiddleware');
const {
  requireRecruiterTenant
} = require('../src/modules/recruiter/middleware/requireRecruiterTenant');
const { requireOrganizationContext } = require('../src/core/middleware/orgMiddleware');
const {
  requireRecruiterAccessEnabled
} = require('../src/core/middleware/platformSettingsMiddleware');
const { getRecruiterScope } = require('../src/modules/recruiter/utils/hub/recruiterAccess');

const root = path.resolve(__dirname, '../..');
const countArg = process.argv.find((value) => value.startsWith('--count='));
assert.ok(countArg, 'Run each fixture in a fresh process using --count=261 or --count=1000.');
const fixtureCount = Number(countArg.split('=')[1]);
assert.ok([261, 1000].includes(fixtureCount));
const plansOnly = process.argv.includes('--plans-only');
const output = path.join(
  root,
  `backend/verification/jobs-hub/p1.5a-${plansOnly ? 'plans' : 'benchmarks'}-${fixtureCount}.json`
);
const evidence = {
  status: 'running',
  productionDataUsed: false,
  queryBudgetMs: 5000,
  fixtures: []
};

function acceptedBaseline() {
  const relative = 'backend/src/modules/recruiter/services/hub/applicationShortlistService.js';
  const filename = path.join(root, relative);
  // Pin the accepted blob recorded before implementation; the user may stage
  // or commit current changes between runs. Never modify the checkout/index.
  const preflight = JSON.parse(
    fs.readFileSync(path.join(root, 'backend/verification/jobs-hub/p1.5a-preflight.json'), 'utf8')
  );
  const blob = preflight.stagedBaseline.find((entry) => entry.path === relative)?.indexBlob;
  assert.match(blob || '', /^[a-f0-9]{40}$/);
  const source = execFileSync('git', ['cat-file', 'blob', blob], { cwd: root, encoding: 'utf8' });
  assert.match(source, /maxTimeMS: 5000/);
  assert.doesNotMatch(source, /verifyApplicationIdentities/);
  const baseline = new Module(filename, module);
  baseline.filename = filename;
  baseline.paths = Module._nodeModulePaths(path.dirname(filename));
  baseline._compile(source, filename);
  return baseline.exports;
}
function summary(samples) {
  const values = samples.map((s) => s.ms).sort((a, b) => a - b);
  const percentile = (p) => values[Math.min(values.length - 1, Math.ceil(p * values.length) - 1)];
  return {
    requests: samples.length,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    failures: samples.filter((s) => s.status !== 200).length,
    timeoutRate: samples.filter((s) => s.timeout).length / samples.length,
    samples
  };
}
async function main() {
  const baseline = acceptedBaseline();
  for (const count of [fixtureCount]) {
    const result = { count, samplesPerSequentialMode: 7, memory: {}, plans: {} };
    evidence.fixtures.push(result);
    let fixture;
    try {
      fixture = await startApplicationFixture({
        count,
        configure(app) {
          app.use(
            '/benchmark',
            protect,
            requireRecruiterTenant,
            requireRecruiterAccessEnabled,
            requireOrganizationContext(['recruiter'])
          );
          for (const [name, service] of Object.entries({ baseline, optimized: current }))
            app.get('/benchmark/' + name, async (req, res) => {
              try {
                res.json(
                  await service.listApplicationShortlists({
                    ...(await getRecruiterScope(req)),
                    query: { page: '1', limit: '20' }
                  })
                );
              } catch (error) {
                res
                  .status(error.statusCode || 503)
                  .json({ message: error.message, code: error.code });
              }
            });
        }
      });
      const measure = async (mode) => {
        const start = performance.now();
        const response = await fixture.request('/benchmark/' + mode);
        if (response.status === 200) {
          assert.equal(response.body.meta.total, count);
          assert.equal(response.body.shortlists.length, 20);
        }
        return {
          ms: performance.now() - start,
          status: response.status,
          timeout:
            response.body.code === 50 ||
            /time limit|query budget|timed out|timeout/i.test(response.body.message || ''),
          memory: { rss: process.memoryUsage().rss, heapUsed: process.memoryUsage().heapUsed },
          ...(response.status === 200 ? {} : { message: response.body.message })
        };
      };
      if (!plansOnly) {
        for (const mode of ['baseline', 'optimized']) {
          await measure(mode); // Warmup excluded, same on each mode.
          const samples = [];
          const startMemory = process.memoryUsage();
          for (let i = 0; i < 7; i++) samples.push(await measure(mode));
          result[mode] = summary(samples);
          result.memory[mode] = {
            before: startMemory,
            after: process.memoryUsage(),
            peakSampleRss: Math.max(...samples.map((s) => s.memory.rss)),
            peakSampleHeap: Math.max(...samples.map((s) => s.memory.heapUsed)),
            meaning:
              'Process RSS/heap snapshots, including driver and fixture; not isolated allocation attribution.'
          };
          const concurrent = [];
          for (let wave = 0; wave < 2; wave++)
            concurrent.push(...(await Promise.all(Array.from({ length: 3 }, () => measure(mode)))));
          result[mode + 'SimultaneousReads'] = summary(concurrent);
        }
        const row = fixture.records[count - 1];
        const mixed = await Promise.all([
          measure('optimized'),
          measure('optimized'),
          fixture.request(`/api/recruiter-hub/jobs/${fixture.job._id}/applications/${row._id}`, {
            method: 'PATCH',
            body: { status: 'reviewing', expectedStatus: 'submitted' }
          })
        ]);
        result.optimizedMixed = {
          reads: summary(mixed.slice(0, 2)),
          statusAction: mixed[2].status
        };
        assert.equal(mixed[2].status, 200);
      }
      const queries = [];
      const previousDebug = mongoose.get('debug');
      let identities;
      mongoose.set('debug', (collection, method, filter, options) => {
        if (
          method === 'find' &&
          ['recruitershortlists', 'jobs', 'jobapplications'].includes(collection)
        )
          queries.push({
            collection,
            filter,
            projection: options?.projection,
            limit: options?.limit
          });
      });
      try {
        identities = await withAccess(fixture.scope, (ctx) => verifyApplicationIdentities(ctx));
      } finally {
        mongoose.set('debug', previousDebug);
      }
      result.plans.sourceValidation = [];
      for (const query of queries)
        result.plans.sourceValidation.push({
          collection: query.collection,
          explain: await mongoose.connection
            .collection(query.collection)
            .find(query.filter, {
              projection: query.projection,
              ...(query.limit ? { limit: query.limit } : {}),
              maxTimeMS: 5000
            })
            .explain('executionStats')
        });
      // MongoDB does not allow explain within a multi-document transaction.
      // These identical-query diagnostics run outside it on the isolated fixture.
      for (const mode of ['baseline', 'optimized']) {
        try {
          result.plans[mode] = await Shortlist.aggregate(
            buildPipeline(
              fixture.scope,
              { page: 1, limit: 20 },
              mode === 'optimized' ? identities.ids : undefined
            )
          )
            .option({ maxTimeMS: 5000 })
            .explain('executionStats');
        } catch (error) {
          result.plans[mode] = { failed: true, code: error.code, message: error.message };
        }
      }
      if (!plansOnly) {
        assert.equal(result.optimized.failures, 0);
        assert.equal(result.optimizedSimultaneousReads.failures, 0);
        assert.equal(result.optimizedMixed.reads.failures, 0);
        console.log(
          JSON.stringify({
            count,
            baseline: result.baseline.p50Ms,
            optimized: result.optimized.p50Ms,
            concurrentP95: result.optimizedSimultaneousReads.p95Ms
          })
        );
      }
    } finally {
      if (fixture) result.cleanup = await fixture.stop();
      fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');
    }
  }
  evidence.status = 'passed';
}
main()
  .catch((error) => {
    evidence.status = 'failed';
    evidence.error = error.message;
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n'));
