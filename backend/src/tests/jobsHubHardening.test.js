const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

function load(relative, stubs = {}) {
  const filename = path.resolve(__dirname, relative);
  const unit = new Module(filename, module);
  unit.filename = filename;
  unit.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = unit.require.bind(unit);
  unit.require = (id) => (Object.hasOwn(stubs, id) ? stubs[id] : original(id));
  unit._compile(fs.readFileSync(filename, 'utf8'), filename);
  return unit.exports;
}
const query = (value, observed = {}) => {
  const result = {};
  for (const name of ['sort', 'select', 'limit', 'maxTimeMS', 'skip'])
    result[name] = (...args) => {
      observed[name] = args;
      return result;
    };
  result.lean = async () => value;
  return result;
};
const raw = (patch = {}) => ({
  id: 'job-a',
  title: 'Backend Node.js Engineer',
  company: 'Example',
  applyUrl: 'https://jobs.example.com/a',
  skills: ['Node.js', 'Redis'],
  experienceLevel: 'Entry',
  ...patch
});
const service = (stubs = {}) =>
  load('../services/jobService.js', {
    './platformSettingsService': { getIntegrationSecretsSync: () => ({}) },
    ...stubs
  });
const response = () => ({
  statusCode: 200,
  headers: {},
  set(key, value) {
    this.headers[key] = value;
    return this;
  },
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(value) {
    this.body = value;
    return this;
  }
});

test('normalization rejects missing identities and unsafe application URLs without inventing metadata', () => {
  const jobs = service();
  for (const url of [
    'javascript:alert(1)',
    'http://127.0.0.1/a',
    'http://2130706433/',
    'https://user:secret@example.com/a',
    'http://10.1.1.1/a',
    'http://[::1]/',
    'https://a.local/a',
    'https://'
  ]) {
    assert.equal(jobs.isUsableJob(jobs.normaliseJob(raw({ applyUrl: url }))), false, url);
  }
  assert.equal(jobs.isUsableJob(jobs.normaliseJob(raw({ title: '' }))), false);
  assert.equal(jobs.isUsableJob(jobs.normaliseJob(raw({ company: '' }))), false);
  const job = jobs.normaliseJob(raw());
  assert.equal(job.salary, '');
  assert.deepEqual(job.salaryMetadata, { min: null, max: null, currency: null, period: null });
  assert.equal(job.postedDate, '');
  assert.equal(job.location, 'Unspecified');
  assert.equal(jobs.isUsableJob(jobs.normaliseJob(null)), false);
  assert.doesNotMatch(
    jobs.normaliseJob(raw({ description: '&lt;img src=x onerror=alert(1)&gt;Safe text' }))
      .description,
    /<img/
  );
  assert.equal(
    jobs.normaliseJob(raw({ title: 'Backend Engineer (m/f/d)' })).title,
    'Backend Engineer'
  );
  assert.equal(
    jobs.normaliseJob(raw({ title: 'Full Stack Developer (m/w/d)' })).title,
    'Full Stack Developer'
  );
  assert.equal(
    jobs.normaliseJob(raw({ title: 'DevOps Engineer (all genders)' })).title,
    'DevOps Engineer'
  );
  assert.equal(
    jobs.normaliseJob(raw({ title: 'Cloud Architect [f/m/d]' })).title,
    'Cloud Architect'
  );
});

test('provider expiry and retention override cache freshness and hidden records stay hidden', () => {
  const jobs = service();
  for (const patch of [
    { validThrough: '2000-01-01' },
    { cacheExpiresAt: '2000-01-01' },
    { hidden: true }
  ]) {
    assert.equal(jobs.isUsableJob(jobs.normaliseJob(raw(patch))), false);
  }
  assert.equal(jobs.isUsableJob(jobs.normaliseJob(raw({ freshUntil: '2000-01-01' }))), true);
  const salary = jobs.normaliseJob(
    raw({ salaryMetadata: { min: 100, max: 200, currency: 'PKR', period: 'month' } })
  );
  assert.equal(salary.salaryMetadata.currency, 'PKR');
  assert.equal(salary.salaryMetadata.min, 100);
});

