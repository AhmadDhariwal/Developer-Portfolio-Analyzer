import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WeeklyReport } from '../../../../shared/services/weekly-report.service';
import { formatDate } from '../../weekly-reports-presentation';

@Component({
  selector: 'app-weekly-report-actions',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './weekly-report-actions.component.html',
  styleUrl: './weekly-report-actions.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WeeklyReportActionsComponent {
  @Input() report: WeeklyReport | null = null;
  @Input() loadedAt: Date | null = null;
  @Input() loadSourceLabel = '';
  @Input() isGenerating = false;
  @Input() isExporting = false;
  @Input() isResending = false;
  @Input() isCurrentWeek = false;
  @Input() isArchivedVersion = false;

  @Output() generate = new EventEmitter<void>();
  @Output() refresh = new EventEmitter<void>();
  @Output() downloadPdf = new EventEmitter<void>();
  @Output() resendEmail = new EventEmitter<void>();

  readonly formatDate = formatDate;
}
