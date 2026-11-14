import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

let nextScoreMeterId = 0;

@Component({
  selector: 'app-score-meter',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './score-meter.component.html',
  styleUrl: './score-meter.component.scss',
})
export class ScoreMeterComponent {
  @Input() score: number = 0;
  @Input() maxScore: number = 100;
  @Input() size: 'sm' | 'md' | 'lg' = 'md';

  readonly instanceId = ++nextScoreMeterId;

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

  get gradientId(): string {
    return `score-grad-${this.instanceId}`;
  }

  get scoreColor(): string {
    if (this.score >= 80) return '#10B981';
    if (this.score >= 60) return '#4F46E5';
    if (this.score >= 40) return '#F59E0B';
    return '#EF4444';
  }

  get gradientEndColor(): string {
    if (this.score >= 80) return '#34D399';
    if (this.score >= 60) return '#8B5CF6';
    if (this.score >= 40) return '#FB923C';
    return '#F87171';
  }

  get glowColor(): string {
    if (this.score >= 80) return 'rgba(16, 185, 129, 0.24)';
    if (this.score >= 60) return 'rgba(79, 70, 229, 0.26)';
    if (this.score >= 40) return 'rgba(245, 158, 11, 0.24)';
    return 'rgba(239, 68, 68, 0.24)';
  }
}
