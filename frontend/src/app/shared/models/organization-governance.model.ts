export type OrganizationPolicyId =
  | 'recruiterJobCreation'
  | 'recruiterJobPublication'
  | 'teamSharedJobs'
  | 'sharedPublicEvaluations'
  | 'teamManagerEvaluationManagement'
  | 'candidateMatching'
  | 'invitationCreation'
  | 'managerTeamAdministration';

export type RestrictionReason = 'organization_policy' | 'platform_policy' | 'role_or_ownership';

export interface OrganizationCapabilities {
  version: number;
  capabilities: Record<
    OrganizationPolicyId,
    { allowed: boolean; reason: RestrictionReason | null; resourceChecksRequired: boolean }
  >;
}

export interface OrganizationGeneralSettings {
  _id: string;
  name: string;
  slug: string;
  description: string;
  industry: string;
  website: string;
  timezone: string;
  branding: { logoUrl: string };
}

export interface OrganizationConfiguration {
  organization: OrganizationGeneralSettings;
  version: number;
  policies: Record<OrganizationPolicyId, boolean>;
}

export interface OrganizationGovernance extends OrganizationConfiguration {
  resources: {
    limits: { activeRecruiters: number; teams: number };
    usage: { activeRecruiters: number; teams: number; activeTeams: number };
    editable: false;
  };
  catalog: Array<{ id: OrganizationPolicyId; label: string; type: 'boolean'; default: true }>;
  defaultTimezone: string;
}

export interface OrganizationConfigurationPatch {
  expectedVersion: number;
  general?: Partial<Omit<OrganizationGeneralSettings, '_id' | 'slug'>>;
  policies?: Partial<Record<OrganizationPolicyId, boolean>>;
}

export interface OrganizationDirectoryMember {
  _id: string;
  name: string;
  email: string;
  accountRole: string;
  isActive: boolean;
  isOwner: boolean;
  organizationMembership: {
    _id: string;
    role: 'admin' | 'manager' | 'member';
    status: 'active' | 'invited' | 'disabled';
  } | null;
  teams: Array<{
    _id: string;
    teamId: string;
    name: string;
    role: 'admin' | 'manager' | 'member';
    status: 'active' | 'invited' | 'disabled';
    isActive: boolean;
  }>;
}

export type OrganizationInvitationStatus = 'pending' | 'accepted' | 'expired' | 'revoked';

export interface OrganizationInvitation {
  _id: string;
  name: string;
  email: string;
  role: 'admin' | 'manager' | 'member' | 'recruiter';
  teamId: string | null;
  invitedBy: string;
  acceptedBy: string | null;
  status: OrganizationInvitationStatus;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}
