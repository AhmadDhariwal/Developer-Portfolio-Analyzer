import { OrganizationPolicyId } from '../../../shared/models/organization-governance.model';

export interface OrganizationPolicyPresentation {
  id: OrganizationPolicyId;
  group: string;
  title: string;
  roles: string;
  behavior: string;
  dependencies: string;
  existing: string;
  warning: string;
}

export const ORGANIZATION_POLICIES: readonly OrganizationPolicyPresentation[] = [
  {
    id: 'recruiterJobCreation',
    group: 'Job management',
    title: 'Allow Recruiter job creation',
    roles: 'Recruiter accounts',
    behavior: 'Prevents new Recruiter-created jobs when disabled.',
    dependencies: 'Active account, organization membership and platform Recruiter access.',
    existing: 'Existing authorized job management remains available.',
    warning: 'Recruiters will no longer be able to create jobs.',
  },
  {
    id: 'recruiterJobPublication',
    group: 'Job management',
    title: 'Allow Recruiter job publication',
    roles: 'Authorized Recruiter owners and team managers',
    behavior:
      'Prevents future publication and applicable reopening when disabled. This is not an approval workflow.',
    dependencies: 'Current resource publication permission and platform Recruiter access.',
    existing:
      'Existing published jobs remain published. Authorized closing, archiving and unpublishing remain available.',
    warning: 'Future publication and applicable reopening will be restricted.',
  },
  {
    id: 'teamSharedJobs',
    group: 'Team collaboration',
    title: 'Allow team-shared jobs',
    roles: 'Recruiter owners and authorized team members',
    behavior: 'Disabling withdraws effective non-owner team grants.',
    dependencies:
      'Explicit owner sharing intent, active exact-team membership, active team and organization.',
    existing:
      'Records and stored sharing intent remain. Re-enabling restores only still-valid sharing permissions.',
    warning: 'Non-owner team access to shared jobs will be withdrawn.',
  },
  {
    id: 'sharedPublicEvaluations',
    group: 'Team collaboration',
    title: 'Allow shared public evaluations',
    roles: 'Authorized Recruiter team members and managers',
    behavior:
      'Disabling removes non-owner access to shared public evaluations. Independently authorized metadata access may remain.',
    dependencies:
      'Team-shared job access, explicit evaluation-sharing intent and live candidate consent.',
    existing: 'Historical records remain. Private application-origin evaluations stay owner-only.',
    warning: 'Non-owner access to shared public evaluation results will be withdrawn.',
  },
  {
    id: 'teamManagerEvaluationManagement',
    group: 'Team collaboration',
    title: 'Allow team managers to manage shared evaluations',
    roles: 'Existing non-owner Recruiter team managers and team Admins',
    behavior:
      'Disabling makes existing non-owner managers read-only for applicable shared evaluations.',
    dependencies:
      'Shared public evaluation access and the current resource management grant. New matching also requires candidate matching.',
    existing:
      'Owner authority remains available. Existing notes and results follow the current read grant.',
    warning: 'Existing non-owner managers will become read-only for shared evaluations.',
  },
  {
    id: 'candidateMatching',
    group: 'Candidate assessment',
    title: 'Allow candidate matching and ranking',
    roles: 'Authorized Recruiter owners and evaluation managers',
    behavior:
      'Disabling prevents new applicable matching and job-based ranking. Ranking uses deterministic scoring.',
    dependencies:
      'Current resource generation authority, platform candidate visibility and Recruiter access.',
    existing:
      'Authorized historical evaluations, ordinary candidate discovery, evidence summaries and permitted non-job comparison remain available.',
    warning: 'New job-based matching and ranking will be restricted.',
  },
  {
    id: 'invitationCreation',
    group: 'Membership governance',
    title: 'Allow invitations and pending acceptance',
    roles: 'Existing authorized Admin and organization-manager inviters; pending recipients',
    behavior:
      'Disabling prevents creation, resend and pending acceptance. Authorized revocation and expiry remain available.',
    dependencies:
      'Re-enabling still requires valid inviter authority, recipient eligibility, unexpired pending status and available capacity.',
    existing:
      'Pending invitations remain and do not reserve seats. Separately authorized direct Admin Recruiter provisioning remains available.',
    warning:
      'Pending acceptance and resend will stop. Previously authorized email delivery cannot necessarily be recalled.',
  },
  {
    id: 'managerTeamAdministration',
    group: 'Membership governance',
    title: 'Allow organization managers to administer teams',
    roles: 'Existing direct organization managers',
    behavior:
      'Disabling restricts supported team creation and membership-role assignment by direct organization managers.',
    dependencies:
      'An existing direct organization-manager role; this policy creates no new team-manager authority.',
    existing:
      'Independently authorized team-scoped operations and organization Admin recovery remain available.',
    warning:
      'Direct organization managers will lose the supported organization team administration actions.',
  },
];
