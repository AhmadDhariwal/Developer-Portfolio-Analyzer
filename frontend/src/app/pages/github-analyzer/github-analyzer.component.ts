import {
  Component,
  OnInit,
  OnDestroy,
  AfterViewInit,
  ViewChild,
  ElementRef,
  ChangeDetectorRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Chart, ChartConfiguration, registerables } from 'chart.js';
import {
  GithubService,
  GitHubAnalysisResult,
  LanguageDistribution,
  RepositoryActivity,
  Repository,
  TechnologySignal
} from '../../shared/services/github.service';
import { AuthService } from '../../shared/services/auth.service';

Chart.register(...registerables);

const LANG_COLOURS = [
  '#2563EB', '#16A34A', '#F59E0B', '#DC2626', '#7C3AED',
  '#0891B2', '#DB2777', '#65A30D', '#EA580C', '#475569'
];

@Component({
  selector: 'app-github-analyzer',
  standalone: true,
  imports: [CommonModule, FormsModule],
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
  lastAnalyzedLabel = '';
  cacheStatusLabel = '';

  private donutChart: Chart | null = null;
  private barChart: Chart | null = null;
  private viewReady = false;
  private destroyed = false;
  private pendingLangs: LanguageDistribution[] | null = null;
  private pendingActivity: RepositoryActivity[] | null = null;

  constructor(
    private readonly github: GithubService,
    private readonly authService: AuthService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.isInitLoading = true;
    const storedUsername = this.getStoredActiveUsername();
    if (storedUsername) {
      this.applyDefaultUsername(storedUsername);
      this.isInitLoading = false;
      this.analyze(false);
      return;
    }

    this.github.getActiveUsername().subscribe({
      next: (data) => {
        if (this.destroyed) return;
        this.applyDefaultUsername(data.username || '');
        this.isInitLoading = false;
        if (this.username) this.analyze(false);
      },
      error: () => {
        if (this.destroyed) return;
        this.isInitLoading = false;
      }
    });
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

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.flushPendingCharts();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.viewReady = false;
    this.destroyCharts();
  }

  analyze(forceRefresh = false): void {
    const trimmed = this.username.trim().replace(/^@/, '');
    if (!trimmed) return;

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

    request$.subscribe({
      next: (data) => {
        if (this.destroyed) return;
        this.applyResult(data, trimmed, isDefaultProfileAnalysis);
        this.isAnalyzing = false;
      },
      error: (err) => {
        if (this.destroyed) return;
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

  private applyResult(data: GitHubAnalysisResult, username: string, isDefaultProfileAnalysis: boolean): void {
    this.result = data;
    this.viewedUsername = username;
    this.isTemporaryView = !isDefaultProfileAnalysis;
    this.analysisReady = true;
    this.lastAnalyzedLabel = this.formatDateTime(data.cache?.cachedAt || data.githubSignals?.analyzedAt);
    this.cacheStatusLabel = this.getCacheStatusLabel(data);

    this.pendingLangs = this.displayLanguages.length ? this.displayLanguages : null;
    this.pendingActivity = data.repositoryActivity?.length ? data.repositoryActivity : null;
    this.cdr.detectChanges();
    setTimeout(() => {
      if (!this.destroyed) this.flushPendingCharts();
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
    const ctx = this.donutCanvasRef?.nativeElement;
    if (!ctx) return;
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
            callbacks: {
              label: (ctx) => ` ${ctx.label}: ${ctx.parsed}%`
            }
          }
        }
      }
    };
    this.donutChart = new Chart(ctx, cfg);
  }

  private buildBarChart(activity: RepositoryActivity[]): void {
    const ctx = this.barCanvasRef?.nativeElement;
    if (!ctx) return;
    this.barChart?.destroy();

    const top = [...(activity || [])].sort((a, b) => b.commits - a.commits).slice(0, 7);
    if (!top.length) return;
    const cfg: ChartConfiguration<'bar'> = {
      type: 'bar',
      data: {
        labels: top.map((repo) => repo.repo),
        datasets: [{
          label: 'Commits',
          data: top.map((repo) => repo.commits),
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
          tooltip: { callbacks: { label: (ctx) => ` ${ctx.parsed.x} commits` } }
        },
        scales: {
          x: {
            beginAtZero: true,
            grid: { color: 'rgba(255,255,255,0.05)' },
            ticks: { color: '#94A3B8', font: { size: 11 } }
          },
          y: {
            grid: { display: false },
            ticks: {
              color: '#94A3B8',
              font: { size: 11 },
              callback: function(_val, idx) {
                const label = this.getLabelForValue(idx);
                return label.length > 18 ? `${label.slice(0, 17)}...` : label;
              }
            }
          }
        }
      }
    };
    this.barChart = new Chart(ctx, cfg);
  }

  private destroyCharts(): void {
    this.donutChart?.destroy();
    this.barChart?.destroy();
    this.donutChart = null;
    this.barChart = null;
  }

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

  get healthScore(): number {
    return Number(this.result?.githubHealthScore || this.result?.activityScore || 0);
  }

  get hasActivityData(): boolean {
    return (this.result?.repositoryActivity || []).length > 0;
  }

  get hasAiNarrative(): boolean {
    return Boolean(this.result?.summary || this.result?.explanation || this.result?.strengths?.length || this.result?.weakAreas?.length);
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
    const n = Number(value || 0);
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
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  private sortedLanguages(languages: LanguageDistribution[]): LanguageDistribution[] {
    return [...languages]
      .filter((item) => Boolean(item?.language) && Number.isFinite(Number(item.percentage)))
      .sort((a, b) => Number(b.percentage) - Number(a.percentage) || a.language.localeCompare(b.language));
  }

  private getCacheStatusLabel(data: GitHubAnalysisResult): string {
    switch (data.cache?.source) {
      case 'frontend-cache': return 'Browser cache';
      case 'cache': return 'Backend cache';
      case 'stale-cache': return 'Cached fallback';
      case 'fresh': return 'Fresh analysis';
      default: return data.cache?.hit ? 'Cached' : 'Fresh analysis';
    }
  }
}
