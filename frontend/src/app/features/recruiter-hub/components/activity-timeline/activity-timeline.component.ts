import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-activity-timeline',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="timeline">
      <div class="timeline__item" *ngFor="let item of items">
        <div class="timeline__dot"></div>
        <div class="timeline__content">
          <strong>{{ labelFor(item.action) }}</strong>
          <p>{{ item.candidate?.name || item.job?.title || item.route || 'Recruiter activity' }}</p>
          <small>{{ item.timestamp | date:'medium' }}</small>
        </div>
      </div>
    </section>
  `,
  styles: [`
    .timeline{display:flex;flex-direction:column;gap:.8rem}
    .timeline__item{display:flex;gap:.85rem;align-items:flex-start;padding:1rem;border-radius:18px;background:linear-gradient(180deg,rgba(15,23,42,.94),rgba(15,23,42,.82));border:1px solid rgba(99,102,241,.16);box-shadow:0 18px 34px rgba(2,6,23,.24)}
    .timeline__dot{width:10px;height:10px;border-radius:50%;background:linear-gradient(135deg,#7c3aed,#38bdf8);margin-top:.4rem;box-shadow:0 0 0 6px rgba(99,102,241,.12)}
    strong{color:#f8fafc}
    p,small{margin:.2rem 0 0;color:#94a3b8}
  `]
})
export class ActivityTimelineComponent {
  @Input() items: any[] = [];

  labelFor(action: string): string {
    const value = String(action || '').replace(/RECRUITER_/g, '').replaceAll('_', ' ').trim();
    if (!value) return 'Activity';
    return value.toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
  }
}
