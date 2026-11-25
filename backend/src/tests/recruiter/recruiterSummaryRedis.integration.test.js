const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { promisify } = require('node:util');
const test = require('node:test');

const execute = promisify(execFile);
const url = process.env.RECRUITER_TEST_REDIS_URL;
const cachePath = require.resolve('../../core/cache/redisCacheService');
const summaryPath = require.resolve('../../modules/recruiter/services/hub/recruiterSummaryCache');
const worker = `
  const redis = require(process.argv[1]);
  const { getRecruiterSummary } = require(process.argv[2]);
  const [scope, value, offline] = JSON.parse(process.argv[3]);
  (async () => {
    if (!offline && !await redis.initRedisCache({ silent: true, probeOnly: true })) {
      throw new Error('Disposable Redis connection unavailable');
    }
    try {
      const result = await getRecruiterSummary(scope, () => ({ value }));
      console.log(JSON.stringify(result));
    } finally {
      await redis.closeRedisCache();
    }
  })().catch((error) => { console.error(error.message); process.exitCode = 1; });
`;

test(
  'independent processes share analytics cache and bypass obsolete data on recovery',
  {
    skip: !url && 'Set RECRUITER_TEST_REDIS_URL to an isolated loopback Redis instance',
    timeout: 65000
  },
  async () => {
    assert.equal(process.env.RECRUITER_TEST_REDIS_DISPOSABLE, 'true');
    assert.equal(new URL(url).hostname, '127.0.0.1');
    const scope = {
      recruiterId: randomUUID(),
      organizationId: randomUUID(),
      teamIds: [],
      revision: ['before']
    };
    const read = async (input, value, offline = false) => {
      const { stdout } = await execute(
        process.execPath,
        ['-e', worker, cachePath, summaryPath, JSON.stringify([input, value, offline])],
        {
          env: { ...process.env, REDIS_URL: url, RECRUITER_SUMMARY_CACHE_TTL_SECONDS: '90' },
          timeout: 12000
        }
      );
      return JSON.parse(stdout.trim()).value;
    };
    assert.equal(await read(scope, 'first'), 'first');
    assert.equal(await read(scope, 'other worker'), 'first');
    const updated = { ...scope, revision: ['changed during outage'] };
    assert.equal(await read(updated, 'offline fresh value', true), 'offline fresh value');
    assert.equal(await read(updated, 'after recovery'), 'after recovery');
    assert.equal(await read(updated, 'other worker again'), 'after recovery');
  }
);
