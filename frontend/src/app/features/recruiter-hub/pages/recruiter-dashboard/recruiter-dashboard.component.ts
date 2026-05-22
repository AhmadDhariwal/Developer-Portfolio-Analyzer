import { Component, OnInit } from '@angular/core';
import { RecruiterHubService } from '../../services/recruiter-hub.service';

@Component({
  selector: 'app-recruiter-dashboard',
  standalone: false,
  template: `
    <section class="hub-page">
      <header class="hero">
        <div>
          <span class="hero__kicker">Recruiter Hub</span>
          <h1>Welcome back, {{ dashboard?.profile?.name || 'Recruiter' }}</h1>
          <p>Live candidate, job, and AI match data across your recruiter workspace.</p>
        </div>
      </header>

      <div class="message message--error" *ngIf="error">{{ error }}</div>

      <app-recruiter-loader *ngIf="loading" label="Loading recruiter dashboard..." />

      <ng-container *ngIf="!loading && dashboard">
        <div class="metric-grid">
          <app-recruiter-stat-card label="Total Candidates" [value]="dashboard.metrics?.totalCandidates || 0" />
          <app-recruiter-stat-card label="Average Score" [value]="dashboard.metrics?.avgCandidateScore || 0" />
          <app-recruiter-stat-card label="Open Jobs" [value]="dashboard.metrics?.openJobs || 0" />
          <app-recruiter-stat-card label="Draft Jobs" [value]="dashboard.metrics?.draftJobs || 0" />
          <app-recruiter-stat-card label="Closed Jobs" [value]="dashboard.metrics?.closedJobs || 0" />
          <app-recruiter-stat-card label="Team Recruiters" [value]="dashboard.metrics?.teamRecruiters || 0" />
        </div>

        <div class="content-grid">
          <app-recruiter-performance-chart title="Candidate Score Distribution" [items]="dashboard.charts?.scoreDistribution || []" />
          <app-recruiter-performance-chart title="Candidates by Stack" [items]="dashboard.charts?.candidatesByStack || []" />
          <app-recruiter-performance-chart title="Jobs Posted Trend" [items]="dashboard.charts?.jobsPostedTrend || []" />
          <app-recruiter-performance-chart title="Experience Distribution" [items]="dashboard.charts?.experienceDistribution || []" />
          <app-recruiter-performance-chart title="Top Skills Demand" [items]="dashboard.charts?.topSkillsDemand || []" />
          <app-recruiter-performance-chart title="Supply vs Demand" [items]="dashboard.charts?.supplyVsDemand || []" />
        </div>

        <div class="split-grid">
          <article class="panel">
            <div class="panel__head">
              <h2>Top Candidates</h2>
            </div>
            <app-candidate-card *ngFor="let candidate of dashboard.widgets?.topCandidates || []" [candidate]="candidate" [hideActions]="true"></app-candidate-card>
          </article>

          <article class="panel">
            <div class="panel__head">
              <h2>Recent AI Matches</h2>
            </div>
            <app-match-card *ngFor="let match of dashboard.widgets?.recentMatches || []" [match]="match" [hideActions]="true"></app-match-card>
          </article>
        </div>

        <div class="split-grid">
          <article class="panel">
            <div class="panel__head">
              <h2>Recent Jobs</h2>
            </div>
            <app-job-card *ngFor="let job of dashboard.widgets?.recentJobs || []" [job]="job" [hideActions]="true"></app-job-card>
          </article>

          <article class="panel">
            <div class="panel__head">
              <h2>Pending Follow-ups</h2>
            </div>
            <app-shortlist-card *ngFor="let item of dashboard.widgets?.pendingFollowUps || []" [item]="item" [hideActions]="true"></app-shortlist-card>
          </article>
        </div>

        <article class="panel">
          <div class="panel__head">
            <h2>Recent Activity</h2>
          </div>
          <app-activity-timeline [items]="dashboard.widgets?.recentActivity || []" />
        </article>
      </ng-container>
    </section>
  `,
  styles: [`
    .hub-page{display:flex;flex-direction:column;gap:1rem}
    .hero{padding:1.2rem;border-radius:24px;background:linear-gradient(135deg,rgba(17,24,39,.96),rgba(30,41,59,.88));border:1px solid rgba(99,102,241,.2);box-shadow:0 24px 48px rgba(2,6,23,.32)}
    .hero__kicker{display:inline-flex;margin-bottom:.45rem;padding:.32rem .68rem;border-radius:999px;background:rgba(79,70,229,.16);color:#c7d2fe;font-size:.72rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
    .hero h1{margin:0;color:#f8fafc;font-size:2rem}
    .hero p{margin:.4rem 0 0;color:#94a3b8;max-width:760px}
    .message--error{padding:.85rem 1rem;border-radius:14px;background:rgba(127,29,29,.45);border:1px solid rgba(248,113,113,.24);color:#fecaca}
    .metric-grid,.content-grid,.split-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1rem}
    .split-grid{grid-template-columns:repeat(auto-fit,minmax(360px,1fr))}
    .panel{display:flex;flex-direction:column;gap:.85rem}
    .panel__head{display:flex;justify-content:space-between;align-items:center;gap:.75rem}
    .panel__head h2{margin:0;color:#f8fafc;font-size:1rem}
  `]
})
export class RecruiterDashboardComponent implements OnInit {
  loading = true;
  error = '';
  dashboard: any = null;

  constructor(private readonly hubService: RecruiterHubService) {}

  ngOnInit(): void {
    this.hubService.getDashboard().subscribe({
      next: (dashboard) => {
        this.dashboard = dashboard;
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.message || 'Unable to load recruiter dashboard.';
        this.loading = false;
      }
    });
  }
}
