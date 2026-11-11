import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WeeklyReport } from '../../../../shared/services/weekly-report.service';
import {
  overallLabel,
  reportDate,
  formatDate,
  statusBadgeClass,
  getReadinessScore,
  getReadinessTone,
  getReadinessClass,
} from '../../weekly-reports-presentation';

@Component({
  selector: 'app-weekly-report-overview',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './weekly-report-overview.component.html',
  styleUrl: './weekly-report-overview.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WeeklyReportOverviewComponent {
  @Input({ required: true }) report!: WeeklyReport;
  @Input() narrativeSourceLabel = 'Deterministic';

  get overallLabel(): string {
    return overallLabel(this.report);
  }

  get readinessScore(): number {
    return getReadinessScore(this.report);
  }

  getReadinessTone(score: number): string {
    return getReadinessTone(score);
  }

  getReadinessClass(score: number): string {
    return getReadinessClass(score);
  }

  statusBadgeClass(status: string): string {
    return statusBadgeClass(status);
  }

  reportDate(value: string): string {
    return reportDate(value, this.report);
  }

  formatDate(value: string | null | undefined): string {
    return formatDate(value);
  }
}
