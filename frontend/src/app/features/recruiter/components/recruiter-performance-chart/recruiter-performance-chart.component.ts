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
import { Chart, ChartConfiguration, ChartType, registerables } from 'chart.js';
import { ThemeService } from '../../../../shared/services/theme.service';

Chart.register(...registerables);

export type ChartTone = 'indigo' | 'blue' | 'cyan' | 'green' | 'orange' | 'purple';
export type ChartMode =
  | 'auto'
  | 'bars'
  | 'column'
  | 'area'
  | 'line'
  | 'dual'
  | 'donut'
  | 'radar'
  | 'heatmap'
  | 'gauge'
  | 'funnel';

export interface PerformanceChartItem {
  label?: string;
  date?: string;
  count?: number | null;
  value?: number | null;
  supply?: number | null;
  demand?: number | null;
}

export interface PerformanceChartDataset {
  label: string;
  values: Array<number | null>;
  tone?: ChartTone;
}

@Component({
  selector: 'app-recruiter-performance-chart',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './recruiter-performance-chart.component.html',
  styleUrl: './recruiter-performance-chart.component.scss',
})
export class RecruiterPerformanceChartComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() title = 'Performance';
  @Input() subtitle = '';
  @Input() tone: ChartTone = 'indigo';
  @Input() mode: ChartMode = 'auto';
  @Input() trendLabel = '';
  @Input() emptyMessage = 'No data available yet.';
  @Input() height = 240;
  @Input() valueSuffix = '';
  @Input() seriesLabels: [string, string] = ['Supply', 'Demand'];
  @Input() labels: string[] = [];
  @Input() datasets: PerformanceChartDataset[] = [];
  @Input() items: PerformanceChartItem[] = [];

  @ViewChild('chartCanvas') chartCanvasRef?: ElementRef<HTMLCanvasElement>;

  private chart: Chart | null = null;
  private viewReady = false;
  private renderQueued = false;
  private readonly themeService = inject(ThemeService);

  constructor() {
    effect(() => {
      this.themeService.activeTheme();
      this.scheduleChart();
    });
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.scheduleChart();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (
      changes['items'] ||
      changes['datasets'] ||
      changes['labels'] ||
      changes['mode'] ||
      changes['tone']
    ) {
      this.scheduleChart();
    }
  }

  ngOnDestroy(): void {
    this.viewReady = false;
    this.destroyChart();
  }

  get resolvedMode(): ChartMode {
    if (this.mode !== 'auto') return this.mode;
    if (this.datasets.length > 0 && this.labels.length > 0) return 'column';
    return this.items.some((item) => this.isDualItem(item)) ? 'dual' : 'bars';
  }

  get isCanvasMode(): boolean {
    return !['heatmap', 'gauge', 'funnel'].includes(this.resolvedMode);
  }

  get hasMultiSeries(): boolean {
    return (
      this.datasets.length > 0 &&
      this.labels.length > 0 &&
      this.datasets.some((ds) => ds.values.some((v) => v !== null && v !== undefined))
    );
  }

  get hasRenderableData(): boolean {
    if (this.hasMultiSeries) return true;
    if (this.resolvedMode === 'donut') return this.donutItems.length > 0;
    if (this.resolvedMode === 'gauge') return this.items.length > 0;
    return this.items.length > 0;
  }

  get donutItems(): PerformanceChartItem[] {
    return this.items.filter((item) => this.numericValue(item) > 0).slice(0, 8);
  }

  get totalValue(): number {
    return this.donutItems.reduce((sum, item) => sum + this.numericValue(item), 0);
  }

  get donutGradient(): string {
    const items = this.donutItems;
    const total = this.totalValue;
    if (!items.length || total <= 0) {
      return 'conic-gradient(var(--border-color, #e2e8f0) 0% 100%)';
    }
    let cursor = 0;
    const stops = items.map((item, idx) => {
      const start = cursor;
      const pct = (this.numericValue(item) / total) * 100;
      cursor = idx === items.length - 1 ? 100 : start + pct;
      return `${this.paletteColor(idx)} ${start.toFixed(1)}% ${cursor.toFixed(1)}%`;
    });
    return `conic-gradient(${stops.join(', ')})`;
  }

  get gaugeValue(): number {
    return Math.max(0, Math.min(100, Math.round(this.numericValue(this.items[0] || {}))));
  }

  get gaugeGradient(): string {
    return `conic-gradient(var(--color-primary, #4f46e5) 0% ${this.gaugeValue}%, var(--surface-tertiary, #e2e8f0) ${this.gaugeValue}% 100%)`;
  }

  get gaugeLabel(): string {
    return this.items[0]?.label || 'Score';
  }

  readonly gaugeRadius = 56;
  get gaugeCircumference(): number {
    return 2 * Math.PI * this.gaugeRadius;
  }

  get gaugeDashOffset(): number {
    return this.gaugeCircumference - (this.gaugeValue / 100) * this.gaugeCircumference;
  }

  get funnelBaseline(): number {
    const first = this.numericValue(this.items[0] || {});
    return Math.max(first, ...this.items.map((item) => this.numericValue(item)), 1);
  }

  funnelPercent(item: PerformanceChartItem): number {
    return Math.round((this.numericValue(item) / this.funnelBaseline) * 100);
  }

  isDualItem(item: PerformanceChartItem): boolean {
    if (this.mode === 'dual') return true;
    return item.supply !== undefined || item.demand !== undefined;
  }

  numericValue(item: PerformanceChartItem): number {
    const raw = item?.count ?? item?.value ?? 0;
    const value = Number(raw);
    return Number.isFinite(value) ? value : 0;
  }

  heatCellsFor(item: PerformanceChartItem): number[] {
    const value = this.numericValue(item);
    const max = this.maxItemValue();
    const ratio = max > 0 ? value / max : 0;
    return [0.12, 0.25, 0.42, 0.58, 0.76, 0.95].map((threshold) =>
      ratio >= threshold ? 0.25 + threshold * 0.75 : 0.1,
    );
  }

  paletteColor(index: number): string {
    const colors = [
      '#4f46e5',
      '#10b981',
      '#0284c7',
      '#f59e0b',
      '#6366f1',
      '#ec4899',
      '#14b8a6',
      '#f97316',
    ];
    return colors[index % colors.length];
  }

  donutShare(item: PerformanceChartItem): number {
    const total = Math.max(this.totalValue, 1);
    return Math.round((this.numericValue(item) / total) * 100);
  }

  trackByItem(index: number, item: PerformanceChartItem): string {
    return String(item?.label || item?.date || index);
  }

  trackByIndex(index: number): number {
    return index;
  }

  private scheduleChart(): void {
    if (!this.viewReady || this.renderQueued) return;
    this.renderQueued = true;
    queueMicrotask(() => {
      this.renderQueued = false;
      if (!this.viewReady) return;
      this.destroyChart();
      if (this.isCanvasMode && this.hasRenderableData) {
        this.buildChart();
      }
    });
  }

  private destroyChart(): void {
    this.chart?.destroy();
    this.chart = null;
  }

  private resolveToneHex(style: CSSStyleDeclaration, tone: ChartTone): string {
    const map: Record<ChartTone, { varName: string; fallback: string }> = {
      indigo: { varName: '--color-primary', fallback: '#4f46e5' },
      purple: { varName: '--color-secondary', fallback: '#6366f1' },
      blue: { varName: '--color-info', fallback: '#0284c7' },
      cyan: { varName: '--color-info', fallback: '#0ea5e9' },
      green: { varName: '--color-success', fallback: '#10b981' },
      orange: { varName: '--color-warning', fallback: '#f59e0b' },
    };
    const spec = map[tone] || map.indigo;
    return style.getPropertyValue(spec.varName).trim() || spec.fallback;
  }

  private buildChart(): void {
    const canvas = this.chartCanvasRef?.nativeElement;
    if (!canvas) return;
    try {
      if (typeof canvas.getContext !== 'function' || !canvas.getContext('2d')) {
        return;
      }

      const style = getComputedStyle(canvas);
      const font = style.fontFamily || "'Manrope', 'Inter', sans-serif";
      const gridColor = style.getPropertyValue('--chart-grid').trim() || '#f1f5f9';
      const tickColor = style.getPropertyValue('--chart-tick').trim() || '#526075';
      const labelColor = style.getPropertyValue('--chart-label').trim() || '#475569';
      const donutBorder = style.getPropertyValue('--chart-donut-border').trim() || '#ffffff';
      const surfaceCard = style.getPropertyValue('--surface-card').trim() || '#ffffff';
      const textPrimary = style.getPropertyValue('--text-primary').trim() || '#0f172a';
      const primaryColor = this.resolveToneHex(style, this.tone);

      const mode = this.resolvedMode;

      if (mode === 'donut') {
        const list = this.donutItems;
        if (!list.length) return;
        const cfg: ChartConfiguration<'doughnut'> = {
          type: 'doughnut',
          data: {
            labels: list.map((item) => item.label || item.date || '-'),
            datasets: [
              {
                data: list.map((item) => this.numericValue(item)),
                backgroundColor: list.map((_, idx) => this.paletteColor(idx)),
                borderColor: donutBorder,
                borderWidth: 2,
                hoverOffset: 4,
              },
            ],
          },
          options: {
            animation: false,
            responsive: true,
            maintainAspectRatio: false,
            cutout: '66%',
            plugins: {
              legend: { display: false },
              tooltip: {
                backgroundColor: surfaceCard,
                titleColor: textPrimary,
                bodyColor: labelColor,
                borderColor: gridColor,
                borderWidth: 1,
                titleFont: { family: font, size: 12, weight: 600 },
                bodyFont: { family: font, size: 12 },
              },
            },
          },
        };
        this.chart = new Chart(canvas, cfg);
        return;
      }

      if (this.hasMultiSeries) {
        const chartType: ChartType = mode === 'radar' ? 'radar' : 'bar';
        const cfg: ChartConfiguration = {
          type: chartType,
          data: {
            labels: this.labels,
            datasets: this.datasets.map((ds, idx) => {
              const color = ds.tone
                ? this.resolveToneHex(style, ds.tone)
                : this.paletteColor(idx);
              return {
                label: ds.label,
                data: ds.values.map((v) => (v === null || v === undefined ? null : Number(v))),
                backgroundColor: mode === 'radar' ? `${color}33` : color,
                borderColor: color,
                borderWidth: mode === 'radar' ? 2 : 0,
                borderRadius: mode === 'radar' ? 0 : 4,
                maxBarThickness: 28,
              };
            }),
          },
          options: {
            animation: false,
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                display: true,
                position: 'top',
                align: 'end',
                labels: {
                  color: labelColor,
                  boxWidth: 10,
                  boxHeight: 10,
                  usePointStyle: true,
                  pointStyle: 'circle',
                  font: { family: font, size: 12, weight: 500 },
                },
              },
              tooltip: {
                backgroundColor: surfaceCard,
                titleColor: textPrimary,
                bodyColor: labelColor,
                borderColor: gridColor,
                borderWidth: 1,
                callbacks: {
                  label: (ctx) => {
                    const val = ctx.parsed?.y ?? ctx.parsed?.r;
                    return val === null || val === undefined
                      ? ` ${ctx.dataset.label}: Unavailable`
                      : ` ${ctx.dataset.label}: ${val}${this.valueSuffix}`;
                  },
                },
              },
            },
            scales:
              mode === 'radar'
                ? {
                    r: {
                      min: 0,
                      max: 100,
                      grid: { color: gridColor },
                      angleLines: { color: gridColor },
                      pointLabels: { color: tickColor, font: { family: font, size: 11 } },
                      ticks: { display: false },
                    },
                  }
                : {
                    x: {
                      grid: { display: false },
                      ticks: { color: tickColor, font: { family: font, size: 11.5 } },
                    },
                    y: {
                      beginAtZero: true,
                      suggestedMax: 100,
                      grid: { color: gridColor },
                      ticks: { color: tickColor, font: { family: font, size: 11.5 } },
                    },
                  },
          },
        };
        this.chart = new Chart(canvas, cfg);
        return;
      }

      const itemLabels = this.items.map((item) => item.label || item.date || '-');

      if (mode === 'dual') {
        const supplyColor = style.getPropertyValue('--color-success').trim() || '#10b981';
        const demandColor = style.getPropertyValue('--color-primary').trim() || '#4f46e5';
        const cfg: ChartConfiguration<'bar'> = {
          type: 'bar',
          data: {
            labels: itemLabels,
            datasets: [
              {
                label: this.seriesLabels[0] || 'Supply',
                data: this.items.map((item) => Number(item.supply ?? 0)),
                backgroundColor: supplyColor,
                borderRadius: 4,
                maxBarThickness: 18,
              },
              {
                label: this.seriesLabels[1] || 'Demand',
                data: this.items.map((item) => Number(item.demand ?? 0)),
                backgroundColor: demandColor,
                borderRadius: 4,
                maxBarThickness: 18,
              },
            ],
          },
          options: {
            animation: false,
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                display: true,
                position: 'top',
                align: 'end',
                labels: {
                  color: labelColor,
                  boxWidth: 10,
                  boxHeight: 10,
                  usePointStyle: true,
                  pointStyle: 'circle',
                  font: { family: font, size: 11.5, weight: 500 },
                },
              },
            },
            scales: {
              x: {
                grid: { display: false },
                ticks: { color: tickColor, font: { family: font, size: 11.5 } },
              },
              y: {
                beginAtZero: true,
                grid: { color: gridColor },
                ticks: { precision: 0, color: tickColor, font: { family: font, size: 11.5 } },
              },
            },
          },
        };
        this.chart = new Chart(canvas, cfg);
        return;
      }

      if (mode === 'area' || mode === 'line') {
        const cfg: ChartConfiguration<'line'> = {
          type: 'line',
          data: {
            labels: itemLabels,
            datasets: [
              {
                label: this.title,
                data: this.items.map((item) => this.numericValue(item)),
                borderColor: primaryColor,
                backgroundColor: mode === 'area' ? `${primaryColor}22` : 'transparent',
                fill: mode === 'area',
                tension: 0.32,
                pointRadius: 3.5,
                pointHoverRadius: 5,
                pointBackgroundColor: primaryColor,
                borderWidth: 2,
              },
            ],
          },
          options: {
            animation: false,
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
            },
            scales: {
              x: {
                grid: { display: false },
                ticks: { color: tickColor, font: { family: font, size: 11.5 } },
              },
              y: {
                beginAtZero: true,
                grid: { color: gridColor },
                ticks: { precision: 0, color: tickColor, font: { family: font, size: 11.5 } },
              },
            },
          },
        };
        this.chart = new Chart(canvas, cfg);
        return;
      }

      // Default 'bars' (horizontal) or 'column' (vertical)
      const isHorizontal = mode === 'bars';
      const cfg: ChartConfiguration<'bar'> = {
        type: 'bar',
        data: {
          labels: itemLabels,
          datasets: [
            {
              label: this.title,
              data: this.items.map((item) => this.numericValue(item)),
              backgroundColor: primaryColor,
              borderRadius: 4,
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
              grid: { color: isHorizontal ? gridColor : 'transparent', display: isHorizontal },
              ticks: {
                precision: isHorizontal ? 0 : undefined,
                color: tickColor,
                font: { family: font, size: 11.5 },
              },
            },
            y: {
              beginAtZero: !isHorizontal,
              grid: { color: isHorizontal ? 'transparent' : gridColor, display: !isHorizontal },
              ticks: {
                precision: !isHorizontal ? 0 : undefined,
                color: tickColor,
                font: { family: font, size: 11.5 },
                callback: function (value, idx) {
                  if (!isHorizontal) return String(value);
                  const lbl = this.getLabelForValue(idx);
                  return lbl.length > 20 ? `${lbl.slice(0, 19)}...` : lbl;
                },
              },
            },
          },
        },
      };
      this.chart = new Chart(canvas, cfg);
    } catch {
      // Gracefully handle headless environments without full canvas 2D support.
    }
  }

  private maxItemValue(): number {
    const values = this.items
      .flatMap((item) => [
        this.numericValue(item),
        Number(item?.supply ?? 0),
        Number(item?.demand ?? 0),
      ])
      .filter((val) => Number.isFinite(val) && val >= 0);
    return Math.max(...values, 1);
  }
}