test('dedupe handles tracking URLs and cross-source role duplicates while preserving distinct locations', () => {
  const jobs = service();
  const rows = [
    raw(),
    raw({ id: 'duplicate', applyUrl: 'https://jobs.example.com/a?utm_source=test' }),
    raw({ id: 'other-source', applyUrl: 'https://another.example.com/a' }),
    raw({ id: 'other-location', applyUrl: 'https://jobs.example.com/b', location: 'London' })
  ].map((job) => jobs.normaliseJob(job));
  assert.deepEqual(
    jobs.dedupeJobs(rows).map((job) => job.id),
    ['job-a', 'other-location']
  );
});

test('Mongo cache reads are capped and timed; legacy records retain real provenance and expiry', async () => {
  const observed = {};
  let filter;
  const jobs = service({
    '../models/jobCache': {
      find(value) {
        filter = value;
        return query(
          [
            {
              jobId: 'old',
              source: 'Jooble',
              title: 'Developer',
              company: 'Example',
              applyUrl: 'https://example.com/a',
              expiresAt: new Date(Date.now() + 60000)
            }
          ],
          observed
        );
      }
    }
  });
  const rows = await jobs.loadCachedJobs({}, true);
  assert.deepEqual(observed.limit, [1000]);
  assert.deepEqual(observed.maxTimeMS, [1500]);
  assert.equal(filter.hidden.$ne, true);
  assert.ok(filter.expiresAt.$gt);
  assert.equal(rows[0].source, 'Jooble');
  assert.equal(rows[0].salary, '');
});

test('Mongo bulk persistence is bounded, idempotent by jobId, and reports failures', async () => {
  let operations;
  const jobs = service({
    '../models/jobCache': {
      async bulkWrite(value, options) {
        operations = value;
        assert.equal(options.ordered, false);
        return { upsertedCount: 1 };
      }
    }
  });
  const result = await jobs.syncJobsToCache([raw(), raw(), raw({ title: '' })]);
  assert.equal(result.synced, 1);
  assert.equal(operations[0].updateOne.filter.jobId, 'job-a');
  const failing = service({
    '../models/jobCache': {
      async bulkWrite() {
        throw new Error('offline');
      }
    }
  });
  assert.equal((await failing.syncJobsToCache([raw()])).failed, true);
});

test('public pool deduplicates concurrent Mongo loads and copies results before personalization', async () => {
  const cache = load('../services/jobPoolCacheService.js', {
    './redisCacheService': { getRedisCacheClient: () => null }
  });
  let count = 0;
  const loader = async () => {
    count++;
    await new Promise((resolve) => setImmediate(resolve));
    return [raw()];
  };
  const results = await Promise.all(Array.from({ length: 20 }, () => cache.load(loader)));
  assert.equal(count, 1);
  results[0][0].title = 'private mutation';
  assert.equal((await cache.load(loader))[0].title, raw().title);
});

test('Redis promotion preserves absolute freshness; Mongo and bounded stale fallback survive outages', async (t) => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  let redisReads = 0;
  const redis = {
    async get() {
      redisReads++;
      return JSON.stringify({ version: 2, jobs: [raw()], observedAt: now, until: now + 1000 });
    }
  };
  const cache = load('../services/jobPoolCacheService.js', {
    './redisCacheService': { getRedisCacheClient: () => redis }
  });
  let mongo = 0;
  const loader = async () => {
    mongo++;
    return [raw({ id: 'mongo' })];
  };
  assert.equal((await cache.load(loader))[0].id, 'job-a');
  now += 1001;
  redis.get = async () => {
    throw Error('offline');
  };
  redis.eval = async () => {
    throw Error('offline');
  };
  assert.equal((await cache.load(loader))[0].id, 'mongo');
  assert.equal(mongo, 1);
  now += 301000;
  assert.equal(
    (
      await cache.load(async () => {
        throw Error('Mongo offline');
      })
    )[0].id,
    'mongo'
  );
  now += 3600001;
  await assert.rejects(
    cache.load(async () => {
      throw Error('Mongo offline');
    })
  );
  assert.equal(redisReads, 1);
});

test('poisoned or oversized shared cache envelopes fall back to Mongo', async () => {
  for (const value of [
    '{',
    JSON.stringify({ version: 1, jobs: [] }),
    JSON.stringify({ version: 2, jobs: Array(1001).fill(raw()), until: Date.now() + 60000 })
  ]) {
    const cache = load('../services/jobPoolCacheService.js', {
      './redisCacheService': {
        getRedisCacheClient: () => ({ get: async () => value, eval: async () => 1 })
      }
    });
    assert.equal((await cache.load(async () => [raw({ id: 'safe' })]))[0].id, 'safe');
  }
});

