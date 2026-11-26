import { ChangeDetectorRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Chart } from 'chart.js';
import { Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminModule } from '../../admin.module';
import { ThemeService } from '../../../../shared/services/theme.service';
import { AdminHiringService } from '../../services/admin-hiring.service';
import { AdminConsoleService } from '../admin-console/admin-console.service';
import {
  AdminPerformanceService,
  PerformanceData,
} from '../admin-performance/admin-performance.service';
import { AdminDashboardPageComponent } from './admin-dashboard.component';

describe('AdminDashboardPageComponent', () => {
  let component: AdminDashboardPageComponent;
  const getPerformance = vi.fn<AdminPerformanceService['getPerformance']>();

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AdminModule],
      providers: [{ provide: ChangeDetectorRef, useValue: { markForCheck: () => {} } }],
    });
    getPerformance.mockReset();
    component = TestBed.runInInjectionContext(
      () =>
        new AdminDashboardPageComponent(
          {} as AdminHiringService,
          {} as AdminConsoleService,
          { getPerformance } as unknown as AdminPerformanceService,
          {} as Router,
        ),
    );
  });

  it('provides valid Chart.js scales with and without a secondary axis', () => {
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const canvas = document.createElement('canvas');
    vi.spyOn(canvas, 'getContext').mockReturnValue(null);

    try {
      for (const titles of [undefined, { leftTitle: 'Score', rightTitle: 'Candidates' }]) {
        // Chart.js resolves and validates scales before it acquires a drawing context.
        const chart = new Chart<'bar' | 'line'>(canvas, {
          type: 'bar',
          data: {
            labels: ['Team'],
            datasets: [{ data: [1], ...(titles && { type: 'line', yAxisID: 'y1' }) }],
          },
          options: component['buildChartOptions'](titles),
        });
        try {
          expect(logError).not.toHaveBeenCalledWith('Invalid scale configuration for scale: y1');
          if (titles) {
            expect(chart.options!.scales?.['y1']).toMatchObject({ axis: 'y', position: 'right' });
          } else {
            expect(chart.options!.scales?.['y1']).toBeUndefined();
          }
        } finally {
          chart.destroy();
        }
      }
    } finally {
      logError.mockRestore();
    }
  });

  it('redraws charts with resolved shared colors when the active theme changes', () => {
    const theme = TestBed.inject(ThemeService);
    const render = vi.spyOn(component as any, 'renderCharts').mockImplementation(() => {});
    const root = document.documentElement;
    const originalStyle = root.getAttribute('style');
    const originalPreference = theme.preference();
    try {
      for (const [mode, label] of [
        ['light', '#475569'],
        ['dark', '#cbd5e1'],
      ] as const) {
        theme.setTheme(mode);
        root.style.setProperty('--chart-label', label);
        root.style.setProperty('--chart-tick', label);
        TestBed.tick();
        component.ngAfterViewChecked();
        expect(component['buildChartOptions']()).toMatchObject({
          plugins: { legend: { labels: { color: label } } },
          scales: { x: { ticks: { color: label } }, y: { ticks: { color: label } } },
        });
      }
      expect(render).toHaveBeenCalledTimes(2);
    } finally {
      theme.setTheme(originalPreference);
      if (originalStyle === null) root.removeAttribute('style');
      else root.setAttribute('style', originalStyle);
      render.mockRestore();
    }
  });

  it('keeps the latest filter request and stays loading while an invalid filter is retried', () => {
    const oldResponse = new Subject<PerformanceData>();
    const filterResponse = new Subject<PerformanceData>();
    const fallbackResponse = new Subject<PerformanceData>();
    getPerformance
      .mockReturnValueOnce(oldResponse)
      .mockReturnValueOnce(filterResponse)
      .mockReturnValueOnce(fallbackResponse);
    const emptyResponse = {
      filters: { teams: [], recruiters: [], stacks: [], jobStatuses: [] },
      teamMetrics: [],
      recruiterMetrics: [],
      hiringAnalytics: {
        total: 0,
        open: 0,
        draft: 0,
        closed: 0,
        invitationFunnel: { accepted: 0 },
      },
      recentActivity: [],
    } as unknown as PerformanceData;

    component.loadPerformance();
    component.selectedTeamId = 'removed-team';
    component.onTeamChange();
    expect(oldResponse.observed).toBe(false);
    oldResponse.next(emptyResponse);
    expect(component.performance).toBeNull();

    filterResponse.next(emptyResponse);
    expect(getPerformance).toHaveBeenCalledTimes(3);
    expect(getPerformance.mock.lastCall?.[1]?.teamId).toBeUndefined();
    expect(component.loading).toBe(true);
    fallbackResponse.next(emptyResponse);
    expect(component.loading).toBe(false);
    expect(component.initialized).toBe(true);
    expect(component.performance).toBe(emptyResponse);
    expect(component.hasPerformanceData).toBe(false);

    getPerformance.mockReturnValueOnce(throwError(() => new Error('Analytics unavailable')));
    component.loadPerformance();
    expect(component.analyticsLoadFailed).toBe(true);
    expect(component.refreshing).toBe(false);
    expect(component.error).toBe('Failed to load organization analytics.');
  });

  it('destroys rendered charts when analytics fail or the page is destroyed', () => {
    getPerformance.mockReturnValueOnce(throwError(() => new Error('Analytics unavailable')));
    const previousChart = { destroy: vi.fn() } as unknown as Chart;
    component['teamChart'] = previousChart;
    component.loadPerformance();
    component.ngAfterViewChecked();
    expect(previousChart.destroy).toHaveBeenCalledOnce();
    expect(component['teamChart']).toBeNull();

    const activeChart = { destroy: vi.fn() } as unknown as Chart;
    component['funnelChart'] = activeChart;
    component.ngOnDestroy();
    expect(activeChart.destroy).toHaveBeenCalledOnce();
    expect(component['funnelChart']).toBeNull();
  });

  it('renders a single Hiring Funnel chart without duplicating the Hiring Funnel card or raw Org ID banner', async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [AdminModule],
      providers: [
        {
          provide: AdminHiringService,
          useValue: {
            getOverview: () =>
              of({
                organizationId: 'org-1',
                recruitersCount: 3,
                jobsCount: 4,
                globalDevelopersCount: 12,
                pendingInvitationsCount: 1,
                activeTeamsCount: 2,
                recentActivityCount: 1,
                recentActivity: [],
              }),
            getRecruiters: () => of({ recruiters: [] }),
            getDevelopers: () => of({ developers: [], pagination: { total: 0 } }),
          },
        },
        {
          provide: AdminConsoleService,
          useValue: {
            getPreferences: () =>
              of({
                organization: {
                  _id: 'org-1',
                  name: 'Nexora Systems',
                  slug: 'nexora',
                  ownerId: 'owner-1',
                  description: 'Engineering Org',
                  createdAt: '2026-01-01T00:00:00.000Z',
                  dashboardConfig: { preferredDateRangeDays: 30 },
                },
              }),
          },
        },
        {
          provide: AdminPerformanceService,
          useValue: {
            getPerformance: () =>
              of({
                period: { days: 30, since: '2026-10-27T00:00:00.000Z' },
                filters: {
                  selectedTeamId: '',
                  selectedRecruiterId: '',
                  selectedStack: '',
                  selectedJobStatus: '',
                  teams: [],
                  recruiters: [],
                  stacks: [],
                  jobStatuses: [],
                },
                summary: {
                  totalRecruiters: 3,
                  activeRecruiters: 3,
                  totalTeams: 2,
                  pendingInvitations: 1,
                  totalJobs: 4,
                  recentJobs: 2,
                  openJobs: 2,
                  draftJobs: 1,
                  closedJobs: 1,
                  aiUsageCount: 5,
                  matchesGenerated: 8,
                  topTeam: 'Core',
                  topRecruiter: 'Ava',
                  organizationPerformanceScore: 80,
                },
                recruiterMetrics: [],
                teamMetrics: [],
                hiringAnalytics: {
                  open: 2,
                  draft: 1,
                  closed: 1,
                  total: 4,
                  recentTotal: 2,
                  stackDistribution: [],
                  monthlyTrend: [],
                  invitationFunnel: { total: 3, pending: 1, accepted: 2, revoked: 0, expired: 0 },
                  invitationAcceptanceRate: 67,
                },
                developerAnalytics: {
                  total: 12,
                  publicCount: 10,
                  recentAnalyzed: 4,
                  topStacks: [],
                  topSkills: [],
                  experienceLevels: [],
                  scoreDistribution: [],
                },
                activityBreakdown: [],
                auditHeatmap: [],
                recentActions: [],
              }),
          },
        },
        provideRouter([]),
      ],
    }).compileComponents();

    const pageFixture = TestBed.createComponent(AdminDashboardPageComponent);
    pageFixture.detectChanges();
    const html = pageFixture.nativeElement as HTMLElement;
    const headings = Array.from(html.querySelectorAll('h2, h3')).map((el) =>
      el.textContent?.trim(),
    );
    expect(headings.filter((text) => text === 'Hiring Funnel')).toHaveLength(1);
    expect(headings).toContain('Invitations & Stack Demand');
    const overviewLabels = Array.from(html.querySelectorAll('.overview-band__label')).map((el) =>
      el.textContent?.trim(),
    );
    expect(overviewLabels).not.toContain('Org ID');
    expect(overviewLabels).toContain('Scope');
  });
});
