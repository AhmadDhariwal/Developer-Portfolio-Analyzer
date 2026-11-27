import { signal } from '@angular/core';
import { Subject, of } from 'rxjs';
import {
  OrganizationCapabilities,
  OrganizationPolicyId,
} from '../models/organization-governance.model';
import { OrganizationPolicyState } from '../services/organization-policy-state.service';
export const organizationPolicyIds: OrganizationPolicyId[] = [
  'recruiterJobCreation',
  'recruiterJobPublication',
  'teamSharedJobs',
  'sharedPublicEvaluations',
  'teamManagerEvaluationManagement',
  'candidateMatching',
  'invitationCreation',
  'managerTeamAdministration',
];
export function capabilityFixture(
  disabled: OrganizationPolicyId[] = [],
  version = 0,
): OrganizationCapabilities {
  return {
    version,
    capabilities: Object.fromEntries(
      organizationPolicyIds.map((id) => [
        id,
        {
          allowed: !disabled.includes(id),
          reason: disabled.includes(id) ? 'organization_policy' : null,
          resourceChecksRequired: true,
        },
      ]),
    ) as OrganizationCapabilities['capabilities'],
  };
}
export function policyStateFixture() {
  const state = Object.assign(Object.create(OrganizationPolicyState.prototype), {
    value: signal<OrganizationCapabilities | null>(capabilityFixture()),
    loading: signal(false),
    scope: signal('test-account:test-organization'),
    revision: signal(0),
    contextChanges$: new Subject<void>(),
    resourcesChanged$: new Subject<void>(),
    invalidate: () => {},
    scoped: <T>(value: T) => value,
  }) as OrganizationPolicyState;
  state.refresh = () => of(state.value());
  return state;
}
