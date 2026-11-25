// Disposable HTTP benchmark. No .env, production URI, API mocks or persisted policy cache.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { AsyncLocalStorage } = require('node:async_hooks');
const { createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const Module = require('node:module');
const root = path.resolve(__dirname, '../..');
const outputDirectory = path.join(root, 'backend/verification/jobs-hub/p1.5b');
const option = (name, fallback) =>
  process.argv.find((value) => value.startsWith(`--${name}=`))?.split('=')[1] || fallback;
const phase = option('phase', 'before');
const count = Number(option('count', '1000'));
assert.ok(['before', 'after'].includes(phase));
assert.ok([261, 1000].includes(count));
const preflight = JSON.parse(fs.readFileSync(path.join(outputDirectory, 'preflight.json')));
const sourceEntries = [
  ...preflight.acceptedSources,
  ...[
    'backend/src/modules/recruiter/controllers/hub/applicationShortlistController.js',
    'backend/src/modules/jobs/jobApplicationController.js'
  ].map((relative) => ({
    path: relative,
    blob: execFileSync('git', ['rev-parse', `${preflight.head}:${relative}`], {
      cwd: root,
      encoding: 'utf8'
    }).trim()
  }))
];
const acceptedSources = new Map(
  sourceEntries.map(({ path: relative, blob }) => [
    path.join(root, relative),
    execFileSync('git', ['cat-file', 'blob', blob], { cwd: root, encoding: 'utf8' })
  ])
);
if (phase === 'before') {
  const compile = Module.prototype._compile;
  Module.prototype._compile = function (source, filename) {
    return compile.call(this, acceptedSources.get(filename) || source, filename);
  };
}
const mongoose = require('mongoose');
const { startApplicationFixture } = require('../src/tests/fixtures/applicationPerformanceFixture');
const context = new AsyncLocalStorage();
const workflowBudget = require('../src/modules/recruiter/utils/hub/applicationWorkflowBudget');
const originalRetryGuard = workflowBudget.retryGuard;
workflowBudget.retryGuard = (deadline) => {
  const guard = originalRetryGuard(deadline);
  return async () => {
    const start = performance.now();
    try {
      return await guard();
    } finally {
      const record = context.getStore();
      if (record) record.retryGuardMs = (record.retryGuardMs || 0) + performance.now() - start;
    }
  };
};
const originalConnect = mongoose.connect;
mongoose.connect = (uri, options) =>
  originalConnect.call(mongoose, uri, { ...options, monitorCommands: true });
const originalTransaction = mongoose.connection.transaction;
mongoose.connection.transaction = async function (work, options) {
  const request = context.getStore();
  if (!request) return originalTransaction.call(this, work, options);
  const transaction = { attempts: [], startedMs: performance.now(), options };
  request.transactions.push(transaction);
  try {
    const result = await originalTransaction.call(
      this,
      async (session) => {
        const attempt = { startMs: performance.now(), outcome: 'running' };
        transaction.attempts.push(attempt);
        try {
          const value = await work(session);
          attempt.outcome = 'callback-completed';
          return value;
        } catch (error) {
          attempt.outcome = 'callback-failed';
          attempt.code = error.code;
          attempt.labels = error.errorLabels;
          throw error;
        } finally {
          attempt.durationMs = performance.now() - attempt.startMs;
        }
      },
      options
    );
    transaction.outcome = 'committed';
    return result;
  } catch (error) {
    transaction.outcome = 'failed';
    transaction.error = { name: error.name, code: error.code, labels: error.errorLabels };
    throw error;
  } finally {
    transaction.durationMs = performance.now() - transaction.startedMs;
    transaction.callbackMs = transaction.attempts.reduce((sum, item) => sum + item.durationMs, 0);
    transaction.retryAndCommitMs = transaction.durationMs - transaction.callbackMs;
  }
};
const evidence = {
  phase,
  count,
  status: 'running',
  productionDataUsed: false,
  head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  sources: sourceEntries.map((entry) => ({
    ...entry,
    testedSha256:
      phase === 'before'
        ? createHash('sha256')
            .update(acceptedSources.get(path.join(root, entry.path)))
            .digest('hex')
        : createHash('sha256')
            .update(fs.readFileSync(path.join(root, entry.path)))
            .digest('hex')
  })),
  workflowBudgetSource:
    phase === 'before'
      ? 'not present in accepted implementation'
      : createHash('sha256')
          .update(
            fs.readFileSync(
              path.join(
                root,
                'backend/src/modules/recruiter/utils/hub/applicationWorkflowBudget.js'
              )
            )
          )
          .digest('hex'),
  rounds: 3,
  samples: [],
  groups: {}
};
function summary(samples) {
  const values = samples.map((item) => item.httpMs).sort((a, b) => a - b);
  const percentile = (p) => values[Math.ceil(values.length * p) - 1];
  const commands = samples.flatMap((item) => item.commands);
  const commandMs = (names) =>
    commands.filter((item) => names.includes(item.name)).reduce((sum, item) => sum + item.ms, 0);
  const commitMs = commandMs(['commitTransaction']);
  const abortMs = commandMs(['abortTransaction']);
  const retryAndCommitMs = samples
    .flatMap((item) => item.transactions)
    .reduce((sum, tx) => sum + tx.retryAndCommitMs, 0);
  return {
    requests: samples.length,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    maxMs: values.at(-1),
    httpResults: samples.reduce((counts, item) => {
      counts[item.status] = (counts[item.status] || 0) + 1;
      return counts;
    }, {}),
    timeoutRate: samples.filter((item) => item.timeout).length / samples.length,
    scopedRetryGuardMs: samples.reduce((sum, item) => sum + (item.retryGuardMs || 0), 0),
    readCommandRoundTripMs: commandMs(['find', 'getMore', 'aggregate']),
    writeCommandRoundTripMs: commandMs(['update', 'findAndModify', 'insert']),
    commitRoundTripMs: commitMs,
    abortRoundTripMs: abortMs,
    retryBackoffAndClientOverheadMs: Math.max(0, retryAndCommitMs - commitMs - abortMs),
    commitOutcomes: {
      acknowledged: commands.filter((item) => item.name === 'commitTransaction' && !item.failed)
        .length,
      failedOrUncertain: commands.filter((item) => item.name === 'commitTransaction' && item.failed)
        .length
    },
    transactionAttempts: samples.reduce(
      (sum, item) => sum + item.transactions.reduce((n, tx) => n + tx.attempts.length, 0),
      0
    ),
    retries: samples.reduce(
      (sum, item) =>
        sum + item.transactions.reduce((n, tx) => n + Math.max(0, tx.attempts.length - 1), 0),
      0
    ),
    queryMs: samples.reduce(
      (sum, item) => sum + item.commands.reduce((n, cmd) => n + cmd.ms, 0),
      0
    ),
    maxIndividualCommandMs: Math.max(
      0,
      ...samples.flatMap((item) => item.commands.map((cmd) => cmd.ms))
    ),
    commitResults: samples.flatMap((item) =>
      item.commands.filter((cmd) => cmd.name === 'commitTransaction')
    ),
    peakSampleRss: Math.max(...samples.map((item) => item.memory.rss)),
    peakSampleHeap: Math.max(...samples.map((item) => item.memory.heapUsed))
  };
}
async function main() {
  let fixture;
  try {
    fixture = await startApplicationFixture({
      count,
      seed: `p15b-${count}`,
      configure(app) {
        app.use((req, _res, next) => {
          const record = { id: req.headers['x-benchmark-id'], transactions: [], commands: [] };
          context.run(record, () => {
            evidence.samples.push(record);
            next();
          });
        });
      }
    });
    evidence.fixtureIdentity = createHash('sha256')
      .update(JSON.stringify(fixture.records))
      .digest('hex');
    evidence.runtime = {
      node: process.versions.node,
      mongoose: require('mongoose/package.json').version,
      mongooseDriver: require(
        require.resolve('mongodb/package.json', {
          paths: [path.dirname(require.resolve('mongoose/package.json'))]
        })
      ).version,
      server: (await mongoose.connection.db.admin().serverInfo()).version
    };
    console.log(
      JSON.stringify({ phase, count, ready: true, fixtureIdentity: evidence.fixtureIdentity })
    );
    const commands = new Map();
    const client = mongoose.connection.getClient();
    client.on('commandStarted', (event) => {
      const request = context.getStore();
      if (!request) return;
      const command = event.command;
      commands.set(event.requestId, {
        request,
        name: event.commandName,
        collection:
          command.findAndModify ||
          command.find ||
          command.aggregate ||
          (typeof command.update === 'string' ? command.update : undefined),
        transaction: command.txnNumber?.toString(),
        maxTimeMS: command.maxTimeMS,
        batchSize: command.batchSize,
        // Synthetic fixture resource classes only; no submitted evidence or credentials.
        writeFields: command.updates?.flatMap((item) => Object.keys(item.u?.$inc || {}))
      });
    });
    const finished = (event, failed) => {
      const value = commands.get(event.requestId);
      if (!value) return;
      commands.delete(event.requestId);
      const { request, ...command } = value;
      request.commands.push({
        ...command,
        ms: event.duration,
        failed,
        code: event.failure?.code,
        message: event.failure?.message,
        labels: event.failure?.errorLabels
      });
    };
    client.on('commandSucceeded', (event) => finished(event, false));
    client.on('commandFailed', (event) => finished(event, true));
    const { sign } = require('../src/modules/auth/utils/authSessionToken');
    const token = sign({ _id: fixture.owner });
    let sequence = 0;
    const measure = async (group, row) => {
      const id = String(++sequence);
      const start = performance.now();
      const response = await fetch(
        fixture.origin +
          (row
            ? `/api/recruiter-hub/jobs/${fixture.job._id}/applications/${row._id}`
            : '/api/recruiter-hub/shortlists/applications?page=1&limit=20'),
        {
          method: row ? 'PATCH' : 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'x-benchmark-id': id
          },
          signal: AbortSignal.timeout(130000),
          ...(row
            ? { body: JSON.stringify({ status: 'reviewing', expectedStatus: 'submitted' }) }
            : {})
        }
      );
      const body = await response.json();
      const record = evidence.samples.find((item) => item.id === id);
      Object.assign(record, {
        group,
        status: response.status,
        httpMs: performance.now() - start,
        timeout: /budget|time limit|timeout|timed out|deadline/i.test(body.message || ''),
        memory: { rss: process.memoryUsage().rss, heapUsed: process.memoryUsage().heapUsed },
        ...(response.status === 200 ? {} : { message: body.message })
      });
      if (!row && response.status === 200) {
        assert.equal(body.meta.total, count);
        assert.equal(body.shortlists.length, 20);
      }
      return record;
    };
    await measure('warmup');
    for (let round = 0; round < evidence.rounds; round++) {
      for (let i = 0; i < 5; i++) await measure('sequential');
      await Promise.all(Array.from({ length: 6 }, () => measure('six-reads')));
      await Promise.all([
        ...Array.from({ length: 4 }, () => measure('mixed-read')),
        ...Array.from({ length: 4 }, (_, i) =>
          measure('mixed-write', fixture.records[round * 4 + i])
        )
      ]);
      console.log(JSON.stringify({ phase, count, round: round + 1 }));
    }
    for (const group of ['sequential', 'six-reads', 'mixed-read', 'mixed-write'])
      evidence.groups[group] = summary(evidence.samples.filter((sample) => sample.group === group));
    evidence.groups.mixed = summary(
      evidence.samples.filter((sample) => sample.group?.startsWith('mixed-'))
    );
    evidence.status = evidence.samples.some((sample) => sample.status !== 200)
      ? 'measured-with-failures'
      : 'passed';
    if (evidence.status !== 'passed') process.exitCode = 1;
    console.log(
      JSON.stringify({ phase, count, groups: evidence.groups }, (key, value) =>
        key === 'commitResults' ? undefined : value
      )
    );
  } finally {
    if (fixture) evidence.cleanup = await fixture.stop();
  }
}
main()
  .catch((error) => {
    evidence.status = 'failed';
    evidence.error = error.stack;
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    fs.writeFileSync(
      path.join(outputDirectory, `${phase}-${count}.json`),
      JSON.stringify(evidence, null, 2) + '\n'
    );
  });
