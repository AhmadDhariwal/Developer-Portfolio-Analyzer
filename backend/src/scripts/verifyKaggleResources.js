'use strict';
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
const cache = require('../services/redisCacheService');
const governance = require('../services/integrationGovernanceService');
const resources = require('../services/integrations/kaggleResources');

async function main() {
  const name =
    process.argv.find((value) => value.startsWith('--output='))?.slice(9) ||
    'kaggle-resources-live-2026-10-27.json';
  if (!/^[a-z0-9-]+\.json$/.test(name)) throw Error('Invalid evidence filename.');
  const account =
    process.argv.find((value) => value.startsWith('--account='))?.slice(10) || 'kaggle';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,49}$/.test(account)) throw Error('Invalid public account.');
  const kind = process.argv.find((value) => value.startsWith('--resource='))?.slice(11);
  if (kind && !['notebooks', 'datasets'].includes(kind)) throw Error('Invalid resource kind.');
  const kinds = kind ? [kind] : ['notebooks', 'datasets'];
  const page = Number(process.argv.find((value) => value.startsWith('--page='))?.slice(7) || 1);
  if (!Number.isInteger(page) || page < 1 || page > 1000) throw Error('Invalid page.');
  const output = path.resolve(__dirname, '../../verification/integrations', name);
  if (fs.existsSync(output)) throw Error('Evidence exists; do not repeat this live acceptance.');
  const result = {
    checkedAt: new Date().toISOString(),
    publicAccount: account,
    config: resources.validateConfig(),
    requests: [],
    status: 'BLOCKED'
  };
  const axios = require('axios');
  const interceptor = axios.interceptors.response.use(
    (response) => {
      if (String(response.config.url).startsWith('https://api.kaggle.com/v1/'))
        result.requests.push({
          endpoint: response.config.url,
          status: response.status,
          contentType: String(response.headers['content-type'] || ''),
          keys:
            response.data && typeof response.data === 'object' ? Object.keys(response.data) : [],
          rowCount: response.data?.datasets?.length ?? response.data?.kernels?.length ?? 0,
          identitySamples: (response.data?.datasets || response.data?.kernels || [])
            .slice(0, 5)
            .map((row) =>
              Object.fromEntries(
                [
                  'id',
                  'ref',
                  'title',
                  'ownerRef',
                  'ownerName',
                  'creatorName',
                  'creatorUrl',
                  'author',
                  'isPrivate'
                ]
                  .filter((key) => row[key] !== undefined)
                  .map((key) => [key, row[key]])
              )
            ),
          returnedFieldNames: Object.keys(
            (response.data?.datasets || response.data?.kernels || [])[0] || {}
          )
        });
      return response;
    },
    (error) => {
      if (String(error.config?.url).startsWith('https://api.kaggle.com/v1/'))
        result.requests.push({
          endpoint: error.config.url,
          status: error.response?.status || null
        });
      return Promise.reject(error);
    }
  );
  try {
    if (!result.config.ok) {
      result.reason = 'KAGGLE_TOKEN_MISSING_OR_INVALID';
      return;
    }
    const ready = await cache.initRedisCache({ silent: true, probeOnly: true });
    if (!ready) {
      result.reason = 'REDIS_ADMISSION_UNAVAILABLE';
      return;
    }
    await governance.withJob('kaggle', () =>
      governance.run('kaggle-resource-acceptance', async () => {
        for (const kind of kinds) {
          try {
            result[kind] = { status: 'PASS', ...(await resources.list(kind, account, '', page)) };
          } catch (error) {
            result[kind] = {
              status: 'BLOCKED',
              classifiedStatus: error.status || null,
              reason: error.message
            };
          }
        }
      })
    );
    result.status = kinds.every((key) => result[key]?.status === 'PASS')
      ? 'RESOURCE_READ_PASS'
      : 'BLOCKED';
  } catch {
    result.reason = 'SHARED_ADMISSION_OR_NETWORK_UNAVAILABLE';
  } finally {
    axios.interceptors.response.eject(interceptor);
    await cache.closeRedisCache();
    fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify(result, null, 2));
  }
}
main().catch(() => {
  console.error('Kaggle verification did not complete; sensitive details withheld.');
  process.exitCode = 1;
});
