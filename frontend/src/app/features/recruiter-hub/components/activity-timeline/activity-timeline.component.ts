import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-activity-timeline',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="timeline">
      <div class="timeline__item" *ngFor="let item of items">
        <div class="timeline__dot"></div>
        <div class="timeline__content">
          <strong>{{ item.action }}</strong>
          <p>{{ item.candidate?.name || item.job?.title || item.route }}</p>
          <small>{{ item.timestamp | date:'medium' }}</small>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .timeline{display:flex;flex-direction:column;gap:.8rem}
    .timeline__item{display:flex;gap:.8rem;align-items:flex-start;padding:.9rem;border-radius:14px;background:rgba(15,23,42,.82);border:1px solid rgba(51,65,85,.7)}
    .timeline__dot{width:10px;height:10px;border-radius:50%;background:#6366f1;margin-top:.35rem}
    strong{color:#f8fafc} p,small{margin:.2rem 0 0;color:#94a3b8}
  `]
})
export class ActivityTimelineComponent {
  @Input() items: any[] = [];
}
