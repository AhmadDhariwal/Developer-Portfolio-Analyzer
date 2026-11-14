'use strict';

// Short diagnostics only. All infrastructure is owned by verifyScenarioP3.
module.exports = async ({
  workers,
  worker,
  call,
  report,
  check,
  persist,
  sleep,
  Histogram,
  mongoPort,
  redisPort,
  label,
  transport,
  profile,
  burstOnly,
  lockGate,
  skipMemory,
  redisTrace,
}) => {
  const operations = ['context', 'evaluate', 'history', 'save', 'export'];
  const mix = operations.flatMap((operation, index) =>
    Array([40, 35, 15, 8, 2][index]).fill(operation),
  );
  const counters = Object.fromEntries(operations.map((operation) => [operation, 0]));
  let sequence = 0;
  report.focused = {
    label,
    transport,
    cpuProfiling: profile,
    burstOnly,
    lockGate,
    skipMemory,
    longDurationAcceptance: false,
    profiles: [],
    cold: [],
  };
  const sample = async (name) => {
    const values = await Promise.all(workers.map((item) => item.request('sample', { gc: true })));
    report.samples.push({ label: name, at: new Date().toISOString(), workers: values });
    persist();
    return values;
  };
  async function replace() {
    for (let instance = 0; instance < 2; instance++) {
      const previous = workers[instance];
      await previous.request('stop');
      workers[instance] = await worker(
        transport === 'direct' ? { port: mongoPort } : previous.mongoProxy,
        transport === 'proxy' ? previous.redisProxy : { port: redisPort },
      );
    }
  }
  async function load(name, seconds, rps, profile = false, assess = true) {
    if (redisTrace) await redisTrace.start();
    const histograms = Object.fromEntries(
      operations.map((operation) => [operation, new Histogram()]),
    );
    const statuses = {},
      errors = {};
    const pending = new Set();
    const before = await Promise.all(
      workers.map((item) => (item.draining ? { pid: null } : item.request('diagnostic-reset'))),
    );
    if (profile) await Promise.all(workers.map((item) => item.request('profile-start')));
    const phase = {
      label: name,
      seconds,
      rps,
      scheduled: seconds * rps,
      completed: 0,
      statuses,
      errors,
      peakPending: 0,
    };
    report.phases.push(phase);
    const start = performance.now();
    for (let index = 0; index < seconds * rps; index++) {
      const operation = mix[sequence % 100],
        owner = counters[operation]++ % 100,
        instance = sequence++ % 2;
      if (pending.size >= 128) {
        phase.generatorBackpressure = true;
        await Promise.race(pending);
      }
      const task = call(operation, owner, instance)
        .then(
          (value) => {
            statuses[value.status] = (statuses[value.status] || 0) + 1;
            if (value.status < 400) histograms[operation].add(value.elapsedMs);
            else
              errors[value.body?.message || value.status] =
                (errors[value.body?.message || value.status] || 0) + 1;
            phase.completed++;
          },
          (error) => {
            statuses.network = (statuses.network || 0) + 1;
            errors[error.message] = (errors[error.message] || 0) + 1;
            phase.completed++;
          },
        )
        .finally(() => pending.delete(task));
      pending.add(task);
      phase.peakPending = Math.max(phase.peakPending, pending.size);
      const wait = start + ((index + 1) * 1000) / rps - performance.now();
      if (wait > 0) await sleep(wait);
    }
    await Promise.all(pending);
    phase.elapsedMs = performance.now() - start;
    phase.latency = Object.fromEntries(
      operations.map((operation) => [operation, histograms[operation].json()]),
    );
    phase.diagnostics = await Promise.all(workers.map((item) => item.request('diagnostic')));
    if (redisTrace) phase.redisTrace = await redisTrace.finish();
    phase.cpuPercentOneCore = phase.diagnostics.map((value, instance) =>
      value.pid !== before[instance].pid
        ? null
        : (100 *
            (value.cpu.user +
              value.cpu.system -
              before[instance].cpu.user -
              before[instance].cpu.system)) /
          (phase.elapsedMs * 1000),
    );
    if (profile)
      report.focused.profiles.push({
        phase: name,
        workers: await Promise.all(workers.map((item) => item.request('profile-stop'))),
      });
    if (!profile) {
      check(
        !Object.keys(statuses).some((status) => ![200, 201].includes(Number(status))) &&
          !phase.generatorBackpressure,
        `${name}: every offered request succeeds`,
        phase.statuses,
      );
      const targets = { context: 500, evaluate: 200, history: 150, save: 500, export: 500 };
      if (assess)
        check(
          operations.every((operation) => phase.latency[operation].p95Ms <= targets[operation]) &&
            phase.latency.context.p99Ms <= 1000,
          `${name}: original latency thresholds`,
          phase.latency,
        );
    }
    await sample(name);
    persist();
    console.log(JSON.stringify({ focused: name, statuses, latency: phase.latency }));
    return phase;
  }

  await replace();
  for (let instance = 0; instance < 2; instance++) {
    for (const operation of ['context', 'export', 'evaluate']) {
      const value = await call(operation, 135, instance);
      report.focused.cold.push({
        instance,
        operation,
        status: value.status,
        elapsedMs: value.elapsedMs,
      });
    }
  }
  await load('focused-warmup', 10, 20, false, false);
  await load('focused-burst', lockGate ? 60 : 15, 100, profile);
  if (burstOnly || profile) return;
  const previous = workers[0];
  const inFlight = call('context', 134, 0);
  await sleep(5);
  previous.draining = true;
  const replacement = (async () => {
    await previous.request('stop');
    workers[0] = await worker(previous.mongoProxy, previous.redisProxy);
    const completed = await inFlight;
    report.focused.restart = {
      previous: previous.pid,
      replacement: workers[0].pid,
      inFlightStatus: completed.status,
      inFlightMs: completed.elapsedMs,
      routing: 'Verifier excludes draining worker; deployed load balancer is not verified.',
    };
    check(completed.status === 200, 'In-flight context completes during graceful worker drain');
  })();
  await load('focused-restart', lockGate ? 60 : 10, 20);
  await replacement;
  if (skipMemory) return;
  await load('memory-warmup', 10, 20, false, false);
  const baseline = await sample('memory-baseline');
  for (let index = 0; index < 3; index++)
    await load(`bounded-memory-${index + 1}`, lockGate ? 60 : 10, 20, false, false);
  await sleep(500);
  const final = await sample('memory-final');
  report.focused.memory = final.map((value, instance) => ({
    instance,
    baselineHeap: baseline[instance].memory.heapUsed,
    finalHeap: value.memory.heapUsed,
    growth: value.memory.heapUsed / baseline[instance].memory.heapUsed - 1,
    rss: value.memory.rss,
    context: value.context,
    pool: value.pool,
    observer: value.observer,
  }));
  check(
    report.focused.memory.every(
      (value) =>
        value.growth < 0.1 &&
        value.finalHeap < 256 * 1024 * 1024 &&
        !value.context.pending &&
        !value.context.active &&
        !value.context.joiners &&
        !value.pool.waiting &&
        !value.pool.checkedOut,
    ),
    'Short bounded memory check: original growth/heap/drain limits',
    report.focused.memory,
  );
};
