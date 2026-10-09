import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { GithubAnalyzerComponent } from './github-analyzer.component';
import { GithubService, GitHubAnalysisResult } from '../../shared/services/github.service';
import { AuthService } from '../../shared/services/auth.service';

describe('GithubAnalyzerComponent', () => {
  let component: GithubAnalyzerComponent;
  let fixture: ComponentFixture<GithubAnalyzerComponent>;
  let githubServiceMock: {
    getActiveUsername: ReturnType<typeof vi.fn>;
    analyzeProfile: ReturnType<typeof vi.fn>;
    analyzeAndSave: ReturnType<typeof vi.fn>;
    getCachedAnalysis: ReturnType<typeof vi.fn>;
  };
  let authServiceMock: {
    getCurrentUser: ReturnType<typeof vi.fn>;
  };

  const sampleResult: GitHubAnalysisResult = {
    analysisVersion: 'github-v2',
    dataVersion: 'github-normalized-v1',
    repoCount: 12,
    totalStars: 45,
    totalForks: 10,
    followers: 18,
    activityScore: 82,
    githubHealthScore: 82,
    developerLevel: 'Advanced',
    strengths: ['Strong documentation', 'Consistent commit rhythm'],
    weakAreas: ['Low project diversity in backend stack'],
    summary: 'Demonstrates solid frontend development expertise.',
    explanation: 'High quality repositories with robust commit cadence.',
    cache: {
      source: 'fresh',
      hit: false,
      cachedAt: '2026-10-08T10:00:00.000Z'
    },
    scoring: {
      score: 82,
      ruleVersion: 'github-health-score-v1',
      calculatedAt: '2026-10-08T10:00:00.000Z',
      warnings: ['activity_sampled_repository_history'],
      evidence: {
        sources: [{ type: 'github-user', id: 'octocat' }],
        facts: {
          repoCount: 12,
          originalRepoCount: 10,
          forkRepoCount: 2,
          archivedRepoCount: 1,
          languageCount: 4,
          totalStars: 45,
          totalForks: 10,
          totalCommits: 320,
          activeRepos: 6
        }
      },
      breakdown: {
        codeQuality: { id: 'codeQuality', value: 85, weight: 0.24, contribution: 20.4, available: true },
        projectDiversity: { id: 'projectDiversity', value: 78, weight: 0.17, contribution: 13.3, available: true },
        contribution: { id: 'contribution', value: 80, weight: 0.18, contribution: 14.4, available: true },
        consistency: { id: 'consistency', value: 90, weight: 0.13, contribution: 11.7, available: true },
        projectImpact: { id: 'projectImpact', value: 75, weight: 0.14, contribution: 10.5, available: true },
        profileStrength: { id: 'profileStrength', value: 84, weight: 0.14, contribution: 11.8, available: true }
      }
    },
    languageDistribution: [
      { language: 'TypeScript', percentage: 65 },
      { language: 'HTML', percentage: 20 },
      { language: 'SCSS', percentage: 15 }
    ],
    mainLanguageDistribution: [
      { language: 'TypeScript', percentage: 65 }
    ],
    supportLanguageDistribution: [
      { language: 'HTML', percentage: 20 },
      { language: 'SCSS', percentage: 15 }
    ],
    technologies: [
      { name: 'Angular', category: 'Frontend', confidence: 95 },
      { name: 'Node.js', category: 'Backend', confidence: 85 }
    ],
    technologyCategories: {
      Frontend: [{ name: 'Angular', category: 'Frontend', confidence: 95 }],
      Backend: [{ name: 'Node.js', category: 'Backend', confidence: 85 }]
    },
    repositoryActivity: [
      { repo: 'repo-one', commits: 150 },
      { repo: 'repo-two', commits: 90 }
    ],
    repositories: [
      {
        name: 'repo-one',
        description: 'First public project',
        language: 'TypeScript',
        stars: 30,
        forks: 8,
        commits: 150,
        activityScore: 88,
        qualityScore: 88,
        category: 'Production',
        technologies: ['Angular', 'TypeScript'],
        fork: false,
        archived: false
      },
      {
        name: 'repo-two',
        description: 'Archived demo',
        language: 'TypeScript',
        stars: 15,
        forks: 2,
        commits: 90,
        activityScore: 70,
        qualityScore: 70,
        category: 'Learning',
        technologies: ['Node.js'],
        fork: true,
        archived: true
      }
    ],
    recruiterInsights: {
      headline: 'Full Stack Angular Engineer',
      proofPoints: ['Maintains clean documentation', 'Proven Angular mastery']
    }
  };

  beforeEach(async () => {
    githubServiceMock = {
      getActiveUsername: vi.fn().mockReturnValue(of({ username: 'octocat', isDefault: true })),
      analyzeProfile: vi.fn().mockReturnValue(of(sampleResult)),
      analyzeAndSave: vi.fn().mockReturnValue(of(sampleResult)),
      getCachedAnalysis: vi.fn().mockReturnValue(null)
    };

    authServiceMock = {
      getCurrentUser: vi.fn().mockReturnValue({
        _id: 'usr-1',
        githubUsername: 'octocat',
        activeGithubUsername: 'octocat'
      })
    };

    await TestBed.configureTestingModule({
      imports: [GithubAnalyzerComponent],
      providers: [
        provideRouter([]),
        { provide: GithubService, useValue: githubServiceMock },
        { provide: AuthService, useValue: authServiceMock }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(GithubAnalyzerComponent);
    component = fixture.componentInstance;
  });

  it('should initialize and apply default profile username', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
    expect(component.defaultUsername).toBe('octocat');
    expect(component.username).toBe('octocat');
    expect(component.isInitLoading).toBe(false);
  });

  it('should show onboarding empty state when no GitHub account is configured', () => {
    authServiceMock.getCurrentUser.mockReturnValue(null);
    githubServiceMock.getActiveUsername.mockReturnValue(of({ username: '', isDefault: false }));

    const localFixture = TestBed.createComponent(GithubAnalyzerComponent);
    const localComp = localFixture.componentInstance;
    localFixture.detectChanges();

    expect(localComp.hasNoConfiguredGithub).toBe(true);
    const emptyState = localFixture.nativeElement.querySelector('app-ui-empty-state');
    expect(emptyState).toBeTruthy();
  });

  it('should render loading skeleton while analyzing without existing ready result', () => {
    component.isInitLoading = false;
    component.isAnalyzing = true;
    component.analysisReady = false;
    fixture.detectChanges();

    const skeletons = fixture.nativeElement.querySelectorAll('app-ui-skeleton');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('should execute analyzeAndSave for default profile analysis and render authoritative score', () => {
    component.defaultUsername = 'octocat';
    component.username = 'octocat';
    component.isAnalyzing = false;
    component.analyze(false);
    fixture.detectChanges();

    expect(githubServiceMock.analyzeAndSave).toHaveBeenCalledWith('octocat', false);
    expect(component.analysisReady).toBe(true);
    expect(component.healthScoreValue).toBe(82);
    expect(component.isDefaultProfile).toBe(true);
    expect(component.isTemporaryView).toBe(false);
  });

  it('should render six breakdown components with values, weights, and contributions', () => {
    component.defaultUsername = 'octocat';
    component.username = 'octocat';
    component.isAnalyzing = false;
    component.analyze(false);
    fixture.detectChanges();

    const breakdown = component.scoreBreakdownList;
    expect(breakdown.length).toBe(6);
    expect(breakdown[0].id).toBe('codeQuality');
    expect(breakdown[0].weightPct).toBe(24);
    expect(breakdown[0].value).toBe(85);
    expect(breakdown[0].contribution).toBe(20.4);
    expect(breakdown[0].available).toBe(true);
  });

  it('should handle unavailable metrics properly without converting them to zero', () => {
    const unavailableResult: GitHubAnalysisResult = {
      ...sampleResult,
      totalStars: null,
      followers: null,
      githubHealthScore: null,
      scoring: {
        ...sampleResult.scoring!,
        score: null,
        breakdown: {
          ...sampleResult.scoring!.breakdown,
          projectImpact: { id: 'projectImpact', value: null, weight: 0.14, contribution: null, available: false }
        }
      }
    };
    githubServiceMock.analyzeAndSave.mockReturnValue(of(unavailableResult));
    githubServiceMock.analyzeProfile.mockReturnValue(of(unavailableResult));

    component.defaultUsername = 'octocat';
    component.username = 'octocat';
    component.isAnalyzing = false;
    component.analyze(false);
    fixture.detectChanges();

    expect(component.healthScoreValue).toBeNull();
    expect(component.formatNumber(component.result?.totalStars)).toBe('Unavailable');
    expect(component.formatNumber(component.result?.followers)).toBe('Unavailable');

    const impact = component.scoreBreakdownList.find(b => b.id === 'projectImpact');
    expect(impact?.value).toBeNull();
    expect(impact?.available).toBe(false);
    expect(impact?.contribution).toBeNull();
  });

  it('should distinguish measured zero from unavailable data', () => {
    const zeroResult: GitHubAnalysisResult = {
      ...sampleResult,
      totalStars: 0,
      totalForks: 0,
      followers: 0,
      githubHealthScore: 0,
      scoring: {
        ...sampleResult.scoring!,
        score: 0,
        breakdown: {
          ...sampleResult.scoring!.breakdown,
          contribution: { id: 'contribution', value: 0, weight: 0.18, contribution: 0, available: true }
        }
      }
    };
    githubServiceMock.analyzeAndSave.mockReturnValue(of(zeroResult));
    githubServiceMock.analyzeProfile.mockReturnValue(of(zeroResult));

    component.defaultUsername = 'octocat';
    component.username = 'octocat';
    component.isAnalyzing = false;
    component.analyze(false);
    fixture.detectChanges();

    expect(component.healthScoreValue).toBe(0);
    expect(component.formatNumber(component.result?.totalStars)).toBe('0');
    expect(component.formatNumber(component.result?.followers)).toBe('0');

    const contribution = component.scoreBreakdownList.find(b => b.id === 'contribution');
    expect(contribution?.value).toBe(0);
    expect(contribution?.available).toBe(true);
  });

  it('should display stale warning banner when cache source is stale-cache or rate limited', () => {
    const staleResult: GitHubAnalysisResult = {
      ...sampleResult,
      rateLimited: true,
      warning: 'GitHub API rate limit reached. Showing the most recent cached analysis.',
      cache: {
        source: 'stale-cache',
        hit: true,
        stale: true,
        cachedAt: '2026-10-07T12:00:00.000Z'
      }
    };
    githubServiceMock.analyzeAndSave.mockReturnValue(of(staleResult));
    githubServiceMock.analyzeProfile.mockReturnValue(of(staleResult));

    component.defaultUsername = 'octocat';
    component.username = 'octocat';
    component.isAnalyzing = false;
    component.analyze(false);
    fixture.detectChanges();

    expect(component.isStale).toBe(true);
    expect(component.cacheStatusLabel).toBe('Cached Fallback (Stale)');
    expect(component.cacheBadgeVariant).toBe('warning');

    const warningCallout = fixture.nativeElement.querySelector('.warning-callout');
    expect(warningCallout).toBeTruthy();
  });

  it('should execute analyzeProfile for preview analysis when analyzing non-default username', () => {
    fixture.detectChanges();
    component.defaultUsername = 'octocat';
    component.username = 'torvalds';
    component.isAnalyzing = false;
    component.analyze(false);
    fixture.detectChanges();

    expect(githubServiceMock.analyzeProfile).toHaveBeenCalledWith('torvalds', false);
    expect(component.isDefaultProfile).toBe(false);
    expect(component.isTemporaryView).toBe(true);

    // Return to default profile resets username to octocat and triggers analyzeAndSave
    component.returnToDefaultProfile();
    expect(component.username).toBe('octocat');
    expect(githubServiceMock.analyzeAndSave).toHaveBeenCalledWith('octocat', false);
  });

  it('should validate invalid username format before making HTTP call', () => {
    component.defaultUsername = 'octocat';
    component.username = '-invalid-start';
    component.isAnalyzing = false;
    component.analyze(false);
    fixture.detectChanges();

    expect(component.invalidUsername).toBe(true);
    expect(component.errorMessage).toContain('invalid');
    expect(githubServiceMock.analyzeProfile).not.toHaveBeenCalled();
    expect(githubServiceMock.analyzeAndSave).not.toHaveBeenCalled();
  });

  it('should handle 404 not found error with user-friendly error state', () => {
    githubServiceMock.analyzeProfile.mockReturnValue(throwError(() => ({
      status: 404,
      error: { message: 'GitHub user not found.' }
    })));

    component.defaultUsername = 'octocat';
    component.username = 'nonexistent-user-404';
    component.isAnalyzing = false;
    component.analyze(false);
    fixture.detectChanges();

    expect(component.invalidUsername).toBe(true);
    expect(component.errorMessage).toBe('GitHub user not found.');
    expect(component.analysisReady).toBe(false);

    const errorState = fixture.nativeElement.querySelector('app-ui-error-state');
    expect(errorState).toBeTruthy();
  });

  it('should keep deterministic results visible when AI narrative is missing or fails', () => {
    const deterministicOnlyResult: GitHubAnalysisResult = {
      ...sampleResult,
      summary: undefined,
      explanation: undefined,
      strengths: [],
      weakAreas: [],
      recruiterInsights: undefined
    };
    githubServiceMock.analyzeAndSave.mockReturnValue(of(deterministicOnlyResult));
    githubServiceMock.analyzeProfile.mockReturnValue(of(deterministicOnlyResult));

    component.defaultUsername = 'octocat';
    component.username = 'octocat';
    component.isAnalyzing = false;
    component.analyze(false);
    fixture.detectChanges();

    expect(component.hasAiContent).toBe(false);
    expect(component.healthScoreValue).toBe(82);
    expect(component.scoreBreakdownList.length).toBe(6);
    expect(component.repositoryRows.length).toBe(2);

    const fallbackNotice = fixture.nativeElement.querySelector('.ai-fallback-notice');
    expect(fallbackNotice).toBeTruthy();
  });

  it('should prevent duplicate requests when analysis is already in-flight', () => {
    component.isAnalyzing = true;
    component.username = 'octocat';
    component.analyze(false);

    expect(githubServiceMock.analyzeAndSave).not.toHaveBeenCalled();
    expect(githubServiceMock.analyzeProfile).not.toHaveBeenCalled();
  });

  it('should toggle evidence audit drawer', () => {
    expect(component.showEvidenceDrawer).toBe(false);
    component.toggleEvidenceDrawer();
    expect(component.showEvidenceDrawer).toBe(true);
    component.toggleEvidenceDrawer();
    expect(component.showEvidenceDrawer).toBe(false);
  });

  it('should compute executive summary qualitative state and strategic pillars accurately', () => {
    component.defaultUsername = 'octocat';
    component.username = 'octocat';
    component.isAnalyzing = false;
    component.analyze(false);
    fixture.detectChanges();

    expect(component.qualitativeState).toBe('Strong');
    expect(component.qualitativeStateVariant).toBe('success');
    expect(component.executiveHeadline).toBe('Full Stack Angular Engineer');
    expect(component.executiveExplanation).toBe('Demonstrates solid frontend development expertise.');
    expect(component.strongestSignal.label).toContain('Consistency');
    expect(component.biggestWeakness.label).toContain('Project Impact');
    expect(component.topRecommendedAction).toBeTruthy();

    const executiveSection = fixture.nativeElement.querySelector('.executive-card');
    expect(executiveSection).toBeTruthy();
    expect(executiveSection.textContent).toContain('82');
    expect(executiveSection.textContent).toContain('Strong');
    expect(executiveSection.textContent).toContain('Strongest Signal');
  });

  it('should handle repository display controls: top prioritized repos and sorted full table', () => {
    component.defaultUsername = 'octocat';
    component.username = 'octocat';
    component.isAnalyzing = false;
    component.analyze(false);
    fixture.detectChanges();

    expect(component.showAllRepositories).toBe(false);
    expect(component.topRepositories.length).toBe(2);

    component.toggleShowAllRepositories();
    expect(component.showAllRepositories).toBe(true);

    // Default sort is activityScore desc
    expect(component.sortedRepositoryRows[0].name).toBe('repo-one');

    // Sort by stars asc
    component.setRepoSort('stars');
    expect(component.repoSortField).toBe('stars');
    expect(component.repoSortAsc).toBe(false);
    component.setRepoSort('stars');
    expect(component.repoSortAsc).toBe(true);

    // Toggle back to collapsed view
    component.toggleShowAllRepositories();
    expect(component.showAllRepositories).toBe(false);
  });

  it('should render the clean 6-item key metrics strip', () => {
    component.defaultUsername = 'octocat';
    component.username = 'octocat';
    component.isAnalyzing = false;
    component.analyze(false);
    fixture.detectChanges();

    const metricStrip = fixture.nativeElement.querySelector('.metrics-strip-grid');
    expect(metricStrip).toBeTruthy();
    const metricCells = fixture.nativeElement.querySelectorAll('.metric-cell');
    expect(metricCells.length).toBe(6);
    expect(metricStrip.textContent).toContain('Repositories');
    expect(metricStrip.textContent).toContain('Sampled Commits');
    expect(metricStrip.textContent).toContain('Total Stars');
  });
});
