import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  WeeklyReport,
  WeeklyReportDataSourceStatus,
} from '../../../../shared/services/weekly-report.service';
import { sourceTone, sourceFreshness, formatDate } from '../../weekly-reports-presentation';

@Component({
  selector: 'app-weekly-report-data-sources',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './weekly-report-data-sources.component.html',
  styleUrl: './weekly-report-data-sources.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WeeklyReportDataSourcesComponent {
  @Input() dataSources: Array<{ label: string; status: WeeklyReportDataSourceStatus }> = [];
  @Input() report: WeeklyReport | null = null;
  @Input() emailStatus: string | undefined = '';
  @Input() emailError: string | undefined = '';

  sourceTone(status: WeeklyReportDataSourceStatus): string {
    return sourceTone(status);
  }

  sourceFreshness(status: WeeklyReportDataSourceStatus): string {
    return sourceFreshness(status, this.report);
  }

  formatDate(value: string | null | undefined): string {
    return formatDate(value);
  }

  trackByLabel(_: number, item: { label: string }): string {
    return item.label;
  }
}
