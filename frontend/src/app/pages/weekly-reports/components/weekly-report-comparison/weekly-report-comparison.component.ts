import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WeeklyReport } from '../../../../shared/services/weekly-report.service';
import {
  overallLabel,
  getReadinessScore,
  deltaClass,
  formatDelta,
} from '../../weekly-reports-presentation';

@Component({
  selector: 'app-weekly-report-comparison',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './weekly-report-comparison.component.html',
  styleUrl: './weekly-report-comparison.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WeeklyReportComparisonComponent {
  @Input({ required: true }) report!: WeeklyReport;
  @Input() comparisonAvailable = false;

  get overallLabel(): string {
    return overallLabel(this.report);
  }

  get readinessScore(): number {
    return getReadinessScore(this.report);
  }

  deltaClass(value: number): string {
    return deltaClass(value);
  }

  formatDelta(value: number, suffix = 'pts'): string {
    return formatDelta(value, this.comparisonAvailable, suffix);
  }
}
