import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

export type ScoreCardColor = 'purple' | 'pink' | 'green' | 'amber' | 'blue';

@Component({
  selector: 'app-score-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './score-card.component.html',
  styleUrl: './score-card.component.scss'
})
export class ScoreCardComponent {
  @Input() title: string = '';
  @Input() subtitle?: string;
  @Input() score: number = 0;
  @Input() maxScore: number = 100;
  @Input() color: ScoreCardColor = 'purple';
  @Input() loading: boolean = false;
  @Input() stale: boolean = false;

  get percentage(): number {
    if (!this.maxScore || this.maxScore <= 0) return 0;
    return Math.min(100, Math.max(0, (this.score / this.maxScore) * 100));
  }

  get colorClass(): string {
    const colorMap: Record<ScoreCardColor, string> = {
      purple: 'score-purple',
      pink: 'score-pink',
      green: 'score-green',
      amber: 'score-amber',
      blue: 'score-blue'
    };
    return colorMap[this.color] || 'score-purple';
  }
}
