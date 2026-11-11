import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WeeklyReport } from '../../../../shared/services/weekly-report.service';
import { overallLabel, reportDate } from '../../weekly-reports-presentation';

@Component({
  selector: 'app-weekly-report-momentum-trend',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './weekly-report-momentum-trend.component.html',
  styleUrl: './weekly-report-momentum-trend.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WeeklyReportMomentumTrendComponent {
  @Input() trendReports: WeeklyReport[] = [];
  @Input() selectedReportId = '';

  @Output() selectReport = new EventEmitter<WeeklyReport>();

  overallLabel(report: WeeklyReport): string {
    return overallLabel(report);
  }

  reportDate(value: string, report?: WeeklyReport): string {
    return reportDate(value, report);
  }

  trackByReportId(_: number, report: WeeklyReport): string {
    return report._id;
  }
}
