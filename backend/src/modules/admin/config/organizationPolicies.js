// Fixed restrictions on existing authority. These identifiers are API contracts,
// never arbitrary grants or substitutes for account, membership or consent checks.
const POLICY_CATALOG = Object.freeze({
  recruiterJobCreation: 'Create Recruiter jobs',
  recruiterJobPublication: 'Publish or reopen Recruiter jobs',
  teamSharedJobs: 'Share and access team job metadata',
  sharedPublicEvaluations: 'Share and access public candidate evaluations',
  teamManagerEvaluationManagement: 'Manage shared evaluations as a team manager',
  candidateMatching: 'Generate candidate matches and rankings',
  invitationCreation: 'Create, resend and accept pending invitations',
  managerTeamAdministration: 'Use existing organization-manager team administration'
});

const policyValues = (organization) =>
  Object.fromEntries(
    Object.keys(POLICY_CATALOG).map((key) => [
      key,
      organization?.governance?.policies?.[key] !== false
    ])
  );

const restrictionError = (capability, reason = 'organization_policy') =>
  Object.assign(
    new Error(`Capability ${capability} is restricted by ${reason.replaceAll('_', ' ')}.`),
    {
      status: 403,
      statusCode: 403,
      restriction: { capability, reason }
    }
  );

const assertPolicy = (organization, capability) => {
  if (!Object.hasOwn(POLICY_CATALOG, capability))
    throw new Error('Unknown organization capability.');
  if (!policyValues(organization)[capability]) throw restrictionError(capability);
};

const assertMatchingPolicy = (ctx) => {
  assertPolicy(ctx.organization, 'candidateMatching');
  const visibility = String(ctx.platform?.recruiter?.candidateVisibility || 'public').toLowerCase();
  if (['private', 'disabled', 'none', 'off'].includes(visibility))
    throw restrictionError('candidateMatching', 'platform_policy');
};

module.exports = {
  POLICY_CATALOG,
  policyValues,
  restrictionError,
  assertPolicy,
  assertMatchingPolicy
};
