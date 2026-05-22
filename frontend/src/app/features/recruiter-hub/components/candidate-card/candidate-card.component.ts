import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-candidate-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <article class="candidate-card" [class.candidate-card--selected]="selected">
      <div class="candidate-card__header">
        <div class="candidate-card__identity">
          <div class="candidate-card__avatar">{{ initial }}</div>
          <div>
            <h3>{{ candidate?.name || candidate?.fullName || 'Candidate' }}</h3>
            <p>{{ candidate?.headline || candidate?.stack || 'Developer profile' }}</p>
          </div>
        </div>
        <div class="candidate-card__score">
          <strong>{{ candidate?.readinessScore || candidate?.score || 0 }}</strong>
          <span>Overall</span>
        </div>
      </div>

      <div class="candidate-card__meta">
        <span>{{ candidate?.stack || 'Generalist' }}</span>
        <span>{{ candidate?.yearsOfExperience || 0 }} yrs</span>
        <span>{{ candidate?.location || 'Remote' }}</span>
      </div>

      <div class="candidate-card__metrics">
        <div><label>GitHub</label><strong>{{ candidate?.githubScore || 0 }}</strong></div>
        <div><label>Resume</label><strong>{{ candidate?.resumeScore || 0 }}</strong></div>
        <div><label>Consistency</label><strong>{{ candidate?.consistencyScore || 0 }}</strong></div>
      </div>

      <div class="candidate-card__availability">
        <span class="candidate-card__availability-badge">{{ candidate?.availability || 'Available' }}</span>
        <span class="candidate-card__activity">Active {{ candidate?.lastActive ? (candidate?.lastActive | date:'MMM d') : 'recently' }}</span>
      </div>

      <div class="candidate-card__skills">
        <span *ngFor="let skill of (candidate?.skills || []).slice(0, 6)">{{ skill }}</span>
      </div>

      <div class="candidate-card__summary" *ngIf="candidate?.aiSummary">{{ candidate.aiSummary }}</div>

      <div class="candidate-card__actions" *ngIf="!hideActions">
        <button type="button" class="candidate-card__btn candidate-card__btn--ghost" (click)="view.emit(candidate)">View Profile</button>
        <button type="button" class="candidate-card__btn" (click)="shortlist.emit(candidate)">Shortlist</button>
        <button type="button" class="candidate-card__btn candidate-card__btn--accent" (click)="compare.emit(candidate)">
          {{ selected ? 'Selected' : 'Compare' }}
        </button>
      </div>
    </article>
  `,
  styles: [`
    .candidate-card{padding:1.1rem;border-radius:22px;background:linear-gradient(180deg,rgba(15,23,42,.94),rgba(15,23,42,.82));border:1px solid rgba(99,102,241,.16);display:flex;flex-direction:column;gap:.95rem;box-shadow:0 24px 44px rgba(2,6,23,.28);transition:transform .18s ease,border-color .18s ease,box-shadow .18s ease}
    .candidate-card:hover{transform:translateY(-2px);border-color:rgba(129,140,248,.34);box-shadow:0 28px 54px rgba(2,6,23,.34)}
    .candidate-card--selected{border-color:rgba(96,165,250,.58);box-shadow:0 0 0 1px rgba(96,165,250,.24),0 28px 54px rgba(2,6,23,.34)}
    .candidate-card__header,.candidate-card__availability,.candidate-card__actions{display:flex;align-items:center;justify-content:space-between;gap:.75rem}
    .candidate-card__identity{display:flex;align-items:center;gap:.85rem;min-width:0}
    .candidate-card__avatar{width:44px;height:44px;border-radius:14px;background:linear-gradient(135deg,#4f46e5,#9333ea);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;flex-shrink:0}
    h3{margin:0;color:#f8fafc;font-size:1rem}
    p{margin:.2rem 0 0;color:#94a3b8;font-size:.85rem}
    .candidate-card__score{padding:.55rem .75rem;border-radius:16px;background:rgba(30,41,59,.9);text-align:right;flex-shrink:0}
    .candidate-card__score strong{display:block;color:#4ade80;font-size:1.25rem;line-height:1}
    .candidate-card__score span{font-size:.72rem;color:#94a3b8;text-transform:uppercase;letter-spacing:.08em}
    .candidate-card__meta,.candidate-card__skills{display:flex;flex-wrap:wrap;gap:.5rem}
    .candidate-card__meta span{padding:.38rem .65rem;border-radius:999px;background:rgba(30,41,59,.76);color:#cbd5e1;font-size:.77rem}
    .candidate-card__metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.65rem}
    .candidate-card__metrics div{padding:.75rem;border-radius:16px;background:rgba(15,23,42,.84);border:1px solid rgba(51,65,85,.72)}
    .candidate-card__metrics label{display:block;font-size:.68rem;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8;margin-bottom:.35rem}
    .candidate-card__metrics strong{color:#f8fafc;font-size:1rem}
    .candidate-card__availability-badge{padding:.35rem .7rem;border-radius:999px;background:rgba(34,197,94,.16);color:#86efac;font-weight:700;font-size:.74rem}
    .candidate-card__activity{font-size:.78rem;color:#94a3b8}
    .candidate-card__skills span{padding:.28rem .58rem;border-radius:999px;background:rgba(79,70,229,.16);color:#c7d2fe;font-size:.73rem}
    .candidate-card__summary{color:#cbd5e1;font-size:.84rem;line-height:1.55;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .candidate-card__actions{flex-wrap:wrap}
    .candidate-card__btn{flex:1 1 120px;min-height:42px;border:none;border-radius:12px;background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff;font-weight:700;cursor:pointer}
    .candidate-card__btn--ghost{background:rgba(30,41,59,.92);color:#e2e8f0}
    .candidate-card__btn--accent{background:linear-gradient(135deg,#0f766e,#0284c7)}
  `]
})
export class CandidateCardComponent {
  @Input() candidate: any;
  @Input() selected = false;
  @Input() hideActions = false;
  @Output() view = new EventEmitter<any>();
  @Output() shortlist = new EventEmitter<any>();
  @Output() compare = new EventEmitter<any>();

  get initial(): string {
    return String(this.candidate?.name || this.candidate?.fullName || 'C').trim().charAt(0).toUpperCase() || 'C';
  }
}
