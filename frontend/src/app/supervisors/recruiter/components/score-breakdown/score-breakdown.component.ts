import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-score-breakdown',
  standalone: false,
  templateUrl: './score-breakdown.component.html',
  styleUrls: ['./score-breakdown.component.scss']
})
export class ScoreBreakdownComponent {
  @Input() breakdown: Record<string, { raw: number; weight: number; weighted: number }> = {};

  get keys(): string[] {
    return Object.keys(this.breakdown || {});
  }
}
