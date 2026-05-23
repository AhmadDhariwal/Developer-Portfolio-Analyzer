import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { SearchableSelectOption } from '../../../../shared/components/searchable-select/searchable-select.component';
import { CandidateService } from '../../services/candidate.service';
import { RecruiterJobService } from '../../services/recruiter-job.service';
import { RecruiterMatchService } from '../../services/recruiter-match.service';

@Component({
  selector: 'app-recruiter-matches',
  standalone: false,
  templateUrl: './matches.component.html',
  styleUrl: './matches.component.css'
})
export class MatchesComponent implements OnInit {
  loading = true;
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
    private readonly jobService: RecruiterJobService,
    private readonly candidateService: CandidateService,
    private readonly matchService: RecruiterMatchService
  ) {}

  get jobOptions(): SearchableSelectOption[] {
    return this.jobs.map((job) => ({ value: job._id, label: job.title, meta: job.status }));
  }

  ngOnInit(): void {
    this.selectedJobId = this.route.snapshot.queryParamMap.get('jobId') || '';
    this.loadReferenceData();
  }

  loadReferenceData(): void {
    this.loading = true;
    this.error = '';
    Promise.all([
      new Promise<void>((resolve) => {
        this.jobService.listJobs().subscribe({
          next: (response) => {
            this.jobs = response?.jobs || [];
            resolve();
          },
          error: () => resolve()
        });
      }),
      new Promise<void>((resolve) => {
        this.candidateService.listCandidates({ limit: 24, sortBy: 'score-desc' }).subscribe({
          next: (response) => {
            this.candidates = response?.candidates || [];
            resolve();
          },
          error: () => resolve()
        });
      })
    ]).then(() => this.loadMatches());
  }

  loadMatches(): void {
    this.loading = true;
    this.matchService.listMatches(this.selectedJobId ? { jobId: this.selectedJobId } : {}).subscribe({
      next: (response) => {
        this.matches = response?.matches || [];
        this.loading = false;
      },
      error: (err) => {
        this.matches = [];
        this.error = err?.error?.message || 'Unable to load match results.';
        this.loading = false;
      }
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
    this.loading = true;
    this.error = '';
    this.notice = '';
    const candidateIds = Array.from(this.selectedCandidateIds);
    this.matchService.generateMatches({
      jobId: this.selectedJobId,
      candidateIds: candidateIds.length ? candidateIds : undefined
    }).subscribe({
      next: (response) => {
        this.matches = response?.matches || [];
        this.notice = `Generated ${this.matches.length} match results.`;
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.message || 'Unable to generate matches.';
        this.loading = false;
      }
    });
  }

  shortlist(match: any): void {
    this.matchService.addToShortlist({
      candidateId: match?.candidateId,
      jobId: match?.jobId
    }).subscribe({
      next: () => {
        this.notice = `${match?.candidate?.name || 'Candidate'} added to shortlist.`;
        this.matches = this.matches.map((entry) => entry === match ? { ...entry, status: 'shortlisted', shortlisted: true } : entry);
      },
      error: (err) => {
        this.error = err?.error?.message || 'Unable to shortlist this match.';
      }
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
          jobId: this.selectedJobId || undefined
        }
      });
    }
  }

  private getCandidateId(candidate: any): string {
    return String(candidate?.id || candidate?.userId || '').trim();
  }
}
