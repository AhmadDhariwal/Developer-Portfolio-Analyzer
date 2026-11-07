const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./fixtures/newsHubRedisFixture');

function setup() {
  const counters = new Map();
  const middleware = load('../middleware/newsMiddleware.js', {
    '../services/redisCacheService': {
      getRedisCacheClient: () => ({
        eval: async (_script, { keys }) => {
          const count = (counters.get(keys[0]) || 0) + 1;
          counters.set(keys[0], count);
          return count;
        }
      })
    }
  });
  const request = async (query, user = 'browse-test') => {
    const result = { status: 200, admitted: false, headers: {} };
    const req = { user: { _id: user }, query };
    const res = {
      set(key, value) {
        result.headers[key] = value;
      },
      status(code) {
        result.status = code;
        return this;
      },
      json() {}
    };
    let feedAdmitted = false;
    await middleware.feedLimit(req, res, () => {
      feedAdmitted = true;
    });
    if (feedAdmitted)
      await middleware.validateFeed(req, res, () => {
        result.admitted = true;
      });
    return result;
  };
  return { counters, request };
}

test('catalog refresh, view switches, filtering and pagination use only the 120/minute feed budget', async () => {
  const { counters, request } = setup();
  for (let index = 0; index < 120; index++) {
    const result = await request({
      mode: index % 2 ? 'explore' : 'personalized',
      bypassCache: 'true',
      page: String(1 + (index % 3)),
      date: index % 2 ? 'week' : 'month'
    });
    assert.equal(result.status, 200);
    assert.equal(result.admitted, true);
    assert.equal(result.headers['Cache-Control'], 'private, no-store');
  }
  assert.ok([...counters.keys()].every((key) => key.includes(':request:feed:')));
  assert.equal((await request({ bypassCache: 'true' })).status, 429);
});

test('provider checks retain their separate 3/minute limit without blocking subsequent browsing or another account', async () => {
  const { request } = setup();
  for (const refresh of ['true', '1', 'yes']) assert.equal((await request({ refresh })).status, 200);
  const blocked = await request({ refresh: 'true' });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers['Retry-After'], '60');
  assert.equal((await request({ bypassCache: 'true', mode: 'explore' })).status, 200);
  assert.equal((await request({ refresh: 'false', bypassCache: 'true' })).status, 200);
  assert.equal((await request({ refresh: 'true' }, 'another-account')).status, 200);
});
