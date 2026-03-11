import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-score-meter',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './score-meter.component.html',
  styleUrl: './score-meter.component.scss'
})
export class ScoreMeterComponent {
  @Input() score: number = 0;
  @Input() maxScore: number = 100;
  @Input() size: 'sm' | 'md' | 'lg' = 'md';

  // SVG arc constants
  readonly radius = 80;
  readonly cx = 100;
  readonly cy = 100;
  // Full circumference
  readonly circumference = 2 * Math.PI * this.radius;

  get percentage(): number {
    return Math.min(100, Math.max(0, (this.score / this.maxScore) * 100));
  }

  // Dash offset so arc fills percentage of circle
  get dashOffset(): number {
    return this.circumference - (this.percentage / 100) * this.circumference;
  }

  get scoreColor(): string {
    if (this.score >= 80) return '#22C55E';
    if (this.score >= 60) return '#6366F1';
    if (this.score >= 40) return '#F59E0B';
    return '#EF4444';
  }

  get glowColor(): string {
    if (this.score >= 80) return 'rgba(34, 197, 94, 0.3)';
    if (this.score >= 60) return 'rgba(99, 102, 241, 0.3)';
    if (this.score >= 40) return 'rgba(245, 158, 11, 0.3)';
    return 'rgba(239, 68, 68, 0.3)';
  }
}
