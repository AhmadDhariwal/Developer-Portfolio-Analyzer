const mongoose = require('mongoose');
const User = require('../../../auth/models/user');
const Organization = require('../../../admin/models/organization');
const Membership = require('../../../admin/models/membership');
const Settings = require('../../../super-admin/models/platformSettings');
const {
  candidateFromSources,
  mergeCandidates,
  sanitizePublicCandidate
} = require('../matching/matchingService');
const { formatCandidateCard } = require('../../utils/hub/candidateFormatter');
const { requireObjectId } = require('../../utils/recruiterValidation');
const {
  buildPipeline,
  buildHydrationPipeline
} = require('../../utils/hub/candidateDiscoveryPipeline');
const pagination = require('../../utils/hub/candidateDiscoveryQuery');

const MAX_TIME_MS = 15000;
const availability = ['Open to entry roles', 'High intent', 'Available', 'Review needed'];
const unavailable = (message, statusCode = 503) =>
  Object.assign(new Error(message), { statusCode });

async function withCandidateReadScope(
  { organizationId, recruiterId, sessionRevision = 0, requireRecruiter = false },
  read
) {
  if (requireRecruiter && !recruiterId)
    throw unavailable('Recruiter authentication is required.', 401);
  const orgId = new mongoose.Types.ObjectId(requireObjectId(organizationId, 'organizationId'));
  const scope = {
    organizationId: String(orgId),
    recruiterId: recruiterId ? requireObjectId(recruiterId, 'recruiterId') : '',
    sessionRevision
  };
  try {
    // A read-only snapshot keeps the count, joined filter values and page payload
    // consistent. No candidate pool, cached grants or writes to source records.
    return await User.db.transaction(
      async (session) => {
        const organization = await Organization.findOne({ _id: orgId, isSuspended: { $ne: true } })
          .session(session)
          .select('_id')
          .lean();
        if (!organization) throw unavailable('Organization access is unavailable.', 403);
        if (scope.recruiterId) {
          const actor = await User.findOne({
            _id: scope.recruiterId,
            organizationId: orgId,
            role: 'recruiter',
            isActive: { $ne: false }
          })
            .session(session)
            .select('sessionRevision')
            .lean();
          const membership = await Membership.findOne({
            userId: scope.recruiterId,
            organizationId: orgId,
            teamId: null
          })
            .session(session)
            .select('status')
            .lean();
          if (
            !actor ||
            Number(actor.sessionRevision || 0) !== Number(sessionRevision) ||
            (membership && membership.status !== 'active')
          )
            throw unavailable('Recruiter access is unavailable.', 403);
        }
        const settings = await Settings.findOne({ scope: 'global' })
          .session(session)
          .select('recruiter.candidateVisibility recruiter.enableRecruiterAccess')
          .lean();
        if (!settings) throw unavailable('Platform settings are not initialized.');
        if (requireRecruiter && settings.recruiter?.enableRecruiterAccess === false)
          throw unavailable('Recruiter access is currently disabled by Super Admin settings.', 403);
        const mode = String(settings.recruiter?.candidateVisibility || 'public').toLowerCase();
        const requestScope = { ...scope, visibility: mode };
        const visible = {
          isPublic: true,
          role: { $in: ['developer', 'user'] },
          isActive: { $ne: false },
          ...(mode === 'organization' ? { organizationId: orgId } : {})
        };
        const blocked = ['private', 'disabled', 'none', 'off'].includes(mode);
        return read({ session, scope, requestScope, visible, blocked });
      },
      {
        readConcern: { level: 'snapshot' },
        readPreference: 'primary',
        maxCommitTimeMS: MAX_TIME_MS
      }
    );
  } catch (error) {
    if (error.code === 50 || error.codeName === 'MaxTimeMSExpired')
      throw unavailable(
        'Candidate search exceeded its time budget. Retry the search or contact support.'
      );
    throw error;
  }
}

async function hydrateCandidateRows(rows, visible, session) {
  const documents = rows.length
    ? await User.aggregate(
        buildHydrationPipeline(
          rows.map((row) => row._id),
          visible
        )
      )
        .session(session)
        .option({ maxTimeMS: MAX_TIME_MS })
    : [];
  const byId = new Map(
    documents.map((user) => {
      const base = candidateFromSources(user, {
        analysis: user._a,
        resume: user._r,
        profile: user._p,
        sprint: user._s,
        weeklyReport: user._w
      });
      const alias = user._aliases[0];
      const legacy = alias
        ? [
            {
              ...alias.last,
              skills: alias.skills.filter(Boolean),
              fullName: alias.name.value || user.name,
              headline: alias.headline.value || user.jobTitle,
              projects: alias.projectPayload?.data || []
            }
          ]
        : [];
      const [merged] = mergeCandidates(legacy, [base]);
      return [
        String(user._id),
        formatCandidateCard({ ...sanitizePublicCandidate(merged), id: String(user._id) })
      ];
    })
  );
  const candidates = rows.map((row) => byId.get(String(row._id))).filter(Boolean);
  if (candidates.length !== rows.length)
    throw unavailable('Candidate eligibility changed. Retry this search.');
  return candidates;
}

async function listCandidatePage({ organizationId, recruiterId, sessionRevision = 0, query = {} }) {
  const options = pagination.parse(query);
  return withCandidateReadScope(
    { organizationId, recruiterId, sessionRevision },
    async ({ session, scope, requestScope, visible, blocked }) => {
      const position = pagination.decode(options, requestScope);
      const pipeline = buildPipeline(visible, options, position);
      const [result] = blocked
        ? [{ data: [], count: [], stacks: [], locations: [] }]
        : await User.aggregate(pipeline)
            .session(session)
            .collation({ locale: 'en' })
            .allowDiskUse(true)
            .option({ maxTimeMS: MAX_TIME_MS });
      const total = result.count[0]?.total || 0;
      const rows = result.data.slice(0, options.limit);
      const hasNext = result.data.length > options.limit;
      const candidates = await hydrateCandidateRows(rows, visible, session);
      return {
        candidates,
        filters: {
          stacks: result.stacks.slice(0, 200).map((row) => row._id),
          locations: result.locations.slice(0, 200).map((row) => row._id),
          availability,
          optionsTruncated: result.stacks.length > 200 || result.locations.length > 200
        },
        meta: {
          page: options.page,
          limit: options.limit,
          total,
          organizationId: scope.organizationId,
          recruiterId: scope.recruiterId,
          totalPages: Math.max(1, Math.ceil(total / options.limit)),
          sortBy: options.sortBy,
          hasNext,
          hasPrevious: options.page > 1,
          nextCursor:
            hasNext && rows.length ? pagination.encode(options, requestScope, rows.at(-1)) : null,
          pagination: position ? 'cursor' : 'page'
        }
      };
    }
  );
}

module.exports = { listCandidatePage, withCandidateReadScope, hydrateCandidateRows, MAX_TIME_MS };
