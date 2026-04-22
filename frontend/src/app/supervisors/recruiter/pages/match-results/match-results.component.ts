import { Component, OnInit } from '@angular/core';

import { RecruiterCandidate, RecruiterJob, RankedCandidate, RecruiterService } from '../../services/recruiter.service';
import { RecruiterMessageService } from '../../../recruiter-shared/services/recruiter-message.service';

@Component({
  selector: 'app-match-results-page',
  standalone: false,
  templateUrl: './match-results.component.html',
  styleUrls: ['./match-results.component.scss']
})
export class MatchResultsPageComponent implements OnInit {
  jobs: RecruiterJob[] = [];
  candidates: RecruiterCandidate[] = [];
  selectedJobId = '';
  selectedCandidateIds = new Set<string>();
  matches: RankedCandidate[] = [];

  constructor(
    public readonly recruiterService: RecruiterService,
    private readonly recruiterMessage: RecruiterMessageService
  ) {}

  ngOnInit(): void {
    this.loadData();
  }

  loadData(): void {
    this.recruiterService.getJobs().subscribe({
      next: (jobs) => {
        this.jobs = jobs;
      },
      error: () => {
        this.jobs = [];
      }
    });

    this.recruiterService.getCandidates({ limit: 100 }).subscribe({
      next: (candidates) => {
        this.candidates = candidates;
      },
      error: () => {
        this.candidates = [];
      }
    });
  }

  setSelectedJob(jobId: string): void {
    this.selectedJobId = jobId;
  }

  handleSelection(event: { id: string; selected: boolean }): void {
    if (event.selected) {
      this.selectedCandidateIds.add(event.id);
    } else {
      this.selectedCandidateIds.delete(event.id);
    }
  }

  runMatch(): void {
    if (!this.selectedJobId) {
      this.recruiterMessage.warning('Please select a job before matching.');
      return;
    }

    this.recruiterService.matchCandidates(this.selectedJobId, Array.from(this.selectedCandidateIds)).subscribe({
      next: (result) => {
        this.matches = result.rankedCandidates || [];
        this.recruiterMessage.success('Candidate matching completed successfully.');
      },
      error: () => {
        this.matches = [];
        this.recruiterMessage.error('Failed to match candidates.');
      }
    });
  }

  runAiRank(): void {
    if (!this.selectedJobId) {
      this.recruiterMessage.warning('Please select a job before AI ranking.');
      return;
    }

    this.recruiterService.rankCandidates(this.selectedJobId, Array.from(this.selectedCandidateIds)).subscribe({
      next: (result) => {
        this.matches = result.rankedCandidates || [];
        this.recruiterMessage.success('AI ranking completed successfully.');
      },
      error: () => {
        this.matches = [];
        this.recruiterMessage.error('Failed to run AI ranking.');
      }
    });
  }
}
