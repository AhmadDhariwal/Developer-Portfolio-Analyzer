import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-recruiter-performance-chart',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="chart-card">
      <h3>{{ title }}</h3>
      <div class="chart-row" *ngFor="let item of items">
        <span>{{ item.label || item.date }}</span>
        <div class="bar"><i [style.width.%]="item.count || item.value || 0"></i></div>
        <strong>{{ item.count || item.value || 0 }}</strong>
      </div>
    </div>
  `,
  styles: [`
    .chart-card{padding:1rem;border-radius:16px;background:rgba(15,23,42,.82);border:1px solid rgba(51,65,85,.72)}
    h3{margin:0 0 .85rem;color:#f8fafc}.chart-row{display:grid;grid-template-columns:minmax(90px,140px) 1fr 40px;gap:.75rem;align-items:center;margin-bottom:.65rem;color:#cbd5e1;font-size:.82rem}
    .bar{height:10px;border-radius:999px;background:rgba(30,41,59,.85);overflow:hidden}.bar i{display:block;height:100%;background:linear-gradient(90deg,#6366f1,#22c55e)}
  `]
})
export class RecruiterPerformanceChartComponent {
  @Input() title = 'Performance';
  @Input() items: Array<{ label?: string; date?: string; count?: number; value?: number }> = [];
}
