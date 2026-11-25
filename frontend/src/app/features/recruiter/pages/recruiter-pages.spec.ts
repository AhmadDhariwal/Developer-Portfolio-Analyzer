import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../../shared/services/auth.service';
import { TenantContextService } from '../../../shared/services/tenant-context.service';
import { RecruiterModule } from '../recruiter.module';
import { CandidateService } from '../services/candidate.service';
import { RecruiterHubService } from '../services/recruiter-hub.service';
import { JobApplicationsService } from '../../../shared/services/job-applications.service';
import { RecruiterJobService } from '../services/recruiter-job.service';
import { RecruiterMatchService } from '../services/recruiter-match.service';
import { RecruiterActivityLogsComponent } from './activity-logs/activity-logs.component';
import { CandidateDetailsComponent } from './candidate-details/candidate-details.component';
import { CandidatesComponent } from './candidates/candidates.component';
import { ComparisonComponent } from './comparison/comparison.component';
import { JobDetailsComponent } from './job-details/job-details.component';
import { JobsComponent } from './jobs/jobs.component';
import { MatchesComponent } from './matches/matches.component';
import { RecruiterAnalyticsComponent } from './recruiter-analytics/recruiter-analytics.component';
import { RecruiterDashboardComponent } from './recruiter-dashboard/recruiter-dashboard.component';
import { RecruiterProfileComponent } from './recruiter-profile/recruiter-profile.component';
import { ShortlistsComponent } from './shortlists/shortlists.component';

