import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-match-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <article class="match-card">
      <div class="match-card__header">
        <div>
          <div class="match-card__rank" *ngIf="match?.rank">Rank #{{ match.rank }}</div>
          <h3>{{ match?.candidate?.name || match?.candidate?.fullName || match?.candidateId }}</h3>
          <p>{{ match?.job?.title || match?.jobId }}</p>
        </div>
        <div class="match-card__score">
          <strong>{{ match?.matchScore || 0 }}%</strong>
          <span>Match</span>
        </div>
      </div>

      <div class="match-card__meta">
        <div><label>Skill</label><strong>{{ match?.skillMatchPercent || 0 }}%</strong></div>
        <div><label>Confidence</label><strong>{{ match?.confidenceScore || 0 }}%</strong></div>
        <div><label>Readiness</label><strong>{{ match?.readinessScore || 0 }}</strong></div>
      </div>

      <div class="match-card__insight">
        <span class="match-card__badge">{{ match?.experienceMatch || 'Moderate' }} experience fit</span>
        <span class="match-card__status" *ngIf="match?.status">{{ match.status }}</span>
      </div>

      <p class="match-card__summary">{{ match?.recommendation || match?.explanation || 'AI ranking complete.' }}</p>

      <div class="match-card__skills" *ngIf="(match?.strengths || []).length">
        <span *ngFor="let item of (match?.strengths || []).slice(0, 3)">{{ item }}</span>
      </div>

      <div class="match-card__actions" *ngIf="!hideActions">
        <button type="button" class="match-card__btn" (click)="shortlist.emit(match)">Shortlist</button>
        <button type="button" class="match-card__btn match-card__btn--ghost" (click)="compare.emit(match)">Compare</button>
      </div>
    </article>
  `,
  styles: [`
    .match-card{padding:1.1rem;border-radius:22px;background:linear-gradient(180deg,rgba(15,23,42,.94),rgba(15,23,42,.82));border:1px solid rgba(59,130,246,.16);display:flex;flex-direction:column;gap:.9rem;box-shadow:0 24px 44px rgba(2,6,23,.28)}
    .match-card__header,.match-card__actions,.match-card__insight{display:flex;justify-content:space-between;gap:.75rem;align-items:flex-start;flex-wrap:wrap}
    .match-card__rank{display:inline-flex;padding:.22rem .55rem;border-radius:999px;background:rgba(245,158,11,.14);color:#fcd34d;font-size:.71rem;font-weight:700;margin-bottom:.45rem}
    h3{margin:0;color:#f8fafc;font-size:1rem}
    p{margin:.2rem 0 0;color:#94a3b8;font-size:.84rem}
    .match-card__score{padding:.55rem .8rem;border-radius:16px;background:rgba(15,23,42,.92);text-align:right}
    .match-card__score strong{display:block;color:#4ade80;font-size:1.3rem;line-height:1}
    .match-card__score span{font-size:.72rem;color:#94a3b8;text-transform:uppercase;letter-spacing:.08em}
    .match-card__meta{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.7rem}
    .match-card__meta div{padding:.75rem;border-radius:16px;background:rgba(15,23,42,.84);border:1px solid rgba(51,65,85,.72)}
    .match-card__meta label{display:block;font-size:.68rem;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8;margin-bottom:.35rem}
    .match-card__meta strong{color:#f8fafc}
    .match-card__badge,.match-card__status,.match-card__skills span{padding:.28rem .6rem;border-radius:999px;font-size:.73rem}
    .match-card__badge{background:rgba(96,165,250,.14);color:#bfdbfe}
    .match-card__status{background:rgba(79,70,229,.16);color:#c7d2fe;text-transform:capitalize}
    .match-card__summary{margin:0;color:#cbd5e1;line-height:1.6}
    .match-card__skills{display:flex;flex-wrap:wrap;gap:.5rem}
    .match-card__skills span{background:rgba(34,197,94,.14);color:#bbf7d0}
    .match-card__btn{flex:1 1 120px;min-height:42px;border:none;border-radius:12px;background:linear-gradient(135deg,#0f766e,#0284c7);color:#fff;font-weight:700;cursor:pointer}
    .match-card__btn--ghost{background:rgba(30,41,59,.92);color:#e2e8f0}
  `]
})
export class MatchCardComponent {
  @Input() match: any;
  @Input() hideActions = false;
  @Output() shortlist = new EventEmitter<any>();
  @Output() compare = new EventEmitter<any>();
}
