import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { AdminPerformanceComponent } from './admin-performance.component';
import { AdminPerformanceService, PerformanceData } from './admin-performance.service';

describe('AdminPerformanceComponent', () => {
  let fixture: ComponentFixture<AdminPerformanceComponent>;
  let component: AdminPerformanceComponent;
  const queryParamMap$ = new BehaviorSubject(convertToParamMap({}));

  const mockData = {
    period: { days: 30, since: '2026-10-27T00:00:00.000Z' },
    filters: {
      selectedTeamId: '',
      selectedRecruiterId: '',
      selectedStack: '',
      selectedJobStatus: '',
      teams: [{ _id: 'team-1', name: 'Platform Team' }],
      recruiters: [{ _id: 'rec-1', name: 'Ava Recruiter' }],
      stacks: ['TypeScript'],
      jobStatuses: ['open', 'draft', 'closed'],
    },
    summary: {
      totalRecruiters: 6,
      activeRecruiters: 5,
      inactiveRecruiters: 1,
      totalTeams: 2,
      activeTeams: 2,
      pendingInvitations: 2,
      totalJobs: 10,
      recentJobs: 4,
      openJobs: 5,
      draftJobs: 3,
      closedJobs: 2,
      aiUsageCount: 15,
      matchesGenerated: 20,
      topTeam: 'Platform Team',
      topRecruiter: 'Ava Recruiter',
      organizationPerformanceScore: 84,
      avgPortfolioScore: 78,
      totalAuditActions: 50,
    },
    comparisons: {
      jobsCreated: { current: 4, previous: 2, delta: 2, deltaPct: 100 },
      invitationsAccepted: { current: 4, previous: 2, delta: 2, deltaPct: 100 },
    },
    recruiterMetrics: [
      {
        _id: 'rec-1',
        name: 'Ava Recruiter',
        email: 'ava@nexora.dev',
        isActive: true,
        teamId: 'team-1',
        totalJobs: 5,
        recentJobs: 2,
        totalAnalyses: 8,
        githubAnalyses: 4,
        resumeAnalyses: 4,
        hiringSuccessRate: 40,
        matchesGenerated: 10,
        shortlists: 3,
        aiUsage: 8,
        activityScore: 82,
        lastActiveAt: null,
        candidatesAnalyzed: 12,
        aiRankCalls: 4,
        matchCalls: 6,
        aiEnhancedCandidates: 5,
        openJobs: 3,
        draftJobs: 1,
        closedJobs: 1,
        recentJobsList: [],
        recentCandidates: [],
        recentActivity: [],
        score: 88,
      },
    ],
    teamMetrics: [
      {
        _id: 'team-1',
        name: 'Platform Team',
        isActive: true,
        memberCount: 7,
        activeMembers: 6,
        recruiterCount: 3,
        totalJobs: 6,
        recentJobs: 3,
        openJobs: 3,
        draftJobs: 2,
        closedJobs: 1,
        engagementScore: 76,
        hiringPerformance: 65,
        performanceScore: 76,
        aiUsage: 10,
        candidatesAnalyzed: 12,
        matchesGenerated: 14,
        recentJobsList: [],
        recentCandidates: [],
        recentActivity: [],
      },
    ],
    aiStats: {
      totalAnalyses: 15,
      recentAnalyses: 8,
      analysesByRecruiter: [{ name: 'Ava Recruiter', count: 8 }],
    },
    hiringAnalytics: {
      open: 5,
      draft: 3,
      closed: 2,
      total: 10,
      recentJobs: 4,
      acceptanceRate: 67,
      stackDistribution: [{ stack: 'TypeScript', count: 6 }],
      monthlyTrend: [{ label: 'Nov', count: 4 }],
      invitationFunnel: { total: 6, pending: 2, accepted: 4, revoked: 0, expired: 0 },
    },
    developerAnalytics: {
      total: 100,
      publicCount: 40,
      recentAnalyzed: 12,
      topStacks: [],
      topSkills: [],
      experienceLevels: [],
      scoreDistribution: [],
    },
    activityBreakdown: [],
    auditHeatmap: [],
    recentActions: [],
  } as unknown as PerformanceData;

  const svcSpy = {
    getPerformance: vi.fn().mockReturnValue(of(mockData)),
  };

  beforeEach(async () => {
    queryParamMap$.next(convertToParamMap({}));
    svcSpy.getPerformance.mockReturnValue(of(mockData));
    await TestBed.configureTestingModule({
      imports: [AdminPerformanceComponent],
      providers: [
        { provide: AdminPerformanceService, useValue: svcSpy },
        { provide: ActivatedRoute, useValue: { queryParamMap: queryParamMap$.asObservable() } },
        { provide: Router, useValue: { navigate: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminPerformanceComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('computes a conic gradient for the job status breakdown donut and surfaces distinct team labels', () => {
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Organization Performance Composite',
    );
    expect(component.jobStatusDonutGradient).toContain('conic-gradient(');
    expect(component.jobStatusDonutGradient).toContain('50.00%');

    component.setSection('teams');
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent || '';
    expect(text).toContain('Total Members');
    expect(text).toContain('Active Recruiters');
    expect(text).toContain('Team Engagement Score');
    expect(text).toContain('Hiring Close Rate');
  });

  it('shows an error banner when loading performance data fails', () => {
    svcSpy.getPerformance.mockReturnValueOnce(throwError(() => new Error('Network error')));
    queryParamMap$.next(convertToParamMap({ days: '14' }));
    expect(component.error).toContain('Failed to load performance data.');
  });
});
