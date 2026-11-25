'use strict';

/**
 * Idempotent, non-destructive index verification and creation for Recruiter hot queries.
 * Supports --dry-run (default) and --apply when executed directly.
 */
const mongoose = require('mongoose');
const Job = require('../modules/recruiter/models/Job');
const RecruiterMatch = require('../modules/recruiter/models/RecruiterMatch');
const RecruiterShortlist = require('../modules/recruiter/models/RecruiterShortlist');
const AuditLog = require('../modules/admin/models/auditLog');
const User = require('../modules/auth/models/user');

const RECRUITER_INDEX_SPECS = [
  {
    model: Job,
    modelName: 'Job',
    key: { organizationId: 1, recruiterId: 1, updatedAt: -1 },
    name: 'recruiter_job_org_recruiter_updated_at'
  },
  {
    model: Job,
    modelName: 'Job',
    key: { organizationId: 1, status: 1, updatedAt: -1 },
    name: 'recruiter_job_org_status_updated_at'
  },
  {
    model: RecruiterMatch,
    modelName: 'RecruiterMatch',
    key: { organizationId: 1, recruiterId: 1, updatedAt: -1 },
    name: 'recruiter_match_org_recruiter_updated_at'
  },
  {
    model: RecruiterMatch,
    modelName: 'RecruiterMatch',
    key: { organizationId: 1, recruiterId: 1, jobId: 1, updatedAt: -1 },
    name: 'recruiter_match_org_recruiter_job_updated_at'
  },
  {
    model: RecruiterShortlist,
    modelName: 'RecruiterShortlist',
    key: { organizationId: 1, recruiterId: 1, updatedAt: -1 },
    name: 'recruiter_shortlist_org_recruiter_updated_at'
  },
  {
    model: RecruiterShortlist,
    modelName: 'RecruiterShortlist',
    key: { organizationId: 1, recruiterId: 1, jobId: 1, updatedAt: -1 },
    name: 'recruiter_shortlist_org_recruiter_job_updated_at'
  },
  {
    model: AuditLog,
    modelName: 'AuditLog',
    key: { organizationId: 1, actor: 1, timestamp: -1 },
    name: 'recruiter_audit_org_actor_timestamp'
  },
  {
    model: AuditLog,
    modelName: 'AuditLog',
    key: { organizationId: 1, actor: 1, action: 1, timestamp: -1 },
    name: 'recruiter_audit_org_actor_action_timestamp'
  },
  {
    model: User,
    modelName: 'User',
    key: { isPublic: 1, role: 1, isActive: 1, _id: 1 },
    name: 'recruiter_user_public_role_active_id'
  },
  {
    model: User,
    modelName: 'User',
    key: { organizationId: 1, isPublic: 1, role: 1, isActive: 1, _id: 1 },
    name: 'recruiter_user_org_public_role_active_id'
  }
];

const ensureRecruiterIndexes = async ({ dryRun = false } = {}) => {
  const existingByCollection = new Map();
  const created = [];
  const present = [];
  const pending = [];

  for (const spec of RECRUITER_INDEX_SPECS) {
    await spec.model.init();
    const collection = spec.model.collection;
    const collectionName = collection.collectionName;

    if (!existingByCollection.has(collectionName)) {
      const db = collection.conn?.db || mongoose.connection.db;
      const exists = await db
        .listCollections({ name: collectionName }, { nameOnly: true })
        .toArray();
      const indexes = exists.length > 0 ? await collection.indexes() : [];
      existingByCollection.set(collectionName, indexes);
    }

    const existing = existingByCollection.get(collectionName);
    const keyJson = JSON.stringify(spec.key);
    const matched = existing.find(
      (item) => JSON.stringify(item.key) === keyJson || item.name === spec.name
    );

    if (matched) {
      if (JSON.stringify(matched.key) !== keyJson) {
        throw new Error(
          `Index ${spec.name} on ${collectionName} conflicts with existing definition ${JSON.stringify(matched.key)}.`
        );
      }
      present.push({
        model: spec.modelName,
        collection: collectionName,
        name: matched.name,
        key: spec.key
      });
      continue;
    }

    if (dryRun) {
      pending.push({
        model: spec.modelName,
        collection: collectionName,
        name: spec.name,
        key: spec.key
      });
      continue;
    }

    await collection.createIndex(spec.key, {
      name: spec.name,
      background: true
    });
    created.push({
      model: spec.modelName,
      collection: collectionName,
      name: spec.name,
      key: spec.key
    });
    existing.push({ name: spec.name, key: spec.key });
  }

  return {
    dryRun,
    totalRequired: RECRUITER_INDEX_SPECS.length,
    presentCount: present.length,
    createdCount: created.length,
    pendingCount: pending.length,
    present,
    created,
    pending
  };
};

