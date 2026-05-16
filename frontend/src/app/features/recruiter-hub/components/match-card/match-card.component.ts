import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-match-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="match-card">
      <div class="match-card__header">
        <div>
          <h3>{{ match?.candidate?.name || match?.candidate?.fullName || match?.candidateId }}</h3>
          <p>{{ match?.job?.title || match?.jobId }}</p>
        </div>
        <span>{{ match?.matchScore }}%</span>
      </div>
      <div class="match-card__meta">
        <span>Skill {{ match?.skillMatchPercent }}%</span>
        <span>Confidence {{ match?.confidenceScore }}%</span>
        <span>{{ match?.experienceMatch }}</span>
      </div>
      <p>{{ match?.recommendation }}</p>
      <div class="match-card__actions">
        <button type="button" (click)="shortlist.emit(match)">Shortlist</button>
        <button type="button" (click)="compare.emit(match)">Compare</button>
      </div>
    </div>
  `,
  styles: [`
    .match-card{padding:1rem;border-radius:16px;background:rgba(15,23,42,.82);border:1px solid rgba(51,65,85,.72);display:flex;flex-direction:column;gap:.75rem}
    .match-card__header{display:flex;justify-content:space-between;gap:.75rem}.match-card__header h3{margin:0;color:#f8fafc}.match-card__header p{margin:.2rem 0 0;color:#94a3b8;font-size:.84rem}
    .match-card__header span{font-size:1.4rem;font-weight:800;color:#4ade80}
    .match-card__meta{display:flex;flex-wrap:wrap;gap:.5rem;color:#cbd5e1;font-size:.8rem}
    p{margin:0;color:#cbd5e1;font-size:.86rem}
    .match-card__actions{display:flex;gap:.5rem;flex-wrap:wrap}
    button{border:none;border-radius:10px;padding:.65rem .85rem;background:#334155;color:#fff;font-weight:700;cursor:pointer}
  `]
})
export class MatchCardComponent {
  @Input() match: any;
  @Output() shortlist = new EventEmitter<any>();
  @Output() compare = new EventEmitter<any>();
}
