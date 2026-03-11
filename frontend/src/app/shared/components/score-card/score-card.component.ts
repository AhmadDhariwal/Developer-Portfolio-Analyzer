import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-score-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './score-card.component.html',
  styleUrl: './score-card.component.scss'
})
export class ScoreCardComponent {
  @Input() title: string = '';
  @Input() score: number = 0;
  @Input() maxScore: number = 100;
  @Input() color: 'purple' | 'pink' | 'green' | 'amber' = 'purple';

  get percentage(): number {
    return Math.min(100, Math.max(0, (this.score / this.maxScore) * 100));
  }

  get colorClass(): string {
    const colorMap = {
      purple: 'score-purple',
      pink: 'score-pink',
      green: 'score-green',
      amber: 'score-amber'
    };
    return colorMap[this.color];
  }
}
