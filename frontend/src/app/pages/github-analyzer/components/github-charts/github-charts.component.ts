import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  effect,
  ElementRef,
  inject,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { Chart, ChartConfiguration, registerables } from 'chart.js';
import { UiBadgeComponent } from '../../../../shared/components';
import {
  GitHubAnalysisResult,
  LanguageDistribution,
  RepositoryActivity,
} from '../../../../shared/services/github.service';
import { ThemeService } from '../../../../shared/services/theme.service';
import { GithubPresentation, LANG_COLOURS } from '../../github-presentation';
Chart.register(...registerables);
@Component({
  selector: 'app-github-charts',
  standalone: true,
  imports: [CommonModule, UiBadgeComponent],
  templateUrl: './github-charts.component.html',
  styleUrl: './github-charts.component.scss',
})
export class GithubChartsComponent
  extends GithubPresentation
  implements AfterViewInit, OnChanges, OnDestroy
{
  @Input({ required: true }) hasLanguageData!: boolean;
  @Input({ required: true }) hasActivityData!: boolean;
  @Input({ required: true }) result!: GitHubAnalysisResult;
  @Input({ required: true }) displayLanguages!: LanguageDistribution[];
  @Input({ required: true }) supportLanguages!: LanguageDistribution[];

  @ViewChild('donutCanvas') donutCanvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('barCanvas') barCanvasRef!: ElementRef<HTMLCanvasElement>;
  private donutChart: Chart | null = null;
  private barChart: Chart | null = null;
  private viewReady = false;
  private chartRenderQueued = false;
  private readonly themeService = inject(ThemeService);
  constructor() {
    super();
    effect(() => {
      this.themeService.activeTheme();
      this.scheduleCharts();
    });
  }
  ngAfterViewInit(): void {
    this.viewReady = true;
    this.scheduleCharts();
  }
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['result']) this.scheduleCharts();
  }
  ngOnDestroy(): void {
    this.viewReady = false;
    this.destroyCharts();
  }
  private scheduleCharts(): void {
    if (!this.viewReady || this.chartRenderQueued) return;
    this.chartRenderQueued = true;
    queueMicrotask(() => {
      this.chartRenderQueued = false;
      if (!this.viewReady) return;
      this.destroyCharts();
      this.buildDonutChart(this.displayLanguages);
      this.buildBarChart(this.result.repositoryActivity);
    });
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

      const style = getComputedStyle(canvas);
      const chartFont = style.fontFamily;

      const cfg: ChartConfiguration<'doughnut'> = {
        type: 'doughnut',
        data: {
          labels: langs.map((lang) => lang.language),
          datasets: [
            {
              data: langs.map((lang) => lang.percentage),
              backgroundColor: langs.map((_, i) => LANG_COLOURS[i % LANG_COLOURS.length]),
              borderColor: style.getPropertyValue('--surface-card').trim(),
              borderWidth: 2,
              hoverOffset: 6,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '68%',
          plugins: {
            legend: { display: false },
            tooltip: {
              titleFont: { family: chartFont, size: 12, weight: 600 },
              bodyFont: { family: chartFont, size: 12 },
              callbacks: {
                label: (c) => ` ${c.label}: ${c.parsed}%`,
              },
            },
          },
        },
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

      const top = [...(activity || [])]
        .sort((a, b) => (b.commits ?? 0) - (a.commits ?? 0))
        .slice(0, 7);
      if (!top.length) return;

      const style = getComputedStyle(canvas);
      const chartFont = style.fontFamily;
      const primary = style.getPropertyValue('--color-primary').trim();
      const muted = style.getPropertyValue('--text-muted').trim();
      const border = style.getPropertyValue('--border-color').trim();

      const cfg: ChartConfiguration<'bar'> = {
        type: 'bar',
        data: {
          labels: top.map((repo) => repo.repo),
          datasets: [
            {
              label: 'Commits',
              data: top.map((repo) => repo.commits ?? 0),
              backgroundColor: primary,
              borderColor: primary,
              borderWidth: 1,
              borderRadius: 4,
              barThickness: 16,
            },
          ],
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              titleFont: { family: chartFont, size: 12, weight: 600 },
              bodyFont: { family: chartFont, size: 12 },
              callbacks: { label: (c) => ` ${c.parsed.x} commits (sampled)` },
            },
          },
          scales: {
            x: {
              beginAtZero: true,
              grid: { color: border },
              ticks: {
                color: muted,
                font: { family: chartFont, size: 12, weight: 500 },
              },
            },
            y: {
              grid: { display: false },
              ticks: {
                color: muted,
                font: { family: chartFont, size: 12, weight: 500 },
                callback: function (_val, idx) {
                  const label = this.getLabelForValue(idx);
                  return label.length > 18 ? `${label.slice(0, 17)}...` : label;
                },
              },
            },
          },
        },
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
}