test('feed never awaits providers, preserves deterministic ranking and isolates contexts', async () => {
  const freshUntil = new Date(Date.now() + 60000);
  const jobs = service({
    './jobPoolCacheService': {
      load: async () => [
        raw({ freshUntil }),
        raw({
          id: 'front',
          freshUntil,
          title: 'Frontend React Engineer',
          skills: ['React'],
          applyUrl: 'https://example.com/frontend'
        })
      ]
    },
    './jobGovernanceService': {
      withLease: async () => {
        throw Error('must not request providers');
      }
    }
  });
  const options = {
    careerStack: 'Backend',
    experienceLevel: 'Entry',
    knownSkills: ['Node.js'],
    skillGaps: ['Redis']
  };
  const one = await jobs.buildJobPool(options);
  const two = await jobs.buildJobPool(options);
  assert.deepEqual(one.jobs, two.jobs);
  assert.equal(one.jobs[0].id, 'job-a');
  const other = await jobs.buildJobPool({ careerStack: 'Frontend', knownSkills: ['React'] });
  assert.equal(other.jobs[0].id, 'front');
  assert.equal(one.jobs[0].id, 'job-a');
  assert.equal(one.diagnostics.fromCacheOnly, true);
  assert.ok(one.jobs[0].missingSkills.includes('Redis'));
  assert.doesNotMatch(one.jobs[0].whyMatched, /overlap with Node.js, Redis/);
});

test('all provider calls use quota admission and transport bounds, with no credential leakage', async () => {
  const reservations = [];
  const completions = [];
  let config;
  const transport = load('../services/jobProviderTransport.js', {
    './jobGovernanceService': {
      reserve: async (source) => {
        reservations.push(source);
        return { allowed: true };
      },
      finish: async (...args) => completions.push(args)
    },
    axios: {
      request: async (value) => {
        config = value;
        throw Object.assign(Error('secret API key'), {
          response: { status: 429, data: 'secret body', headers: { 'retry-after': '90' } }
        });
      }
    }
  });
  await assert.rejects(
    transport.get('jooble', 'https://jooble.org/api/secret', { timeout: 999999 }),
    (error) => {
      assert.equal(error.message, 'Job source request failed.');
      assert.equal(error.response.data, null);
      return true;
    }
  );
  assert.deepEqual(reservations, ['jooble']);
  assert.equal(config.timeout, 6000);
  assert.equal(config.maxRedirects, 0);
  assert.ok(config.signal);
  assert.equal(completions[0][1].status, 429);
});

test('denied quota never reaches HTTP and unavailable quota store fails closed', async () => {
  const governance = load('../services/jobGovernanceService.js', {
    './redisCacheService': { getRedisCacheClient: () => null }
  });
  assert.equal((await governance.reserve('arbeitnow')).reason, 'quota_store_unavailable');
  const transport = load('../services/jobProviderTransport.js', {
    './jobGovernanceService': { reserve: async () => ({ allowed: false, reason: 'daily_budget' }) },
    axios: { request: () => assert.fail('HTTP must not run') }
  });
  await assert.rejects(transport.get('jsearch', 'https://example.com'), /daily_budget/);
});

test('provider admission supplies atomic shared keys, budgets, intervals and UTC resets', async () => {
  let call;
  const governance = load('../services/jobGovernanceService.js', {
    './redisCacheService': {
      getRedisCacheClient: () => ({
        eval: async (script, args) => {
          call = { script, ...args };
          return [1, 'allowed'];
        }
      })
    }
  });
  const result = await governance.reserve('remotive');
  assert.equal(result.allowed, true);
  assert.equal(call.arguments[3], '4');
  assert.equal(call.arguments[7], '21600000');
  assert.ok(call.keys.every((key) => key.includes('{remotive}')));
  assert.equal(new Date(Number(call.arguments[5])).getUTCHours(), 0);
  assert.equal(new Date(Number(call.arguments[6])).getUTCDate(), 1);
});

