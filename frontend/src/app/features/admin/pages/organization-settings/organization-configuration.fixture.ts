import { OrganizationGovernance } from '../../../../shared/models/organization-governance.model';
import { ConsolePreferences } from '../admin-console/admin-console.service';
import { organizationPolicyIds } from '../../../../shared/testing/organization-policy-state.fixture';
export function governanceFixture(version = 3): OrganizationGovernance {
  return {
    organization: {
      _id: 'org-a',
      name: 'Engineering organization',
      slug: 'engineering',
      description: 'Public organization description',
      industry: 'Technology',
      website: 'https://example.test',
      timezone: 'Asia/Karachi',
      branding: { logoUrl: '' },
    },
    version,
    policies: Object.fromEntries(
      organizationPolicyIds.map((id) => [id, true]),
    ) as OrganizationGovernance['policies'],
    resources: {
      limits: { activeRecruiters: 5, teams: 10 },
      usage: { activeRecruiters: 3, teams: 4, activeTeams: 2 },
      editable: false,
    },
    catalog: organizationPolicyIds.map((id) => ({ id, label: id, type: 'boolean', default: true })),
    defaultTimezone: 'UTC',
  };
}
export function preferencesFixture(version = 3): ConsolePreferences {
  return {
    organization: {
      governanceVersion: version,
      _id: 'org-a',
      name: 'Engineering organization',
      slug: 'engineering',
      description: 'Public organization description',
      createdAt: '2026-01-01',
      ownerId: 'owner-a',
      dashboardConfig: {
        preferredDateRangeDays: 30,
        defaultTeamId: '',
        showKpiCards: true,
        showTeamAnalytics: true,
        showRecruiterPerformance: true,
        showJobTrends: true,
        showActivityFeed: true,
      },
    },
  };
}