const extractPlanSummary = (explainResult) => {
  const stages = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.stage) {
      stages.push({
        stage: node.stage,
        indexName: node.indexName || null
      });
    }
    walk(node.inputStage);
    if (Array.isArray(node.inputStages)) {
      node.inputStages.forEach(walk);
    }
  };

  walk(explainResult?.queryPlanner?.winningPlan);
  const stats = explainResult?.executionStats || {};

  return {
    winningStages: stages,
    usesIxScan: stages.some((entry) => entry.stage === 'IXSCAN'),
    usesCollScan: stages.some((entry) => entry.stage === 'COLLSCAN'),
    indexNames: stages.map((entry) => entry.indexName).filter(Boolean),
    nReturned: Number(stats.nReturned ?? 0),
    totalDocsExamined: Number(stats.totalDocsExamined ?? 0),
    totalKeysExamined: Number(stats.totalKeysExamined ?? 0),
    executionTimeMillis: Number(stats.executionTimeMillis ?? 0)
  };
};

const explainRecruiterQueryPlans = async ({ organizationId, recruiterId } = {}) => {
  const orgId = organizationId
    ? new mongoose.Types.ObjectId(String(organizationId))
    : new mongoose.Types.ObjectId();
  const recId = recruiterId
    ? new mongoose.Types.ObjectId(String(recruiterId))
    : new mongoose.Types.ObjectId();

  const [
    jobsPlan,
    matchesPlan,
    shortlistsPlan,
    auditPlan,
    publicUsersPlan
  ] = await Promise.all([
    Job.find({ organizationId: orgId, recruiterId: recId })
      .sort({ updatedAt: -1 })
      .limit(50)
      .lean()
      .explain('executionStats'),
    RecruiterMatch.find({ organizationId: orgId, recruiterId: recId })
      .sort({ updatedAt: -1 })
      .limit(50)
      .lean()
      .explain('executionStats'),
    RecruiterShortlist.find({ organizationId: orgId, recruiterId: recId })
      .sort({ updatedAt: -1 })
      .limit(50)
      .lean()
      .explain('executionStats'),
    AuditLog.find({ organizationId: orgId, actor: recId })
      .sort({ timestamp: -1 })
      .limit(50)
      .lean()
      .explain('executionStats'),
    User.find({
      role: { $in: ['developer', 'user'] },
      isPublic: true,
      isActive: { $ne: false }
    })
      .sort({ _id: 1 })
      .limit(500)
      .lean()
      .explain('executionStats')
  ]);

  return {
    jobs: extractPlanSummary(jobsPlan),
    matches: extractPlanSummary(matchesPlan),
    shortlists: extractPlanSummary(shortlistsPlan),
    auditLogs: extractPlanSummary(auditPlan),
    publicCandidates: extractPlanSummary(publicUsersPlan)
  };
};

module.exports = {
  RECRUITER_INDEX_SPECS,
  ensureRecruiterIndexes,
  explainRecruiterQueryPlans,
  extractPlanSummary
};

if (require.main === module) {
  const apply = process.argv.includes('--apply');
  const explain = process.argv.includes('--explain');
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;

  if (!uri) {
    console.error('MONGODB_URI is required');
    process.exit(1);
  }

  mongoose
    .connect(uri)
    .then(async () => {
      const indexReport = await ensureRecruiterIndexes({ dryRun: !apply });
      const output = {
        ...indexReport,
        ...(explain ? { queryPlans: await explainRecruiterQueryPlans() } : {})
      };
      console.log(JSON.stringify(output, null, 2));
      await mongoose.disconnect();
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
