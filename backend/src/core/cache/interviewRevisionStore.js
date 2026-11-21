const mongoose = require('mongoose');
const { randomUUID } = require('node:crypto');
const governance = require('../../modules/integrations/services/integrationMongoGovernanceService');
const State = require('../../modules/integrations/models/integrationGovernanceState');
const PREFIX = 'cache:interview:revision:';
const RETAIN_REVISION = new Date('9999-01-01T00:00:00.000Z');

// Revision records share the existing coordination schema and TTL index. Their
// namespace outlives cached responses, including when the writer exits offline.
async function create(name, observed = '') {
  if (mongoose.connection.readyState !== 1) return null;
  return governance.transaction(async (session) => {
    const key = `${PREFIX}${name}`;
    const previous = await State.collection.findOne({ _id: key }, { session });
    const epoch = previous?.leases?.[0]?.token || randomUUID();
    const [observedEpoch, observedCount] = String(observed).split(':');
    const count =
      Math.max(previous?.count || 0, observedEpoch === epoch ? Number(observedCount) || 0 : 0) + 1;
    const revision = `${epoch}:${count}:${randomUUID()}`;
    await State.collection.replaceOne(
      { _id: key },
      {
        _id: key,
        count,
        expiresAt: RETAIN_REVISION,
        leases: [
          { token: epoch, until: RETAIN_REVISION },
          { token: revision, until: RETAIN_REVISION }
        ]
      },
      { upsert: true, session }
    );
    return revision;
  });
}

async function restore(redis) {
  if (mongoose.connection.readyState !== 1) return false;
  const rows = await State.collection
    .find({ _id: /^cache:interview:revision:/ }, { timeoutMS: 2000 })
    .limit(1001)
    .toArray();
  if (rows.length > 1000) throw Error('Interview revision recovery bound exceeded.');
  for (let offset = 0; offset < rows.length; offset += 16) {
    await Promise.all(
      rows
        .slice(offset, offset + 16)
        .map((row) => publish(redis, row._id.slice(PREFIX.length), row.leases[1].token))
    );
  }
  return true;
}

async function publish(redis, name, revision) {
  if (String(revision).split(':').length !== 3) return redis.set(name, revision);
  return redis.eval(
    "local old=redis.call('GET',KEYS[1]); local oe,oc=string.match(old or '', '^([^:]+):(%d+):'); local ne,nc=string.match(ARGV[1], '^([^:]+):(%d+):'); if oe and ne and oe==ne and tonumber(oc)>=tonumber(nc) then return 0 end; if old~=ARGV[1] then redis.call('SET',KEYS[1],ARGV[1]); return 1 end; return 0",
    { keys: [name], arguments: [revision] }
  );
}

module.exports = { create, restore, publish };
