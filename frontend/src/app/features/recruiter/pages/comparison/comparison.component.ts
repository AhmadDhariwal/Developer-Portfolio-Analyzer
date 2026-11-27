import { DestroyRef as PolicyDestroyRef } from '@angular/core';
import { takeUntilDestroyed as takeUntilPolicyDestroyed } from '@angular/core/rxjs-interop';
import { OrganizationPolicyState } from '../../../../shared/services/organization-policy-state.service';
import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { catchError, forkJoin, of } from 'rxjs';
import { finalize } from 'rxjs/operators';
import {
  ChartTone,
  PerformanceChartDataset,
} from '../../components/recruiter-performance-chart/recruiter-performance-chart.component';
import { CandidateService } from '../../services/candidate.service';
import { RecruiterJobService } from '../../services/recruiter-job.service';
import { RecruiterMatchService } from '../../services/recruiter-match.service';

@Component({
  selector: 'app-recruiter-comparison',
  templateUrl: './comparison.component.html',
  styleUrl: './comparison.component.scss',
  standalone: false,
})
export class ComparisonComponent implements OnInit {
  readonly policies = inject(OrganizationPolicyState);
  private readonly policyDestroy = inject(PolicyDestroyRef);
  private readonly cdr = inject(ChangeDetectorRef);
  loading = false;
  candidatesLoading = true;
  error = '';
  candidatesError = '';
  comparison: any[] = [];
  candidates: any[] = [];
  jobs: any[] = [];
  selectedJobId = '';
  pickerSearch = '';
  selectedIds = new Set<string>();

  private readonly tones: ChartTone[] = ['indigo', 'green', 'cyan'];

  constructor(
    private route: ActivatedRoute,
    private candidateService: CandidateService,
    private jobService: RecruiterJobService,
    private matchService: RecruiterMatchService,
  ) {}

  ngOnInit(): void {
    this.policies.resourcesChanged$
      .pipe(takeUntilPolicyDestroyed(this.policyDestroy))
      .subscribe(() => {
        if (this.selectedJobId) this.comparison = [];
        this.loadReferenceData(false);
        this.cdr.markForCheck();
      });
    this.policies.contextChanges$
      .pipe(takeUntilPolicyDestroyed(this.policyDestroy))
      .subscribe(() => {
        this.comparison = [];
        this.candidates = [];
        this.jobs = [];
        this.selectedJobId = '';
        this.selectedIds.clear();
        this.loadReferenceData(false);
        this.cdr.markForCheck();
      });
    this.route.queryParamMap.subscribe((params) => {
      const idsParam = params.get('ids') || '';
      const jobIdParam = params.get('jobId') || '';
      if (jobIdParam) {
        this.selectedJobId = jobIdParam;
      }
      const parsedIds = idsParam
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
        .slice(0, 3);
      this.selectedIds = new Set(parsedIds);
      this.loadReferenceData(parsedIds.length >= 2);
    });
  }

  get jobOptions(): Array<{ label: string; value: string }> {
    return [
      { label: 'No job filter (general comparison)', value: '' },
      ...this.jobs.map((job) => ({
        label: job.title || 'Untitled job',
        value: job._id || job.id,
      })),
    ];
  }

