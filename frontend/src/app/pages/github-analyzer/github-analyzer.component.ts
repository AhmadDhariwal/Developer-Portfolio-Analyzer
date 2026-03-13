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
  Repository
} from '../../shared/services/github.service';

Chart.register(...registerables);

// Colour palette for language chart segments and table badges
const LANG_COLOURS = [
  '#6366F1', '#8B5CF6', '#22C55E', '#F59E0B', '#3B82F6',
  '#EC4899', '#14B8A6', '#F97316', '#EF4444', '#06B6D4'
];

@Component({
  selector: 'app-github-analyzer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './github-analyzer.component.html',
  styleUrl: './github-analyzer.component.scss'
})
export class GithubAnalyzerComponent implements OnInit, AfterViewInit, OnDestroy {

  @ViewChild('donutCanvas')  donutCanvasRef!:  ElementRef<HTMLCanvasElement>;
  @ViewChild('barCanvas')    barCanvasRef!:    ElementRef<HTMLCanvasElement>;

  username      = '';
  isAnalyzing   = false;
  analysisReady = false;
  errorMessage  = '';
  isInitLoading = true;
  result: GitHubAnalysisResult | null = null;

  private donutChart: Chart | null = null;
  private barChart:   Chart | null = null;
  private viewReady = false;
  private pendingLangs: LanguageDistribution[] | null = null;
  private pendingActivity: RepositoryActivity[] | null = null;

  constructor(
    private readonly github: GithubService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    // On component load, fetch the active username (last searched or signup default)
    this.isInitLoading = true;
    this.github.getActiveUsername().subscribe({
      next: (data) => {
        this.username = data.username;
        this.isInitLoading = false;
        // Auto-analyze with the active username
        if (this.username) {
          this.analyze();
        }
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
    this.donutChart?.destroy();
    this.barChart?.destroy();
  }

  // ── Main trigger ────────────────────────────────────────────────────────────
  analyze(): void {
    const trimmed = this.username.trim();
    if (!trimmed || this.isAnalyzing) return;

    this.isAnalyzing   = true;
    this.analysisReady = false;
    this.errorMessage  = '';
    this.result        = null;
    this.destroyCharts();

    // Use analyzeAndSave (private endpoint) to persist results + update lastSearchedGithub
    this.github.analyzeAndSave(trimmed).subscribe({
      next: (data) => {
        this.result = data;
        this.isAnalyzing = false;
        this.analysisReady = true;

        // Queue chart data and flush only when canvases are guaranteed present
        this.pendingLangs = data.languageDistribution ?? [];
        this.pendingActivity = data.repositoryActivity ?? [];

        this.cdr.detectChanges();
        setTimeout(() => this.flushPendingCharts(), 0);
      },
      error: (err) => {
        this.isAnalyzing = false;
        this.analysisReady = false;
        this.errorMessage = err.error?.message ?? 'Failed to analyze GitHub profile. Please check the username and try again.';
        this.cdr.detectChanges();
      }
    });
  }

  // ── Chart builders ──────────────────────────────────────────────────────────
  private buildCharts(): void {
    if (!this.result) return;
    this.buildDonutChart(this.result.languageDistribution);
    this.buildBarChart(this.result.repositoryActivity);
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

    this.cdr.detectChanges();
  }

  private buildDonutChart(langs: LanguageDistribution[]): void {
    const ctx = this.donutCanvasRef?.nativeElement;
    if (!ctx) return;
    this.donutChart?.destroy();

    const cfg: ChartConfiguration<'doughnut'> = {
      type: 'doughnut',
      data: {
        labels: langs.map(l => l.language),
        datasets: [{
          data:            langs.map(l => l.percentage),
          backgroundColor: langs.map((_, i) => LANG_COLOURS[i % LANG_COLOURS.length]),
          borderColor:     '#0B0F19',
          borderWidth:     3,
          hoverOffset:     8
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
              label: ctx => ` ${ctx.label}: ${ctx.parsed}%`
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

    // Show top 7 repos sorted by commits
    const top = [...activity].sort((a, b) => b.commits - a.commits).slice(0, 7);

    const cfg: ChartConfiguration<'bar'> = {
      type: 'bar',
      data: {
        labels: top.map(r => r.repo),
        datasets: [{
          label:           'Commits',
          data:            top.map(r => r.commits),
          backgroundColor: top.map((_, i) => LANG_COLOURS[i % LANG_COLOURS.length] + 'CC'),
          borderColor:     top.map((_, i) => LANG_COLOURS[i % LANG_COLOURS.length]),
          borderWidth:     1,
          borderRadius:    4,
          barThickness:    16
        }]
      },
      options: {
        indexAxis: 'y',          // horizontal bars (matches screenshot)
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: { label: ctx => ` ${ctx.parsed.x} commits` }
          }
        },
        scales: {
          x: {
            grid:  { color: 'rgba(255,255,255,0.05)' },
            ticks: { color: '#94A3B8', font: { size: 11 } }
          },
          y: {
            grid:  { display: false },
            ticks: {
              color: '#94A3B8',
              font:  { size: 11 },
              callback: function(val, idx) {
                const label = this.getLabelForValue(idx);
                return label.length > 18 ? label.slice(0, 17) + '…' : label;
              }
            }
          }
        }
      }
    };
    this.barChart = new Chart(ctx, cfg);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────
  private destroyCharts(): void {
    this.donutChart?.destroy();
    this.barChart?.destroy();
    this.donutChart = null;
    this.barChart   = null;
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
    return Math.min(score, 100) + '%';
  }

  formatNumber(n: number): string {
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    return n.toString();
  }
}

