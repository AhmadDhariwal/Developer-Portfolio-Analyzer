import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-job-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <article class="job-card">
      <div class="job-card__head">
        <div>
          <h3>{{ job?.title || 'Untitled job' }}</h3>
          <p>{{ job?.location || 'Remote' }} | {{ job?.employmentType || 'full-time' }}</p>
        </div>
        <span class="job-card__status" [class.job-card__status--draft]="job?.status === 'draft'" [class.job-card__status--closed]="job?.status === 'closed'">{{ job?.status || 'open' }}</span>
      </div>

      <p class="job-card__desc">{{ job?.description || 'No description available.' }}</p>

      <div class="job-card__meta">
        <div><label>Stack</label><strong>{{ job?.stack || 'Generalist' }}</strong></div>
        <div><label>Experience</label><strong>{{ job?.minExperienceYears || 0 }}+ yrs</strong></div>
        <div><label>Required</label><strong>{{ (job?.requiredSkills || []).length }}</strong></div>
      </div>

      <div class="job-card__skills">
        <span *ngFor="let skill of (job?.requiredSkills || []).slice(0, 6)">{{ skill }}</span>
      </div>

      <div class="job-card__actions" *ngIf="!hideActions">
        <button type="button" class="job-card__btn job-card__btn--ghost" (click)="view.emit(job)">View</button>
        <button type="button" class="job-card__btn" (click)="edit.emit(job)">Edit</button>
        <button type="button" class="job-card__btn job-card__btn--accent" (click)="archive.emit(job)">
          {{ job?.status === 'closed' ? 'Archived' : 'Archive' }}
        </button>
        <button type="button" class="job-card__btn job-card__btn--danger" (click)="remove.emit(job)">Delete</button>
      </div>
    </article>
  `,
  styles: [`
    .job-card{padding:1.1rem;border-radius:22px;background:linear-gradient(180deg,rgba(15,23,42,.94),rgba(15,23,42,.82));border:1px solid rgba(99,102,241,.16);display:flex;flex-direction:column;gap:.9rem;box-shadow:0 24px 44px rgba(2,6,23,.28)}
    .job-card__head,.job-card__actions{display:flex;justify-content:space-between;gap:.75rem;align-items:flex-start;flex-wrap:wrap}
    h3{margin:0;color:#f8fafc;font-size:1rem}
    p{margin:.2rem 0 0;color:#94a3b8;font-size:.84rem}
    .job-card__status{padding:.34rem .7rem;border-radius:999px;background:rgba(34,197,94,.16);color:#86efac;font-size:.73rem;font-weight:700;text-transform:capitalize}
    .job-card__status--draft{background:rgba(250,204,21,.16);color:#fde68a}
    .job-card__status--closed{background:rgba(248,113,113,.16);color:#fecaca}
    .job-card__desc{margin:0;color:#cbd5e1;line-height:1.6}
    .job-card__meta{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.7rem}
    .job-card__meta div{padding:.75rem;border-radius:16px;background:rgba(15,23,42,.84);border:1px solid rgba(51,65,85,.72)}
    .job-card__meta label{display:block;font-size:.68rem;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8;margin-bottom:.35rem}
    .job-card__meta strong{color:#f8fafc}
    .job-card__skills,.job-card__actions{display:flex;flex-wrap:wrap;gap:.5rem}
    .job-card__skills span{padding:.28rem .58rem;border-radius:999px;background:rgba(79,70,229,.16);color:#c7d2fe;font-size:.73rem}
    .job-card__btn{flex:1 1 110px;min-height:42px;border:none;border-radius:12px;background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff;font-weight:700;cursor:pointer}
    .job-card__btn--ghost{background:rgba(30,41,59,.92);color:#e2e8f0}
    .job-card__btn--accent{background:linear-gradient(135deg,#0f766e,#0284c7)}
    .job-card__btn--danger{background:rgba(127,29,29,.9)}
  `]
})
export class JobCardComponent {
  @Input() job: any;
  @Input() hideActions = false;
  @Output() view = new EventEmitter<any>();
  @Output() edit = new EventEmitter<any>();
  @Output() archive = new EventEmitter<any>();
  @Output() remove = new EventEmitter<any>();
}
