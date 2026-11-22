import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { finalize } from 'rxjs/operators';
import { Subscription } from 'rxjs';
import { PerformanceChartItem } from '../../components/recruiter-performance-chart/recruiter-performance-chart.component';
import { CandidateService } from '../../services/candidate.service';
import { RecruiterJobService } from '../../services/recruiter-job.service';
import { RecruiterMatchService } from '../../services/recruiter-match.service';

export type MatchStatusFilter = 'all' | 'generated' | 'shortlisted' | 'rejected';

@Component({
  selector: 'app-recruiter-matches',
  templateUrl: './matches.component.html',
  styleUrl: './matches.component.scss',
  standalone: false,
})
export class MatchesComponent implements OnInit {
  private readonly cdr = inject(ChangeDetectorRef);
  jobsLoading = true;
  candidatesLoading = true;
  matchesLoading = true;
  generating = false;
  error = '';
  notice = '';
  jobs: any[] = [];
  candidates: any[] = [];
  matches: any[] = [];
  selectedJobId = '';
  candidateSearch = '';
  statusFilter: MatchStatusFilter = 'all';
  selectedCandidateIds = new Set<string>();
  compareIds = new Set<string>();

  private matchesRequest?: Subscription;
  private readonly compareNames = new Map<string, string>();

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private jobService: RecruiterJobService,
    private candidateService: CandidateService,
    private matchService: RecruiterMatchService,
  ) {}

  ngOnInit(): void {
    this.route.queryParamMap.subscribe((params) => {
      const requestedJobId = String(params.get('jobId') || '').trim();
      if (requestedJobId && requestedJobId !== this.selectedJobId) {
        this.selectedJobId = requestedJobId;
      }
      this.loadJobs();
      this.loadCandidates();
      this.loadMatches();
    });
  }

  get canManageSelectedJob(): boolean {
    return (
      this.jobs.find((job) => String(job._id || job.id) === this.selectedJobId)?.access
        ?.evaluationManage === true
    );
  }

  get jobOptions(): Array<{ label: string; value: string }> {
    return this.jobs.map((job) => ({
      label: `${job.title}${job.access?.isOwner ? '' : ' � Shared'} (${job.status || 'open'})`,
      value: job._id || job.id,
    }));
  }

  get filteredPoolCandidates(): any[] {
    const query = this.candidateSearch.trim().toLowerCase();
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

  get openJobsCount(): number {
    return this.jobs.filter((job) => String(job?.status || '').toLowerCase() === 'open').length;
  }

  get generatedCount(): number {
    return this.matches.filter(
      (match) => String(match?.status || 'generated').toLowerCase() === 'generated',
    ).length;
  }

  get shortlistedCount(): number {
    return this.matches.filter(
      (match) => String(match?.status || '').toLowerCase() === 'shortlisted',
    ).length;
  }

  get rejectedCount(): number {
    return this.matches.filter((match) => String(match?.status || '').toLowerCase() === 'rejected')
      .length;
  }

  get filteredMatches(): any[] {
    if (this.statusFilter === 'all') {
      return this.matches;
    }
    return this.matches.filter(
      (match) => String(match?.status || 'generated').toLowerCase() === this.statusFilter,
    );
  }

  get scoreDistributionItems(): PerformanceChartItem[] {
    if (!this.matches.length) {
      return [];
    }
    let band90 = 0;
    let band80 = 0;
    let band70 = 0;
    let bandLow = 0;

    for (const match of this.matches) {
      const score = Number(match?.matchScore ?? 0);
      if (score >= 90) band90 += 1;
      else if (score >= 80) band80 += 1;
      else if (score >= 70) band70 += 1;
      else bandLow += 1;
    }

    return [
      { label: '90-100%', count: band90 },
      { label: '80-89%', count: band80 },
      { label: '70-79%', count: band70 },
      { label: '< 70%', count: bandLow },
    ];
  }

  get statusDistributionItems(): PerformanceChartItem[] {
    if (!this.matches.length) {
      return [];
    }
    return [
      { label: 'Generated', count: this.generatedCount },
      { label: 'Shortlisted', count: this.shortlistedCount },
      { label: 'Rejected', count: this.rejectedCount },
    ];
  }

  get selectedCompareList(): Array<{ id: string; name: string }> {
    return Array.from(this.compareIds).map((id) => ({
      id,
      name: this.compareNames.get(id) || 'Candidate',
    }));
  }

  setStatusFilter(filter: MatchStatusFilter): void {
    this.statusFilter = filter;
  }

  loadJobs(): void {
    this.jobsLoading = true;
    this.jobService
      .listEvaluationJobs()
      .pipe(finalize(() => this.cdr.markForCheck()))
      .subscribe({
        next: (response: any) => {
          this.jobs = response?.jobs || [];
          if (!this.jobs.some((job) => String(job._id || job.id) === this.selectedJobId)) {
            this.selectedJobId = String(this.jobs[0]?._id || this.jobs[0]?.id || '');
            this.loadMatches();
          }
          this.jobsLoading = false;
        },
        error: (err) => {
          this.jobs = [];
          this.error = err?.error?.message || 'Unable to load recruiter jobs.';
          this.jobsLoading = false;
        },
      });
  }

  loadCandidates(): void {
    this.candidatesLoading = true;
    this.candidateService
      .listCandidates({ limit: 24, sortBy: 'score-desc' })
      .pipe(finalize(() => this.cdr.markForCheck()))
      .subscribe({
        next: (response: any) => {
          this.candidates = response?.candidates || [];
          for (const candidate of this.candidates) {
            const cid = this.candidateId(candidate);
            if (cid) {
              this.compareNames.set(cid, candidate?.name || candidate?.fullName || 'Candidate');
            }
          }
          this.candidatesLoading = false;
        },
        error: () => {
          this.candidatesLoading = false;
        },
      });
  }

  loadMatches(): void {
    this.matchesRequest?.unsubscribe();
    this.matches = [];
    this.matchesLoading = true;
    this.matchesRequest = this.matchService
      .listMatches(this.selectedJobId ? { jobId: this.selectedJobId } : {})
      .pipe(finalize(() => this.cdr.markForCheck()))
      .subscribe({
        next: (response: any) => {
          this.matches = response?.matches || [];
          this.matchesLoading = false;
        },
        error: (err) => {
          this.matches = [];
          this.clearCompare();
          this.error = err?.error?.message || 'Unable to load saved matches.';
          this.matchesLoading = false;
        },
      });
  }

  onJobChange(jobId: string): void {
    this.selectedJobId = jobId;
    this.loadMatches();
  }

  toggleCandidate(candidate: any): void {
    const id = this.candidateId(candidate);
    if (!id) {
      return;
    }
    if (this.selectedCandidateIds.has(id)) {
      this.selectedCandidateIds.delete(id);
    } else {
      this.selectedCandidateIds.add(id);
    }
  }

  clearSelection(): void {
    this.selectedCandidateIds.clear();
  }

  isCandidateSelected(candidate: any): boolean {
    const id = this.candidateId(candidate);
    return id ? this.selectedCandidateIds.has(id) : false;
  }

  runMatches(): void {
    if (!this.selectedJobId || this.generating || !this.canManageSelectedJob) {
      if (!this.selectedJobId) {
        this.error = 'Select a target job before running match scoring.';
      }
      return;
    }
    this.generating = true;
    this.error = '';
    this.notice = '';

    const candidateIds = Array.from(this.selectedCandidateIds);
    this.matchService
      .generateMatches({
        jobId: this.selectedJobId,
        candidateIds: candidateIds.length ? candidateIds : undefined,
      })
      .pipe(finalize(() => this.cdr.markForCheck()))
      .subscribe({
        next: (response: any) => {
          const generatedMatches = response?.matches || [];
          const generatedCount = generatedMatches.length;
          // Hydrate persisted match records so newly generated items carry Mongo _id for status updates.
          this.matchService
            .listMatches(this.selectedJobId ? { jobId: this.selectedJobId } : {})
            .pipe(finalize(() => this.cdr.markForCheck()))
            .subscribe({
              next: (persisted: any) => {
                const hydrated = persisted?.matches || [];
                this.matches = hydrated.length ? hydrated : generatedMatches;
                this.notice = `Generated ${generatedCount} match results.`;
                this.generating = false;
              },
              error: () => {
                this.matches = generatedMatches;
                this.notice = `Generated ${generatedCount} match results.`;
                this.generating = false;
              },
            });
        },
        error: (err) => {
          this.error = err?.error?.message || 'Could not generate matches.';
          this.generating = false;
        },
      });
  }

  shortlist(match: any): void {
    if (match?.access?.manage !== true) return;
    const candidateId = String(match?.candidate?.id || match?.candidateId || '').trim();
    const jobId = String(match?.job?._id || match?.jobId || this.selectedJobId || '').trim();
    if (!candidateId) {
      return;
    }
    this.error = '';
    this.notice = '';

    this.matchService
      .addToShortlist({
        candidateId,
        jobId: jobId || undefined,
      })
      .pipe(finalize(() => this.cdr.markForCheck()))
      .subscribe({
        next: () => {
          match.status = 'shortlisted';
          this.loadMatches();
          this.notice = `${match?.candidate?.name || 'Candidate'} shortlisted for ${match?.job?.title || 'job'}.`;
        },
        error: (err) => {
          this.refreshAfterDenied(err);
          this.error = err?.error?.message || 'Could not shortlist candidate.';
        },
      });
  }

  updateStatus(match: any, status: 'generated' | 'rejected'): void {
    if (match?.access?.manage !== true) return;
    const matchId = String(match?._id || match?.id || '').trim();
    if (!matchId) {
      this.error = 'Reload saved matches before updating this match status.';
      return;
    }
    this.error = '';
    this.notice = '';

    this.matchService
      .updateMatchStatus(matchId, status, match.version)
      .pipe(finalize(() => this.cdr.markForCheck()))
      .subscribe({
        next: (response) => {
          Object.assign(match, response?.match || { status });
          this.notice =
            status === 'rejected'
              ? `${match?.candidate?.name || 'Match'} marked as rejected.`
              : `${match?.candidate?.name || 'Match'} restored to generated.`;
        },
        error: (err) => {
          this.refreshAfterDenied(err);
          this.error = err?.error?.message || 'Could not update match status.';
        },
      });
  }

  compare(match: any): void {
    const candidateId = String(match?.candidate?.id || match?.candidateId || '').trim();
    if (!candidateId) {
      return;
    }
    this.error = '';

    if (this.compareIds.has(candidateId)) {
      this.compareIds.delete(candidateId);
      return;
    }
    if (this.compareIds.size >= 3) {
      this.error = 'Select up to 3 candidates for comparison.';
      return;
    }
    this.compareNames.set(candidateId, match?.candidate?.name || 'Candidate');
    this.compareIds.add(candidateId);
  }

  removeCompareId(id: string): void {
    this.compareIds.delete(id);
  }

  clearCompare(): void {
    this.compareIds.clear();
  }

  isMatchSelected(match: any): boolean {
    const cid = String(match?.candidate?.id || match?.candidateId || '').trim();
    return cid ? this.compareIds.has(cid) : false;
  }

  openComparison(): void {
    if (this.compareIds.size < 2) {
      this.error = 'Select at least 2 candidates to compare side by side.';
      return;
    }
    this.router.navigate(['/app/recruiter/comparison'], {
      queryParams: {
        ids: Array.from(this.compareIds).join(','),
        jobId: this.jobs.find((job) => String(job._id || job.id) === this.selectedJobId)?.access
          ?.isOwner
          ? this.selectedJobId
          : undefined,
      },
    });
  }

  private refreshAfterDenied(error: any): void {
    if ([403, 404, 409].includes(error?.status)) {
      this.matches = [];
      this.clearCompare();
      this.loadJobs();
      this.loadMatches();
    }
  }

  trackByItem(_: number, item: any): string {
    return String(item?._id || item?.id || item?.userId || _);
  }

  private candidateId(candidate: any): string {
    return String(candidate?.id || candidate?.userId || candidate?._id || '').trim();
  }
}
