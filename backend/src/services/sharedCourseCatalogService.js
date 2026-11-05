'use strict';

// Authoritative raw provider coverage. No owner, evidence, ranking or progress belongs here.
const mongoose = require('mongoose');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { skills } = require('../utils/courseIdentity');
const governance = require('./courseGovernanceService');

const VERSION = 'shared-courses-v1';
const TOPICS = [
  'JavaScript',
  'TypeScript',
  'Python',
  'React',
  'Angular',
  'Vue',
  'Node.js',
  'Express',
  'MongoDB',
  'SQL',
  'PostgreSQL',
  'Docker',
  'Kubernetes',
  'AWS',
  'GCP',
  'Azure',
  'Git',
  'HTML',
  'CSS',
  'Redux',
  'GraphQL',
  'REST',
  'API',
  'Testing',
  'CI/CD',
  'Linux',
  'System Design',
  'Data Structures',
  'Algorithms',
  'Machine Learning',
  'AI',
  'Java',
  'C#',
  '.NET',
  'PHP',
  'Django',
  'FastAPI',
  'Spring',
  'Next.js',
  'Tailwind CSS',
  'Flutter',
  'Accessibility',
  'Data Science',
  'Statistics',
  'C++',
];
const STACKS = ['Frontend', 'Backend', 'Full Stack', 'AI/ML'];
const FRESH_MS = 6 * 60 * 60 * 1000;
const STALE_MS = 7 * 24 * 60 * 60 * 1000;
const NEGATIVE_MS = 10 * 60 * 1000;
const LEASE_MS = 45_000;
const STORE_MS = 5000;
const MAX_ACTIVE = 4;
const MAX_WAITERS = 200;
const memory = new Map();
const inflight = new Map();
const counters = { memoryHits: 0, mongoHits: 0, builds: 0, staleHits: 0, budgetDenied: 0 };
const curatedMemory = new Map();
let revisionMemory;
let waiting = 0;
let initializedDb;
let initialization;

const unavailable = () =>
  Object.assign(Error('Shared catalog temporarily unavailable.'), { status: 503 });
const collection = () => mongoose.connection.db.collection('shared_course_catalog');
const canonicalTopic = (topic, stack = 'Full Stack') => {
  const candidate = skills(
    [
      String(topic || '')
        .trim()
        .replace(/\s+/g, ' '),
    ],
    1,
  )[0];
  // Finite taxonomy bounds both storage and paid query cardinality. Unknown free-text
  // queries filter the stack pool locally; they never create arbitrary paid searches.
  return (
    TOPICS.find((name) => name.toLowerCase() === candidate?.toLowerCase()) ||
    (STACKS.includes(stack) ? stack : 'Full Stack')
  );
};

async function initialize() {
  if (mongoose.connection.readyState !== 1) throw unavailable();
  const db = mongoose.connection.db;
  if (db !== initializedDb || !initialization) {
    initializedDb = db;
    initialization = (async () => {
      await collection().createIndex(
        { 'courses.id': 1 },
        { name: 'catalog_course_identity', timeoutMS: STORE_MS },
      );
      await collection().createIndex(
        { version: 1, freshUntil: 1, _id: 1 },
        { name: 'catalog_refresh_schedule', timeoutMS: STORE_MS },
      );
    })().catch((error) => {
      initialization = null;
      throw error;
    });
  }
  return initialization;
}

const valid = (row, fingerprint) =>
  row?.version === VERSION &&
  row.fingerprint === fingerprint &&
  Array.isArray(row.courses) &&
  row.courses.length <= 40 &&
  row.staleUntil > new Date();
const remember = (key, row, stale = false) => {
  memory.delete(key);
  memory.set(key, {
    row,
    until: Math.min(
      Date.now() + (stale ? 5000 : 30_000),
      new Date(stale ? row.staleUntil : row.freshUntil).getTime(),
    ),
  });
  while (memory.size > TOPICS.length + STACKS.length + 1) memory.delete(memory.keys().next().value);
};
const result = (row) => ({
  courses: structuredClone(row.courses),
  status: row.status,
  reason: row.reason || '',
  fromCache: true,
  stale: row.freshUntil <= new Date(),
  staleUntil: row.staleUntil,
});

async function read(key) {
  return collection().findOne({ _id: key }, { timeoutMS: STORE_MS });
}

