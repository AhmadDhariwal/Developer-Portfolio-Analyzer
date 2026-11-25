const assert = require('node:assert/strict');
const test = require('node:test');
const redisCache = require('../../core/cache/redisCacheService');

test('analytics uses scoped shared entries and invalidates by authoritative input after an outage', async (t) => {
  const previousTtl = process.env.RECRUITER_SUMMARY_CACHE_TTL_SECONDS;
  process.env.RECRUITER_SUMMARY_CACHE_TTL_SECONDS = '30';
  t.after(() => {
    if (previousTtl === undefined) delete process.env.RECRUITER_SUMMARY_CACHE_TTL_SECONDS;
    else process.env.RECRUITER_SUMMARY_CACHE_TTL_SECONDS = previousTtl;
  });
  const entries = new Map();
  let online = true;
  t.mock.method(redisCache, 'getRedisCacheClient', () =>
    online
      ? {
          get: async (key) => entries.get(key),
          setEx: async (key, ttl, value) => {
            assert.equal(ttl, 30);
            entries.set(key, value);
          }
        }
      : null
  );
  t.mock.method(redisCache, 'acquireCacheLock', async () => true);
  t.mock.method(redisCache, 'releaseCacheLock', async () => {});
  const {
    getRecruiterSummary
  } = require('../../modules/recruiter/services/hub/recruiterSummaryCache');
  const scope = {
    recruiterId: 'actor-a',
    organizationId: 'org-a',
    teamIds: [],
    revision: ['job-1']
  };
  let computations = 0;
  const build = () => ({ metric: ++computations });
  assert.deepEqual(await getRecruiterSummary(scope, build), { metric: 1 });
  assert.deepEqual(await getRecruiterSummary(scope, build), { metric: 1 });
  assert.deepEqual(await getRecruiterSummary({ ...scope, organizationId: 'org-b' }, build), {
    metric: 2
  });
  online = false;
  const updated = { ...scope, revision: ['job-2'] };
  assert.deepEqual(await getRecruiterSummary(updated, build), { metric: 3 });
  online = true;
  assert.deepEqual(await getRecruiterSummary(updated, build), { metric: 4 });
  assert.deepEqual(await getRecruiterSummary(updated, build), { metric: 4 });
});
