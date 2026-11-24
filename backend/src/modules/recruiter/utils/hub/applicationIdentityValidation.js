const { performance } = require('node:perf_hooks');
const Shortlist = require('../../models/RecruiterShortlist');
const Job = require('../../models/Job');
const Application = require('../../../jobs/models/jobApplication');
const { canonicalApplicationId } = require('../../../jobs/services/jobApplicationService');
const { denied } = require('./recruiterJobAccess');

const QUERY_BUDGET_MS = 5000;
const MAX_IDENTITY_ROWS = 10000;
const objectIdTypes = (fields) =>
  fields.map((field) => ({ $eq: [{ $type: '$' + field }, 'objectId'] }));

function remainingBudget(deadline) {
  const remaining = Math.floor(deadline - performance.now());
  if (remaining < 1)
    throw denied('Application evaluations exceeded their query budget. Please retry.', 503);
  return remaining;
}

// Request-local only, inside the existing authorization snapshot transaction.
// This is an integrity allowlist, never a cached permission or persisted marker.
async function verifyApplicationIdentities(ctx, { maxRows = MAX_IDENTITY_ROWS } = {}) {
  const deadline = performance.now() + QUERY_BUDGET_MS;
  const cursor = Shortlist.find({
    recruiterId: ctx.recruiterId,
    organizationId: ctx.organizationId,
    jobId: { $type: 'objectId' },
    candidateId: { $type: 'objectId' },
    applicationId: { $type: 'string', $regex: /^[a-f0-9]{64}$/ },
    $expr: {
      $and: [
        ...objectIdTypes(['_id', 'jobId', 'candidateId', 'recruiterId', 'organizationId']),
        { $eq: [{ $type: '$applicationId' }, 'string'] }
      ]
    }
  })
    .select('_id applicationId jobId candidateId recruiterId organizationId')
    .limit(maxRows + 1)
    .maxTimeMS(QUERY_BUDGET_MS)
    .session(ctx.session)
    .lean()
    .cursor({ batchSize: 256 });
  const rows = [];
  let scanned = 0;
  try {
    for await (const row of cursor) {
      remainingBudget(deadline);
      if (++scanned > maxRows)
        throw denied('Application evaluation integrity capacity exceeded. Contact support.', 503);
      if (row.applicationId === canonicalApplicationId(row.jobId, row.candidateId)) rows.push(row);
    }
  } finally {
    await cursor.close();
  }
  const jobs = await Job.find({
    _id: { $in: [...new Set(rows.map((row) => String(row.jobId)))] },
    recruiterId: ctx.recruiterId,
    organizationId: ctx.organizationId,
    $expr: { $and: objectIdTypes(['recruiterId', 'organizationId']) }
  })
    .select('_id recruiterId organizationId')
    .session(ctx.session)
    .maxTimeMS(remainingBudget(deadline))
    .lean();
  const applications = await Application.find({
    _id: { $in: rows.map((row) => row.applicationId) },
    recruiterId: ctx.recruiterId,
    organizationId: ctx.organizationId,
    'consent.version': 'direct-apply-v1',
    status: { $in: ['submitted', 'reviewing', 'rejected', 'withdrawn'] },
    $expr: {
      $and: [
        ...objectIdTypes(['jobId', 'applicantId', 'recruiterId', 'organizationId']),
        ...[
          ['consent.version', 'string'],
          ['consent.sharePortfolio', 'bool'],
          ['consent.submittedAt', 'date'],
          ['status', 'string']
        ].map(([field, type]) => ({ $eq: [{ $type: '$' + field }, type] }))
      ]
    }
  })
    .select(
      '_id jobId applicantId recruiterId organizationId status consent.version consent.submittedAt consent.sharePortfolio'
    )
    .session(ctx.session)
    .maxTimeMS(remainingBudget(deadline))
    .lean();
  const jobMap = new Map(jobs.map((job) => [id(job._id), job]));
  const appMap = new Map(applications.map((application) => [application._id, application]));
  const ids = rows
    .filter((row) => {
      const application = appMap.get(row.applicationId),
        job = jobMap.get(id(row.jobId));
      return genuine(application, job) && canonicalRow(row, application, job);
    })
    .map((row) => row._id);
  remainingBudget(deadline);
  return { ids, deadline };
}

const id = (value) => String(value || '');
function genuine(application, job) {
  return (
    job &&
    application &&
    id(application.jobId) === id(job._id) &&
    id(application.organizationId) === id(job.organizationId) &&
    id(application.recruiterId) === id(job.recruiterId) &&
    application._id === canonicalApplicationId(job._id, application.applicantId) &&
    application.consent?.version === 'direct-apply-v1' &&
    typeof application.consent.sharePortfolio === 'boolean' &&
    application.consent.submittedAt instanceof Date &&
    Number.isFinite(+new Date(application.consent.submittedAt)) &&
    ['submitted', 'reviewing', 'rejected', 'withdrawn'].includes(application.status)
  );
}
function canonicalRow(row, application, job) {
  return (
    row &&
    row.applicationId === application._id &&
    id(row.candidateId) === id(application.applicantId) &&
    id(row.jobId) === id(job._id) &&
    id(row.recruiterId) === id(job.recruiterId) &&
    id(row.organizationId) === id(job.organizationId)
  );
}

module.exports = {
  verifyApplicationIdentities,
  remainingBudget,
  MAX_IDENTITY_ROWS,
  genuine,
  canonicalRow
};
