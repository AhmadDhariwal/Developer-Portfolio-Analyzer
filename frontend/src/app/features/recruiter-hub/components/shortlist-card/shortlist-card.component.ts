import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-shortlist-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <article class="shortlist-card">
      <div class="shortlist-card__head">
        <div>
          <h3>{{ item?.candidate?.name || item?.candidate?.fullName || 'Candidate' }}</h3>
          <p>{{ item?.job?.title || 'General shortlist' }}</p>
        </div>
        <span class="shortlist-card__status">{{ item?.status || 'shortlisted' }}</span>
      </div>

      <div class="shortlist-card__meta">
        <span>{{ item?.candidate?.stack || 'Generalist' }}</span>
        <span>{{ item?.candidate?.yearsOfExperience || 0 }} yrs</span>
        <span>{{ item?.updatedAt ? (item.updatedAt | date:'MMM d, y') : 'Recently updated' }}</span>
      </div>

      <p class="shortlist-card__notes">{{ item?.notes || 'No notes added yet. Keep the pipeline moving with a quick follow-up.' }}</p>

      <div class="shortlist-card__actions" *ngIf="!hideActions">
        <button type="button" class="shortlist-card__btn" (click)="edit.emit(item)">Advance</button>
        <button type="button" class="shortlist-card__btn shortlist-card__btn--ghost" (click)="remove.emit(item)">Remove</button>
      </div>
    </article>
  `,
  styles: [`
    .shortlist-card{padding:1.05rem;border-radius:22px;background:linear-gradient(180deg,rgba(15,23,42,.94),rgba(15,23,42,.82));border:1px solid rgba(99,102,241,.16);display:flex;flex-direction:column;gap:.85rem;box-shadow:0 24px 44px rgba(2,6,23,.28)}
    .shortlist-card__head,.shortlist-card__actions{display:flex;justify-content:space-between;gap:.75rem;align-items:flex-start;flex-wrap:wrap}
    h3{margin:0;color:#f8fafc;font-size:1rem}
    p{margin:.2rem 0 0;color:#94a3b8;font-size:.84rem}
    .shortlist-card__status{padding:.35rem .7rem;border-radius:999px;background:rgba(79,70,229,.16);color:#c7d2fe;font-size:.73rem;font-weight:700;text-transform:capitalize}
    .shortlist-card__meta{display:flex;flex-wrap:wrap;gap:.5rem}
    .shortlist-card__meta span{padding:.28rem .58rem;border-radius:999px;background:rgba(30,41,59,.86);color:#cbd5e1;font-size:.73rem}
    .shortlist-card__notes{margin:0;color:#cbd5e1;line-height:1.6}
    .shortlist-card__btn{flex:1 1 120px;min-height:42px;border:none;border-radius:12px;background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff;font-weight:700;cursor:pointer}
    .shortlist-card__btn--ghost{background:rgba(30,41,59,.92);color:#e2e8f0}
  `]
})
export class ShortlistCardComponent {
  @Input() item: any;
  @Input() hideActions = false;
  @Output() edit = new EventEmitter<any>();
  @Output() remove = new EventEmitter<any>();
}
