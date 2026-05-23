import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CandidateService } from '../../services/candidate.service';
import { RecruiterMatchService } from '../../services/recruiter-match.service';

@Component({
  selector: 'app-recruiter-candidate-details',
  standalone: false,
  templateUrl: './candidate-details.component.html',
  styleUrl: './candidate-details.component.css'
})
export class CandidateDetailsComponent implements OnInit {
  loading = true;
  error = '';
  notice = '';
  candidate: any = null;
  analysis: any = null;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly candidateService: CandidateService,
    private readonly matchService: RecruiterMatchService
  ) {}

  get initial(): string {
    return String(this.candidate?.name || 'C').trim().charAt(0).toUpperCase() || 'C';
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id') || '';
    this.candidateService.getCandidate(id).subscribe({
      next: (response) => {
        this.candidate = response?.candidate || null;
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.message || 'Unable to load candidate details.';
        this.loading = false;
      }
    });
  }

  analyze(): void {
    const candidateId = this.getCandidateId();
    if (!candidateId) return;
    this.notice = '';
    this.error = '';
    this.candidateService.analyzeCandidate(candidateId).subscribe({
      next: (response) => {
        this.analysis = response?.analysis || null;
        this.notice = 'AI summary refreshed.';
      },
      error: (err) => {
        this.error = err?.error?.message || 'Unable to analyze this candidate right now.';
      }
    });
  }

  shortlist(): void {
    const candidateId = this.getCandidateId();
    if (!candidateId) return;
    this.notice = '';
    this.error = '';
    this.matchService.addToShortlist({ candidateId }).subscribe({
      next: () => {
        this.notice = `${this.candidate?.name || 'Candidate'} added to shortlist.`;
      },
      error: (err) => {
        this.error = err?.error?.message || 'Unable to shortlist this candidate.';
      }
    });
  }

  goBackToCandidates(): void {
    this.router.navigate(['/app/recruiter/candidates']);
  }

  private getCandidateId(): string {
    return String(this.candidate?.id || this.candidate?.userId || '').trim();
  }
}
