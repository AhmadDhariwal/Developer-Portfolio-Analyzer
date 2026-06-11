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
  isInitLoading = true;
  isTemporaryView = false;
  result: GitHubAnalysisResult | null = null;
  lastAnalyzedLabel = '';
  cacheStatusLabel = '';

  private donutChart: Chart | null = null;
  private barChart: Chart | null = null;
  private viewReady = false;
  private pendingLangs: LanguageDistribution[] | null = null;
  private pendingActivity: RepositoryActivity[] | null = null;
  private activeRequestKey = '';

  constructor(
    private readonly github: GithubService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.isInitLoading = true;
    this.github.getActiveUsername().subscribe({
      next: (data) => {
        this.defaultUsername = data.username || '';
        this.username = this.defaultUsername;
        this.viewedUsername = this.defaultUsername;
        this.isTemporaryView = false;
        this.isInitLoading = false;
        if (this.username) this.analyze(false);
      },
      error: () => {
        this.isInitLoading = false;
      }
    });
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.flushPendingCharts();
  }

  ngOnDestroy(): void {
    this.destroyCharts();
  }

  analyze(forceRefresh = false): void {
    const trimmed = this.username.trim().replace(/^@/, '');
    if (!trimmed) return;

    const normalizedDefault = this.defaultUsername.trim().toLowerCase();
    const normalizedCurrent = trimmed.toLowerCase();
    const isDefaultProfileAnalysis = Boolean(normalizedDefault) && normalizedCurrent === normalizedDefault;
    const mode: 'public' | 'save' = isDefaultProfileAnalysis ? 'save' : 'public';
    const requestKey = `${mode}:${normalizedCurrent}:${forceRefresh ? 'refresh' : 'normal'}`;

    if (this.isAnalyzing && this.activeRequestKey === requestKey) return;

    const cached = !forceRefresh ? this.github.getCachedAnalysis(trimmed, mode) : null;
    if (cached) {
      this.applyResult(cached, trimmed, isDefaultProfileAnalysis);
    }

    this.isAnalyzing = true;
    this.activeRequestKey = requestKey;
    this.errorMessage = '';
    if (!cached) {
      this.analysisReady = false;
      this.result = null;
      this.destroyCharts();
    }

    const request$ = isDefaultProfileAnalysis
      ? this.github.analyzeAndSave(trimmed, forceRefresh)
      : this.github.analyzeProfile(trimmed, forceRefresh);

    request$.subscribe({
      next: (data) => {
        this.applyResult(data, trimmed, isDefaultProfileAnalysis);
        this.isAnalyzing = false;
        this.activeRequestKey = '';
      },
      error: (err) => {
        this.isAnalyzing = false;
        this.activeRequestKey = '';
        this.analysisReady = Boolean(this.result);
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
    this.lastAnalyzedLabel = this.formatDateTime(data.cache?.cachedAt || data.githubSignals?.analyzedAt || new Date().toISOString());
    this.cacheStatusLabel = data.cache?.hit
      ? data.cache.source === 'stale-cache' ? 'Cached fallback' : 'Cached'
      : 'Fresh';

    this.pendingLangs = this.displayLanguages;
    this.pendingActivity = data.repositoryActivity ?? [];
    this.cdr.detectChanges();
    setTimeout(() => this.flushPendingCharts(), 0);
  }

  private flushPendingCharts(): void {
    if (!this.viewReady || !this.analysisReady || !this.result) return;
    if (!this.donutCanvasRef?.nativeElement || !this.barCanvasRef?.nativeElement) return;

    if (this.pendingLangs) {
      this.buildDonutChart(this.pendingLangs);
      this.pendingLangs = null;
    }

    if (this.pendingActivity) {
      this.buildBarChart(this.pendingActivity);
      this.pendingActivity = null;
    }
  }

  private buildDonutChart(langs: LanguageDistribution[]): void {
    const ctx = this.donutCanvasRef?.nativeElement;
    if (!ctx) return;
    this.donutChart?.destroy();

    const safeLangs = langs.length ? langs : [{ language: 'No data', percentage: 100 }];
    const cfg: ChartConfiguration<'doughnut'> = {
      type: 'doughnut',
      data: {
        labels: safeLangs.map((lang) => lang.language),
        datasets: [{
          data: safeLangs.map((lang) => lang.percentage),
          backgroundColor: safeLangs.map((_, i) => LANG_COLOURS[i % LANG_COLOURS.length]),
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
    const safe = top.length ? top : [{ repo: 'No commit data', commits: 0 }];
    const cfg: ChartConfiguration<'bar'> = {
      type: 'bar',
      data: {
        labels: safe.map((repo) => repo.repo),
        datasets: [{
          label: 'Commits',
          data: safe.map((repo) => repo.commits),
          backgroundColor: safe.map((_, i) => `${LANG_COLOURS[i % LANG_COLOURS.length]}CC`),
          borderColor: safe.map((_, i) => LANG_COLOURS[i % LANG_COLOURS.length]),
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
    return main.length ? main : (this.result?.languageDistribution || []);
  }

  get supportLanguages(): LanguageDistribution[] {
    return this.result?.supportLanguageDistribution || [];
  }

  get topTechnologies(): TechnologySignal[] {
    return (this.result?.technologies || []).slice(0, 16);
  }

  get technologyCategories(): Array<{ category: string; items: TechnologySignal[] }> {
    const categories = this.result?.technologyCategories || {};
    return Object.keys(categories)
      .map((category) => ({ category, items: (categories[category] || []).slice(0, 6) }))
      .filter((group) => group.items.length > 0);
  }

  get repositoryRows(): Repository[] {
    return [...(this.result?.repositories || [])]
      .sort((a, b) => Number(b.qualityScore || b.activityScore || 0) - Number(a.qualityScore || a.activityScore || 0));
  }

  get healthScore(): number {
    return Number(this.result?.githubHealthScore || this.result?.activityScore || 0);
  }

  get hasChartData(): boolean {
    return this.displayLanguages.length > 0 || (this.result?.repositoryActivity || []).length > 0;
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
}
