import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { SearchableSelectOption } from '../../../../shared/components/searchable-select/searchable-select.component';
import { CandidateService } from '../../services/candidate.service';
import { RecruiterJobService } from '../../services/recruiter-job.service';
import { RecruiterMatchService } from '../../services/recruiter-match.service';

@Component({
  selector: 'app-recruiter-comparison',
  standalone: false,
  templateUrl: './comparison.component.html',
  styleUrl: './comparison.component.css'
})
export class ComparisonComponent implements OnInit {
  loading = true;
  error = '';
  comparison: any[] = [];
  candidates: any[] = [];
  jobs: any[] = [];
  selectedJobId = '';
  readonly selectedIds = new Set<string>();

  constructor(
    private readonly route: ActivatedRoute,
    private readonly candidateService: CandidateService,
    private readonly jobService: RecruiterJobService,
    private readonly matchService: RecruiterMatchService
  ) {}

  get jobOptions(): SearchableSelectOption[] {
    return this.jobs.map((job) => ({ value: job._id, label: job.title, meta: job.status }));
  }

  ngOnInit(): void {
    this.selectedJobId = this.route.snapshot.queryParamMap.get('jobId') || '';
    String(this.route.snapshot.queryParamMap.get('ids') || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 3)
      .forEach((id) => this.selectedIds.add(id));

    Promise.all([
      new Promise<void>((resolve) => {
        this.candidateService.listCandidates({ limit: 24, sortBy: 'score-desc' }).subscribe({
          next: (response) => {
            this.candidates = response?.candidates || [];
            resolve();
          },
          error: () => resolve()
        });
      }),
      new Promise<void>((resolve) => {
        this.jobService.listJobs().subscribe({
          next: (response) => {
            this.jobs = response?.jobs || [];
            resolve();
          },
          error: () => resolve()
        });
      })
    ]).then(() => this.loadComparison());
  }

  toggleCandidate(candidate: any): void {
    const id = String(candidate?.id || candidate?.userId || '').trim();
    if (!id) return;
    if (this.selectedIds.has(id)) {
      this.selectedIds.delete(id);
      return;
    }
    if (this.selectedIds.size >= 3) {
      this.error = 'You can compare up to 3 candidates at a time.';
      return;
    }
    this.selectedIds.add(id);
    this.error = '';
  }

  isSelected(candidate: any): boolean {
    return this.selectedIds.has(String(candidate?.id || candidate?.userId || '').trim());
  }

  loadComparison(): void {
    if (this.selectedIds.size < 2) {
      this.loading = false;
      this.comparison = [];
      return;
    }

    this.loading = true;
    this.error = '';
    this.matchService.compareCandidates({
      candidateIds: Array.from(this.selectedIds),
      jobId: this.selectedJobId || undefined
    }).subscribe({
      next: (response) => {
        this.comparison = response?.comparison || [];
        this.loading = false;
      },
      error: (err) => {
        this.comparison = [];
        this.error = err?.error?.message || 'Unable to compare the selected candidates.';
        this.loading = false;
      }
    });
  }
}
