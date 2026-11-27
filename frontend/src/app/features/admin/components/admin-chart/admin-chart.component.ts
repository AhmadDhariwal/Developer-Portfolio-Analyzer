import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild,
  effect,
  inject,
} from '@angular/core';
import { Chart, ChartConfiguration, ChartDataset, registerables } from 'chart.js';
import { ThemeService } from '../../../../shared/services/theme.service';

Chart.register(...registerables);

export type AdminChartMode = 'area' | 'bar' | 'horizontal-bar' | 'grouped-bar' | 'donut' | 'combo';
export type AdminChartTone = 'indigo' | 'emerald' | 'sky' | 'amber' | 'slate';

export interface AdminChartSeries {
  label: string;
  values: number[];
  tone?: AdminChartTone;
  type?: 'bar' | 'line';
}

export interface AdminChartPoint {
  label: string;
  value: number;
  secondaryValue?: number;
}

@Component({
  selector: 'app-admin-chart',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './admin-chart.component.html',
  styleUrl: './admin-chart.component.scss',
})
export class AdminChartComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() title = '';
  @Input() subtitle = '';
  @Input() badgeText = '';
  @Input() mode: AdminChartMode = 'bar';
  @Input() tone: AdminChartTone = 'indigo';
  @Input() height = 230;
  @Input() labels: string[] = [];
  @Input() items: AdminChartPoint[] = [];
  @Input() series: AdminChartSeries[] = [];
  @Input() valueSuffix = '';
  @Input() suggestedMax = 0;
  @Input() centerLabel = 'Total';
  @Input() emptyMessage = 'No data available for the selected filters yet.';
  @Input() bare = false;

  @ViewChild('canvas') canvasRef?: ElementRef<HTMLCanvasElement>;

  private chart: Chart | null = null;
  private viewReady = false;
  private renderQueued = false;
  private readonly themeService = inject(ThemeService);

  private static readonly PALETTE = ['#4f46e5', '#10b981', '#0ea5e9', '#f59e0b', '#64748b'];

  constructor() {
    effect(() => {
      this.themeService.activeTheme();
      this.scheduleRender();
    });
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.scheduleRender();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (
      changes['mode'] ||
      changes['tone'] ||
      changes['labels'] ||
      changes['items'] ||
      changes['series'] ||
      changes['valueSuffix'] ||
      changes['suggestedMax']
    ) {
      this.scheduleRender();
    }
  }

  ngOnDestroy(): void {
    this.viewReady = false;
    this.destroyChart();
  }

  get donutItems(): AdminChartPoint[] {
    return this.items.filter((item) => Number(item.value || 0) > 0).slice(0, 6);
  }

  get donutTotal(): number {
    return this.donutItems.reduce((sum, item) => sum + Number(item.value || 0), 0);
  }

  get hasData(): boolean {
    if (this.mode === 'donut') {
      return this.donutItems.length > 0;
    }
    if (this.series.length > 0 && this.labels.length > 0) {
      return this.series.some((s) => s.values.length > 0);
    }
    return this.items.length > 0 && this.items.some((item) => Number.isFinite(Number(item.value)));
  }

  colorAt(index: number): string {
    return AdminChartComponent.PALETTE[index % AdminChartComponent.PALETTE.length];
  }

  donutShare(item: AdminChartPoint): number {
    const total = this.donutTotal;
    return total > 0 ? Math.round((Number(item.value || 0) / total) * 100) : 0;
  }

  private scheduleRender(): void {
    if (!this.viewReady || this.renderQueued) return;
    this.renderQueued = true;
    queueMicrotask(() => {
      this.renderQueued = false;
      if (!this.viewReady) return;
      this.destroyChart();
      if (this.hasData) {
        this.renderChart();
      }
    });
  }

  private destroyChart(): void {
    this.chart?.destroy();
    this.chart = null;
  }

  private toneColor(tone: AdminChartTone | undefined, style: CSSStyleDeclaration): string {
    const map: Record<AdminChartTone, { cssVar: string; fallback: string }> = {
      indigo: { cssVar: '--color-primary', fallback: '#4f46e5' },
      emerald: { cssVar: '--color-success', fallback: '#10b981' },
      sky: { cssVar: '--color-info', fallback: '#0ea5e9' },
      amber: { cssVar: '--color-warning', fallback: '#f59e0b' },
      slate: { cssVar: '--text-muted', fallback: '#64748b' },
    };
    const entry = map[tone || 'indigo'] || map.indigo;
    return style.getPropertyValue(entry.cssVar).trim() || entry.fallback;
  }

  private renderChart(): void {
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas || typeof canvas.getContext !== 'function') return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    try {
      const style = getComputedStyle(document.documentElement);
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      const font = style.fontFamily || "'Manrope', 'Segoe UI', sans-serif";
      const gridColor = isDark ? 'rgba(148, 163, 184, 0.14)' : 'rgba(203, 213, 225, 0.55)';
      const tickColor = style.getPropertyValue('--chart-tick').trim() || '#64748b';
      const labelColor = style.getPropertyValue('--chart-label').trim() || '#475569';
      const donutBorder = style.getPropertyValue('--surface-card').trim() || '#ffffff';
      const tooltipBg = isDark ? '#1e293b' : '#0f172a';
      const tooltipBorder = isDark ? 'rgba(148, 163, 184, 0.28)' : 'rgba(255, 255, 255, 0.12)';
      const primaryColor = this.toneColor(this.tone, style);

      const commonTooltip = {
        backgroundColor: tooltipBg,
        titleColor: '#f8fafc',
        bodyColor: '#e2e8f0',
        borderColor: tooltipBorder,
        borderWidth: 1,
        padding: 10,
        cornerRadius: 8,
        titleFont: { family: font, size: 12, weight: 600 },
        bodyFont: { family: font, size: 12 },
      };

      if (this.mode === 'donut') {
        const list = this.donutItems;
        const cfg: ChartConfiguration<'doughnut'> = {
          type: 'doughnut',
          data: {
            labels: list.map((item) => item.label),
            datasets: [
              {
                data: list.map((item) => Number(item.value || 0)),
                backgroundColor: list.map((_, idx) => this.colorAt(idx)),
                borderColor: donutBorder,
                borderWidth: 2,
                borderRadius: 4,
                spacing: 2,
                hoverOffset: 4,
              },
            ],
          },
          options: {
            animation: false,
            responsive: true,
            maintainAspectRatio: false,
            cutout: '75%',
            plugins: {
              legend: { display: false },
              tooltip: {
                ...commonTooltip,
                callbacks: {
                  label: (context) => {
                    const value = Number(context.parsed || 0);
                    return ` ${context.label}: ${value}${this.valueSuffix}`;
                  },
                },
              },
            },
          },
        };
        this.chart = new Chart(canvas, cfg);
        return;
      }

      if (this.mode === 'area') {
        const areaLabels =
          this.labels.length > 0 ? this.labels : this.items.map((item) => item.label);
        const areaValues =
          this.series.length > 0
            ? this.series[0].values
            : this.items.map((item) => Number(item.value || 0));

        const gradient = ctx.createLinearGradient(0, 0, 0, this.height);
        gradient.addColorStop(0, isDark ? 'rgba(99, 102, 241, 0.28)' : 'rgba(79, 70, 229, 0.2)');
        gradient.addColorStop(1, 'rgba(99, 102, 241, 0)');

        const datasets: ChartDataset<'line'>[] =
          this.series.length > 1
            ? this.series.map((s, idx) => {
                const c = s.tone ? this.toneColor(s.tone, style) : this.colorAt(idx);
                return {
                  label: s.label,
                  data: s.values,
                  borderColor: c,
                  backgroundColor: idx === 0 ? gradient : 'transparent',
                  fill: idx === 0,
                  tension: 0.36,
                  borderWidth: 2.5,
                  pointRadius: 3,
                  pointHoverRadius: 5,
                  pointBackgroundColor: c,
                  pointBorderColor: donutBorder,
                  pointBorderWidth: 1.5,
                };
              })
            : [
                {
                  label: this.series[0]?.label || this.title || 'Trend',
                  data: areaValues,
                  borderColor: primaryColor,
                  backgroundColor: gradient,
                  fill: true,
                  tension: 0.36,
                  borderWidth: 2.5,
                  pointRadius: 3.5,
                  pointHoverRadius: 5,
                  pointBackgroundColor: primaryColor,
                  pointBorderColor: donutBorder,
                  pointBorderWidth: 2,
                },
              ];

        const cfg: ChartConfiguration<'line'> = {
          type: 'line',
          data: { labels: areaLabels, datasets },
          options: {
            animation: false,
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
              legend: {
                display: this.series.length > 1,
                position: 'top',
                align: 'end',
                labels: {
                  color: labelColor,
                  usePointStyle: true,
                  pointStyle: 'circle',
                  boxWidth: 8,
                  boxHeight: 8,
                  font: { family: font, size: 11.5, weight: 500 },
                },
              },
              tooltip: commonTooltip,
            },
            scales: {
              x: {
                grid: { display: false },
                border: { display: false },
                ticks: { color: tickColor, font: { family: font, size: 11 } },
              },
              y: {
                beginAtZero: true,
                suggestedMax: this.suggestedMax > 0 ? this.suggestedMax : undefined,
                border: { display: false },
                grid: { color: gridColor },
                ticks: { precision: 0, color: tickColor, font: { family: font, size: 11 } },
              },
            },
          },
        };
        this.chart = new Chart(canvas, cfg);
        return;
      }

      if (this.mode === 'grouped-bar' || this.mode === 'combo') {
        const multiLabels =
          this.labels.length > 0 ? this.labels : this.items.map((item) => item.label);
        const datasets = this.series.map((s, idx) => {
          const color = s.tone ? this.toneColor(s.tone, style) : this.colorAt(idx);
          if (s.type === 'line') {
            return {
              type: 'line' as const,
              label: s.label,
              data: s.values,
              borderColor: color,
              backgroundColor: 'transparent',
              tension: 0.35,
              borderWidth: 2.2,
              pointRadius: 3,
              pointHoverRadius: 5,
              pointBackgroundColor: color,
            };
          }
          return {
            type: 'bar' as const,
            label: s.label,
            data: s.values,
            backgroundColor: color,
            borderRadius: 6,
            borderSkipped: false as const,
            maxBarThickness: 26,
          };
        });

        const cfg: ChartConfiguration<'bar' | 'line'> = {
          type: 'bar',
          data: { labels: multiLabels, datasets },
          options: {
            animation: false,
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
              legend: {
                display: true,
                position: 'top',
                align: 'end',
                labels: {
                  color: labelColor,
                  usePointStyle: true,
                  pointStyle: 'circle',
                  boxWidth: 8,
                  boxHeight: 8,
                  font: { family: font, size: 11.5, weight: 500 },
                },
              },
              tooltip: {
                ...commonTooltip,
                callbacks: {
                  label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.y}${this.valueSuffix}`,
                },
              },
            },
            scales: {
              x: {
                grid: { display: false },
                border: { display: false },
                ticks: { color: tickColor, font: { family: font, size: 11 } },
              },
              y: {
                beginAtZero: true,
                suggestedMax: this.suggestedMax > 0 ? this.suggestedMax : undefined,
                border: { display: false },
                grid: { color: gridColor },
                ticks: { precision: 0, color: tickColor, font: { family: font, size: 11 } },
              },
            },
          },
        };
        this.chart = new Chart(canvas, cfg);
        return;
      }

      const isHorizontal = this.mode === 'horizontal-bar';
      const barLabels = this.labels.length > 0 ? this.labels : this.items.map((item) => item.label);
      const barValues =
        this.series.length > 0
          ? this.series[0].values
          : this.items.map((item) => Number(item.value || 0));

      const cfg: ChartConfiguration<'bar'> = {
        type: 'bar',
        data: {
          labels: barLabels,
          datasets: [
            {
              label: this.series[0]?.label || this.title || 'Count',
              data: barValues,
              backgroundColor: primaryColor,
              borderRadius: 6,
              borderSkipped: false,
              maxBarThickness: isHorizontal ? 16 : 30,
            },
          ],
        },
        options: {
          indexAxis: isHorizontal ? 'y' : 'x',
          animation: false,
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              ...commonTooltip,
              callbacks: {
                label: (ctx) => {
                  const val = isHorizontal ? ctx.parsed.x : ctx.parsed.y;
                  return ` ${val}${this.valueSuffix}`;
                },
              },
            },
          },
          scales: {
            x: {
              beginAtZero: true,
              ...(isHorizontal && this.suggestedMax > 0 ? { suggestedMax: this.suggestedMax } : {}),
              border: { display: false },
              grid: { color: isHorizontal ? gridColor : 'transparent', display: isHorizontal },
              ticks: {
                precision: isHorizontal ? 0 : undefined,
                color: tickColor,
                font: { family: font, size: 11 },
              },
            },
            y: {
              beginAtZero: !isHorizontal,
              ...(!isHorizontal
                ? {
                    suggestedMax:
                      this.suggestedMax > 0
                        ? this.suggestedMax
                        : Math.max(4, ...barValues.map((v) => Number(v || 0))),
                  }
                : {}),
              border: { display: false },
              grid: { color: isHorizontal ? 'transparent' : gridColor, display: !isHorizontal },
              ticks: {
                precision: !isHorizontal ? 0 : undefined,
                color: tickColor,
                font: { family: font, size: 11 },
                callback: function (val, idx) {
                  if (!isHorizontal) return String(val);
                  const lbl = this.getLabelForValue(idx);
                  return lbl.length > 22 ? `${lbl.slice(0, 21)}...` : lbl;
                },
              },
            },
          },
        },
      };
      this.chart = new Chart(canvas, cfg);
    } catch {
      // Safe fallback when headless test runners mock 2D canvas without full Chart.js drawing
    }
  }
}
