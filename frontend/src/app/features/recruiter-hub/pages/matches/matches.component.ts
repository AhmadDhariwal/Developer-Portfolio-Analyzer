import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { SearchableSelectOption } from '../../../../shared/components/searchable-select/searchable-select.component';
import { CandidateService } from '../../services/candidate.service';
import { RecruiterJobService } from '../../services/recruiter-job.service';
import { RecruiterMatchService } from '../../services/recruiter-match.service';

@Component({
  selector: 'app-recruiter-matches',
  standalone: false,
  template: `
    <section class="hub-page">
      <header class="hub-header">
        <div>
          <span class="hub-kicker">Recruiter Hub</span>
          <h1>Match Results</h1>
          <p>Select a job, optionally narrow the candidate pool, and generate AI-ranked match results.</p>
        </div>
        <div class="hub-summary">
          <strong>{{ matches.length }}</strong>
          <span>Results loaded</span>
        </div>
      </header>

      <div class="message message--error" *ngIf="error">{{ error }}</div>
      <div class="message message--success" *ngIf="notice">{{ notice }}</div>

      <div class="glass-form">
        <div class="field">
          <label>Select job</label>
          <app-searchable-select [options]="jobOptions" [value]="selectedJobId" [emptyOptionLabel]="'Choose a job'" (valueChange)="onJobChange($event)" />
        </div>
        <div class="field">
          <label>Candidate pool</label>
          <div class="selection-chip">{{ selectedCandidateIds.size || 0 }} selected</div>
        </div>
        <div class="form-actions">
          <button type="button" class="ghost-btn" (click)="clearSelection()">Clear Selection</button>
          <button type="button" class="primary-btn" [disabled]="!selectedJobId" (click)="runMatches()">Generate Matches</button>
        </div>
      </div>

      <div class="candidate-picker" *ngIf="candidates.length > 0">
        <button
          type="button"
          class="candidate-pill"
          *ngFor="let candidate of candidates"
          [class.candidate-pill--active]="isCandidateSelected(candidate)"
          (click)="toggleCandidate(candidate)">
          <strong>{{ candidate.name || candidate.fullName }}</strong>
          <span>{{ candidate.stack || 'Generalist' }} | {{ candidate.readinessScore || candidate.score || 0 }}</span>
        </button>
      </div>

      <app-recruiter-loader *ngIf="loading" label="Loading matches..." />

      <div class="card-grid" *ngIf="!loading && matches.length > 0">
        <app-match-card
          *ngFor="let match of matches"
          [match]="match"
          (shortlist)="shortlist(match)"
          (compare)="compare(match)" />
      </div>

      <app-recruiter-empty-state
        *ngIf="!loading && matches.length === 0"
        title="No match results yet"
        message="Choose a job and run AI ranking to build live match results for your pipeline." />
    </section>
  `,
  styles: [`
    .hub-page{display:flex;flex-direction:column;gap:1rem}
    .hub-header{display:flex;justify-content:space-between;gap:1rem;align-items:flex-end;flex-wrap:wrap}
    .hub-kicker{display:inline-flex;margin-bottom:.45rem;padding:.32rem .68rem;border-radius:999px;background:rgba(79,70,229,.16);color:#c7d2fe;font-size:.72rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
    h1{margin:0;color:#f8fafc;font-size:2rem}
    .hub-header p{margin:.4rem 0 0;color:#94a3b8;max-width:720px}
    .hub-summary{padding:1rem 1.2rem;border-radius:20px;background:linear-gradient(135deg,rgba(79,70,229,.22),rgba(14,165,233,.14));border:1px solid rgba(99,102,241,.22);display:flex;flex-direction:column;align-items:flex-end}
    .hub-summary strong{color:#f8fafc;font-size:1.5rem;line-height:1}
    .hub-summary span{margin-top:.35rem;color:#cbd5e1;font-size:.82rem}
    .message{padding:.85rem 1rem;border-radius:14px;font-size:.88rem}
    .message--error{background:rgba(127,29,29,.45);border:1px solid rgba(248,113,113,.24);color:#fecaca}
    .message--success{background:rgba(6,78,59,.45);border:1px solid rgba(52,211,153,.2);color:#bbf7d0}
    .glass-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:.9rem;padding:1rem 1.1rem;border-radius:22px;background:linear-gradient(180deg,rgba(15,23,42,.94),rgba(15,23,42,.82));border:1px solid rgba(99,102,241,.16);box-shadow:0 24px 44px rgba(2,6,23,.28)}
    .field{display:flex;flex-direction:column;gap:.4rem}
    label{font-size:.72rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#94a3b8}
    .selection-chip{min-height:44px;border-radius:12px;border:1px solid rgba(71,85,105,.75);background:rgba(15,23,42,.86);display:flex;align-items:center;padding:0 .9rem;color:#f8fafc}
    .form-actions{display:flex;gap:.75rem;align-items:flex-end;justify-content:flex-end;flex-wrap:wrap}
    .primary-btn,.ghost-btn{min-height:42px;border:none;border-radius:12px;font-weight:700;cursor:pointer;padding:0 1rem}
    .primary-btn{background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff}
    .ghost-btn{background:rgba(30,41,59,.92);color:#e2e8f0}
    .primary-btn[disabled]{opacity:.45;cursor:not-allowed}
    .candidate-picker{display:flex;flex-wrap:wrap;gap:.65rem}
    .candidate-pill{border:1px solid rgba(99,102,241,.16);border-radius:16px;background:rgba(15,23,42,.86);padding:.75rem .85rem;display:flex;flex-direction:column;gap:.2rem;color:#e2e8f0;cursor:pointer;min-width:170px;text-align:left}
    .candidate-pill span{font-size:.78rem;color:#94a3b8}
    .candidate-pill--active{border-color:rgba(96,165,250,.58);background:rgba(30,41,59,.94)}
    .card-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:1rem}
  `]
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
