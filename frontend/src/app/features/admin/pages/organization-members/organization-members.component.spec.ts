import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BehaviorSubject, Subject } from 'rxjs';
import { signal } from '@angular/core';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { OrganizationMembersComponent } from './organization-members.component';
import { OrganizationInvitationsComponent } from '../organization-invitations/organization-invitations.component';
import { OrganizationUsageComponent } from '../organization-usage/organization-usage.component';
import { OrganizationOverviewComponent } from '../organization-overview/organization-overview.component';
import { OrganizationConfigurationStore } from '../../services/organization-configuration.store';
import { OrganizationGovernanceService } from '../../../../shared/services/organization-governance.service';
import { OrganizationPolicyState } from '../../../../shared/services/organization-policy-state.service';
import { AuthService } from '../../../../shared/services/auth.service';
import { TenantContextService } from '../../../../shared/services/tenant-context.service';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { OrganizationDirectoryMember } from '../../../../shared/models/organization-governance.model';
import { policyStateFixture } from '../../../../shared/testing/organization-policy-state.fixture';
import {
  governanceFixture,
  preferencesFixture,
} from '../../testing/organization-configuration.fixture';
import { organizationCapacity } from '../../utils/organization-capacity';

function member(id: string, name: string, teamId = 'team-a'): OrganizationDirectoryMember {
  return {
    _id: id,
    name,
    email: `${id}@fixture.test`,
    accountRole: 'recruiter',
    isActive: true,
    isOwner: false,
    organizationMembership: { _id: `direct-${id}`, role: 'member', status: 'active' },
    teams: [
      {
        _id: `${id}-${teamId}`,
        teamId,
        name: `Team ${teamId}`,
        role: 'manager',
        status: 'active',
        isActive: true,
      },
    ],
  };
}
describe('Organization directories and read models rendered contracts', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: AuthService,
          useValue: { currentUser$: new BehaviorSubject({ _id: 'admin', role: 'admin' }) },
        },
        {
          provide: TenantContextService,
          useValue: { state$: new BehaviorSubject({ organizationId: 'org-a' }) },
        },
        { provide: OrganizationPolicyState, useFactory: policyStateFixture },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify({ ignoreCancelled: true }));
  function configuration(disabled = false) {
    const governance = governanceFixture();
    governance.policies.invitationCreation = !disabled;
    http.expectOne((request) => request.url.endsWith('/governance')).flush(governance);
    http.expectOne((request) => request.url.endsWith('/preferences')).flush(preferencesFixture());
  }
  it('deduplicates members, preserves exact server totals and filters/paginates without requests', async () => {
    const fixture = TestBed.createComponent(OrganizationMembersComponent);
    fixture.detectChanges();
    const rows = [
      member('r0', 'Multi-team Recruiter'),
      member('r0', 'Multi-team Recruiter', 'team-b'),
      ...Array.from({ length: 24 }, (_, index) =>
        member(`r${index + 1}`, `Recruiter ${index + 1}`),
      ),
    ];
    http
      .expectOne((request) => request.url.endsWith('/members'))
      .flush({ members: rows, total: 25, publicDevelopersIncluded: false });
    await fixture.whenStable();
    expect(fixture.componentInstance.rows()).toHaveLength(25);
    expect(fixture.componentInstance.rows().find((row) => row._id === 'r0')?.teams).toHaveLength(2);
    expect(fixture.nativeElement.querySelectorAll('tbody tr')).toHaveLength(20);
    const next = [
      ...(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>),
    ].find((button) => button.textContent?.trim() === 'Next')!;
    next.click();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelectorAll('tbody tr')).toHaveLength(5);
    const search = fixture.nativeElement.querySelector('input[type=search]') as HTMLInputElement;
    search.value = 'Multi-team';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(fixture.nativeElement.textContent).toContain('1 filtered / 25 server total');
    http.expectNone((request) => request.url.endsWith('/members'));
  });
  it('filters role, team, account and direct membership states separately', async () => {
    const fixture = TestBed.createComponent(OrganizationMembersComponent);
    fixture.detectChanges();
    const active = member('a', 'Active Recruiter');
    const disabled = member('b', 'Disabled Direct Recruiter');
    disabled.organizationMembership!.status = 'disabled';
    disabled.isActive = false;
    http
      .expectOne((request) => request.url.endsWith('/members'))
      .flush({ members: [active, disabled], total: 2, publicDevelopersIncluded: false });
    await fixture.whenStable();
    fixture.componentInstance.membershipStatus.set('disabled');
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('tbody').textContent).toContain('Disabled Direct');
    expect(fixture.nativeElement.querySelector('tbody').textContent).not.toContain(
      'Active Recruiter',
    );
    fixture.componentInstance.accountStatus.set('active');
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('tbody').textContent).toContain('No members match');
  });
  it('clears old rows and settles a denied directory refresh', async () => {
    const fixture = TestBed.createComponent(OrganizationMembersComponent);
    fixture.detectChanges();
    http
      .expectOne((request) => request.url.endsWith('/members'))
      .flush({ members: [member('a', 'Old name')], total: 1 });
    await fixture.whenStable();
    fixture.componentInstance.load();
    http
      .expectOne((request) => request.url.endsWith('/members'))
      .flush({}, { status: 403, statusText: 'Forbidden' });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).not.toContain('Old name');
    expect(fixture.nativeElement.textContent).toContain('current organization Admin');
    expect(fixture.componentInstance.loading()).toBe(false);
  });
  it('loads all invitation statuses once, uses human attribution, and filters locally without requesting tokens', async () => {
    const fixture = TestBed.createComponent(OrganizationInvitationsComponent);
    fixture.detectChanges();
    configuration();
    http
      .expectOne((request) => request.url.endsWith('/members'))
      .flush({ members: [member('inviter', 'Inviter name')], total: 1 });
    http.expectOne((request) => request.url.endsWith('/teams')).flush({ teams: [] });
    http
      .expectOne((request) => request.url.endsWith('/invitations'))
      .flush({
        invitations: ['pending', 'accepted', 'expired', 'revoked'].map((status, index) => ({
          _id: `i${index}`,
          name: 'Recipient ' + index,
          email: `recipient${index}@fixture.test`,
          role: 'recruiter',
          status,
          teamId: null,
          invitedBy: 'inviter',
          acceptedBy: null,
          createdAt: '2026-11-01',
          expiresAt: '2026-12-01',
        })),
      });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Inviter name');
    expect(fixture.nativeElement.querySelectorAll('tbody tr')).toHaveLength(4);
    fixture.componentInstance.status.set('expired');
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('tbody').textContent).toContain('Recipient 2');
    http.expectNone(
      (request) => request.url.includes('token') || request.url.endsWith('/invitations'),
    );
  });
  it('restricts creation/resend under invitation policy while retaining revoke, expiry and direct provisioning navigation', async () => {
    const fixture = TestBed.createComponent(OrganizationInvitationsComponent);
    fixture.detectChanges();
    configuration(true);
    http.expectOne((request) => request.url.endsWith('/members')).flush({ members: [], total: 0 });
    http.expectOne((request) => request.url.endsWith('/teams')).flush({ teams: [] });
    http
      .expectOne((request) => request.url.endsWith('/invitations'))
      .flush({
        invitations: [
          {
            _id: 'i1',
            name: 'Recipient',
            email: 'r@fixture.test',
            role: 'recruiter',
            status: 'pending',
            invitedBy: 'admin',
            teamId: null,
            createdAt: '2026-11-01',
            expiresAt: '2026-12-01',
          },
        ],
      });
    await fixture.whenStable();
    const buttons = [
      ...(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>),
    ];
    expect(buttons.find((button) => button.textContent?.trim() === 'Resend')!.disabled).toBe(true);
    expect(buttons.find((button) => button.textContent?.trim() === 'Revoke')!.disabled).toBe(false);
    expect(buttons.find((button) => button.textContent?.trim() === 'Expire')!.disabled).toBe(false);
    fixture.componentInstance.form = { name: 'Test name', email: 'test@fixture.test', teamId: '' };
    fixture.componentInstance.create();
    http.expectNone((request) => request.method === 'POST');
    expect(fixture.nativeElement.textContent).toContain('separate authority');
  });
  it.each([
    [0, 0, 'Zero capacity'],
    [0, 5, 'Capacity available'],
    [5, 5, 'At capacity'],
    [7, 5, 'Over capacity'],
    [2, 0, 'Over capacity'],
  ])('renders usage %s/%s safely as %s', async (used, limit, label) => {
    const fixture = TestBed.createComponent(OrganizationUsageComponent);
    fixture.detectChanges();
    const governance = governanceFixture();
    governance.resources.limits.activeRecruiters = limit;
    governance.resources.usage.activeRecruiters = used;
    http.expectOne((request) => request.url.endsWith('/governance')).flush(governance);
    http.expectOne((request) => request.url.endsWith('/preferences')).flush(preferencesFixture());
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain(label);
    expect(fixture.nativeElement.textContent).not.toMatch(/NaN|Infinity/);
    const capacity = organizationCapacity(used, limit);
    expect(capacity.remaining).toBeGreaterThanOrEqual(0);
    expect(capacity.bar).toBeLessThanOrEqual(100);
    expect(fixture.nativeElement.querySelector('input')).toBeNull();
  });
  it('renders overview counts from server totals with dedicated management links', async () => {
    const fixture = TestBed.createComponent(OrganizationOverviewComponent);
    fixture.detectChanges();
    configuration();
    const owner = member('owner', 'Human owner');
    owner.isOwner = true;
    http
      .expectOne((request) => request.url.endsWith('/members'))
      .flush({ members: [owner], total: 1 });
    http
      .expectOne((request) => request.url.endsWith('/overview'))
      .flush({
        organization: { createdAt: '2026-01-01' },
        stats: {
          membersCount: 25,
          recruitersCount: 10,
          activeRecruitersCount: 3,
          teamsCount: 4,
          activeTeamsCount: 2,
          jobsCount: 15,
          pendingInvitationsCount: 6,
        },
        membershipSummary: { internalMembersCount: 25, adminCount: 2 },
      });
    http.expectOne((request) => request.url.includes('/activity?')).flush({ logs: [], total: 0 });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Human owner');
    expect(fixture.nativeElement.textContent).toContain('25');
    expect(
      fixture.nativeElement.querySelector('a[href="/app/admin/organization/policies"]'),
    ).toBeTruthy();
    expect(fixture.nativeElement.querySelector('table')).toBeNull();
  });
});
