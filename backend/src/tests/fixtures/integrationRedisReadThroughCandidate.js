'use strict';
// Benchmark-only prototype. Production public snapshots do not import Redis.
const { createHash } = require('node:crypto');
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function createCandidate(collection, clientFor) {
  const counts = { mongoReads: 0, redisGets: 0, redisSets: 0 };
  const pending = new Set();
  async function full(key) {
    counts.mongoReads++;
    const row = await collection.findOne({ _id: key });
    return row && row.freshUntil > new Date() ? row : null;
  }
  async function populate(client, row) {
    counts.redisSets++;
    await client.set(
      `candidate:${row._id}`,
      JSON.stringify({
        key: row._id,
        generation: row.generation,
        freshUntil: row.freshUntil.getTime(),
        observation: row.observation
      }),
      { EX: Math.max(1, Math.floor((row.freshUntil.getTime() - Date.now()) / 1000)) }
    );
  }
  return {
    counts,
    async baseline(key) {
      return (await full(key))?.observation || null;
    },
    async warm(key) {
      const row = await full(key);
      await populate(clientFor(), row);
    },
    async read(key) {
      const client = clientFor();
      if (!client) return (await full(key))?.observation || null;
      counts.mongoReads++;
      const metadata = await collection.findOne(
        { _id: key, freshUntil: { $gt: new Date() } },
        {
          projection: { generation: 1, freshUntil: 1, contentHash: 1 }
        }
      );
      if (!metadata) return null;
      try {
        counts.redisGets++;
        const cached = JSON.parse(await client.get(`candidate:${key}`));
        if (
          cached?.key === key &&
          cached.generation === metadata.generation &&
          cached.freshUntil === metadata.freshUntil.getTime() &&
          digest(cached.observation) === metadata.contentHash
        )
          return cached.observation;
      } catch {
        /* Optional cache failure cannot override Mongo validity. */
      }
      const row = await full(key);
      if (!row) return null;
      const write = populate(client, row)
        .catch(() => {})
        .finally(() => pending.delete(write));
      pending.add(write);
      return row.observation;
    },
    drain: () => Promise.allSettled([...pending])
  };
}

module.exports = { createCandidate, digest };
