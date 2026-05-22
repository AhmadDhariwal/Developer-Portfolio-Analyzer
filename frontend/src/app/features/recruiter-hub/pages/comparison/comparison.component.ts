import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { SearchableSelectOption } from '../../../../shared/components/searchable-select/searchable-select.component';
import { CandidateService } from '../../services/candidate.service';
import { RecruiterJobService } from '../../services/recruiter-job.service';
import { RecruiterMatchService } from '../../services/recruiter-match.service';

@Component({
  selector: 'app-recruiter-comparison',
  standalone: false,
  template: `
    <section class="hub-page">
      <header class="hub-header">
        <div>
          <span class="hub-kicker">Recruiter Hub</span>
          <h1>Comparison</h1>
          <p>Choose up to 3 candidates and compare real scores, readiness, and optional job match context.</p>
        </div>
        <button type="button" class="primary-btn" [disabled]="selectedIds.size < 2" (click)="loadComparison()">Compare Candidates</button>
      </header>

      <div class="message message--error" *ngIf="error">{{ error }}</div>

      <div class="glass-form">
        <div class="field">
          <label>Optional job context</label>
          <app-searchable-select [options]="jobOptions" [value]="selectedJobId" [emptyOptionLabel]="'No job selected'" (valueChange)="selectedJobId = $event" />
        </div>
        <div class="field">
          <label>Selected candidates</label>
          <div class="selection-chip">{{ selectedIds.size }} of 3 selected</div>
        </div>
      </div>

      <div class="candidate-picker" *ngIf="candidates.length > 0">
        <button
          type="button"
          class="candidate-pill"
          *ngFor="let candidate of candidates"
          [class.candidate-pill--active]="isSelected(candidate)"
          (click)="toggleCandidate(candidate)">
          <strong>{{ candidate.name || candidate.fullName }}</strong>
          <span>{{ candidate.stack || 'Generalist' }} | {{ candidate.readinessScore || candidate.score || 0 }}</span>
        </button>
      </div>

      <app-recruiter-loader *ngIf="loading" label="Loading comparison..." />

      <app-comparison-table *ngIf="!loading && comparison.length > 0" [items]="comparison" />

      <app-recruiter-empty-state
        *ngIf="!loading && comparison.length === 0"
        title="Select candidates to compare"
        message="Pick at least 2 candidates from the scoped list above to unlock the side-by-side comparison table." />
    </section>
  `,
  styles: [`
    .hub-page{display:flex;flex-direction:column;gap:1rem}
    .hub-header{display:flex;justify-content:space-between;gap:1rem;align-items:flex-end;flex-wrap:wrap}
    .hub-kicker{display:inline-flex;margin-bottom:.45rem;padding:.32rem .68rem;border-radius:999px;background:rgba(79,70,229,.16);color:#c7d2fe;font-size:.72rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
    h1{margin:0;color:#f8fafc;font-size:2rem}
    .hub-header p{margin:.4rem 0 0;color:#94a3b8;max-width:720px}
    .message--error{padding:.85rem 1rem;border-radius:14px;background:rgba(127,29,29,.45);border:1px solid rgba(248,113,113,.24);color:#fecaca}
    .glass-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:.9rem;padding:1rem 1.1rem;border-radius:22px;background:linear-gradient(180deg,rgba(15,23,42,.94),rgba(15,23,42,.82));border:1px solid rgba(99,102,241,.16);box-shadow:0 24px 44px rgba(2,6,23,.28)}
    .field{display:flex;flex-direction:column;gap:.4rem}
    label{font-size:.72rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#94a3b8}
    .selection-chip{min-height:44px;border-radius:12px;border:1px solid rgba(71,85,105,.75);background:rgba(15,23,42,.86);display:flex;align-items:center;padding:0 .9rem;color:#f8fafc}
    .candidate-picker{display:flex;flex-wrap:wrap;gap:.65rem}
    .candidate-pill{border:1px solid rgba(99,102,241,.16);border-radius:16px;background:rgba(15,23,42,.86);padding:.75rem .85rem;display:flex;flex-direction:column;gap:.2rem;color:#e2e8f0;cursor:pointer;min-width:170px;text-align:left}
    .candidate-pill span{font-size:.78rem;color:#94a3b8}
    .candidate-pill--active{border-color:rgba(96,165,250,.58);background:rgba(30,41,59,.94)}
    .primary-btn{min-height:42px;border:none;border-radius:12px;background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff;font-weight:700;cursor:pointer;padding:0 1rem}
    .primary-btn[disabled]{opacity:.45;cursor:not-allowed}
  `]
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