test('429 and exhausted response quota open cooldown; Retry-After dates are never shortened', async () => {
  const calls = [];
  const governance = load('../services/jobGovernanceService.js', {
    './redisCacheService': {
      getRedisCacheClient: () => ({
        eval: async (...args) => {
          calls.push(args);
          return 1;
        },
        zRem: async () => {}
      })
    }
  });
  const delay = 3 * 86400000;
  assert.equal(governance.retryDelay({ 'retry-after': String(delay / 1000) }), delay);
  assert.ok(
    governance.retryDelay({ 'retry-after': new Date(Date.now() + delay).toUTCString() }) >=
      delay - 1000
  );
  await governance.finish(
    { allowed: true, base: 'jobs:v2:{jooble}', token: 'owner' },
    { status: 429, headers: { 'retry-after': '120' }, failed: true }
  );
  assert.equal(calls[0][1].keys[0], 'jobs:v2:{jooble}:cooldown');
  assert.equal(calls[0][1].arguments[0], '120000');
  calls.length = 0;
  await governance.finish(
    { allowed: true, base: 'jobs:v2:{adzuna}', token: 'owner' },
    { status: 200, headers: { 'x-ratelimit-remaining': '0' } }
  );
  assert.ok(calls.some(([, args]) => args.keys[0].endsWith(':cooldown')));
});

test('lease release compares ownership atomically and refuses absent Redis', async () => {
  let script;
  const governance = load('../services/jobGovernanceService.js', {
    './redisCacheService': {
      getRedisCacheClient: () => ({
        set: async () => 'OK',
        eval: async (value) => {
          script = value;
        }
      })
    }
  });
  assert.equal(await governance.withLease('refresh', 60, async () => 'done'), 'done');
  assert.match(script, /GET.*ARGV\[1\].*DEL/);
  const blocked = load('../services/jobGovernanceService.js', {
    './redisCacheService': { getRedisCacheClient: () => null }
  });
  assert.equal((await blocked.withLease('refresh', 60, () => assert.fail())).skipped, true);
});

test('free source failures do not break paid fallback and malformed rows are isolated', async () => {
  const sources = [];
  const jobs = service({
    '../models/jobSourceHealth': { find: () => query([]) },
    './jobProviderTransport': {
      get: async (source) => {
        sources.push(source);
        if (source === 'arbeitnow') throw Object.assign(Error('timeout'), { code: 'ETIMEDOUT' });
        return {
          status: 200,
          data: [
            null,
            { legal: 'terms' },
            {
              id: '1',
              position: 'Engineer',
              company: 'Example',
              url: 'https://remoteok.com/a',
              tags: 'bad tags'
            }
          ]
        };
      }
    }
  });
  const result = await jobs.fetchLiveJobSources('developer', { platform: 'All' });
  assert.ok(sources.includes('arbeitnow'));
  assert.ok(sources.includes('remoteok'));
  assert.ok(result.jobs.length >= 1);
  assert.ok(result.diagnostics.sourceFailures.some((failure) => failure.source === 'arbeitnow'));
  assert.doesNotMatch(JSON.stringify(result), /secret/);
});

test('Saved/Applied/Hidden updates isolate owners, validate allowlists and survive expired cache records', async () => {
  const records = new Map();
  const model = {
    findOne: (filter) => query(records.get(filter._id) || null),
    findOneAndUpdate(filter, update) {
      const value = { ...(records.get(filter._id) || update.$setOnInsert), ...update.$set };
      records.set(filter._id, value);
      return query(value);
    }
  };
  let available = true;
  const actions = load('../services/jobActionService.js', {
    '../models/userJobAction': model,
    './jobService': { findCachedJobById: async () => (available ? raw() : null) }
  });
  const one = '000000000000000000000001';
  const two = '000000000000000000000002';
  await actions.update(one, 'job-a', { saved: true });
  await actions.update(one, 'job-a', { saved: true });
  assert.equal(records.size, 1);
  const second = await actions.update(two, 'job-a', { hidden: true });
  assert.equal(second.userId, two);
  assert.equal(second.saved, undefined);
  assert.equal(records.size, 2);
  available = false;
  assert.equal((await actions.update(one, 'job-a', { applied: true })).applied, true);
  await assert.rejects(
    actions.update(two, 'missing', { saved: true }),
    (error) => error.status === 404
  );
  for (const patch of [{ userId: two }, { saved: 'true' }, { $set: { hidden: false } }, {}])
    await assert.rejects(actions.update(one, 'job-a', patch), (error) => error.status === 400);
  await assert.rejects(
    actions.update('invalid', 'job-a', { saved: true }),
    (error) => error.status === 401
  );
});

