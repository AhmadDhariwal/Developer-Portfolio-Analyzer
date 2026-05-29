import { Component, OnInit } from '@angular/core';
import { RecruiterHubService } from '../../services/recruiter-hub.service';

@Component({
  selector: 'app-recruiter-activity-logs',
  standalone: false,
  templateUrl: './activity-logs.component.html',
  styleUrl: './activity-logs.component.scss',
})
export class RecruiterActivityLogsComponent implements OnInit {
  loading = true;
  error = '';
  logs: any[] = [];
  filters: any = { action: '', candidateId: '', jobId: '', from: '', to: '' };
  actionOptions: any[] = [];
  candidateOptions: any[] = [];
  jobOptions: any[] = [];

  constructor(private readonly hubService: RecruiterHubService) {}

  ngOnInit(): void {
    this.loadActivity();
  }

  get shortlistActions(): number {
    return this.logs.filter((item) => String(item?.action || '').includes('SHORTLIST')).length;
  }

  get aiActions(): number {
    return this.logs.filter((item) => String(item?.action || '').includes('AI')).length;
  }

  loadActivity(): void {
    this.loading = true;
    this.error = '';
    this.hubService.getActivity(this.filters).subscribe({
      next: (response) => {
        this.logs = response?.logs || [];
        this.actionOptions = (response?.filters?.actions || []).map((label: string) => ({
          value: label,
          label,
        }));
        this.candidateOptions = (response?.filters?.candidates || []).map((item: any) => ({
          value: item._id,
          label: item.name,
        }));
        this.jobOptions = (response?.filters?.jobs || []).map((item: any) => ({
          value: item._id,
          label: item.title,
        }));
        this.loading = false;
      },
      error: (err) => {
        this.logs = [];
        this.error = err?.error?.message || 'Unable to load recruiter activity.';
        this.loading = false;
      },
    });
  }

  trackByLog(index: number, item: any): string {
    return String(item?._id || item?.id || item?.timestamp || index);
  }
}
