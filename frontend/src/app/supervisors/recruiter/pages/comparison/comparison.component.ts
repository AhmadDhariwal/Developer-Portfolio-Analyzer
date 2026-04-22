import { Component, OnInit } from '@angular/core';

import { RecruiterCandidate, RecruiterService } from '../../services/recruiter.service';
import { RecruiterMessageService } from '../../../recruiter-shared/services/recruiter-message.service';

@Component({
  selector: 'app-candidate-comparison-page',
  standalone: false,
  templateUrl: './comparison.component.html',
  styleUrls: ['./comparison.component.scss']
})
export class CandidateComparisonPageComponent implements OnInit {
  candidates: RecruiterCandidate[] = [];
  selectedIds = new Set<string>();

  constructor(
    public readonly recruiterService: RecruiterService,
    private readonly recruiterMessage: RecruiterMessageService
  ) {}

  ngOnInit(): void {
    this.recruiterService.getCandidates({ limit: 50 }).subscribe({
      next: (candidates) => {
        this.candidates = candidates;
      },
      error: () => {
        this.candidates = [];
        this.recruiterMessage.error('Failed to load candidates for comparison.');
      }
    });
  }

  handleSelection(event: { id: string; selected: boolean }): void {
    if (event.selected) {
      if (this.selectedIds.size >= 3) {
        this.recruiterMessage.warning('You can compare up to 3 candidates.');
        return;
      }
      this.selectedIds.add(event.id);
    } else {
      this.selectedIds.delete(event.id);
    }
  }

  get selectedCandidates(): RecruiterCandidate[] {
    return this.candidates.filter((candidate) => this.selectedIds.has(candidate.id));
  }
}