test('Jobs Hub limits are authenticated, shared, and stricter for mutations during Redis outages', async () => {
  let count = 0;
  const redis = { eval: async () => ++count };
  let current = redis;
  const limits = load('../middleware/jobsRateLimit.js', {
    '../services/redisCacheService': { getRedisCacheClient: () => current }
  });
  const limiter = limits.limiter('focused', 2, 60000);
  const req = { user: { _id: 'user' }, query: {} };
  let passed = 0;
  const responses = await Promise.all(
    Array.from({ length: 5 }, async () => {
      const res = response();
      await limiter(req, res, () => passed++);
      return res;
    })
  );
  assert.equal(passed, 2);
  assert.equal(responses.filter((res) => res.statusCode === 429).length, 3);
  assert.ok(responses[2].headers['Retry-After']);
  current = null;
  const denied = response();
  await limits.actionRateLimit(req, denied, () => assert.fail());
  assert.equal(denied.statusCode, 503);
  const unauthenticated = response();
  await limiter({ query: {} }, unauthenticated, () => assert.fail());
  assert.equal(unauthenticated.statusCode, 401);
});

test('query pollution is rejected and personalized HTTP responses cannot enter public caches', () => {
  const limits = require('../middleware/jobsRateLimit');
  const invalid = response();
  limits.validateJobsRequest({ query: { skills: { $ne: '' } }, params: {} }, invalid, () =>
    assert.fail()
  );
  assert.equal(invalid.statusCode, 400);
  const valid = response();
  limits.validateJobsRequest({ query: { skills: 'Node.js' }, params: {} }, valid, () => {});
  assert.equal(valid.headers['Cache-Control'], 'private, no-store');
});

test('controller scopes evidence and actions to the authenticated user, hides before pagination, and keeps detail contracts', async () => {
  let evidenceUser;
  let actionOwner;
  const pool = [raw({ id: 'hidden' }), raw({ id: 'saved' }), raw({ id: 'third' })];
  const controller = load('../controllers/jobController.js', {
    '../services/jobService': {
      buildJobPool: async () => ({ jobs: pool, diagnostics: { fromCacheOnly: true } }),
      normaliseJobFilters: () => ({
        page: 1,
        limit: 1,
        platform: 'All',
        location: 'All',
        skills: '',
        jobType: 'All',
        expLevel: 'All'
      }),
      findCachedJobById: async (id) => pool.find((job) => job.id === id),
      isUsableJob: () => true
    },
    '../services/coursePersonalizationService': {
      resolveSkillSignals: async (id, stack) => {
        evidenceUser = { id, stack };
        return { knownSkills: ['Node.js'], skillGaps: [] };
      }
    },
    '../services/jobActionService': {
      forJobs: async (id) => {
        actionOwner = id;
        return [
          { jobId: 'hidden', hidden: true },
          { jobId: 'saved', saved: true }
        ];
      }
    },
    '../models/recommendation': { find: () => query([]) },
    '../models/careerSprint': { findOne: () => query(null) },
    '../services/courseService': { buildCoursePool: async () => [] },
    '../services/platformSettingsService': { getIntegrationSecretsSync: () => ({}) }
  });
  const req = {
    user: { _id: 'owner', activeCareerStack: 'Backend', careerStack: 'Frontend' },
    query: { stack: 'Frontend', userId: 'foreign' }
  };
  const res = response();
  await controller.fetchJobs(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.total, 2);
  assert.equal(res.body.jobs.length, 1);
  assert.equal(res.body.jobs[0].id, 'saved');
  assert.equal(res.body.jobs[0].actions.saved, true);
  assert.equal(actionOwner, 'owner');
  assert.deepEqual(evidenceUser, { id: 'owner', stack: 'Backend' });
  const detail = response();
  // Return only the requested job's actions, as the real query does.
  const hiddenController = load('../controllers/jobController.js', {
    '../services/jobService': { findCachedJobById: async () => pool[0], isUsableJob: () => true },
    '../services/coursePersonalizationService': {
      resolveSkillSignals: async () => ({ knownSkills: [], skillGaps: [] })
    },
    '../services/jobActionService': { forJobs: async () => [{ jobId: 'hidden', hidden: true }] }
  });
  await hiddenController.getJobById({ ...req, params: { id: 'hidden' } }, detail);
  assert.equal(detail.statusCode, 404);
});

