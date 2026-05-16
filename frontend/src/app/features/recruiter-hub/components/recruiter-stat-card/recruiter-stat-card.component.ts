import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-recruiter-stat-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="stat-card">
      <div class="stat-card__label">{{ label }}</div>
      <div class="stat-card__value">{{ value }}</div>
      <div class="stat-card__hint" *ngIf="hint">{{ hint }}</div>
    </div>
  `,
  styles: [`
    .stat-card{padding:1rem 1.1rem;border-radius:16px;background:rgba(15,23,42,.82);border:1px solid rgba(51,65,85,.7);box-shadow:0 20px 40px rgba(2,6,23,.22)}
    .stat-card__label{font-size:.76rem;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em}
    .stat-card__value{margin-top:.45rem;font-size:1.6rem;font-weight:800;color:#f8fafc}
    .stat-card__hint{margin-top:.4rem;font-size:.82rem;color:#818cf8}
  `]
})
export class RecruiterStatCardComponent {
  @Input() label = '';
  @Input() value: string | number = '';
  @Input() hint = '';
}
