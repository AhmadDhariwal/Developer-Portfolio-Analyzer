import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WeeklyReport } from '../../../../shared/services/weekly-report.service';
import { overallLabel, reportDate } from '../../weekly-reports-presentation';

@Component({
  selector: 'app-weekly-report-history',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './weekly-report-history.component.html',
  styleUrl: './weekly-report-history.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WeeklyReportHistoryComponent {
  @Input() history: WeeklyReport[] = [];
  @Input() selectedReportId = '';
  @Input() isOpen = false;

  @Output() toggle = new EventEmitter<void>();
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
