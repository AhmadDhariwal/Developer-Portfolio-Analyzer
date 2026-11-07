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
      traceId: store.id,
      receivedAt: store.receivedAt,
      quotaAt: stamp(),
      key: args[1].keys[0],
      queueAtStart: queue(),
    };
    store.current = record;
    store.records.push(record);
    requests.add(record);
    try {
      const result = await evalCommand.apply(this, args);
      record.counter = Number(result);
      return result;
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
  return {
    middleware(req, res, next) {
      const store = {
        id: req.get('X-Scenario-Trace') || 'unlabelled',
        receivedAt: stamp(),
        records: [],
      };
      res.once('finish', () => {
        const now = stamp();
        for (const record of store.records) {
          record.status = res.statusCode;
          record.finishedAt = now;
        }
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
    },
  };
};
