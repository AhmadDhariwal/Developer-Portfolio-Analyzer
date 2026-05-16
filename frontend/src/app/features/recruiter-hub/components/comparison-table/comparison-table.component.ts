import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-comparison-table',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="comparison-wrap" *ngIf="items.length">
      <table>
        <tr>
          <th>Metric</th>
          <th *ngFor="let item of items">{{ item.name }}</th>
        </tr>
        <tr><td>Stack</td><td *ngFor="let item of items">{{ item.stack }}</td></tr>
        <tr><td>Experience</td><td *ngFor="let item of items">{{ item.experience }}</td></tr>
        <tr><td>Readiness</td><td *ngFor="let item of items">{{ item.readinessScore }}</td></tr>
        <tr><td>GitHub</td><td *ngFor="let item of items">{{ item.githubScore }}</td></tr>
        <tr><td>Resume</td><td *ngFor="let item of items">{{ item.resumeScore }}</td></tr>
        <tr><td>Project Quality</td><td *ngFor="let item of items">{{ item.projectQuality }}</td></tr>
        <tr><td>Recommendation</td><td *ngFor="let item of items">{{ item.recommendation }}</td></tr>
      </table>
    </div>
  `,
  styles: [`
    .comparison-wrap{overflow:auto;border-radius:16px;border:1px solid rgba(51,65,85,.72);background:rgba(15,23,42,.82)}
    table{width:100%;border-collapse:collapse;color:#e2e8f0} th,td{padding:.85rem 1rem;border-bottom:1px solid rgba(51,65,85,.5);text-align:left} th{background:rgba(30,41,59,.6);font-size:.8rem}
    td:first-child{color:#94a3b8;font-weight:700}
  `]
})
export class ComparisonTableComponent {
  @Input() items: any[] = [];
}
