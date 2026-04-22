import { Component, OnInit } from '@angular/core';
import { forkJoin } from 'rxjs';

import { RecruiterService, RecruiterCandidate, RecruiterJob, RankedCandidate } from '../../services/recruiter.service';

@Component({
  selector: 'app-recruiter-dashboard-page',
  standalone: false,
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class RecruiterDashboardPageComponent implements OnInit {
  totalCandidates = 0;
  averageScore = 0;
  topCandidates: RecruiterCandidate[] = [];
  recentMatches: RankedCandidate[] = [];
  jobs: RecruiterJob[] = [];

  constructor(public readonly recruiterService: RecruiterService) {}

  ngOnInit(): void {
    this.loadDashboard();
    this.recruiterService.latestMatches$.subscribe((matches) => {
      this.recentMatches = matches.slice(0, 5);
    });
  }

  private loadDashboard(): void {
    forkJoin({
      candidates: this.recruiterService.getCandidates({ limit: 100 }),
      jobs: this.recruiterService.getJobs()
    }).subscribe({
      next: ({ candidates, jobs }) => {
        this.totalCandidates = candidates.length;
        this.jobs = jobs;
        this.topCandidates = [...candidates]
          .sort((a, b) => b.score - a.score)
          .slice(0, 3);

        const total = candidates.reduce((sum, item) => sum + (item.score || 0), 0);
        this.averageScore = candidates.length ? Number((total / candidates.length).toFixed(2)) : 0;
      },
      error: () => {
        this.totalCandidates = 0;
        this.averageScore = 0;
        this.topCandidates = [];
        this.jobs = [];
      }
    });
  }
}