describe('Recruiter Hub page components', () => {
  let hubServiceMock: Record<string, ReturnType<typeof vi.fn>>;
  let candidateServiceMock: Record<string, ReturnType<typeof vi.fn>>;
  let jobServiceMock: Record<string, ReturnType<typeof vi.fn>>;
  let matchServiceMock: Record<string, ReturnType<typeof vi.fn>>;
  let authServiceMock: Record<string, ReturnType<typeof vi.fn>>;
  let tenantContextMock: Record<string, any>;

  const configureRecruiterPageModule = async (
    pageComponent: any,
    options: {
      params?: Record<string, string>;
      queryParams?: Record<string, string>;
    } = {},
  ) => {
    await TestBed.configureTestingModule({
      imports: [RecruiterModule],
      providers: [
        provideRouter([]),
        {
          provide: JobApplicationsService,
          useValue: { applicants: () => of({ applications: [] }) },
        },
        { provide: RecruiterHubService, useValue: hubServiceMock },
        { provide: CandidateService, useValue: candidateServiceMock },
        { provide: RecruiterJobService, useValue: jobServiceMock },
        { provide: RecruiterMatchService, useValue: matchServiceMock },
        { provide: AuthService, useValue: authServiceMock },
        { provide: TenantContextService, useValue: tenantContextMock },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap(options.params || { id: 'item-1' }),
              queryParamMap: convertToParamMap(options.queryParams || {}),
            },
            queryParamMap: of(convertToParamMap(options.queryParams || {})),
          },
        },
      ],
    }).compileComponents();

    const fixture: ComponentFixture<any> = TestBed.createComponent(pageComponent);
    fixture.detectChanges();
    return fixture;
  };

  beforeEach(() => {
    hubServiceMock = {
      getDashboard: vi.fn().mockReturnValue(
        of({
          metrics: { totalCandidates: 12, activeJobs: 3, matchesGenerated: 8 },
          charts: { topSkillsDemand: [{ label: 'TypeScript', count: 5 }] },
          widgets: { assignedTeams: [], recentActivity: [], topCandidates: [], recentJobs: [] },
          profile: { organizationId: 'org1', organizationName: 'Alpha Org' },
        }),
      ),
      getAnalytics: vi.fn().mockReturnValue(
        of({
          metrics: { openJobs: 2, shortlistedCandidates: 4 },
          charts: { scoreDistribution: [], topSkillsDemand: [] },
        }),
      ),
      getActivity: vi.fn().mockReturnValue(
        of({
          logs: [{ _id: 'log1', action: 'RECRUITER_JOB_CREATED', timestamp: '2026-11-19' }],
        }),
      ),
      getProfile: vi.fn().mockReturnValue(
        of({
          profile: {
            _id: 'r1',
            name: 'Ayesha',
            email: 'rec@alpha.test',
            phoneNumber: '+923001112233',
            location: 'Lahore',
            githubUsername: 'ayesha-rec',
            linkedin: 'in/ayesha',
          },
        }),
      ),
      updateProfile: vi.fn().mockReturnValue(
        of({
          profile: {
            _id: 'r1',
            name: 'Ayesha Updated',
            email: 'rec@alpha.test',
            phoneNumber: '+923001112233',
            location: 'Remote',
          },
        }),
      ),
    };

    candidateServiceMock = {
      listCandidates: vi.fn().mockReturnValue(
        of({
          candidates: [
            { id: 'c1', name: 'Aliya Dev', stack: 'Full Stack', readinessScore: 88 },
            { id: 'c2', name: 'Bilal Dev', stack: 'Backend', readinessScore: 79 },
          ],
          total: 2,
          page: 1,
          totalPages: 1,
          meta: { total: 2, page: 1, totalPages: 1, limit: 12 },
        }),
      ),
      getCandidate: vi.fn().mockReturnValue(
        of({
          candidate: { id: 'c1', name: 'Aliya Dev', readinessScore: 88, skills: ['TypeScript'] },
        }),
      ),
      analyzeCandidate: vi.fn().mockReturnValue(
        of({
          insight: { summary: 'Strong systems skills', recommendation: 'Hire' },
        }),
      ),
    };

    jobServiceMock = {
      listEvaluationJobs: vi.fn().mockReturnValue(
        of({
          jobs: [
            {
              _id: 'j1',
              title: 'Engineer',
              access: { isOwner: true, evaluationView: true, evaluationManage: true },
            },
          ],
        }),
      ),
      listJobs: vi.fn().mockReturnValue(
        of({
          jobs: [
            {
              _id: 'j1',
              title: 'Staff Engineer',
              role: 'Backend',
              stack: 'Node.js',
              location: 'Remote',
              employmentType: 'full-time',
              status: 'open',
              minExperienceYears: 3,
              requiredSkills: ['TypeScript'],
            },
          ],
        }),
      ),
      getJob: vi.fn().mockReturnValue(
        of({
          job: {
            _id: 'j1',
            version: 0,
            access: {
              isOwner: true,
              matching: true,
              evaluationView: true,
              evaluationManage: true,
              privateEvidence: true,
              edit: true,
              publish: true,
              archive: true,
              delete: true,
              manageSharing: true,
            },
            title: 'Staff Engineer',
            stack: 'Node.js',
            status: 'open',
            requiredSkills: ['TypeScript'],
          },
        }),
      ),
      createJob: vi.fn().mockReturnValue(of({ job: { _id: 'j2', title: 'New Role' } })),
      updateJob: vi.fn().mockReturnValue(of({ job: { _id: 'j1', title: 'Updated Role' } })),
      archiveJob: vi.fn().mockReturnValue(of({ job: { _id: 'j1', status: 'closed' } })),
      deleteJob: vi.fn().mockReturnValue(of({ message: 'Deleted' })),
    };

    matchServiceMock = {
      listMatches: vi.fn().mockReturnValue(
        of({
          matches: [
            {
              _id: 'm1',
              access: { manage: true },
              jobId: 'j1',
              candidateId: 'c1',
              matchScore: 90,
              status: 'generated',
              candidate: { id: 'c1', name: 'Aliya Dev' },
              job: { _id: 'j1', title: 'Staff Engineer' },
            },
          ],
        }),
      ),
      generateMatches: vi.fn().mockReturnValue(of({ matches: [] })),
      updateMatchStatus: vi
        .fn()
        .mockReturnValue(
          of({ match: { _id: 'm1', access: { manage: true }, status: 'shortlisted' } }),
        ),
      getShortlists: vi.fn().mockReturnValue(
        of({
          shortlists: [
            {
              _id: 's1',
              access: { manage: true },
              status: 'shortlisted',
              candidate: { id: 'c1', name: 'Aliya Dev' },
            },
          ],
        }),
      ),
      addToShortlist: vi.fn().mockReturnValue(of({ shortlist: { _id: 's1' } })),
      updateShortlist: vi
        .fn()
        .mockReturnValue(
          of({ shortlist: { _id: 's1', access: { manage: true }, status: 'reviewing' } }),
        ),
      removeShortlist: vi.fn().mockReturnValue(of({ message: 'Removed' })),
      compareCandidates: vi.fn().mockReturnValue(
        of({
          comparison: [
            { id: 'c1', name: 'Aliya Dev', readinessScore: 88 },
            { id: 'c2', name: 'Bilal Dev', readinessScore: 79 },
          ],
        }),
      ),
    };

    authServiceMock = {
      updateCurrentUser: vi.fn(),
    };

    Object.assign(authServiceMock, {
      currentUser$: of({ _id: 'r1', role: 'recruiter', organizationId: 'org1' }),
    });

    tenantContextMock = {
      syncOrganization: vi.fn(),
      snapshot: { organizationId: 'org1', organizationName: 'Alpha Org', myRole: 'recruiter' },
    };
  });

  it('loads RecruiterDashboardComponent metrics, syncs tenant org, and navigates on openRoute', async () => {
    const fixture = await configureRecruiterPageModule(RecruiterDashboardComponent);
    const component: RecruiterDashboardComponent = fixture.componentInstance;
    const navSpy = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    expect(component.loading).toBe(false);
    expect(tenantContextMock['syncOrganization']).toHaveBeenCalled();

    // Dashboard pipeline funnel scales small counts against min baseline 10 instead of 100%
    component.dashboard.metrics = {
      ...component.dashboard.metrics,
      totalCandidates: 3,
      candidatesViewed: 3,
      candidatesAnalyzed: 1,
      matchesGenerated: 0,
      shortlistedCandidates: 0,
    };
    expect(component.funnelItems.map((item) => item.percent)).toEqual([30, 30, 10, 0, 0]);
    expect(component.supplyVsDemandSubtitle).toContain('Create jobs with required skills');

    // Scales dynamically above 10 when pool grows past 10
    component.dashboard.metrics.totalCandidates = 20;
    component.dashboard.charts.supplyVsDemand = [{ label: 'TypeScript', supply: 2, demand: 1 }];
    expect(component.funnelItems[0].percent).toBe(100);
    expect(component.funnelItems[1].percent).toBe(15);
    expect(component.supplyVsDemandSubtitle).toContain('vs your created jobs (Demand)');

    component.openRoute('/app/recruiter/jobs');
    expect(navSpy).toHaveBeenCalledWith(['/app/recruiter/jobs']);
  });

  it('handles CandidatesComponent filter application, shortlisting, and error state', async () => {
    const fixture = await configureRecruiterPageModule(CandidatesComponent);
    const component: CandidatesComponent = fixture.componentInstance;
    expect(component.candidates.length).toBe(2);
    expect(component.loading).toBe(false);

    component.applyFilters({
      search: 'Aliya',
      stack: 'Full Stack',
      location: '',
      skills: '',
      minReadiness: 80,
      sortBy: 'score-desc',
      page: 1,
      limit: 12,
    });
    expect(candidateServiceMock['listCandidates']).toHaveBeenCalled();

    component.shortlist(component.candidates[0]);
    expect(matchServiceMock['addToShortlist']).toHaveBeenCalledWith({ candidateId: 'c1' });

    candidateServiceMock['listCandidates'].mockReturnValueOnce(
      throwError(() => ({ error: { message: 'Pool unavailable' } })),
    );
    component.loadCandidates();
    expect(component.error).toBe('Pool unavailable');
    expect(component.loading).toBe(false);
  });

  it('loads CandidateDetailsComponent by route id and runs analyze + shortlist actions', async () => {
    const fixture = await configureRecruiterPageModule(CandidateDetailsComponent, {
      params: { id: 'c1' },
    });
    const component: CandidateDetailsComponent = fixture.componentInstance;
    expect(component.candidate?.name).toBe('Aliya Dev');
    component.analyze();
    expect(candidateServiceMock['analyzeCandidate']).toHaveBeenCalledWith('c1');
    component.shortlist();
    expect(matchServiceMock['addToShortlist']).toHaveBeenCalledWith({ candidateId: 'c1' });
  });

  it('CandidateDetails distinguishes absent evidence from measured zero without AI confidence claims', async () => {
    candidateServiceMock['getCandidate'].mockReturnValue(
      of({
        candidate: {
          id: 'c1',
          name: 'Fixture',
          readinessScore: null,
          score: 0,
          githubScore: null,
          resumeScore: null,
          skillScores: [
            { name: 'Unknown', score: null },
            { name: 'Measured zero', score: 0 },
          ],
        },
      }),
    );
    candidateServiceMock['analyzeCandidate'].mockReturnValue(
      of({
        analysis: {
          availableSignalScore: null,
          confidenceScore: null,
          summary: 'No valid measurements are available.',
          scoreExplanation: 'Missing values are excluded. This is not statistical confidence.',
        },
      }),
    );
    const fixture = await configureRecruiterPageModule(CandidateDetailsComponent);
    const component: CandidateDetailsComponent = fixture.componentInstance;
    expect(component.readinessScore).toBeNull();
    expect(component.hasGithubScore).toBe(false);
    expect(component.skillScores).toEqual([{ name: 'Measured zero', score: 0 }]);
    expect(component.breakdownChartItems.some((item) => item.label === 'GitHub')).toBe(false);
    component.analyze();
    fixture.detectChanges();
    expect(component.hasAvailableSignalScore).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Available-signal average:');
    expect(fixture.nativeElement.textContent).toContain('Timestamp unavailable');
    expect(fixture.nativeElement.textContent).not.toContain('Run AI Analysis');
    expect(fixture.nativeElement.textContent).not.toContain('AI Candidate Assessment');
    component.candidate = { readinessScore: 0, githubScore: 0, resumeScore: 0 };
    component.analysis = {
      availableSignalScore: 0,
      evidence: [{ key: 'github', score: 0, recordedAt: '2026-11-18T12:00:00.000Z' }],
    };
    expect(component.readinessScore).toBe(0);
    expect(component.hasGithubScore).toBe(true);
    expect(component.hasAvailableSignalScore).toBe(true);
    expect(component.formatScore(0)).toBe('0%');
    expect(component.formatScore(null)).toBe('Unavailable');
    expect(component.evidenceItems[1].recordedAt).toBe('2026-11-18T12:00:00.000Z');
  });

  it('creates a job without description on JobsComponent and supports archive/delete confirmation', async () => {
    const fixture = await configureRecruiterPageModule(JobsComponent);
    const component: JobsComponent = fixture.componentInstance;

    component.jobForm.patchValue({
      title: 'Frontend Lead',
      role: 'Frontend',
      stack: 'Angular',
      location: 'Remote',
      employmentType: 'full-time',
      status: 'open',
      minExperienceYears: 3,
      requiredSkills: 'Angular, TypeScript',
      description: '',
    });
    component.saveJob();
    expect(jobServiceMock['createJob']).toHaveBeenCalled();

    component.archiveJob({ _id: 'j1', title: 'Staff Engineer', access: { archive: true } });
    component.onConfirmAccepted();
    expect(jobServiceMock['archiveJob']).toHaveBeenCalledWith('j1');
  });

  it('loads JobDetailsComponent and generates matches', async () => {
    const fixture = await configureRecruiterPageModule(JobDetailsComponent, {
      params: { id: 'j1' },
    });
    const component: JobDetailsComponent = fixture.componentInstance;
    expect(component.job?.title).toBe('Staff Engineer');
    component.generateMatches();
    expect(matchServiceMock['generateMatches']).toHaveBeenCalledWith({ jobId: 'j1' });
  });

  it('shared Job Details never fetches matching or mounts private applications', async () => {
    jobServiceMock['getJob'].mockReturnValue(
      of({
        job: {
          _id: 'j1',
          title: 'Shared Job',
          owner: { name: 'Creator' },
          teamShared: true,
          sharedTeam: { name: 'Hiring' },
          access: {
            isOwner: false,
            view: true,
            edit: false,
            publish: false,
            matching: false,
            privateEvidence: false,
          },
        },
      }),
    );
    const fixture = await configureRecruiterPageModule(JobDetailsComponent, {
      params: { id: 'j1' },
    });
    const component: JobDetailsComponent = fixture.componentInstance;
    expect(matchServiceMock['listMatches']).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('app-job-applicants')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Creator');
    component.generateMatches();
    component.togglePublication();
    expect(matchServiceMock['generateMatches']).not.toHaveBeenCalled();
    expect(jobServiceMock['updateJob']).not.toHaveBeenCalled();
  });
  it('team manager can publish with the observed revision but gets no evidence/matching controls', async () => {
    const job = {
      _id: 'j1',
      title: 'Shared Job',
      version: 3,
      published: false,
      access: {
        isOwner: false,
        view: true,
        edit: true,
        publish: true,
        matching: false,
        privateEvidence: false,
      },
    };
    jobServiceMock['getJob'].mockReturnValue(of({ job }));
    jobServiceMock['updateJob'].mockReturnValue(
      of({ job: { ...job, version: 4, published: true } }),
    );
    const fixture = await configureRecruiterPageModule(JobDetailsComponent, {
      params: { id: 'j1' },
    });
    fixture.componentInstance.togglePublication();
    expect(jobServiceMock['updateJob']).toHaveBeenCalledWith('j1', {
      published: true,
      expectedVersion: 3,
    });
    expect(matchServiceMock['listMatches']).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('app-job-applicants')).toBeNull();
  });

  it('renders MatchesComponent, updates match status, and advances ShortlistsComponent', async () => {
    const matchFixture = await configureRecruiterPageModule(MatchesComponent);
    const matchesComp: MatchesComponent = matchFixture.componentInstance;
    expect(matchesComp.matches.length).toBe(1);
    matchesComp.updateStatus(matchesComp.matches[0], 'rejected');
    expect(matchServiceMock['updateMatchStatus']).toHaveBeenCalledWith('m1', 'rejected', undefined);

    TestBed.resetTestingModule();
    const slFixture = await configureRecruiterPageModule(ShortlistsComponent);
    const slComp: ShortlistsComponent = slFixture.componentInstance;
    expect(slComp.shortlists.length).toBe(1);
    slComp.advance({ _id: 's1', access: { manage: true }, status: 'shortlisted' });
    slComp.onConfirmAccepted();
    expect(matchServiceMock['updateShortlist']).toHaveBeenCalledWith('s1', {
      status: 'reviewing',
      expectedVersion: undefined,
    });
  });

  it('shows explicitly shared evaluations without mounting private applications or enabling generation for members', async () => {
    jobServiceMock['getJob'].mockReturnValue(
      of({
        job: {
          _id: 'shared',
          title: 'Team role',
          access: { evaluationView: true, evaluationManage: false, privateEvidence: false },
        },
      }),
    );
    const fixture = await configureRecruiterPageModule(JobDetailsComponent);
    expect(matchServiceMock['listMatches']).toHaveBeenCalledWith({ jobId: 'item-1' });
    expect(fixture.nativeElement.textContent).toContain('View Matches');
    expect(fixture.nativeElement.querySelector('app-job-applicants')).toBeNull();
    fixture.componentInstance.generateMatches();
    expect(matchServiceMock['generateMatches']).not.toHaveBeenCalled();
  });

  it('blocks member shortlist mutations and clears retained results on request failure', async () => {
    const fixture = await configureRecruiterPageModule(ShortlistsComponent);
    const component = fixture.componentInstance;
    const item = { _id: 'shared', version: 4, access: { manage: false }, status: 'shortlisted' };
    component.advance(item);
    component.updateNotes({ item, notes: 'Forbidden' });
    component.remove(item);
    expect(component.confirmState().open).toBe(false);
    expect(matchServiceMock['updateShortlist']).not.toHaveBeenCalled();
    expect(matchServiceMock['removeShortlist']).not.toHaveBeenCalled();
    matchServiceMock['getShortlists'].mockReturnValue(
      throwError(() => ({ status: 403, error: { message: 'Revoked' } })),
    );
    component.loadShortlists();
    expect(component.shortlists).toEqual([]);
    expect(fixture.componentInstance.error).toBe('Revoked');
  });

  it('supports ComparisonComponent multi-candidate selection, Analytics, ActivityLogs, and Profile save', async () => {
    const compFixture = await configureRecruiterPageModule(ComparisonComponent);
    const comp: ComparisonComponent = compFixture.componentInstance;
    comp.toggleCandidate({ id: 'c1' });
    comp.toggleCandidate({ id: 'c2' });
    comp.loadComparison();
    expect(matchServiceMock['compareCandidates']).toHaveBeenCalledWith({
      candidateIds: ['c1', 'c2'],
      jobId: undefined,
    });

    TestBed.resetTestingModule();
    const analyticsFixture = await configureRecruiterPageModule(RecruiterAnalyticsComponent);
    expect(analyticsFixture.componentInstance.loading).toBe(false);

    TestBed.resetTestingModule();
    const logsFixture = await configureRecruiterPageModule(RecruiterActivityLogsComponent);
    expect(logsFixture.componentInstance.logs.length).toBe(1);

    TestBed.resetTestingModule();
    const profileFixture = await configureRecruiterPageModule(RecruiterProfileComponent);
    const profileComp: RecruiterProfileComponent = profileFixture.componentInstance;
    expect(profileComp.loading).toBe(false);
    profileComp.save();
    expect(hubServiceMock['updateProfile']).toHaveBeenCalled();
  });
});
