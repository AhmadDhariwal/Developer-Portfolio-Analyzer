import {
  Component,
  OnInit,
  AfterViewInit,
  OnDestroy,
  ViewChild,
  ElementRef,
  ChangeDetectorRef,
  inject,
  DestroyRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Chart, ChartConfiguration, registerables } from 'chart.js';
import {
  GithubService,
  GitHubAnalysisResult,
  LanguageDistribution,
  RepositoryActivity,
  Repository,
  TechnologySignal,
  ScoreBreakdownItem,
  ScoreEvidence
} from '../../shared/services/github.service';
import { AuthService } from '../../shared/services/auth.service';
import {
  UiButtonComponent,
  UiCardComponent,
  UiMetricCardComponent,
  ScoreCardComponent,
  ScoreCardColor,
  UiBadgeComponent,
  BadgeVariant,
  UiSkeletonComponent,
  UiEmptyStateComponent,
  UiErrorStateComponent,
  UiProgressComponent,
  ProgressColor,
  UiTooltipDirective,
  UiPageHeaderComponent,
  UiSectionHeaderComponent
} from '../../shared/components';

Chart.register(...registerables);

const LANG_COLOURS = [
  '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#6D5DF6',
  '#06B6D4', '#EC4899', '#84CC16', '#F97316', '#64748B'
];

export interface DisplayBreakdownItem {
  id: string;
  label: string;
  description: string;
  weightPct: number;
  value: number | null;
  contribution: number | null;
  available: boolean;
  color: ProgressColor;
}

