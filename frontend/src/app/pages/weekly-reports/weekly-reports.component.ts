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
}
