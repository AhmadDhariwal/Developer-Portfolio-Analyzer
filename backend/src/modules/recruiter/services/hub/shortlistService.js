const RecruiterShortlist = require('../../models/RecruiterShortlist');
const RecruiterMatch = require('../../models/RecruiterMatch');
const Candidate = require('../../models/Candidate');
const { requireObjectId, invalidInput } = require('../../utils/recruiterValidation');
const access = require('../../utils/hub/recruiterEvaluationAccess');
const SHORTLIST_STATUSES = new Set([
  'shortlisted',
  'reviewing',
  'contacted',
  'interview',
  'rejected'
]);
const normalizeStatus = (value) => {
  const status = String(value || 'shortlisted')
    .trim()
    .toLowerCase();
  if (!SHORTLIST_STATUSES.has(status)) throw invalidInput('Shortlist status is invalid.');
  return status;
};
const syncMatchStatus = async (item, status, session) => {
  if (!item.jobId) return;
  const { recruiterId, organizationId, candidateId, jobId } = item;
  const legacyAliases = await Candidate.find({
    $or: [{ userId: candidateId }, { _id: candidateId }]
  })
    .session(session)
    .select('_id userId')
    .lean();
  const candidateIds = [
    ...new Set(
      [candidateId, ...legacyAliases.flatMap((entry) => [entry._id, entry.userId])]
        .filter(Boolean)
        .map((id) => String(id))
    )
  ];
  await RecruiterMatch.updateMany(
    {
      recruiterId,
      organizationId,
      candidateId: { $in: candidateIds },
      jobId,
      status: { $ne: status }
    },
    { $set: { status }, $inc: { __v: 1 } },
    { session }
  );
};

const shortlistMatchStatus = (status) => (status === 'rejected' ? 'rejected' : 'shortlisted');
async function hydrate(ctx, items, jobs) {
  items = items.filter((item) => access.ownsRecord(item, jobs.get(String(item.jobId)), ctx));
  const candidates = await access.candidates(
    ctx,
    items.map((item) => item.candidateId)
  );
  return items
    .filter(
      (item) =>
        access.ownsRecord(item, jobs.get(String(item.jobId)), ctx) &&
        candidates.get(String(item.candidateId))
    )
    .map((item) =>
      access.rowView(
        item,
        jobs.get(String(item.jobId)),
        candidates.get(String(item.candidateId)),
        ctx
      )
    );
}
const addToShortlist = async ({ payload = {}, ...scope }) => {
  const id = requireObjectId(payload.candidateId, 'candidateId');
  const jobId = payload.jobId ? requireObjectId(payload.jobId, 'jobId') : null;
  const status = normalizeStatus(payload.status);
  await Promise.all([RecruiterMatch.init(), RecruiterShortlist.init()]);
  return access.withAccess(scope, async (ctx) => {
    const jobs = jobId ? await access.jobs(ctx, jobId) : new Map();
    const job = jobs.get(jobId);
    if (job) access.authorize(job, ctx, true);
    const candidate = (await access.candidates(ctx, [id])).get(id);
    if (!candidate) throw access.denied('Candidate not found.', 404);
    const recruiterId = job ? job.recruiterId : ctx.recruiterId;
    const row = await RecruiterShortlist.findOneAndUpdate(
      { recruiterId, organizationId: ctx.organizationId, candidateId: candidate.userId, jobId },
      {
        $set: { teamId: job ? job.teamId || null : scope.teamIds?.[0] || null },
        $setOnInsert: {
          notes: String(payload.notes || '').trim(),
          status
        }
      },
      { session: ctx.session, upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
    await syncMatchStatus(row, shortlistMatchStatus(row.status), ctx.session);
    return (await hydrate(ctx, [row], jobs))[0];
  });
};
const listShortlists = async ({ query = {}, ...scope }) =>
  access.withAccess(scope, async (ctx) => {
    const jobs = await access.jobs(ctx, query.jobId);
    const filter = {
      organizationId: ctx.organizationId,
      ...(query.jobId
        ? { jobId: query.jobId }
        : {
            $or: [
              { jobId: { $in: [...jobs.keys()] } },
              { recruiterId: ctx.recruiterId, jobId: null }
            ]
          })
    };
    if (query.status) filter.status = normalizeStatus(query.status);
    const rows = await RecruiterShortlist.find(filter)
      .sort({ updatedAt: -1 })
      .session(ctx.session)
      .lean();
    return hydrate(ctx, rows, jobs);
  });
async function selected(ctx, shortlistId) {
  const row = await RecruiterShortlist.findOne({
    _id: requireObjectId(shortlistId, 'shortlistId'),
    organizationId: ctx.organizationId
  })
    .session(ctx.session)
    .lean();
  if (!row) return null;
  const jobs = row.jobId ? await access.jobs(ctx, row.jobId) : new Map();
  const job = jobs.get(String(row.jobId));
  if (!access.ownsRecord(row, job, ctx)) return null;
  if (job) access.authorize(job, ctx, true);
  const [visible] = await hydrate(ctx, [row], jobs);
  return visible ? { row, jobs } : null;
}
const updateShortlist = async ({ shortlistId, payload = {}, ...scope }) =>
  access.withAccess(scope, async (ctx) => {
    const result = await selected(ctx, shortlistId);
    if (!result) return null;
    access.version(result.row, payload.expectedVersion);
    const job = result.jobs.get(String(result.row.jobId));
    const update = { teamId: job ? job.teamId || null : result.row.teamId };
    if (payload.notes !== undefined) update.notes = String(payload.notes || '').trim();
    if (payload.status !== undefined) update.status = normalizeStatus(payload.status);
    const row = await RecruiterShortlist.findOneAndUpdate(
      {
        _id: result.row._id,
        recruiterId: result.row.recruiterId,
        organizationId: ctx.organizationId
      },
      { $set: update, $inc: { __v: 1 } },
      { session: ctx.session, new: true, runValidators: true }
    ).lean();
    if (update.status) await syncMatchStatus(row, shortlistMatchStatus(row.status), ctx.session);
    return (await hydrate(ctx, [row], result.jobs))[0];
  });
const removeShortlist = async ({ shortlistId, ...scope }) =>
  access.withAccess(scope, async (ctx) => {
    const result = await selected(ctx, shortlistId);
    if (!result) return null;
    const row = await RecruiterShortlist.findOneAndDelete(
      {
        _id: result.row._id,
        recruiterId: result.row.recruiterId,
        organizationId: ctx.organizationId
      },
      { session: ctx.session }
    ).lean();
    await syncMatchStatus(row, 'generated', ctx.session);
    const job = result.jobs.get(String(row.jobId));
    return { ...row, teamId: job ? job.teamId || null : row.teamId };
  });
module.exports = { addToShortlist, listShortlists, updateShortlist, removeShortlist };
