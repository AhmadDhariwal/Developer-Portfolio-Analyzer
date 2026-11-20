import { ChangeDetectorRef, Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { finalize } from 'rxjs/operators';
import { PerformanceChartItem } from '../../components/recruiter-performance-chart/recruiter-performance-chart.component';
import { CandidateService } from '../../services/candidate.service';
import { RecruiterMatchService } from '../../services/recruiter-match.service';

@Component({
  selector: 'app-recruiter-candidate-details',
  templateUrl: './candidate-details.component.html',
  styleUrl: './candidate-details.component.scss',
  standalone: false,
})
export class CandidateDetailsComponent implements OnInit {
  private readonly cdr = inject(ChangeDetectorRef);
  loading = true;
  analyzing = false;
  shortlisting = false;
  error = '';
  notice = '';
  candidate: any = null;
  analysis: any = null;

  private currentCandidateId = '';
  private readonly destroyRef = inject(DestroyRef);

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private candidateService: CandidateService,
    private matchService: RecruiterMatchService,
  ) {}

  ngOnInit(): void {
    const paramStream = this.route.paramMap;
    if (paramStream) {
      paramStream.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
        const id = String(params.get('id') || '').trim();
        this.initWithCandidateId(id);
      });
      return;
    }
    const fallbackId = String(this.route.snapshot?.paramMap?.get('id') || '').trim();
    this.initWithCandidateId(fallbackId);
  }

  private initWithCandidateId(id: string): void {
    if (!id) {
      this.error = 'Candidate id is missing.';
      this.loading = false;
      return;
    }
    this.currentCandidateId = id;
    this.loadCandidate();
  }

  get initial(): string {
    return (
      String(this.candidate?.name || this.candidate?.fullName || 'C')
        .trim()
        .charAt(0)
        .toUpperCase() || 'C'
    );
  }

  get readinessScore(): number {
    return Math.round(Number(this.candidate?.readinessScore ?? this.candidate?.score ?? 0));
  }

  get hasGithubScore(): boolean {
    return this.candidate?.githubScore !== null && this.candidate?.githubScore !== undefined;
  }

  get hasConfidenceScore(): boolean {
    return (
      this.analysis?.confidenceScore !== null &&
      this.analysis?.confidenceScore !== undefined &&
      Number.isFinite(Number(this.analysis.confidenceScore))
    );
  }

  get breakdownChartItems(): PerformanceChartItem[] {
    if (!this.candidate) {
      return [];
    }
    const candidates: Array<{ label: string; raw: unknown }> = [
      { label: 'Readiness', raw: this.candidate?.readinessScore ?? this.candidate?.score },
      { label: 'GitHub', raw: this.candidate?.githubScore },
      { label: 'Resume', raw: this.candidate?.resumeScore },
      { label: 'Consistency', raw: this.candidate?.consistencyScore },
      { label: 'Growth', raw: this.candidate?.growthPotentialScore },
      { label: 'Profile', raw: this.candidate?.profileCompleteness },
    ];
    return candidates
      .filter(
        (entry) =>
          entry.raw !== null && entry.raw !== undefined && Number.isFinite(Number(entry.raw)),
      )
      .map((entry) => ({
        label: entry.label,
        count: Math.round(Number(entry.raw)),
      }));
  }

  get skillScores(): Array<{ name: string; score: number }> {
    const items = Array.isArray(this.candidate?.skillScores) ? this.candidate.skillScores : [];
    return items
      .filter((item: any) => item?.name)
      .map((item: any) => ({
        name: String(item.name),
        score: Math.min(100, Math.max(0, Math.round(Number(item.score ?? 0)))),
      }));
  }

  get strengthsList(): string[] {
    return Array.isArray(this.analysis?.strengths) ? this.analysis.strengths : [];
  }

  get weaknessesList(): string[] {
    return Array.isArray(this.analysis?.weaknesses) ? this.analysis.weaknesses : [];
  }

  loadCandidate(): void {
    if (!this.currentCandidateId) {
      return;
    }
    this.loading = true;
    this.error = '';

    this.candidateService
      .getCandidate(this.currentCandidateId)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.cdr.markForCheck()),
      )
      .subscribe({
        next: (response: any) => {
          this.candidate = response?.candidate || null;
          this.loading = false;
        },
        error: (err) => {
          this.error = err?.error?.message || 'Unable to load candidate profile.';
          this.loading = false;
        },
      });
  }

  analyzeCandidate(): void {
    const id = String(
      this.candidate?.id || this.candidate?.userId || this.currentCandidateId,
    ).trim();
    if (!id || this.analyzing) {
      return;
    }
    this.analyzing = true;
    this.error = '';
    this.notice = '';

    this.candidateService
      .analyzeCandidate(id)
      .pipe(finalize(() => this.cdr.markForCheck()))
      .subscribe({
        next: (response: any) => {
          this.analysis = response?.analysis || response?.insight || null;
          this.notice = 'AI candidate analysis updated from verified telemetry.';
          this.analyzing = false;
        },
        error: (err) => {
          this.error = err?.error?.message || 'Could not run candidate analysis.';
          this.analyzing = false;
        },
      });
  }

  analyze(): void {
    this.analyzeCandidate();
  }

  addToShortlist(): void {
    const id = String(
      this.candidate?.id || this.candidate?.userId || this.currentCandidateId,
    ).trim();
    if (!id || this.shortlisting) {
      return;
    }
    this.shortlisting = true;
    this.error = '';
    this.notice = '';

    this.matchService
      .addToShortlist({ candidateId: id })
      .pipe(finalize(() => this.cdr.markForCheck()))
      .subscribe({
        next: () => {
          this.notice = `${this.candidate?.name || 'Candidate'} added to shortlist.`;
          this.shortlisting = false;
        },
        error: (err) => {
          this.error = err?.error?.message || 'Could not add candidate to shortlist.';
          this.shortlisting = false;
        },
      });
  }

  shortlist(): void {
    this.addToShortlist();
  }

  openComparison(): void {
    const id = String(
      this.candidate?.id || this.candidate?.userId || this.currentCandidateId,
    ).trim();
    this.router.navigate(['/app/recruiter/comparison'], {
      queryParams: id ? { ids: id } : undefined,
    });
  }

  formatScore(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) {
      return 'Unavailable';
    }
    return `${Math.round(Number(value))}%`;
  }
}
