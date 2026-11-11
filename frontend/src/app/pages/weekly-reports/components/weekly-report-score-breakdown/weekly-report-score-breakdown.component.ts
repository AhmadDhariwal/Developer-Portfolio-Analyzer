import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ScoreBreakdownItem } from '../../weekly-reports-presentation';

@Component({
  selector: 'app-weekly-report-score-breakdown',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './weekly-report-score-breakdown.component.html',
  styleUrl: './weekly-report-score-breakdown.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WeeklyReportScoreBreakdownComponent {
  @Input() items: ScoreBreakdownItem[] = [];
  @Input() overallLabel = '';
}
