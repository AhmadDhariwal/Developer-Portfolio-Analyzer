import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';

import { RecruiterCandidate, RecruiterService } from '../../services/recruiter.service';
import { RecruiterMessageService } from '../../../recruiter-shared/services/recruiter-message.service';

@Component({
  selector: 'app-candidate-list-page',
  standalone: false,
  templateUrl: './candidate-list.component.html',
  styleUrls: ['./candidate-list.component.scss']
})
export class CandidateListPageComponent implements OnInit {
  filters = {
    search: '',
    stack: '',
    experience: 0,
    minScore: 0
  };

  candidates: RecruiterCandidate[] = [];

  constructor(
    public readonly recruiterService: RecruiterService,
    private readonly recruiterMessage: RecruiterMessageService,
    private readonly router: Router
  ) {}

  ngOnInit(): void {
    this.loadCandidates();
  }

  loadCandidates(): void {
    this.recruiterService.getCandidates(this.filters).subscribe({
      next: (candidates) => {
        this.candidates = candidates;
        if (!candidates.length) {
          this.recruiterMessage.warning('No candidates found for current filters.');
        }
      },
      error: () => {
        this.candidates = [];
        this.recruiterMessage.error('Failed to load recruiter candidates.');
      }
    });
  }

  openProfile(candidateId: string): void {
    this.router.navigate(['/app/recruiter/candidate', candidateId]);
  }
}