test('Express router contracts preserve GET endpoints and protect every action alias', async () => {
  const pass = (_req, _res, next) => next();
  const route = load('../routes/jobRoutes.js', {
    '../middleware/authmiddleware': {
      protect: (req, res, next) => {
        if (req.headers.authorization !== 'test-owner')
          return res.status(401).json({ message: 'Authentication required.' });
        req.user = { _id: 'owner' };
        return next();
      }
    },
    '../middleware/jobsRateLimit': {
      jobsRateLimit: pass,
      jobsRefreshLimit: pass,
      actionRateLimit: pass,
      validateJobsRequest: pass
    },
    '../controllers/jobController': {
      fetchJobs: (_req, res) => res.json({ jobs: [] }),
      getJobById: (req, res) => res.json({ job: { id: req.params.id } }),
      getSourceHealthStatus: (_req, res) => res.json({ sources: {} }),
      getCacheHealthStatus: (_req, res) => res.json({ totalCachedJobs: 0 })
    },
    '../controllers/jobActionController': {
      list: (_req, res) => res.json({ actions: [] }),
      update: (_req, res) => res.json({ action: {} }),
      toggle: (field, value) => (_req, res) => res.json({ action: { [field]: value } })
    }
  });
  // Exercise real Express routing without depending on Windows dynamic TCP port
  // exclusions. Controller and quota behavior are verified separately above.
  const dispatch = (method, url, authenticated = true) =>
    new Promise((resolve, reject) => {
      const res = response();
      res.json = (value) => {
        res.body = value;
        resolve(res);
        return res;
      };
      route.handle(
        { method, url, headers: authenticated ? { authorization: 'test-owner' } : {}, query: {} },
        res,
        (error) => (error ? reject(error) : reject(new Error(`Unmatched route: ${method} ${url}`)))
      );
    });
  assert.equal((await dispatch('GET', '/', false)).statusCode, 401);
  for (const endpoint of ['/', '/source-health', '/cache-health', '/actions', '/job-a'])
    assert.equal((await dispatch('GET', endpoint)).statusCode, 200);
  assert.equal((await dispatch('PUT', '/job-a/actions')).statusCode, 200);
  for (const [alias, field] of [
    ['save', 'saved'],
    ['apply', 'applied'],
    ['hide', 'hidden']
  ]) {
    assert.equal((await dispatch('POST', `/job-a/${alias}`, false)).statusCode, 401);
    for (const method of ['POST', 'DELETE']) {
      const result = await dispatch(method, `/job-a/${alias}`);
      assert.equal(result.statusCode, 200);
      assert.equal(result.body.action[field], method === 'POST');
    }
  }
});

test('all six adapters preserve source identities and free-first fallback avoids unnecessary paid calls', async (t) => {
  const names = [
    'RAPIDAPI_KEY',
    'JOOBLE_API_KEY',
    'ADZUNA_APP_ID',
    'ADZUNA_APP_KEY',
    'JOB_REMOTIVE_ENABLED'
  ];
  const prior = names.map((name) => process.env[name]);
  names.forEach((name) => {
    process.env[name] = name === 'JOB_REMOTIVE_ENABLED' ? 'true' : 'test-configured-value';
  });
  t.after(() =>
    names.forEach((name, index) => {
      if (prior[index] === undefined) delete process.env[name];
      else process.env[name] = prior[index];
    })
  );
  const calls = [];
  const fixture = (source) => {
    calls.push(source);
    const base = {
      id: source,
      title: `${source} Engineer`,
      company: 'Example',
      company_name: 'Example',
      employer_name: 'Example',
      job_title: `${source} Engineer`,
      position: `${source} Engineer`,
      job_apply_link: `https://example.com/${source}`,
      url: `https://example.com/${source}`,
      link: `https://example.com/${source}`,
      redirect_url: `https://example.com/${source}`
    };
    if (source === 'remoteok') return { status: 200, data: [base] };
    return { status: 200, data: { data: [base], jobs: [base], results: [base] } };
  };
  const jobs = service({
    '../models/jobSourceHealth': { find: () => query([]) },
    './jobProviderTransport': {
      get: async (source) => fixture(source),
      post: async (source) => fixture(source)
    }
  });
  const result = await jobs.fetchLiveJobSources('developer', { platform: 'All' });
  assert.equal(calls.length, 6);
  assert.deepEqual(
    new Set(result.jobs.map((job) => job.source.toLowerCase())),
    new Set(['jsearch', 'jooble', 'adzuna', 'remotive', 'arbeitnow', 'remoteok'])
  );
  assert.ok(calls.indexOf('jsearch') > calls.indexOf('remoteok'));
  const abundant = service({
    '../models/jobSourceHealth': { find: () => query([]) },
    './jobProviderTransport': {
      get: async (source) => {
        assert.ok(
          ['arbeitnow', 'remoteok', 'remotive'].includes(source),
          'paid adapter must not run'
        );
        if (source !== 'remoteok') throw Error('unavailable');
        return {
          status: 200,
          data: Array.from({ length: 90 }, (_, id) => ({
            id,
            position: `Engineer ${id}`,
            company: 'Example',
            url: `https://example.com/${id}`
          }))
        };
      },
      post: async () => assert.fail('paid adapter must not run')
    }
  });
  assert.equal(
    (await abundant.fetchLiveJobSources('developer', { platform: 'All' })).jobs.length,
    90
  );
});

