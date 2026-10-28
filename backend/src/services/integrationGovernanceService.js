'use strict';
const { AsyncLocalStorage } = require('node:async_hooks');
const { createHash } = require('node:crypto');
// Integration admission has one durable authority, independent of cache health.
const mongo = require('./integrationMongoGovernanceService');
const context = new AsyncLocalStorage();
const integer = (name, fallback, min, max) => {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
};
const hash = (value) => createHash('sha256').update(String(value)).digest('hex');
const unavailable = () =>
  Object.assign(Error('Integration controls temporarily unavailable.'), { status: 503 });
async function reserve(provider, owner, duration) {
  return mongo.admit(provider, owner, duration, {
    global: integer('INTEGRATION_GLOBAL_CONCURRENCY', 8, 1, 64),
    provider: integer('INTEGRATION_PROVIDER_CONCURRENCY', 2, 1, 16),
    requests: integer('INTEGRATION_PROVIDER_REQUESTS_PER_MIN', 60, 1, 10000),
    user: integer('INTEGRATION_USER_PROVIDER_REQUESTS_PER_MIN', 20, 1, 1000)
  });
}
function retryAfter(headers = {}) {
  const value = headers['retry-after'];
  const delay =
    value === undefined
      ? 60000
      : /^\d+(\.\d+)?$/.test(String(value))
        ? Number(value) * 1000
        : Date.parse(String(value)) - Date.now();
  const reset = Number(headers['x-ratelimit-reset']) * 1000 - Date.now();
  return Math.max(
    1000,
    Number.isFinite(delay) ? delay : 60000,
    Number.isFinite(reset) && Number(headers['x-ratelimit-remaining']) === 0 ? reset : 0
  );
}
async function finish(reservation, error) {
  try {
    if (error)
      await mongo.failure(
        reservation.provider,
        error.response?.status,
        [403, 429].includes(error.response?.status) ? retryAfter(error.response?.headers) : 60000
      );
  } finally {
    await mongo.release(reservation);
  }
}
async function request(provider, operation, retry = false) {
  const state = context.getStore();
  if (!state?.owner || state.signal.aborted) throw unavailable();
  const timeout = Math.min(
    integer('INTEGRATION_REQUEST_TIMEOUT_MS', 10000, 1000, 30000),
    state.until - Date.now()
  );
  if (timeout <= 0) throw unavailable();
  const attempts = retry ? 2 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const reservation = await reserve(provider, state.owner, timeout + 2000);
    if (state.observationMeter) state.observationMeter.requests++;
    let failure;
    try {
      const result = await operation({
        timeout,
        signal: state.signal,
        maxRedirects: 0,
        maxContentLength: 2 * 1024 * 1024,
        maxBodyLength: 100 * 1024,
        proxy: false
      });
      if (
        result?.headers?.['x-ratelimit-remaining'] !== undefined &&
        Number(result.headers['x-ratelimit-remaining']) === 0
      ) {
        await mongo.cooldown(provider, retryAfter(result.headers));
      }
      const payload = result?.data;
      // Stack Exchange expresses backoff and quota inside successful JSON responses.
      if (payload && (Number(payload.backoff) > 0 || payload.quota_remaining === 0)) {
        await mongo.cooldown(provider, Math.max(60000, Number(payload.backoff || 0) * 1000));
      }
      return result;
    } catch (error) {
      if (error.response?.status === 429) {
        error.status = 429;
        error.retryAfter = Math.ceil(retryAfter(error.response.headers) / 1000);
      }
      failure = error;
      // Never retry exchanges, refreshes, quota errors, authentication failures or unsafe writes.
      if (
        attempt + 1 >= attempts ||
        ![502, 503, 504].includes(error.response?.status) ||
        state.signal.aborted ||
        state.until - Date.now() < timeout + 500
      )
        throw error;
    } finally {
      await finish(reservation, failure).catch(() => {});
    }
    await new Promise((resolve) => setTimeout(resolve, 100 + Math.floor(Math.random() * 300)));
  }
}
function assertActive() {
  const state = context.getStore();
  if (!state || state.signal.aborted || state.until <= Date.now())
    throw Object.assign(Error('Provider request timed out.'), { code: 'ERR_CANCELED' });
}

async function measurePublicFetch(operation) {
  assertActive();
  const state = context.getStore();
  const observationMeter = { requests: 0 };
  const value = await context.run({ ...state, observationMeter }, operation);
  assertActive();
  return { value, requestCost: Math.max(1, observationMeter.requests) };
}

async function consumePublicSnapshot(provider, cost) {
  assertActive();
  await mongo.consumeSnapshot(
    provider,
    context.getStore().owner,
    cost,
    integer('INTEGRATION_USER_PROVIDER_REQUESTS_PER_MIN', 20, 1, 1000)
  );
  assertActive();
}
async function withJob(provider, operation) {
  const reservation = await mongo.admit(
    provider,
    '',
    integer('INTEGRATION_OPERATION_TIMEOUT_MS', 60000, 5000, 120000) + 10000,
    {
      global: integer('INTEGRATION_GLOBAL_CONCURRENCY', 8, 1, 64),
      provider: integer('INTEGRATION_PROVIDER_CONCURRENCY', 2, 1, 16)
    },
    true
  );
  try {
    return await operation();
  } finally {
    await mongo.release(reservation).catch(() => {});
  }
}
async function run(owner, operation) {
  const duration = integer('INTEGRATION_OPERATION_TIMEOUT_MS', 60000, 5000, 120000);
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(Object.assign(Error('Provider request timed out.'), { code: 'ERR_CANCELED' }));
    }, duration);
  });
  try {
    return await Promise.race([
      context.run(
        { owner: String(owner), until: Date.now() + duration, signal: controller.signal },
        operation
      ),
      deadline
    ]);
  } finally {
    clearTimeout(timer);
  }
}
function actionLimit(name, authenticated = true) {
  return async (req, res, next) => {
    try {
      const count = await mongo.action(name, authenticated ? req.user?._id : req.ip);
      if (count > integer('INTEGRATION_ACTIONS_PER_MIN', 10, 1, 1000)) {
        res.set('Retry-After', '60');
        return res.status(429).json({ message: 'Too many integration requests.' });
      }
      res.set('Cache-Control', 'private, no-store');
      next();
    } catch {
      return res.status(503).json({ message: 'Integration controls temporarily unavailable.' });
    }
  };
}
module.exports = {
  run,
  withJob,
  request,
  assertActive,
  measurePublicFetch,
  consumePublicSnapshot,
  actionLimit,
  integer,
  hash,
  reserve,
  finish,
  retryAfter
};