@Component({
  selector: 'app-github-analyzer',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    UiButtonComponent,
    UiCardComponent,
    UiMetricCardComponent,
    ScoreCardComponent,
    UiBadgeComponent,
    UiSkeletonComponent,
    UiEmptyStateComponent,
    UiErrorStateComponent,
    UiProgressComponent,
    UiTooltipDirective,
    UiPageHeaderComponent,
    UiSectionHeaderComponent
  ],
  templateUrl: './github-analyzer.component.html',
  styleUrl: './github-analyzer.component.scss'
})
export class GithubAnalyzerComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('donutCanvas') donutCanvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('barCanvas') barCanvasRef!: ElementRef<HTMLCanvasElement>;

  username = '';
  defaultUsername = '';
  viewedUsername = '';
  isAnalyzing = false;
  analysisReady = false;
  errorMessage = '';
  invalidUsername = false;
  isInitLoading = true;
  isTemporaryView = false;
  result: GitHubAnalysisResult | null = null;
  showEvidenceDrawer = false;

  private donutChart: Chart | null = null;
  private barChart: Chart | null = null;
  private viewReady = false;
  private pendingLangs: LanguageDistribution[] | null = null;
  private pendingActivity: RepositoryActivity[] | null = null;

  private readonly github = inject(GithubService);
  private readonly authService = inject(AuthService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    const stored = this.getStoredActiveUsername();
    if (stored) {
      this.applyDefaultUsername(stored);
      this.isInitLoading = false;
    }
  }

  ngOnInit(): void {
    if (this.defaultUsername) {
      this.isInitLoading = false;
      this.scheduleInitialAnalyze();
      return;
    }

    this.isInitLoading = true;
    const storedUsername = this.getStoredActiveUsername();
    if (storedUsername) {
      this.applyDefaultUsername(storedUsername);
      this.isInitLoading = false;
      this.scheduleInitialAnalyze();
      return;
    }

    this.github.getActiveUsername()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.applyDefaultUsername(data.username || '');
          this.isInitLoading = false;
          if (this.username) {
            this.scheduleInitialAnalyze();
          }
          this.cdr.markForCheck();
        },
        error: () => {
          this.isInitLoading = false;
          this.cdr.markForCheck();
        }
      });
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.flushPendingCharts();
  }

  ngOnDestroy(): void {
    this.viewReady = false;
    this.destroyCharts();
  }

  private getStoredActiveUsername(): string {
    const user = this.authService.getCurrentUser();
    return String(user?.activeGithubUsername || user?.githubUsername || '').trim().replace(/^@/, '');
  }

  private applyDefaultUsername(username: string): void {
    this.defaultUsername = String(username || '').trim().replace(/^@/, '');
    this.username = this.defaultUsername;
    this.viewedUsername = this.defaultUsername;
    this.isTemporaryView = false;
  }

  private scheduleInitialAnalyze(): void {
    queueMicrotask(() => {
      if (this.username.trim()) {
        this.analyze(false);
      }
    });
  }

  analyze(forceRefresh = false): void {
    const trimmed = this.username.trim().replace(/^@/, '');
    if (!trimmed) return;

    if (trimmed.length > 200) {
      this.errorMessage = 'GitHub username is too large.';
      this.invalidUsername = false;
      return;
    }

    if (trimmed.length > 39 || !/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(trimmed)) {
      this.errorMessage = 'GitHub username format is invalid.';
      this.invalidUsername = true;
      return;
    }

    const normalizedDefault = this.defaultUsername.trim().toLowerCase();
    const normalizedCurrent = trimmed.toLowerCase();
    const isDefaultProfileAnalysis = Boolean(normalizedDefault) && normalizedCurrent === normalizedDefault;

    if (this.isAnalyzing) return;

    this.isAnalyzing = true;
    this.errorMessage = '';
    this.invalidUsername = false;

    const keepCurrentResult = forceRefresh && this.viewedUsername.toLowerCase() === normalizedCurrent;
    if (!keepCurrentResult) {
      this.analysisReady = false;
      this.result = null;
      this.destroyCharts();
    }

    const request$ = isDefaultProfileAnalysis
      ? this.github.analyzeAndSave(trimmed, forceRefresh)
      : this.github.analyzeProfile(trimmed, forceRefresh);

    request$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.isAnalyzing = false;
          this.applyResult(data, trimmed, isDefaultProfileAnalysis);
        },
        error: (err) => {
          this.isAnalyzing = false;
          this.analysisReady = Boolean(this.result);
          this.invalidUsername = err.status === 404 || err.error?.status === 404;
          this.errorMessage = err.error?.message ?? 'Failed to analyze GitHub profile. Please check the username and try again.';
          this.cdr.detectChanges();
        }
      });
  }

  refreshAnalysis(): void {
    this.analyze(true);
  }

  returnToDefaultProfile(): void {
    if (!this.defaultUsername || this.isAnalyzing) return;
    this.username = this.defaultUsername;
    this.analyze(false);
  }

  toggleEvidenceDrawer(): void {
    this.showEvidenceDrawer = !this.showEvidenceDrawer;
  }

  private applyResult(data: GitHubAnalysisResult, username: string, isDefaultProfileAnalysis: boolean): void {
    this.result = data;
    this.viewedUsername = username;
    this.isTemporaryView = !isDefaultProfileAnalysis;
    this.analysisReady = true;

    this.pendingLangs = this.displayLanguages.length ? this.displayLanguages : null;
    this.pendingActivity = data.repositoryActivity?.length ? data.repositoryActivity : null;

    this.cdr.detectChanges();
    setTimeout(() => {
      this.flushPendingCharts();
    }, 0);
  }

  private flushPendingCharts(): void {
    if (!this.viewReady || !this.analysisReady || !this.result) return;
    if (this.pendingLangs && this.donutCanvasRef?.nativeElement) {
      this.buildDonutChart(this.pendingLangs);
      this.pendingLangs = null;
    }

    if (this.pendingActivity && this.barCanvasRef?.nativeElement) {
      this.buildBarChart(this.pendingActivity);
      this.pendingActivity = null;
    }
  }

  private buildDonutChart(langs: LanguageDistribution[]): void {
    const canvas = this.donutCanvasRef?.nativeElement;
    if (!canvas) return;
    try {
      if (typeof canvas.getContext !== 'function' || !canvas.getContext('2d')) {
        return;
      }
      this.donutChart?.destroy();
      if (!langs.length) return;

      const cfg: ChartConfiguration<'doughnut'> = {
        type: 'doughnut',
        data: {
          labels: langs.map((lang) => lang.language),
          datasets: [{
            data: langs.map((lang) => lang.percentage),
            backgroundColor: langs.map((_, i) => LANG_COLOURS[i % LANG_COLOURS.length]),
            borderColor: '#111827',
            borderWidth: 3,
            hoverOffset: 6
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '68%',
          plugins: {
            legend: { display: false },
            tooltip: {
              titleFont: { family: 'Inter, system-ui, sans-serif', size: 12, weight: 600 },
              bodyFont: { family: 'Inter, system-ui, sans-serif', size: 12 },
              callbacks: {
                label: (c) => ` ${c.label}: ${c.parsed}%`
              }
            }
          }
        }
      };
      this.donutChart = new Chart(canvas, cfg);
    } catch {
      // Gracefully handle environments without full canvas 2D support
    }
  }

  private buildBarChart(activity: RepositoryActivity[]): void {
    const canvas = this.barCanvasRef?.nativeElement;
    if (!canvas) return;
    try {
      if (typeof canvas.getContext !== 'function' || !canvas.getContext('2d')) {
        return;
      }
      this.barChart?.destroy();

      const top = [...(activity || [])].sort((a, b) => (b.commits ?? 0) - (a.commits ?? 0)).slice(0, 7);
      if (!top.length) return;

      const cfg: ChartConfiguration<'bar'> = {
        type: 'bar',
        data: {
          labels: top.map((repo) => repo.repo),
          datasets: [{
            label: 'Commits',
            data: top.map((repo) => repo.commits ?? 0),
            backgroundColor: top.map((_, i) => `${LANG_COLOURS[i % LANG_COLOURS.length]}CC`),
            borderColor: top.map((_, i) => LANG_COLOURS[i % LANG_COLOURS.length]),
            borderWidth: 1,
            borderRadius: 4,
            barThickness: 16
          }]
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              titleFont: { family: 'Inter, system-ui, sans-serif', size: 12, weight: 600 },
              bodyFont: { family: 'Inter, system-ui, sans-serif', size: 12 },
              callbacks: { label: (c) => ` ${c.parsed.x} commits (sampled)` }
            }
          },
          scales: {
            x: {
              beginAtZero: true,
              grid: { color: 'rgba(255,255,255,0.05)' },
              ticks: {
                color: '#94A3B8',
                font: { family: 'Inter, system-ui, sans-serif', size: 12, weight: 500 }
              }
            },
            y: {
              grid: { display: false },
              ticks: {
                color: '#94A3B8',
                font: { family: 'Inter, system-ui, sans-serif', size: 12, weight: 500 },
                callback: function(_val, idx) {
                  const label = this.getLabelForValue(idx);
                  return label.length > 18 ? `${label.slice(0, 17)}...` : label;
                }
              }
            }
          }
        }
      };
      this.barChart = new Chart(canvas, cfg);
    } catch {
      // Gracefully handle environments without full canvas 2D support
    }
  }

  private destroyCharts(): void {
    this.donutChart?.destroy();
    this.barChart?.destroy();
    this.donutChart = null;
    this.barChart = null;
  }

  // ── Authoritative Score & Breakdown ─────────────────────────────

  get healthScoreValue(): number | null {
    if (!this.result) return null;
    if (this.result.scoring && this.result.scoring.score !== undefined) {
      return this.result.scoring.score;
    }
    if (this.result.githubHealthScore !== undefined) {
      return this.result.githubHealthScore;
    }
    if (this.result.activityScore !== undefined) {
      return this.result.activityScore;
    }
    return null;
  }

  get scoreCardColor(): ScoreCardColor {
    const score = this.healthScoreValue;
    if (score === null) return 'purple';
    if (score >= 80) return 'green';
    if (score >= 60) return 'blue';
    if (score >= 40) return 'amber';
    return 'pink';
  }

  get scoreBreakdownList(): DisplayBreakdownItem[] {
    if (!this.result) return [];
    const breakdown = this.result.scoring?.breakdown || {};
    const scores = this.result.scores || {};

    const definitions: Array<{ id: string; label: string; description: string; weight: number; color: ProgressColor }> = [
      {
        id: 'codeQuality',
        label: 'Code Quality',
        description: 'Repo documentation, README cleanliness, and engineering stack depth',
        weight: 24,
        color: 'primary'
      },
      {
        id: 'projectDiversity',
        label: 'Project Diversity',
        description: 'Language distribution balance and tech stack breadth across projects',
        weight: 17,
        color: 'info'
      },
      {
        id: 'contribution',
        label: 'Contribution Signal',
        description: 'Commit depth across top active repositories (sampled contributor history)',
        weight: 18,
        color: 'success'
      },
      {
        id: 'consistency',
        label: 'Consistency',
        description: 'Push frequency and active repository updates over the past 6 months',
        weight: 13,
        color: 'warning'
      },
      {
        id: 'projectImpact',
        label: 'Project Impact',
        description: 'Community adoption, stars, forks, and project visibility',
        weight: 14,
        color: 'primary'
      },
      {
        id: 'profileStrength',
        label: 'Profile Strength',
        description: 'Profile completeness, follower network, and repository volume',
        weight: 14,
        color: 'secondary'
      }
    ];

    return definitions.map(def => {
      const item: ScoreBreakdownItem | undefined = breakdown[def.id];
      let value: number | null = null;
      let contribution: number | null = null;
      let available = false;

      if (item) {
        value = item.value !== null && Number.isFinite(item.value) ? Math.round(item.value) : null;
        contribution = item.contribution !== null && Number.isFinite(item.contribution) ? Number(item.contribution.toFixed(1)) : null;
        available = item.available === true && value !== null;
      } else if (scores[def.id] !== undefined && scores[def.id] !== null) {
        const num = Number(scores[def.id]);
        if (Number.isFinite(num)) {
          value = Math.round(num);
          available = true;
        }
      }

      return {
        id: def.id,
        label: def.label,
        description: def.description,
        weightPct: def.weight,
        value,
        contribution,
        available,
        color: def.color
      };
    });
  }

  // ── Metrics & Evidence ──────────────────────────────────────────

  get evidenceFacts(): ScoreEvidence['facts'] | null {
    return this.result?.scoring?.evidence?.facts || null;
  }

  get originalRepoCount(): number {
    if (this.evidenceFacts?.originalRepoCount !== undefined) {
      return this.evidenceFacts.originalRepoCount;
    }
    return (this.result?.repositories || []).filter(r => !r.fork).length;
  }

  get forkedRepoCount(): number {
    if (this.evidenceFacts?.forkRepoCount !== undefined) {
      return this.evidenceFacts.forkRepoCount;
    }
    return (this.result?.repositories || []).filter(r => r.fork).length;
  }

  get archivedRepoCount(): number {
    if (this.evidenceFacts?.archivedRepoCount !== undefined) {
      return this.evidenceFacts.archivedRepoCount;
    }
    return (this.result?.repositories || []).filter(r => r.archived).length;
  }

  get totalSampledCommits(): number | null {
    if (this.evidenceFacts?.totalCommits !== undefined) {
      return this.evidenceFacts.totalCommits;
    }
    const activity = this.result?.repositoryActivity || [];
    if (!activity.length) return null;
    return activity.reduce((sum, item) => sum + (Number.isFinite(item.commits) ? Number(item.commits) : 0), 0);
  }

  get ruleVersion(): string {
    return this.result?.scoring?.ruleVersion || this.result?.analysisVersion || 'github-health-score-v1';
  }

  get calculationTimestamp(): string {
    const ts = this.result?.scoring?.calculatedAt ||
      this.result?.fetchedAt ||
      this.result?.cache?.cachedAt ||
      this.result?.githubSignals?.analyzedAt;
    return this.formatDateTime(ts);
  }

  get isDefaultProfile(): boolean {
    if (!this.defaultUsername) return false;
    const current = (this.viewedUsername || this.username).trim().toLowerCase();
    return current === this.defaultUsername.trim().toLowerCase();
  }

  get isStale(): boolean {
    return Boolean(
      this.result?.cache?.stale ||
      this.result?.cache?.source === 'stale-cache' ||
      this.result?.rateLimited ||
      (this.result?.warning && this.result.warning.toLowerCase().includes('rate limit'))
    );
  }

  get cacheBadgeVariant(): BadgeVariant {
    if (this.isStale) return 'warning';
    if (this.result?.cache?.source === 'fresh') return 'success';
    if (this.result?.cache?.source === 'frontend-cache') return 'info';
    return 'primary';
  }

  get cacheStatusLabel(): string {
    if (!this.result) return '';
    if (this.isStale) return 'Cached Fallback (Stale)';
    switch (this.result.cache?.source) {
      case 'frontend-cache': return 'Browser Cache';
      case 'cache': return 'Backend Cache';
      case 'fresh': return 'Fresh Analysis';
      default: return this.result.cache?.hit ? 'Cached' : 'Fresh Analysis';
    }
  }

  get scoringWarnings(): string[] {
    const warnings = this.result?.scoring?.warnings || [];
    const map: Record<string, string> = {
      'activity_sampled_repository_history': 'Activity metrics reflect sampled history across the top 5 active repositories.',
      'repository_quality_uses_sampled_signals': 'Repository scores are derived from manifests, docs, and public heuristics.',
      'activity_partial_or_unavailable': 'Commit activity was partially restricted by API rate limits.',
      'repository_metrics_partial': 'Some repository metrics were partially collected.',
      'language_data_unavailable': 'Language byte distribution is temporarily unavailable.',
      'score_unavailable': 'Health score calculation was omitted due to missing core signals.'
    };
    return warnings.map(w => map[w] || w);
  }

  // ── Languages & Technologies ───────────────────────────────────

  get displayLanguages(): LanguageDistribution[] {
    const main = this.result?.mainLanguageDistribution || [];
    return this.sortedLanguages(main.length ? main : (this.result?.languageDistribution || []));
  }

  get supportLanguages(): LanguageDistribution[] {
    return this.sortedLanguages(this.result?.supportLanguageDistribution || []);
  }

  get technologyCategories(): Array<{ category: string; items: TechnologySignal[] }> {
    const categories = this.result?.technologyCategories || {};
    const signals = [
      ...(this.result?.technologies || []),
      ...Object.entries(categories).flatMap(([category, items]) =>
        (items || []).map((item) => ({ ...item, category: item.category || category })))
    ];
    const deduped = new Map<string, TechnologySignal>();
    signals.forEach((item) => {
      const name = String(item?.name || '').trim();
      if (!name) return;
      const key = name.toLowerCase();
      const existing = deduped.get(key);
      if (!existing || Number(item.confidence || 0) > Number(existing.confidence || 0)) {
        deduped.set(key, { ...item, name, category: item.category || 'Other' });
      }
    });

    const grouped = new Map<string, TechnologySignal[]>();
    deduped.forEach((item) => {
      const category = item.category || 'Other';
      grouped.set(category, [...(grouped.get(category) || []), item]);
    });
    return Array.from(grouped.entries())
      .map(([category, items]) => ({
        category,
        items: items.sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0) || a.name.localeCompare(b.name))
      }))
      .sort((a, b) => a.category.localeCompare(b.category));
  }

  get repositoryRows(): Repository[] {
    return [...(this.result?.repositories || [])]
      .sort((a, b) =>
        this.repositoryScore(b) - this.repositoryScore(a) ||
        Number(b.stars || 0) - Number(a.stars || 0) ||
        String(a.name || '').localeCompare(String(b.name || '')));
  }

  // ── Conditionals & UI State ────────────────────────────────────

  get hasNoConfiguredGithub(): boolean {
    return !this.isInitLoading && !this.defaultUsername && !this.analysisReady && !this.isAnalyzing && !this.errorMessage;
  }

  get hasEmptyRepositories(): boolean {
    return this.analysisReady && Boolean(this.result) && (this.result?.repoCount === 0 || !this.result?.repositories?.length);
  }

  get hasLanguageData(): boolean {
    return this.displayLanguages.length > 0;
  }

  get hasActivityData(): boolean {
    return (this.result?.repositoryActivity || []).length > 0;
  }

  get hasTechnologyData(): boolean {
    return this.technologyCategories.length > 0;
  }

  get hasAiContent(): boolean {
    return Boolean(
      this.result?.summary ||
      this.result?.explanation ||
      this.result?.strengths?.length ||
      this.result?.weakAreas?.length ||
      this.result?.recruiterInsights?.proofPoints?.length
    );
  }

  get hasStrengths(): boolean {
    return Boolean(this.result?.strengths?.length);
  }

  get hasWeakAreas(): boolean {
    return Boolean(this.result?.weakAreas?.length);
  }

  get hasRecruiterInsights(): boolean {
    return Boolean(this.result?.recruiterInsights?.proofPoints?.length);
  }

  repositoryScore(repo: Repository): number {
    return Number(repo.qualityScore ?? repo.activityScore ?? 0);
  }

  repositoryTechnologies(repo: Repository): string[] {
    return Array.from(new Set((repo.technologies || []).map((tech) => String(tech || '').trim()).filter(Boolean))).slice(0, 3);
  }

  getLangColour(index: number): string {
    return LANG_COLOURS[index % LANG_COLOURS.length];
  }

  getScoreClass(score: number): string {
    if (score >= 80) return 'score-high';
    if (score >= 50) return 'score-mid';
    return 'score-low';
  }

  getScoreBarWidth(score: number): string {
    return `${Math.min(Math.max(Number(score || 0), 0), 100)}%`;
  }

  formatNumber(value: number | undefined | null): string {
    if (value === null || value === undefined) return 'Unavailable';
    const n = Number(value);
    if (!Number.isFinite(n)) return 'Unavailable';
    if (n >= 1000000) return `${(n / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
    return n.toString();
  }

  formatDateTime(value: string | Date | null | undefined): string {
    if (!value) return 'Not analyzed yet';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Not analyzed yet';
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  private sortedLanguages(languages: LanguageDistribution[]): LanguageDistribution[] {
    return [...languages]
      .filter((item) => Boolean(item?.language) && Number.isFinite(Number(item.percentage)))
      .sort((a, b) => Number(b.percentage) - Number(a.percentage) || a.language.localeCompare(b.language));
  }
}

