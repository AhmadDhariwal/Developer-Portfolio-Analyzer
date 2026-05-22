import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-comparison-table',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="comparison-wrap" *ngIf="items.length">
      <table>
        <thead>
          <tr>
            <th>Metric</th>
            <th *ngFor="let item of items">{{ item.name }}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Stack</td>
            <td *ngFor="let item of items">{{ item.stack || 'Generalist' }}</td>
          </tr>
          <tr>
            <td>Experience</td>
            <td *ngFor="let item of items" [class.is-best]="isBest('experience', item.experience)">{{ item.experience || 0 }} yrs</td>
          </tr>
          <tr>
            <td>Readiness</td>
            <td *ngFor="let item of items" [class.is-best]="isBest('readinessScore', item.readinessScore)">{{ item.readinessScore || 0 }}</td>
          </tr>
          <tr>
            <td>GitHub</td>
            <td *ngFor="let item of items" [class.is-best]="isBest('githubScore', item.githubScore)">{{ item.githubScore || 0 }}</td>
          </tr>
          <tr>
            <td>Resume</td>
            <td *ngFor="let item of items" [class.is-best]="isBest('resumeScore', item.resumeScore)">{{ item.resumeScore || 0 }}</td>
          </tr>
          <tr>
            <td>Project Quality</td>
            <td *ngFor="let item of items" [class.is-best]="isBest('projectQuality', item.projectQuality)">{{ item.projectQuality || 0 }}</td>
          </tr>
          <tr *ngIf="hasMatchRow">
            <td>Job Match</td>
            <td *ngFor="let item of items" [class.is-best]="isBest('matchScore', item.match?.matchScore)">
              {{ item.match?.matchScore ?? '-' }}
            </td>
          </tr>
          <tr>
            <td>Recommendation</td>
            <td *ngFor="let item of items">{{ item.recommendation || '-' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  `,
  styles: [`
    .comparison-wrap{overflow:auto;border-radius:22px;border:1px solid rgba(99,102,241,.16);background:linear-gradient(180deg,rgba(15,23,42,.94),rgba(15,23,42,.82));box-shadow:0 24px 44px rgba(2,6,23,.28)}
    table{width:100%;border-collapse:collapse;color:#e2e8f0;min-width:680px}
    th,td{padding:1rem;border-bottom:1px solid rgba(51,65,85,.56);text-align:left;vertical-align:top}
    thead th{position:sticky;top:0;background:rgba(15,23,42,.98);font-size:.76rem;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8;z-index:1}
    tbody td:first-child{color:#cbd5e1;font-weight:700;min-width:150px}
    .is-best{color:#86efac;font-weight:800}
  `]
})
export class ComparisonTableComponent {
  @Input() items: any[] = [];

  get hasMatchRow(): boolean {
    return this.items.some((item) => item?.match?.matchScore !== undefined && item?.match?.matchScore !== null);
  }

  isBest(key: string, value: number | null | undefined): boolean {
    if (value === undefined || value === null) return false;
    const values = this.items
      .map((item) => key === 'matchScore' ? Number(item?.match?.matchScore || 0) : Number(item?.[key] || 0))
      .filter((item) => Number.isFinite(item));
    if (!values.length) return false;
    return Number(value) === Math.max(...values);
  }
}
