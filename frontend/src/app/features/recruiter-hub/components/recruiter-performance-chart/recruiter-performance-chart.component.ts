import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-recruiter-performance-chart',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="chart-card">
      <h3>{{ title }}</h3>

      <ng-container *ngIf="items.length; else emptyBlock">
        <div class="chart-row" *ngFor="let item of items">
          <span class="chart-row__label">{{ item.label || item.date }}</span>

          <ng-container *ngIf="hasDualSeries(item); else singleSeries">
            <div class="chart-row__dual">
              <div class="bar bar--supply"><i [style.width.%]="widthFor(item.supply || 0)"></i></div>
              <div class="bar bar--demand"><i [style.width.%]="widthFor(item.demand || 0)"></i></div>
            </div>
            <strong class="chart-row__value">{{ item.supply || 0 }} / {{ item.demand || 0 }}</strong>
          </ng-container>

          <ng-template #singleSeries>
            <div class="bar"><i [style.width.%]="widthFor(item.count ?? item.value ?? 0)"></i></div>
            <strong class="chart-row__value">{{ item.count ?? item.value ?? 0 }}</strong>
          </ng-template>
        </div>
      </ng-container>

      <ng-template #emptyBlock>
        <p class="chart-card__empty">No data available yet.</p>
      </ng-template>
    </section>
  `,
  styles: [`
    .chart-card{padding:1rem 1.05rem;border-radius:22px;background:linear-gradient(180deg,rgba(15,23,42,.94),rgba(15,23,42,.82));border:1px solid rgba(99,102,241,.16);box-shadow:0 24px 44px rgba(2,6,23,.28)}
    h3{margin:0 0 .9rem;color:#f8fafc;font-size:1rem}
    .chart-row{display:grid;grid-template-columns:minmax(92px,132px) 1fr minmax(48px,74px);gap:.75rem;align-items:center;margin-bottom:.7rem;color:#cbd5e1;font-size:.82rem}
    .chart-row__label{color:#cbd5e1}
    .chart-row__dual{display:grid;gap:.35rem}
    .bar{height:10px;border-radius:999px;background:rgba(30,41,59,.9);overflow:hidden}
    .bar i{display:block;height:100%;background:linear-gradient(90deg,#7c3aed,#38bdf8)}
    .bar--demand i{background:linear-gradient(90deg,#0ea5e9,#22c55e)}
    .chart-row__value{text-align:right;color:#f8fafc}
    .chart-card__empty{margin:0;color:#94a3b8}
  `]
})
export class RecruiterPerformanceChartComponent {
  @Input() title = 'Performance';
  @Input() items: Array<{ label?: string; date?: string; count?: number; value?: number; supply?: number; demand?: number }> = [];

  hasDualSeries(item: { supply?: number; demand?: number }): boolean {
    return item.supply !== undefined || item.demand !== undefined;
  }

  widthFor(value: number): number {
    const values = this.items.flatMap((item) => [
      Number(item.count ?? item.value ?? 0),
      Number(item.supply ?? 0),
      Number(item.demand ?? 0)
    ]).filter((item) => Number.isFinite(item) && item >= 0);
    const max = Math.max(...values, 1);
    return Math.max(8, Math.round((Number(value || 0) / max) * 100));
  }
}
