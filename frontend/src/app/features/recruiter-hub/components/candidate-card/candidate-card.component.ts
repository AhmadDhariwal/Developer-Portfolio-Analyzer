import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-candidate-card',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="candidate-card">
      <div class="candidate-card__header">
        <div>
          <h3>{{ candidate?.name || candidate?.fullName }}</h3>
          <p>{{ candidate?.headline }}</p>
        </div>
        <span class="badge">{{ candidate?.stack }}</span>
      </div>
      <div class="candidate-card__meta">
        <span>{{ candidate?.yearsOfExperience }} yrs</span>
        <span>{{ candidate?.location || 'Remote' }}</span>
        <span>{{ candidate?.availability }}</span>
      </div>
      <div class="candidate-card__scores">
        <span>Readiness {{ candidate?.readinessScore }}</span>
        <span>GitHub {{ candidate?.githubScore }}</span>
        <span>Resume {{ candidate?.resumeScore }}</span>
      </div>
      <div class="candidate-card__skills">
        <span *ngFor="let skill of (candidate?.skills || []).slice(0,6)">{{ skill }}</span>
      </div>
      <div class="candidate-card__actions">
        <button type="button" (click)="view.emit(candidate)">View</button>
        <button type="button" (click)="shortlist.emit(candidate)">Shortlist</button>
        <button type="button" (click)="compare.emit(candidate)">Compare</button>
      </div>
    </div>
  `,
  styles: [`
    .candidate-card{padding:1rem;border-radius:16px;background:rgba(15,23,42,.82);border:1px solid rgba(51,65,85,.72);display:flex;flex-direction:column;gap:.85rem}
    .candidate-card__header{display:flex;justify-content:space-between;gap:.75rem}
    h3{margin:0;color:#f8fafc;font-size:1rem} p{margin:.2rem 0 0;color:#94a3b8;font-size:.86rem}
    .badge{align-self:flex-start;padding:.3rem .65rem;border-radius:999px;background:rgba(99,102,241,.16);color:#c7d2fe;font-size:.72rem;font-weight:700}
    .candidate-card__meta,.candidate-card__scores{display:flex;flex-wrap:wrap;gap:.5rem;color:#cbd5e1;font-size:.8rem}
    .candidate-card__skills{display:flex;flex-wrap:wrap;gap:.45rem}
    .candidate-card__skills span{padding:.25rem .55rem;border-radius:999px;background:rgba(30,41,59,.86);color:#cbd5e1;font-size:.75rem}
    .candidate-card__actions{display:flex;gap:.6rem;flex-wrap:wrap}
    button{border:none;border-radius:10px;padding:.65rem .85rem;background:#312e81;color:#fff;font-weight:700;cursor:pointer}
  `]
})
export class CandidateCardComponent {
  @Input() candidate: any;
  @Output() view = new EventEmitter<any>();
  @Output() shortlist = new EventEmitter<any>();
  @Output() compare = new EventEmitter<any>();
}
