import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WeeklyReportService, WeeklyReport } from '../../shared/services/weekly-report.service';

@Component({
  selector: 'app-weekly-reports',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './weekly-reports.component.html',
  styleUrl: './weekly-reports.component.scss'
})
export class WeeklyReportsComponent implements OnInit {
  latestReport: WeeklyReport | null = null;
  history: WeeklyReport[] = [];
  isLoading = false;
  isGenerating = false;

  constructor(
    private readonly reportService: WeeklyReportService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loadReports();
  }

  loadReports(): void {
    this.isLoading = true;
    this.reportService.getLatest().subscribe({
      next: (report) => {
        this.latestReport = report;
        this.isLoading = false;
        this.loadHistory();
        this.cdr.detectChanges();
      },
      error: () => {
        this.isLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  loadHistory(): void {
    this.reportService.getHistory(6).subscribe({
      next: (res) => {
        this.history = res.reports || [];
        this.cdr.detectChanges();
      },
      error: () => {
        this.history = [];
        this.cdr.detectChanges();
      }
    });
  }

  generateReport(): void {
    this.isGenerating = true;
    this.reportService.generateReport().subscribe({
      next: (report) => {
        this.latestReport = report;
        this.isGenerating = false;
        this.loadHistory();
        this.cdr.detectChanges();
      },
      error: () => {
        this.isGenerating = false;
        this.cdr.detectChanges();
      }
    });
  }

  getReadinessScore(report: WeeklyReport | null): number {
    if (!report?.predictedHiringReadiness) return 0;
    const score = Number(report.predictedHiringReadiness.score || 0);
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  getReadinessTone(score: number): string {
    if (score >= 80) return 'Strong';
    if (score >= 65) return 'Promising';
    return 'Needs Focus';
  }

  getReadinessClass(score: number): string {
    if (score >= 80) return 'high';
    if (score >= 65) return 'medium';
    return 'low';
  }

  getRiskArea(report: WeeklyReport | null): string {
    return report?.biggestRiskArea || 'No major risk identified for this period.';
  }
}
