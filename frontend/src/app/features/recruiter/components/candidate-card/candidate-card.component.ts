import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-candidate-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './candidate-card.component.html',
  styleUrl: './candidate-card.component.scss',
})
export class CandidateCardComponent {
  @Input() candidate: any;
  @Input() selected = false;
  @Input() hideActions = false;
  @Output() view = new EventEmitter<any>();
  @Output() shortlist = new EventEmitter<any>();
  @Output() compare = new EventEmitter<any>();

  get initial(): string {
    return (
      String(this.candidate?.name || this.candidate?.fullName || 'C')
        .trim()
        .charAt(0)
        .toUpperCase() || 'C'
    );
  }

  get overallScore(): number {
    return Math.round(Number(this.candidate?.readinessScore ?? this.candidate?.score ?? 0));
  }

  get scoreToneClass(): string {
    const score = this.overallScore;
    if (score >= 80) return 'candidate-card__score candidate-card__score--high';
    if (score >= 65) return 'candidate-card__score candidate-card__score--mid';
    return 'candidate-card__score candidate-card__score--low';
  }

  get visibleSkills(): string[] {
    return Array.isArray(this.candidate?.skills) ? this.candidate.skills.slice(0, 6) : [];
  }

  get extraSkillsCount(): number {
    const total = Array.isArray(this.candidate?.skills) ? this.candidate.skills.length : 0;
    return Math.max(0, total - 6);
  }

  get profileCompleteness(): number {
    const value = Number(this.candidate?.profileCompleteness ?? 0);
    return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0;
  }
}
