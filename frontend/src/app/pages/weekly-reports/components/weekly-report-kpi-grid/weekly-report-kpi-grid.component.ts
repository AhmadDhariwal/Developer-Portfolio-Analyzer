import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WeeklyReport } from '../../../../shared/services/weekly-report.service';
import {
  metricLabel,
  sprintMetricLabel,
  interviewActivityLabel,
  deltaClass,
  formatDelta,
} from '../../weekly-reports-presentation';

@Component({
  selector: 'app-weekly-report-kpi-grid',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './weekly-report-kpi-grid.component.html',
  styleUrl: './weekly-report-kpi-grid.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WeeklyReportKpiGridComponent {
  @Input({ required: true }) report!: WeeklyReport;
  @Input() comparisonAvailable = false;

  metricLabel(key: string, legacyValue: number): string {
    return metricLabel(key, legacyValue, this.report);
  }

  sprintMetricLabel(report: WeeklyReport): string {
    return sprintMetricLabel(report);
  }

  interviewActivityLabel(report: WeeklyReport): string {
    return interviewActivityLabel(report);
  }

  deltaClass(value: number): string {
    return deltaClass(value);
  }

  formatDelta(value: number, suffix = 'pts'): string {
    return formatDelta(value, this.comparisonAvailable, suffix);
  }
}