async function build(key, topic, fingerprint, fetchProvider) {
  const token = randomUUID();
  const now = new Date();
  let locked;
  try {
    await collection()
      .updateOne(
        { _id: key },
        { $setOnInsert: { topic, leaseUntil: new Date(0) } },
        { upsert: true, timeoutMS: STORE_MS },
      )
      .catch((error) => {
        if (error.code !== 11000) throw error;
      });
    locked = await collection().findOneAndUpdate(
      {
        _id: key,
        $or: [{ leaseUntil: { $exists: false } }, { $expr: { $lte: ['$leaseUntil', '$$NOW'] } }],
      },
      [
        {
          $set: {
            leaseToken: token,
            leaseUntil: { $add: ['$$NOW', LEASE_MS] },
            topic,
            generation: { $add: [{ $ifNull: ['$generation', 0] }, 1] },
          },
        },
      ],
      { returnDocument: 'after', timeoutMS: STORE_MS },
    );
  } catch (error) {
    if (error.code === 11000) return null;
    throw unavailable();
  }
  if (!locked) return null;
  let slot;
  try {
    // Double check after acquisition; another worker may have just published.
    if (valid(locked, fingerprint) && locked.freshUntil > now) return result(locked);
    for (let i = 0; i < MAX_ACTIVE; i++) {
      const lease = await governance.acquirePoolLease(`shared-catalog:slot:${i}`, LEASE_MS);
      if (lease.acquired) {
        slot = { key: `shared-catalog:slot:${i}`, token: lease.token };
        break;
      }
    }
    if (!slot) throw unavailable();
    const control = await read('youtube:control');
    if (control?.openUntil > now) throw unavailable();
    // Current official quota gives search.list its own daily bucket. Reserve an
    // entire pipeline (at most two searches + one details call) in a rolling 25h
    // window, covering even Pacific DST days. Reservations survive failed/crashed calls.
    const configured = process.env.COURSES_YOUTUBE_PIPELINES_PER_25H ?? '48';
    const maximum = Math.max(0, Math.min(49, Math.trunc(Number(configured) || 0)));
    await collection().updateOne(
      { _id: 'youtube:control' },
      { $setOnInsert: { reservations: [] } },
      { upsert: true, timeoutMS: STORE_MS },
    );
    const recent = {
      $filter: {
        input: { $ifNull: ['$reservations', []] },
        as: 'at',
        cond: { $gt: ['$$at', { $subtract: ['$$NOW', 25 * 60 * 60_000] }] },
      },
    };
    const reservation = await collection().updateOne(
      { _id: 'youtube:control', $expr: { $lt: [{ $size: recent }, maximum] } },
      [{ $set: { reservations: { $concatArrays: [recent, ['$$NOW']] } } }],
      { timeoutMS: STORE_MS },
    );
    if (!reservation.matchedCount) {
      counters.budgetDenied++;
      throw unavailable();
    }
    counters.builds++;
    const fetched = await fetchProvider(`${topic} programming`, 40, { forceRefresh: true });
    const successful = fetched.status === 'available';
    const completedAt = new Date();
    const prior = valid(locked, fingerprint) ? locked.courses : [];
    const courses = successful
      ? require('./courseService').dedupeCourses(
          fetched.courses
            .slice(0, 40)
            .map((course) => require('./courseService').normaliseCourse(course))
            .filter(Boolean),
        )
      : prior;
    const failureCount = successful ? 0 : Number(locked.failureCount || 0) + 1;
    const ttl =
      successful && courses.length
        ? FRESH_MS
        : Math.min(60 * 60_000, NEGATIVE_MS * 2 ** Math.min(failureCount, 3));
    const row = {
      version: VERSION,
      fingerprint,
      topic,
      courses,
      status: fetched.status,
      reason: fetched.reason || '',
      failureCount,
      updatedAt: completedAt,
      freshUntil: new Date(Date.now() + ttl),
      staleUntil: successful
        ? new Date(Date.now() + STALE_MS)
        : prior.length
          ? locked.staleUntil
          : new Date(Date.now() + ttl),
    };
    const published = await collection().updateOne(
      { _id: key, leaseToken: token, $expr: { $gt: ['$leaseUntil', '$$NOW'] } },
      { $set: row },
      { timeoutMS: STORE_MS },
    );
    if (!published.matchedCount) throw unavailable();
    // A provider-wide breaker survives process restarts. Successful probes reset it.
    if (successful) {
      await collection().updateOne(
        { _id: 'youtube:control' },
        { $set: { failureCount: 0, openUntil: new Date(0) } },
        { upsert: true, timeoutMS: STORE_MS },
      );
    } else {
      const state = await collection().findOneAndUpdate(
        { _id: 'youtube:control' },
        { $inc: { failureCount: 1 } },
        { upsert: true, returnDocument: 'after', timeoutMS: STORE_MS },
      );
      if (state.failureCount >= 3)
        await collection().updateOne(
          { _id: 'youtube:control' },
          { $set: { openUntil: new Date(Date.now() + 30 * 60_000) } },
          { timeoutMS: STORE_MS },
        );
    }
    remember(key, row);
    return { ...result(row), fromCache: false };
  } finally {
    await collection()
      .updateOne(
        { _id: key, leaseToken: token },
        { $unset: { leaseToken: '', leaseUntil: '' } },
        { timeoutMS: STORE_MS },
      )
      .catch(() => {});
    if (slot) await governance.releasePoolLease(slot.key, slot.token);
  }
}

