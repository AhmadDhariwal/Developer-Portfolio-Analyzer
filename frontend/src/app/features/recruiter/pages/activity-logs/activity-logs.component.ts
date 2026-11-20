import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { finalize } from 'rxjs/operators';
import { PerformanceChartItem } from '../../components/recruiter-performance-chart/recruiter-performance-chart.component';
import { RecruiterHubService } from '../../services/recruiter-hub.service';

@Component({
  selector: 'app-recruiter-activity-logs',
  standalone: false,
  templateUrl: './activity-logs.component.html',
  styleUrl: './activity-logs.component.scss',
})
export class RecruiterActivityLogsComponent implements OnInit {
  private readonly cdr = inject(ChangeDetectorRef);
  loading = true;
  error = '';
  logs: any[] = [];
  meta: { total?: number } = {};
  filters: { action: string; candidateId: string; jobId: string; from: string; to: string } = {
    action: '',
    candidateId: '',
    jobId: '',
    from: '',
    to: '',
  };
  actionOptions: Array<{ value: string; label: string }> = [];
  candidateOptions: Array<{ value: string; label: string }> = [];
  jobOptions: Array<{ value: string; label: string }> = [];

  constructor(private readonly hubService: RecruiterHubService) {}

  ngOnInit(): void {
    this.loadActivity();
  }

  get shortlistActions(): number {
    return this.logs.filter((item) =>
      String(item?.action || '')
        .toUpperCase()
        .includes('SHORTLIST'),
    ).length;
  }

  get aiActions(): number {
    return this.logs.filter((item) => /ANALYZED|MATCH/i.test(String(item?.action || ''))).length;
  }

  get jobActions(): number {
    return this.logs.filter((item) =>
      String(item?.action || '')
        .toUpperCase()
        .includes('JOB'),
    ).length;
  }

  get hasActiveFilters(): boolean {
    return Boolean(
      this.filters.action ||
        this.filters.candidateId ||
        this.filters.jobId ||
        this.filters.from ||
        this.filters.to,
    );
  }

  get actionBreakdownItems(): PerformanceChartItem[] {
    if (!this.logs.length) {
      return [];
    }
    const counts = new Map<string, number>();
    for (const log of this.logs) {
      const label = this.formatActionLabel(String(log?.action || 'EVENT'));
      counts.set(label, (counts.get(label) || 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }

  formatActionLabel(action: string): string {
    const cleaned = String(action || '')
      .replace(/RECRUITER_/g, '')
      .replaceAll('_', ' ')
      .trim();
    if (!cleaned) {
      return 'Event';
    }
    return cleaned.toLowerCase().replace(/\b\w/g, (ch) => ch.toUpperCase());
  }

  loadActivity(): void {
    this.loading = true;
    this.error = '';

    this.hubService
      .getActivity(this.filters)
      .pipe(finalize(() => this.cdr.markForCheck()))
      .subscribe({
        next: (response) => {
          this.logs = response?.logs || [];
          this.meta = response?.meta || { total: this.logs.length };
          this.actionOptions = [
            { value: '', label: 'All Actions' },
            ...(response?.filters?.actions || []).map((raw: string) => ({
              value: raw,
              label: this.formatActionLabel(raw),
            })),
          ];
          this.candidateOptions = [
            { value: '', label: 'All Candidates' },
            ...(response?.filters?.candidates || []).map((item: any) => ({
              value: item._id,
              label: item.name,
            })),
          ];
          this.jobOptions = [
            { value: '', label: 'All Requisitions' },
            ...(response?.filters?.jobs || []).map((item: any) => ({
              value: item._id,
              label: item.title,
            })),
          ];
          this.loading = false;
        },
        error: (err) => {
          this.logs = [];
          this.error = err?.error?.message || 'Unable to load recruiter activity.';
          this.loading = false;
        },
      });
  }

  applyFilters(): void {
    this.loadActivity();
  }

  resetFilters(): void {
    this.filters = { action: '', candidateId: '', jobId: '', from: '', to: '' };
    this.loadActivity();
  }

  trackByLog(index: number, item: any): string {
    return String(item?._id || item?.id || item?.timestamp || index);
  }
}