test('three transport failures trip a shared circuit and malformed responses count as failures', async () => {
  let failures = 0;
  let opened = false;
  const governance = load('../services/jobGovernanceService.js', {
    './redisCacheService': {
      getRedisCacheClient: () => ({
        eval: async (_script, options) => {
          if (options.keys[0].endsWith(':failures')) return ++failures;
          opened = true;
          assert.equal(options.arguments[0], '300000');
          return 1;
        },
        zRem: async () => {}
      })
    }
  });
  for (let index = 0; index < 3; index++)
    await governance.finish(
      { allowed: true, base: 'jobs:v2:{remoteok}', token: String(index) },
      { failed: true, status: 500 }
    );
  assert.equal(opened, true);
  let completion;
  const transport = load('../services/jobProviderTransport.js', {
    './jobGovernanceService': {
      reserve: async () => ({ allowed: true }),
      finish: async (_reservation, value) => {
        completion = value;
      }
    },
    axios: { request: async () => ({ status: 200, data: { jobs: 'malformed' } }) }
  });
  await assert.rejects(
    transport.get('jooble', 'https://jooble.org/api/test'),
    /Job source request failed/
  );
  assert.equal(completion.failed, true);
});

test('worker bounds each tick to one profile and refresh is shared across processes', async () => {
  let runs = 0;
  const worker = load('../services/jobSourceSyncService.js', {
    mongoose: { connection: { readyState: 1 } },
    './jobService': {
      refreshJobCache: async () => {
        runs++;
        await new Promise((resolve) => setImmediate(resolve));
        return { skipped: true };
      }
    }
  });
  const results = await Promise.all([worker.runJobSourceSync(), worker.runJobSourceSync()]);
  assert.equal(runs, 1);
  assert.ok(results.some((result) => result.reason === 'already_running'));
  let held = false;
  const redis = {
    set: async () => {
      if (held) return null;
      held = true;
      return 'OK';
    },
    eval: async () => {
      held = false;
    }
  };
  const one = load('../services/jobGovernanceService.js', {
    './redisCacheService': { getRedisCacheClient: () => redis }
  });
  const two = load('../services/jobGovernanceService.js', {
    './redisCacheService': { getRedisCacheClient: () => redis }
  });
  let total = 0;
  const work = async () => {
    total++;
    await new Promise((resolve) => setImmediate(resolve));
  };
  await Promise.all([one.withLease('refresh', 60, work), two.withLease('refresh', 60, work)]);
  assert.equal(total, 1);
});

test('a slow Mongo fill cannot replace a newer ingestion in process memory', async (t) => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const cache = load('../services/jobPoolCacheService.js', {
    './redisCacheService': { getRedisCacheClient: () => null }
  });
  let release;
  const slow = cache.load(
    () =>
      new Promise((resolve) => {
        release = resolve;
      })
  );
  now += 100;
  await cache.publish([raw({ id: 'new' })]);
  release([raw({ id: 'old' })]);
  await slow;
  assert.equal((await cache.load(() => assert.fail()))[0].id, 'new');
});
