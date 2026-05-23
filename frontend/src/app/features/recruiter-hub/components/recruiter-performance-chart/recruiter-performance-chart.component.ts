import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

type ChartTone = 'indigo' | 'blue' | 'cyan' | 'green' | 'orange' | 'purple';
type ChartMode = 'auto' | 'bars' | 'dual' | 'donut' | 'heatmap' | 'gauge';

@Component({
  selector: 'app-recruiter-performance-chart',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './recruiter-performance-chart.component.html',
  styleUrl: './recruiter-performance-chart.component.css'
})
export class RecruiterPerformanceChartComponent {
  @Input() title = 'Performance';
  @Input() tone: ChartTone = 'indigo';
  @Input() mode: ChartMode = 'auto';
  @Input() trendLabel = '';
  @Input() emptyMessage = 'No data available yet.';
  @Input() items: Array<{ label?: string; date?: string; count?: number; value?: number; supply?: number; demand?: number }> = [];

  get resolvedMode(): ChartMode {
    if (this.mode !== 'auto') return this.mode;
    return this.items.some((item) => this.isDual(item)) ? 'dual' : 'bars';
  }

  get donutItems(): Array<{ label?: string; date?: string; count?: number; value?: number }> {
    return this.items.filter((item) => this.numericValue(item) > 0).slice(0, 8);
  }

  get totalValue(): number {
    return this.donutItems.reduce((sum, item) => sum + this.numericValue(item), 0);
  }

  get donutGradient(): string {
    const items = this.donutItems;
    if (!items.length) return 'conic-gradient(#334155 0 100%)';

    const total = Math.max(this.totalValue, 1);
    let cursor = 0;
    const slices = items.map((item, index) => {
      const share = (this.numericValue(item) / total) * 100;
      const from = cursor;
      cursor += share;
      return `${this.legendColor(index)} ${from}% ${Math.min(cursor, 100)}%`;
    });

    return `conic-gradient(${slices.join(',')})`;
  }

  get gaugeValue(): number {
    return Math.max(0, Math.min(100, this.numericValue(this.items[0] || {})));
  }

  get gaugeLabel(): string {
    return this.items[0]?.label || 'Score';
  }

  get gaugeGradient(): string {
    const value = this.gaugeValue;
    return `conic-gradient(#22c55e 0 ${value}%, rgba(51,65,85,.9) ${value}% 100%)`;
  }

  isDual(item: { supply?: number; demand?: number }): boolean {
    if (this.mode === 'dual') return true;
    return item.supply !== undefined || item.demand !== undefined;
  }

  numericValue(item: { count?: number; value?: number }): number {
    const value = Number(item?.count ?? item?.value ?? 0);
    return Number.isFinite(value) ? value : 0;
  }

  heatCellsFor(item: { count?: number; value?: number; supply?: number; demand?: number }): number[] {
    const value = this.numericValue(item);
    const max = this.maxValue();
    const ratio = max > 0 ? value / max : 0;
    return [0.12, 0.24, 0.38, 0.54, 0.72, 0.94].map((target) => (ratio >= target ? target : 0.08));
  }

  legendColor(index: number): string {
    const palette = ['#60a5fa', '#22d3ee', '#a78bfa', '#4ade80', '#f59e0b', '#f97316', '#f472b6', '#34d399'];
    return palette[index % palette.length];
  }

  widthFor(value: number): number {
    const max = this.maxValue();
    const ratio = max > 0 ? (Number(value || 0) / max) : 0;
    return Math.max(8, Math.round(Math.max(0, ratio) * 100));
  }

  private maxValue(): number {
    const values = this.items
      .flatMap((item) => [
        this.numericValue(item),
        Number(item?.supply ?? 0),
        Number(item?.demand ?? 0)
      ])
      .filter((item) => Number.isFinite(item) && item >= 0);
    return Math.max(...values, 1);
  }
}
