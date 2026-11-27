import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { BehaviorSubject, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TenantContextService } from '../../../../shared/services/tenant-context.service';
import { AdminHiringService, AdminTeamOption } from '../../services/admin-hiring.service';
import { AdminConsolePageComponent } from './admin-console.component';
import { AdminConsoleService, ConsoleOverview } from './admin-console.service';

describe('Admin Console request settlement', () => {
  let overviews: Subject<ConsoleOverview>[];
  let teams: Subject<AdminTeamOption[]>[];
  let context: BehaviorSubject<{ organizationId: string; organizationName: string }>;
  const data: ConsoleOverview = {
    organization: {
      _id: 'org',
      name: 'Closure',
      slug: 'closure',
      description: '',
      createdAt: '2026-11-26',
    },
    stats: {
      recruitersCount: 0,
      activeRecruitersCount: 0,
      inactiveRecruitersCount: 0,
      teamsCount: 0,
      activeTeamsCount: 0,
      jobsCount: 0,
      pendingInvitationsCount: 0,
      membersCount: 0,
    },
  };
  beforeEach(() => {
    overviews = [];
    teams = [];
    context = new BehaviorSubject({ organizationId: 'org', organizationName: 'Closure' });
    TestBed.configureTestingModule({
      imports: [AdminConsolePageComponent],
      providers: [
        {
          provide: AdminConsoleService,
          useValue: {
            getOverview: () => {
              const response = new Subject<ConsoleOverview>();
              overviews.push(response);
              return response;
            },
          },
        },
        {
          provide: AdminHiringService,
          useValue: {
            getTeams: () => {
              const response = new Subject<AdminTeamOption[]>();
              teams.push(response);
              return response;
            },
          },
        },
        { provide: TenantContextService, useValue: { state$: context } },
        {
          provide: ActivatedRoute,
          useValue: { queryParams: new BehaviorSubject({ tab: 'overview' }) },
        },
        { provide: Router, useValue: { navigate: vi.fn() } },
      ],
    });
  });
  async function setup() {
    const fixture = TestBed.createComponent(AdminConsolePageComponent);
    await fixture.whenStable();
    return {
      fixture,
      component: fixture.componentInstance,
      element: fixture.nativeElement as HTMLElement,
    };
  }

  it('sends the loaded configuration version when saving existing preferences', async () => {
    const { fixture, component } = await setup();
    const updatePreferences = vi.fn(() => new Subject());
    Object.assign(TestBed.inject(AdminConsoleService), { updatePreferences });
    component.preferences = {
      organization: {
        _id: 'org',
        name: 'Closure',
        slug: 'closure',
        description: '',
        ownerId: 'owner',
        createdAt: '2026-11-26',
        governanceVersion: 7,
      },
    };
    component.prefForm.name = 'Updated organization';
    component.savePreferences();
    expect(updatePreferences).toHaveBeenCalledWith(
      expect.objectContaining({ expectedVersion: 7, name: 'Updated organization' }),
    );
    fixture.destroy();
  });

  for (const first of ['overview', 'teams']) {
    for (const overviewFails of [false, true]) {
      for (const teamsFail of [false, true]) {
        it(`settles ${first} first, overview error=${overviewFails}, teams error=${teamsFail}`, async () => {
          const { fixture, component, element } = await setup();
          const settleOverview = () =>
            overviewFails
              ? overviews[0].error({ error: { message: 'Overview unavailable' } })
              : overviews[0].next(data);
          const settleTeams = () =>
            teamsFail ? teams[0].error(new Error('Teams unavailable')) : teams[0].next([]);
          expect(element.querySelector('[role="progressbar"]')).not.toBeNull();
          (first === 'overview' ? settleOverview : settleTeams)();
          await fixture.whenStable();
          expect(component.loading).toBe(true);
          (first === 'overview' ? settleTeams : settleOverview)();
          await fixture.whenStable();
          expect(component.loading).toBe(false);
          expect(element.querySelector('[role="progressbar"]')).toBeNull();
          if (overviewFails) expect(element.textContent).toContain('Overview unavailable');
        });
      }
    }
  }

  it('retries failed dependencies and ignores superseded overview and team responses', async () => {
    const { fixture, component, element } = await setup();
    overviews[0].error(new Error('Failure'));
    teams[0].error(new Error('Failure'));
    component.refreshActiveTab();
    expect(teams).toHaveLength(2);
    component.refreshActiveTab();
    overviews[2].next(data);
    teams.at(-1)!.next([]);
    overviews[1].next({ ...data, organization: { ...data.organization, name: 'Old' } });
    await fixture.whenStable();
    expect(component.overview?.organization.name).toBe('Closure');
    expect(element.querySelector('[role="progressbar"]')).toBeNull();
  });

  it('invalidates requests across organization changes and unsubscribes on navigation away', async () => {
    const { fixture, component } = await setup();
    context.next({ organizationId: 'new-org', organizationName: 'New' });
    overviews[0].next(data);
    teams[0].next([{ _id: 'old-team', name: 'Old' }]);
    expect(component.overview).toBeNull();
    expect(component.teamOptions).toEqual([]);
    fixture.destroy();
    expect(overviews.at(-1)?.observed).toBe(false);
    expect(teams.at(-1)?.observed).toBe(false);
    expect(() => overviews.at(-1)?.next(data)).not.toThrow();
  });
});
