const User = require('../../../auth/models/user');
const {
  withCandidateReadScope,
  hydrateCandidateRows,
  MAX_TIME_MS
} = require('./candidateDiscoveryService');
const {
  buildAnalyticsPipeline,
  formatPopulation,
  selectDemandSkills
} = require('../../utils/hub/candidateAnalyticsPipeline');

async function readCandidateAnalytics({ organizationId, recruiterId, sessionRevision, jobs = [] }) {
  const demand = selectDemandSkills(jobs);
  return withCandidateReadScope(
    { organizationId, recruiterId, sessionRevision, requireRecruiter: true },
    async ({ session, visible, blocked }) => {
      const [result] = blocked
        ? []
        : await User.aggregate(buildAnalyticsPipeline(visible, demand))
            .session(session)
            // Match case-sensitive JavaScript Map keys, including Unicode strings.
            .collation({ locale: 'simple' })
            .allowDiskUse(true)
            .option({ maxTimeMS: MAX_TIME_MS });
      const candidates = await hydrateCandidateRows(result?.sample || [], visible, session);
      return { ...formatPopulation(result, demand), candidates };
    }
  );
}

module.exports = { readCandidateAnalytics };
