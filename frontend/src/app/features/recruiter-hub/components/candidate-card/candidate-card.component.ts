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

  get scoreToneClass(): string {
    const score = Number(this.candidate?.readinessScore ?? this.candidate?.score ?? 0);
    if (score >= 80) return 'candidate-card__score candidate-card__score--high';
    if (score >= 65) return 'candidate-card__score candidate-card__score--mid';
    return 'candidate-card__score candidate-card__score--low';
  }
}
