import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { GithubProfileSearchComponent } from './github-profile-search/github-profile-search.component';
import { GithubRepositoryTableComponent } from './github-repository-table/github-repository-table.component';
import { GithubChartsComponent } from './github-charts/github-charts.component';
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
});
