import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-job-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="job-card">
      <div class="job-card__head">
        <div>
          <h3>{{ job?.title }}</h3>
          <p>{{ job?.location || 'Remote' }} • {{ job?.employmentType }}</p>
        </div>
        <span>{{ job?.status }}</span>
      </div>
      <p class="job-card__desc">{{ job?.description }}</p>
      <div class="job-card__skills">
        <span *ngFor="let skill of (job?.requiredSkills || []).slice(0,6)">{{ skill }}</span>
      </div>
      <div class="job-card__actions">
        <button type="button" (click)="view.emit(job)">View</button>
        <button type="button" (click)="edit.emit(job)">Edit</button>
        <button type="button" (click)="archive.emit(job)">Archive</button>
      </div>
    </div>
  `,
  styles: [`
    .job-card{padding:1rem;border-radius:16px;background:rgba(15,23,42,.82);border:1px solid rgba(51,65,85,.72);display:flex;flex-direction:column;gap:.8rem}
    .job-card__head{display:flex;justify-content:space-between;gap:.75rem}
    .job-card__head h3{margin:0;color:#f8fafc}.job-card__head p{margin:.2rem 0 0;color:#94a3b8;font-size:.85rem}
    .job-card__head span{align-self:flex-start;padding:.25rem .6rem;border-radius:999px;background:rgba(99,102,241,.15);color:#c7d2fe;font-size:.73rem;text-transform:capitalize}
    .job-card__desc{margin:0;color:#cbd5e1;font-size:.86rem;line-height:1.5}
    .job-card__skills,.job-card__actions{display:flex;flex-wrap:wrap;gap:.5rem}
    .job-card__skills span{padding:.25rem .55rem;border-radius:999px;background:rgba(30,41,59,.86);font-size:.74rem;color:#cbd5e1}
    button{border:none;border-radius:10px;padding:.65rem .85rem;background:#312e81;color:#fff;font-weight:700;cursor:pointer}
  `]
})
export class JobCardComponent {
  @Input() job: any;
  @Output() view = new EventEmitter<any>();
  @Output() edit = new EventEmitter<any>();
  @Output() archive = new EventEmitter<any>();
}
