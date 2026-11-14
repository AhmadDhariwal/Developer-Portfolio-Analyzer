import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { GithubProfileSearchComponent } from './github-profile-search/github-profile-search.component';
import { GithubRepositoryTableComponent } from './github-repository-table/github-repository-table.component';
import { GithubChartsComponent } from './github-charts/github-charts.component';
import { GithubTechnicalAuditComponent } from './github-technical-audit/github-technical-audit.component';
import { ThemeService } from '../../../shared/services/theme.service';
import {
  GitHubAnalysisResult,
  LanguageDistribution,
  RepositoryActivity,
} from '../../../shared/services/github.service';

describe('GitHub presentation boundaries', () => {
  it('emits search intent and username changes without an HTTP service', async () => {
    const fixture = TestBed.createComponent(GithubProfileSearchComponent);
    fixture.componentRef.setInput('username', 'octocat');
    fixture.componentRef.setInput('isAnalyzing', false);
    fixture.componentRef.setInput('result', null);
    fixture.componentRef.setInput('analysisReady', false);
    const requested = vi.fn(),
      changed = vi.fn();
    fixture.componentInstance.analyzeRequested.subscribe(requested);
    fixture.componentInstance.usernameChange.subscribe(changed);
    fixture.detectChanges();
    await fixture.whenStable();
    const input: HTMLInputElement = fixture.nativeElement.querySelector('input');
    input.value = 'preview';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter' }));
    expect(changed).toHaveBeenCalledExactlyOnceWith('preview');
    expect(requested).toHaveBeenCalledOnce();
  });

  it('emits one sorting action and retains native table semantics', () => {
    const fixture = TestBed.createComponent(GithubRepositoryTableComponent);
    for (const [name, value] of Object.entries({
      repositoryRows: [{ name: 'one' }],
      sortedRepositoryRows: [],
      showAllRepositories: false,
      repoSortField: 'score',
      repoSortAsc: false,
      viewedUsername: 'octocat',
      username: 'octocat',
    }))
      fixture.componentRef.setInput(name, value);
    const sorted = vi.fn();
    fixture.componentInstance.sortRequested.subscribe(sorted);
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('th button') as HTMLButtonElement;
    button.click();
    expect(sorted).toHaveBeenCalledOnce();
    expect(fixture.nativeElement.querySelector('table')).toBeTruthy();
  });

  it('owns exactly one chart pair, recreates on theme/result changes and destroys on teardown', async () => {
    const activeTheme = signal('light');
    TestBed.configureTestingModule({
      providers: [{ provide: ThemeService, useValue: { activeTheme } }],
    });
    const charts = { created: vi.fn(), destroyed: vi.fn() };
    const fixture = TestBed.createComponent(GithubChartsComponent);
    const lifecycle = fixture.componentInstance as unknown as {
      buildDonutChart: (languages: LanguageDistribution[]) => void;
      buildBarChart: (activity: RepositoryActivity[]) => void;
      donutChart: { destroy: () => void } | null;
      barChart: { destroy: () => void } | null;
    };
    vi.spyOn(lifecycle, 'buildDonutChart').mockImplementation(() => {
      charts.created();
      lifecycle.donutChart = { destroy: charts.destroyed };
    });
    vi.spyOn(lifecycle, 'buildBarChart').mockImplementation(() => {
      charts.created();
      lifecycle.barChart = { destroy: charts.destroyed };
    });
    const result = {
      repositoryActivity: [{ repo: 'one', commits: 3 }],
      languageDistributionSource: 'language_bytes',
    } as GitHubAnalysisResult;
    for (const [name, value] of Object.entries({
      result,
      hasLanguageData: true,
      hasActivityData: true,
      displayLanguages: [{ language: 'TypeScript', percentage: 100 }],
      supportLanguages: [],
    }))
      fixture.componentRef.setInput(name, value);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(charts.created).toHaveBeenCalledTimes(2);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(charts.created).toHaveBeenCalledTimes(2);
    activeTheme.set('dark');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(charts.created).toHaveBeenCalledTimes(4);
    fixture.componentRef.setInput('result', { ...result });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(charts.created).toHaveBeenCalledTimes(6);
    fixture.destroy();
    expect(charts.destroyed).toHaveBeenCalledTimes(6);
    vi.restoreAllMocks();
  });

  it('renders audit provenance, weights, source metadata, tech evidence, inputs and notices with zero vs unavailable fidelity', () => {
    const fixture = TestBed.createComponent(GithubTechnicalAuditComponent);
    const result: GitHubAnalysisResult = {
      analysisVersion: 'github-analysis/v3',
      dataVersion: 'github-data/v2',
      repoCount: 12,
      totalStars: 0,
      totalForks: 0,
      activityScore: 64,
      githubHealthScore: 64,
      cache: { source: 'fresh', hit: false },
      dataAvailability: { activityScope: 'repository_contributor_history' },
      languageDistribution: [],
      repositoryActivity: [{ repo: 'alpha', commits: 0 }],
      repositories: [],
      warning: 'Partial repository metrics.',
      scoring: {
        score: 64,
        breakdown: {},
        warnings: ['activity_sampled_repository_history'],
        ruleVersion: 'github-health/v2',
        calculatedAt: '2026-11-14T10:00:00Z',
        evidence: {
          sources: [{ type: 'github-user', id: 'octocat' }],
          inputs: { codeQuality: 0, profileStrength: null },
          facts: { activeRepos: 4 },
        },
      },
    };
    for (const [name, value] of Object.entries({
      showEvidenceDrawer: true,
      result,
      ruleVersion: 'github-health/v2',
      calculationTimestamp: 'Nov 14, 2026',
      cacheStatusLabel: 'Fresh compute',
      originalRepoCount: 10,
      forkedRepoCount: 2,
      archivedRepoCount: 1,
      totalSampledCommits: 0,
      evidenceFacts: result.scoring?.evidence.facts,
      scoreBreakdownList: [
        {
          id: 'codeQuality',
          label: 'Code Quality',
          description: 'Repository documentation and code signals',
          weightPct: 24,
          value: 72,
          contribution: 17.3,
          available: true,
          color: 'primary',
        },
        {
          id: 'profileStrength',
          label: 'Profile Strength',
          description: 'Follower and star visibility signals',
          weightPct: 12,
          value: null,
          contribution: null,
          available: false,
          color: 'info',
        },
      ],
      hasTechnologyData: true,
      technologyCategories: [
        {
          category: 'Frontend',
          items: [{ name: 'Angular', category: 'Frontend', confidence: 82, sources: ['repo-a'] }],
        },
      ],
      scoringWarnings: ['activity_sampled_repository_history'],
    })) {
      fixture.componentRef.setInput(name, value);
    }

    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('github-health/v2');
    expect(text).toContain('64/100');
    expect(text).toContain('Source Metadata');
    expect(text).toContain('Sampled repository contributor history');
    expect(text).toContain('octocat');
    expect(text).toContain('Partial repository metrics.');
    expect(text).toContain('Angular');
    expect(text).toContain('82% confidence');
    expect(text).toContain('Code Quality');
    expect(text).toContain('Unavailable');
    expect(fixture.nativeElement.querySelectorAll('.drawer-weight-row').length).toBe(2);
    expect(fixture.nativeElement.querySelectorAll('.drawer-input-card')[0].textContent).toContain(
      '0',
    );
    expect(fixture.nativeElement.querySelector('.drawer-notices-box')?.textContent).toContain(
      'activity_sampled_repository_history',
    );
  });
});
