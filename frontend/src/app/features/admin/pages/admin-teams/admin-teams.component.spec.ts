import { ChangeDetectorRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminHiringService } from '../../services/admin-hiring.service';
import { AdminConsoleService } from '../admin-console/admin-console.service';
import { AdminTeamsPageComponent } from './admin-teams.component';

describe('AdminTeamsPageComponent', () => {
  const team = { _id: 'team-1', name: 'Platform', isActive: true, members: [] };
  let teams: Array<Omit<typeof team, 'members'> & { members: { _id: string }[] }>;
  let component: AdminTeamsPageComponent;
  const getTeamsPaginated = vi.fn(() =>
    of({ teams, page: 1, limit: 10, total: teams.length, totalPages: 1, hasMore: false }),
  );
  type AnalyticsResponse = { teamMetrics: { name: string; performanceScore: number }[] };
  const getPerformance = vi.fn(() => of<AnalyticsResponse>({ teamMetrics: [] }));

  beforeEach(() => {
    vi.useFakeTimers();
    teams = [];
    getTeamsPaginated.mockClear();
    getPerformance.mockClear();
    TestBed.configureTestingModule({
      providers: [{ provide: ChangeDetectorRef, useValue: { markForCheck: () => {} } }],
    });
    component = TestBed.runInInjectionContext(
      () =>
        new AdminTeamsPageComponent(
          {
            getTeamsPaginated,
            getPerformance,
            createTeam: () => {
              teams = [team];
              return of({ team });
            },
            updateTeam: () => {
              teams = [{ ...teams[0], name: 'Infrastructure' }];
              return of({ team: teams[0] });
            },
            setTeamActive: () => {
              teams = [{ ...teams[0], isActive: false }];
              return of({ team: teams[0] });
            },
            assignRecruiterToTeam: () => {
              teams = [{ ...teams[0], members: [{ _id: 'recruiter-1' }] }];
              return of({ team: teams[0] });
            },
            removeRecruiterFromTeam: () => {
              teams = [{ ...teams[0], members: [] }];
              return of({ team: teams[0] });
            },
            deleteTeam: () => {
              teams = [];
              return of({});
            },
          } as unknown as AdminConsoleService,
          { getRecruiters: () => of([]) } as unknown as AdminHiringService,
        ),
    );
    component.ngOnInit();
  });

  afterEach(() => vi.useRealTimers());

  it('reloads once per mutation and synchronizes or closes the team drawer', () => {
    component.onStatusChange('all');
    expect(getTeamsPaginated).toHaveBeenCalledTimes(1);

    component.openCreateModal();
    component.modalTeamForm.name = team.name;
    component.createTeam();
    expect(component.teams).toEqual([team]);
    expect(component.message).toBe('Team created successfully.');

    component.viewDetails(component.teams[0]);
    component.openEditModal(component.teams[0]);
    component.saveTeam();
    expect(component.selectedTeam.name).toBe('Infrastructure');

    component.newRecruiterId = 'recruiter-1';
    component.assignRecruiter();
    expect(component.teams[0].members).toEqual([{ _id: 'recruiter-1' }]);
    component.removeRecruiter('recruiter-1');
    expect(component.teams[0].members).toEqual([]);

    component.toggleActive(component.teams[0]);
    expect(component.loading).toBe(false);
    expect(component.selectedTeam.isActive).toBe(false);

    component.confirmDelete(component.teams[0], new Event('click'));
    component.deleteTeam();
    expect(component.teams).toEqual([]);
    expect(component.selectedTeam).toBeNull();
    expect(getTeamsPaginated).toHaveBeenCalledTimes(7);
    expect(getPerformance).toHaveBeenCalledTimes(7);
  });

  it('ignores superseded widget responses and distinguishes analytics errors from empty data', () => {
    const older = new Subject<AnalyticsResponse>();
    const newer = new Subject<AnalyticsResponse>();
    getPerformance.mockReturnValueOnce(older).mockReturnValueOnce(newer);

    component.modalTeamForm.name = team.name;
    component.createTeam();
    component.toggleActive(team);
    newer.next({ teamMetrics: [{ name: 'Current', performanceScore: 10 }] });
    older.next({ teamMetrics: [{ name: 'Old', performanceScore: 100 }] });
    expect(component.topTeams.map((metric) => metric.name)).toEqual(['Current']);

    getPerformance.mockImplementationOnce(() =>
      throwError(() => new Error('Analytics unavailable')),
    );
    component.toggleActive(team);
    expect(component.topTeams).toEqual([]);
    expect(component.analyticsLoadFailed).toBe(true);
    expect(component.loading).toBe(false);
    expect(component.message).toBe('Team deactivated.');
  });
});
