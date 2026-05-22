import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-recruiter-stat-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <article class="stat-card">
      <div class="stat-card__label">{{ label }}</div>
      <div class="stat-card__value">{{ value }}</div>
      <div class="stat-card__hint" *ngIf="hint">{{ hint }}</div>
    </article>
  `,
  styles: [`
    .stat-card{padding:1rem 1.05rem;border-radius:22px;background:linear-gradient(180deg,rgba(15,23,42,.94),rgba(15,23,42,.82));border:1px solid rgba(99,102,241,.16);box-shadow:0 24px 44px rgba(2,6,23,.28)}
    .stat-card__label{font-size:.72rem;color:#94a3b8;text-transform:uppercase;letter-spacing:.08em}
    .stat-card__value{margin-top:.5rem;font-size:1.7rem;font-weight:800;color:#f8fafc;line-height:1.1}
    .stat-card__hint{margin-top:.45rem;font-size:.82rem;color:#c7d2fe}
  `]
})
export class RecruiterStatCardComponent {
  @Input() label = '';
  @Input() value: string | number = '';
  @Input() hint = '';
}
