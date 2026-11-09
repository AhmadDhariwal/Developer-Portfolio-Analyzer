'use strict';

// Opt-in, test-process-only timing. Never loaded by application startup.
const { AsyncLocalStorage } = require('node:async_hooks');
const { performance, PerformanceObserver } = require('node:perf_hooks');
const stamp = () => performance.timeOrigin + performance.now();
class Ring {
  constructor(capacity) {
    this.items = new Array(capacity);
    this.count = 0;
  }
  add(value) {
    this.items[this.count++ % this.items.length] = value;
  }
  clear() {
    this.items.fill(undefined);
    this.count = 0;
  }
  values() {
    const length = Math.min(this.count, this.items.length);
    const first = Math.max(0, this.count - length);
    return Array.from({ length }, (_, index) => this.items[(first + index) % this.items.length]);
  }
}

module.exports = ({ raw, socket, cache, queue }) => {
  const scope = new AsyncLocalStorage();
  const requests = new Ring(4096),
    pauses = new Ring(512),
    garbage = new Ring(512);
  const replies = [],
    staged = [];
  let responseBuffer = '',
    phaseStart = stamp(),
    lastTick = stamp();
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const from = performance.timeOrigin + entry.startTime;
      if (from >= phaseStart)
        garbage.add({
          from,
          to: from + entry.duration,
          durationMs: entry.duration,
          kind: entry.detail.kind,
        });
    }
  });
  observer.observe({ entryTypes: ['gc'] });
  const heartbeat = setInterval(() => {
    const now = stamp();
    if (now - lastTick > 25) pauses.add({ from: lastTick, to: now, lagMs: now - lastTick - 5 });
    lastTick = now;
  }, 5);
  heartbeat.unref();

  // This connection carries only quota EVALs after startup. Observe RESP integer
  // replies in FIFO order, independently of the SDK's unchanged decoder.
  socket.prependListener('data', (chunk) => {
    responseBuffer += chunk.toString('ascii');
    if (responseBuffer.length > 65536) throw Error('Trace RESP buffer bound exceeded.');
    let end;
    while ((end = responseBuffer.indexOf('\r\n')) >= 0) {
      const line = responseBuffer.slice(0, end);
      responseBuffer = responseBuffer.slice(end + 2);
      if (line[0] !== ':' && line[0] !== '-') continue;
      const record = replies.shift();
      if (record) {
        record.replyReadAt = stamp();
        record.replyType = line[0];
      }
    }
  });
  const write = socket.write;
  socket.write = function (...args) {
    const record = scope.getStore()?.current;
    if (record && !record.enqueuedAt) {
      record.enqueuedAt = stamp();
      if (replies.length >= 4096 || staged.length >= 4096)
        throw Error('Trace queue bound exceeded.');
      replies.push(record);
      staged.push(record);
    }
    return write.apply(this, args);
  };
  for (const name of ['_write', '_writev']) {
    const original = socket[name];
    socket[name] = function (...args) {
      const batch = staged.splice(0);
      const before = stamp();
      for (const record of batch) record.dispatchedAt = before;
      const callback = args.at(-1);
      args[args.length - 1] = (...values) => {
        const now = stamp();
        for (const record of batch) record.writeCallbackAt = now;
        callback(...values);
      };
      const result = original.apply(this, args);
      const elapsed = stamp() - before;
      for (const record of batch) record.writeCallMs = elapsed;
      return result;
    };
  }
  const evalCommand = raw.eval;
  raw.eval = async function (...args) {
    const store = scope.getStore();
    if (!store) return evalCommand.apply(this, args);
    const record = {
      traceId: store.request.traceId,
      quotaAt: stamp(),
      queueAtStart: queue(),
    };
    store.current = record;
    store.request.redis.push(record);
    try {
      const result = await evalCommand.apply(this, args);
      record.counter = Number(result);
      return result;
    } catch (error) {
      record.errorCode = error.code || error.name || 'REDIS_ERROR';
      throw error;
    } finally {
      record.settledAt = stamp();
    }
  };
  const getClient = cache.getRedisCacheClient;
  cache.getRedisCacheClient = (...args) => {
    const target = getClient(...args);
    if (!target) return target;
    return new Proxy(target, {
      get(object, name) {
        const value = Reflect.get(object, name);
        if (name !== 'eval') return value;
        return async (...values) => {
          const store = scope.getStore();
          try {
            return await value.apply(object, values);
          } catch (error) {
            if (store?.current) {
              store.current.rejectedAt = stamp();
              store.current.error = error.message;
            }
            throw error;
          }
        };
      },
    });
  };
  const mongoRequests = new Map();
  const observeMongo = (client) => {
    client.on('connectionCheckOutStarted', () => {
      const request = scope.getStore()?.request;
      if (request) request.checkoutStartedAt = stamp();
    });
    client.on('connectionCheckedOut', (event) => {
      const request = scope.getStore()?.request;
      if (request) {
        request.mongo.push({
          kind: 'checkout',
          durationMs: event.durationMS,
          at: stamp(),
        });
        delete request.checkoutStartedAt;
      }
    });
    client.on('connectionCheckOutFailed', (event) => {
      const request = scope.getStore()?.request;
      if (request) {
        request.mongo.push({
          kind: 'checkout-failed',
          reason: event.reason,
          durationMs: event.durationMS,
          at: stamp(),
        });
        delete request.checkoutStartedAt;
      }
    });
    client.on('commandStarted', (event) => {
      const request = scope.getStore()?.request;
      if (!request) return;
      const record = {
        kind: 'command',
        name: event.commandName,
        database: event.databaseName,
        collection: event.command?.find || event.command?.aggregate || event.command?.count,
        startedAt: stamp(),
      };
      request.mongo.push(record);
      mongoRequests.set(event.requestId, { request, record });
    });
    const finishCommand = (event, failed) => {
      const pending = mongoRequests.get(event.requestId);
      if (!pending) return;
      mongoRequests.delete(event.requestId);
      pending.record.finishedAt = stamp();
      pending.record.durationMs = event.duration;
      if (failed) pending.record.failed = true;
    };
    client.on('commandSucceeded', (event) => finishCommand(event, false));
    client.on('commandFailed', (event) => finishCommand(event, true));
    return () => mongoRequests.clear();
  };
  return {
    observeMongo,
    record(kind, fields = {}) {
      const request = scope.getStore()?.request;
      if (!request) return false;
      request.spans.push({ kind, at: stamp(), ...fields });
      return true;
    },
    middleware(req, res, next) {
      const startedAt = stamp();
      const request = {
        traceId: req.get('X-Scenario-Trace') || 'unlabelled',
        method: req.method,
        endpoint: req.path,
        startedAt,
        redis: [],
        mongo: [],
        spans: [],
      };
      requests.add(request);
      const store = {
        request,
        current: null,
      };
      res.once('finish', () => {
        const now = stamp();
        request.status = res.statusCode;
        request.finishedAt = now;
        request.durationMs = now - startedAt;
      });
      scope.run(store, next);
    },
    reset() {
      requests.clear();
      pauses.clear();
      garbage.clear();
      phaseStart = lastTick = stamp();
    },
    snapshot() {
      return {
        clock: 'Unix milliseconds from performance.timeOrigin + performance.now',
        requests: requests.values(),
        pauses: pauses.values(),
        garbage: garbage.values(),
        totals: { requests: requests.count, pauses: pauses.count, garbage: garbage.count },
        capacities: { requests: 4096, pauses: 512, garbage: 512, pending: 4096, respBytes: 65536 },
        pending: replies.length,
        staged: staged.length,
      };
    },
    close() {
      clearInterval(heartbeat);
      observer.disconnect();
      mongoRequests.clear();
    },
  };
};
