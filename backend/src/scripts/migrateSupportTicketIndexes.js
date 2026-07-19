require('dotenv').config();
const mongoose = require('mongoose');
const SupportTicket = require('../models/supportTicket');
const SupportTicketDedupe = require('../models/supportTicketDedupe');
const SupportTicketQuota = require('../models/supportTicketQuota');

const INDEXES = [
  { collection: SupportTicket.collection, name: 'support_ticket_user_created_at', keys: { userId: 1, createdAt: -1 } },
  { collection: SupportTicket.collection, name: 'support_ticket_status_created_at', keys: { status: 1, createdAt: -1 } },
  {
    collection: SupportTicket.collection,
    name: 'support_ticket_user_dedupe_window_unique',
    keys: { userId: 1, dedupeKey: 1, dedupeWindow: 1 },
    options: {
      unique: true,
      partialFilterExpression: { dedupeKey: { $type: 'string' }, dedupeWindow: { $type: 'number' } }
    }
  },
  { collection: SupportTicketDedupe.collection, name: 'support_ticket_dedupe_expiry_ttl', keys: { expiresAt: 1 }, options: { expireAfterSeconds: 0 } },
  { collection: SupportTicketQuota.collection, name: 'support_ticket_quota_user_window_unique', keys: { userId: 1, window: 1 }, options: { unique: true } },
  { collection: SupportTicketQuota.collection, name: 'support_ticket_quota_expiry_ttl', keys: { expiresAt: 1 }, options: { expireAfterSeconds: 0 } }
];

const duplicateCount = async (collection, groupId) => {
  const duplicates = await collection.aggregate([
    { $match: { dedupeKey: { $type: 'string' }, dedupeWindow: { $type: 'number' } } },
    { $group: { _id: groupId, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $count: 'groups' }
  ]).toArray();
  return duplicates[0]?.groups || 0;
};

const sameKeys = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const ensureIndex = async (index) => {
  const existing = await index.collection.indexes();
  const matched = existing.find((candidate) => sameKeys(candidate.key, index.keys));
  if (matched) {
    if (index.options?.unique && !matched.unique) throw new Error(`Existing index ${matched.name} is not unique.`);
    return matched.name;
  }
  return index.collection.createIndex(index.keys, { name: index.name, ...(index.options || {}) });
};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const ticketDuplicates = await duplicateCount(SupportTicket.collection, {
    userId: '$userId', dedupeKey: '$dedupeKey', dedupeWindow: '$dedupeWindow'
  });
  const quotaDuplicates = await SupportTicketQuota.collection.aggregate([
    { $group: { _id: { userId: '$userId', window: '$window' }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $count: 'groups' }
  ]).toArray();
  const quotaDuplicateGroups = quotaDuplicates[0]?.groups || 0;
  console.log(JSON.stringify({ ticketDuplicateGroups: ticketDuplicates, quotaDuplicateGroups }));
  if (ticketDuplicates || quotaDuplicateGroups) process.exitCode = 2;
  if (!process.exitCode) {
    const createdOrVerified = [];
    for (const index of INDEXES) createdOrVerified.push(await ensureIndex(index));
    const verified = await Promise.all([...new Set(INDEXES.map((index) => index.collection))].map(async (collection) => ({
      collection: collection.collectionName,
      indexes: (await collection.indexes()).map((index) => index.name)
    })));
    console.log(JSON.stringify({ createdOrVerified, verified }));
  }
  await mongoose.disconnect();
})().catch(async (error) => {
  console.error('Support index migration failed:', error.message);
  await mongoose.disconnect();
  process.exit(1);
});
