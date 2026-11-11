import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WeeklyReport } from '../../../../shared/services/weekly-report.service';
import { hasText, getRiskArea } from '../../weekly-reports-presentation';

@Component({
  selector: 'app-weekly-report-narrative',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './weekly-report-narrative.component.html',
  styleUrl: './weekly-report-narrative.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WeeklyReportNarrativeComponent {
  @Input({ required: true }) report!: WeeklyReport;

  hasText(values: string[] | null | undefined): boolean {
    return hasText(values);
  }

  getRiskArea(report: WeeklyReport): string {
    return getRiskArea(report);
  }
}
