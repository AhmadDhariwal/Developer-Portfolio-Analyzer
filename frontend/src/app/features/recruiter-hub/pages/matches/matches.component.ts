import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { SearchableSelectOption } from '../../../../shared/components/searchable-select/searchable-select.component';
import { CandidateService } from '../../services/candidate.service';
import { RecruiterHubService } from '../../services/recruiter-hub.service';
import { RecruiterJobService } from '../../services/recruiter-job.service';
import { RecruiterMatchService } from '../../services/recruiter-match.service';

@Component({
  selector: 'app-recruiter-matches',
  standalone: false,
  templateUrl: './matches.component.html',
  styleUrl: './matches.component.scss',
})
export class MatchesComponent implements OnInit {
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
  readonly selectedCandidateIds = new Set<string>();
  readonly compareIds = new Set<string>();

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly hubService: RecruiterHubService,
    private readonly jobService: RecruiterJobService,
    private readonly candidateService: CandidateService,
    private readonly matchService: RecruiterMatchService,
  ) {}

  get jobOptions(): SearchableSelectOption[] {
    return this.jobs.map((job) => ({ value: job._id, label: job.title, meta: job.status }));
  }

  ngOnInit(): void {
    this.selectedJobId = this.route.snapshot.queryParamMap.get('jobId') || '';
    this.loadJobs();
    this.loadCandidates();
  }

  get openJobsCount(): number {
    return this.jobs.filter((job) => String(job?.status || '').toLowerCase() === 'open').length;
  }

  get shortlistedCount(): number {
    return this.matches.filter((match) => String(match?.status || '').toLowerCase() === 'shortlisted')
      .length;
  }

  get rejectedCount(): number {
    return this.matches.filter((match) => String(match?.status || '').toLowerCase() === 'rejected')
      .length;
  }

  loadJobs(): void {
    this.jobsLoading = true;
    this.jobService.listJobs().subscribe({
      next: (response) => {
        this.jobs = response?.jobs || [];
        if (!this.selectedJobId && this.jobs.length) {
          const preferredJob =
            this.jobs.find((job) => String(job?.status || '').toLowerCase() === 'open') ||
            this.jobs.find((job) => String(job?.status || '').toLowerCase() === 'draft') ||
            this.jobs[0];
          this.selectedJobId = String(preferredJob?._id || '');
        }
        this.jobsLoading = false;
        this.loadMatches();
      },
      error: (err) => {
        this.jobs = [];
        this.jobsLoading = false;
        this.error = err?.error?.message || 'Unable to load jobs. Existing matches may still be available.';
        this.loadMatches();
      },
    });
  }

  loadCandidates(): void {
    this.candidatesLoading = true;
    this.candidateService.listCandidates({ limit: 24, sortBy: 'score-desc' }).subscribe({
      next: (response) => {
        this.candidates = response?.candidates || [];
        this.candidatesLoading = false;
      },
      error: (err) => {
        this.candidates = [];
        this.candidatesLoading = false;
        this.error =
          this.error || err?.error?.message || 'Unable to load candidate suggestions right now.';
      },
    });
  }

  loadMatches(): void {
    this.matchesLoading = true;
    this.matchService
      .listMatches(this.selectedJobId ? { jobId: this.selectedJobId } : {})
      .subscribe({
        next: (response) => {
          this.matches = response?.matches || [];
          this.error = '';
          this.matchesLoading = false;
        },
        error: (err) => {
          this.matches = [];
          this.error = err?.error?.message || 'Unable to load match results.';
          this.matchesLoading = false;
        },
      });
  }

  onJobChange(jobId: string): void {
    this.selectedJobId = jobId;
    this.loadMatches();
  }

  toggleCandidate(candidate: any): void {
    const id = this.getCandidateId(candidate);
    if (!id) return;
    if (this.selectedCandidateIds.has(id)) {
      this.selectedCandidateIds.delete(id);
      return;
    }
    this.selectedCandidateIds.add(id);
  }

  clearSelection(): void {
    this.selectedCandidateIds.clear();
    this.compareIds.clear();
  }

  isCandidateSelected(candidate: any): boolean {
    return this.selectedCandidateIds.has(this.getCandidateId(candidate));
  }

  runMatches(): void {
    if (!this.selectedJobId) return;
    this.generating = true;
    this.matchesLoading = true;
    this.error = '';
    this.notice = '';
    const candidateIds = Array.from(this.selectedCandidateIds);
    this.matchService
      .generateMatches({
        jobId: this.selectedJobId,
        candidateIds: candidateIds.length ? candidateIds : undefined,
      })
      .subscribe({
        next: (response) => {
          this.matches = response?.matches || [];
          this.notice = `Generated ${this.matches.length} match results.`;
          this.hubService.clearCache();
          this.generating = false;
          this.matchesLoading = false;
        },
        error: (err) => {
          this.error = err?.error?.message || 'Unable to generate matches.';
          this.generating = false;
          this.matchesLoading = false;
        },
      });
  }

  shortlist(match: any): void {
    this.matchService
      .addToShortlist({
        candidateId: match?.candidateId,
        jobId: match?.jobId,
      })
      .subscribe({
        next: () => {
          this.notice = `${match?.candidate?.name || 'Candidate'} added to shortlist.`;
          this.error = '';
          this.matches = this.matches.map((entry) =>
            entry === match ? { ...entry, status: 'shortlisted', shortlisted: true } : entry,
          );
          this.hubService.clearCache();
        },
        error: (err) => {
          this.error = err?.error?.message || 'Unable to shortlist this match.';
        },
      });
  }

  updateStatus(match: any, status: 'generated' | 'rejected'): void {
    const matchId = String(match?._id || '').trim();
    if (!matchId) return;

    this.notice = '';
    this.error = '';
    this.matchService.updateMatchStatus(matchId, status).subscribe({
      next: (response) => {
        const nextMatch = response?.match || { ...match, status };
        this.matches = this.matches.map((entry) =>
          String(entry?._id || '') === matchId ? { ...entry, ...nextMatch } : entry,
        );
        this.notice = status === 'rejected' ? 'Match marked as rejected.' : 'Match reset to generated.';
        this.hubService.clearCache();
      },
      error: (err) => {
        this.error = err?.error?.message || 'Unable to update this match status.';
      },
    });
  }

  compare(match: any): void {
    const id = String(match?.candidateId || '').trim();
    if (!id) return;
    if (this.compareIds.has(id)) {
      this.compareIds.delete(id);
    } else if (this.compareIds.size < 3) {
      this.compareIds.add(id);
    } else {
      this.error = 'You can compare up to 3 matched candidates.';
      return;
    }

    if (this.compareIds.size >= 2) {
      this.router.navigate(['/app/recruiter/comparison'], {
        queryParams: {
          ids: Array.from(this.compareIds).join(','),
          jobId: this.selectedJobId || undefined,
        },
      });
    }
  }

  private getCandidateId(candidate: any): string {
    return String(candidate?.id || candidate?.userId || '').trim();
  }

  trackByItem(index: number, item: any): string {
    return String(
      item?._id || item?.id || item?.candidateId || item?.jobId || item?.userId || index,
    );
  }
}