  get filteredCandidates(): any[] {
    const query = this.pickerSearch.trim().toLowerCase();
    if (!query) {
      return this.candidates;
    }
    return this.candidates.filter((candidate) => {
      const haystack = [
        candidate?.name,
        candidate?.fullName,
        candidate?.stack,
        ...(candidate?.skills || []),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }

  get selectedJobTitle(): string {
    if (!this.selectedJobId) {
      return 'General Pool';
    }
    const found = this.jobs.find((job) => (job._id || job.id) === this.selectedJobId);
    return found?.title || 'Selected Requisition';
  }

  get topReadinessDisplay(): string {
    if (!this.comparison.length) {
      return '-';
    }
    const maxScore = Math.max(
      ...this.comparison.map((item) => Number(item?.readinessScore ?? item?.score ?? 0)),
    );
    return `${Math.round(maxScore)}%`;
  }

  get unavailableGithubCount(): number {
    return this.comparison.filter(
      (item) => item?.githubScore === null || item?.githubScore === undefined,
    ).length;
  }

  get comparisonChartLabels(): string[] {
    const base = ['Readiness', 'GitHub', 'Resume', 'Consistency', 'Growth'];
    const hasMatch = this.comparison.some(
      (item) => item?.match?.matchScore !== null && item?.match?.matchScore !== undefined,
    );
    return hasMatch ? [...base, 'JD Match'] : base;
  }

  get comparisonChartDatasets(): PerformanceChartDataset[] {
    if (!this.comparison.length) {
      return [];
    }
    const includeMatch = this.comparison.some(
      (item) => item?.match?.matchScore !== null && item?.match?.matchScore !== undefined,
    );

    return this.comparison.map((item, idx) => {
      const values: Array<number | null> = [
        this.nullableNumber(item?.readinessScore ?? item?.score),
        this.nullableNumber(item?.githubScore),
        this.nullableNumber(item?.resumeScore),
        this.nullableNumber(item?.consistencyScore),
        this.nullableNumber(item?.growthPotentialScore),
      ];
      if (includeMatch) {
        values.push(this.nullableNumber(item?.match?.matchScore));
      }
      return {
        label: item?.name || `Candidate ${idx + 1}`,
        tone: this.tones[idx % this.tones.length],
        values,
      };
    });
  }

  loadReferenceData(shouldCompare = false): void {
    this.candidatesLoading = true;
    this.candidatesError = '';
    const runInitialCompare =
      shouldCompare &&
      this.selectedIds.size >= 2 &&
      (!this.selectedJobId || this.policies.allowed('candidateMatching'));
    if (shouldCompare && this.selectedJobId && !this.policies.allowed('candidateMatching'))
      this.error = this.policies.explanation('candidateMatching');
    if (runInitialCompare) {
      this.loading = true;
      this.error = '';
    }

    forkJoin({
      candidatesRes: this.candidateService.listCandidates({ limit: 24, sortBy: 'score-desc' }).pipe(
        catchError((err) => {
          this.candidatesError =
            err?.error?.message || 'Unable to load candidate pool for selection.';
          return of({ candidates: [] });
        }),
      ),
      jobsRes: this.jobService.listJobs().pipe(catchError(() => of({ jobs: [] }))),
      compareRes: runInitialCompare
        ? this.matchService
            .compareCandidates({
              candidateIds: Array.from(this.selectedIds),
              jobId: this.selectedJobId || undefined,
            })
            .pipe(
              catchError((err) => {
                this.error = err?.error?.message || 'Unable to compare selected candidates.';
                return of({ candidates: [], comparison: [] });
              }),
            )
        : of(null),
    })
      .pipe(finalize(() => this.cdr.markForCheck()))
      .subscribe(({ candidatesRes, jobsRes, compareRes }: any) => {
        this.candidates = candidatesRes?.candidates || [];
        this.jobs = jobsRes?.jobs || [];
        if (runInitialCompare) {
          this.comparison = compareRes?.candidates || compareRes?.comparison || [];
          this.loading = false;
        }
        this.candidatesLoading = false;
      });
  }

  onJobChange(jobId: string): void {
    this.selectedJobId = jobId;
    if (this.selectedIds.size >= 2) {
      this.loadComparison();
    }
  }

  toggleCandidate(candidate: any): void {
    const id = this.candidateId(candidate);
    if (!id) {
      return;
    }
    this.error = '';

    if (this.selectedIds.has(id)) {
      this.selectedIds.delete(id);
      return;
    }
    if (this.selectedIds.size >= 3) {
      this.error = 'Maximum 3 candidates can be compared at once.';
      return;
    }
    this.selectedIds.add(id);
  }

  clearSelection(): void {
    this.selectedIds.clear();
    this.comparison = [];
    this.error = '';
  }

  isSelected(candidate: any): boolean {
    const id = this.candidateId(candidate);
    return id ? this.selectedIds.has(id) : false;
  }

  loadComparison(): void {
    if (this.selectedJobId && !this.policies.allowed('candidateMatching')) {
      this.error = this.policies.explanation('candidateMatching');
      return;
    }
    if (this.selectedIds.size < 2) {
      this.error = 'Select 2-3 candidates to run a comparison.';
      return;
    }
    this.loading = true;
    this.error = '';

    this.matchService
      .compareCandidates({
        candidateIds: Array.from(this.selectedIds),
        jobId: this.selectedJobId || undefined,
      })
      .pipe(finalize(() => this.cdr.markForCheck()))
      .pipe(takeUntilPolicyDestroyed(this.policyDestroy))
      .subscribe({
        next: (response: any) => {
          this.comparison = response?.candidates || response?.comparison || [];
          this.loading = false;
        },
        error: (err) => {
          this.error = err?.error?.message || 'Unable to compare selected candidates.';
          this.loading = false;
        },
      });
  }

  trackByCandidate(index: number, candidate: any): string {
    return String(candidate?.id || candidate?.userId || candidate?._id || index);
  }

  private candidateId(candidate: any): string {
    return String(candidate?.id || candidate?.userId || candidate?._id || '').trim();
  }

  private nullableNumber(raw: unknown): number | null {
    if (raw === null || raw === undefined || raw === '') {
      return null;
    }
    const num = Number(raw);
    return Number.isFinite(num) ? Math.round(num) : null;
  }
}