async function getYouTube({ topic, careerStack, fingerprint, fetchProvider, background = false }) {
  await initialize();
  const canonical = canonicalTopic(topic, careerStack);
  const key = `youtube:${canonical}`;
  const cached = memory.get(key);
  if (cached?.until > Date.now() && valid(cached.row, fingerprint)) {
    counters.memoryHits++;
    return result(cached.row);
  }
  const row = await read(key);
  if (valid(row, fingerprint) && row.freshUntil > new Date()) {
    counters.mongoHits++;
    remember(key, row);
    return result(row);
  }
  const refresh = () => {
    if (inflight.has(key)) return inflight.get(key);
    if (inflight.size >= MAX_ACTIVE) return Promise.reject(unavailable());
    const work = (async () => {
      const deadline = Date.now() + LEASE_MS + STORE_MS;
      while (Date.now() < deadline) {
        const built = await build(key, canonical, fingerprint, fetchProvider);
        if (built) return built;
        if (background) return null;
        await delay(150 + Math.floor(Math.random() * 100));
        const completed = await read(key);
        if (valid(completed, fingerprint) && completed.freshUntil > new Date())
          return result(completed);
      }
      throw unavailable();
    })().finally(() => inflight.delete(key));
    inflight.set(key, work);
    return work;
  };
  if (valid(row, fingerprint) && !background) {
    counters.staleHits++;
    remember(key, row, true);
    refresh().catch(() => {});
    return { ...result(row), reason: 'Cached courses are being refreshed.' };
  }
  if (waiting >= MAX_WAITERS) throw unavailable();
  waiting++;
  try {
    return await refresh();
  } finally {
    waiting--;
  }
}

async function ingestCurated(courses, version) {
  await initialize();
  // One bounded inventory document; historical private snapshots are never rewritten.
  if (courses.length > 200) throw Error('Curated inventory exceeds reviewed catalog limit.');
  await collection().updateOne(
    { _id: 'curated' },
    { $set: { version, courses, updatedAt: new Date() } },
    { upsert: true, timeoutMS: STORE_MS },
  );
}

async function getCurated(courses, version) {
  await initialize();
  const cached = curatedMemory.get(version);
  if (cached?.db === initializedDb && cached.until > Date.now())
    return structuredClone(cached.courses);
  let row = await read('curated');
  if (row?.version !== version) {
    await ingestCurated(courses, version);
    row = await read('curated');
  }
  const active = row.courses.filter((course) => !row.audits?.[course.id]?.archived);
  curatedMemory.clear();
  curatedMemory.set(version, { db: initializedDb, until: Date.now() + 30_000, courses: active });
  return structuredClone(active);
}

async function revision() {
  if (mongoose.connection.readyState !== 1) return VERSION;
  await initialize();
  if (revisionMemory?.db === initializedDb && revisionMemory.until > Date.now())
    return revisionMemory.value;
  const row = await collection().findOne(
    { _id: 'curated' },
    { projection: { version: 1, auditRevision: 1 }, timeoutMS: STORE_MS },
  );
  const value = `${VERSION}:${row?.version || 'initial'}:${row?.auditRevision || 'initial'}`;
  revisionMemory = { db: initializedDb, value, until: Date.now() + 30_000 };
  return value;
}

async function findCourse(courseId) {
  await initialize();
  const row = await collection().findOne(
    {
      'courses.id': courseId,
      [`audits.${courseId}.archived`]: { $ne: true },
      $or: [{ _id: 'curated' }, { version: VERSION, staleUntil: { $gt: new Date() } }],
    },
    { projection: { 'courses.$': 1 }, timeoutMS: STORE_MS },
  );
  return row?.courses?.[0] || null;
}

// Storage/network faults have one retryable public classification; no database
// exception or provider response crosses the course API boundary.
const storageBoundary =
  (work) =>
  async (...args) => {
    try {
      return await work(...args);
    } catch {
      throw unavailable();
    }
  };

module.exports = {
  getYouTube: storageBoundary(getYouTube),
  getCurated: storageBoundary(getCurated),
  revision: storageBoundary(revision),
  findCourse: storageBoundary(findCourse),
  ingestCurated,
  initialize,
  canonicalTopic,
  TOPICS,
  STACKS,
  VERSION,
  clearMemory: () => {
    memory.clear();
    curatedMemory.clear();
    revisionMemory = null;
  },
  metrics: () => ({ ...counters, memoryEntries: memory.size, inflight: inflight.size, waiting }),
};
