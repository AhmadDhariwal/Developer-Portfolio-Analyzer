import { Component, OnInit } from '@angular/core';
import { RecruiterHubService } from '../../services/recruiter-hub.service';

@Component({
  selector: 'app-recruiter-dashboard',
  standalone: false,
  template: `
    <section class="hub-page">
      <div class="hub-header"><h1>Recruiter Hub</h1><p>Secure recruiter workspace for candidates, jobs, matches, and activity.</p></div>
      <app-recruiter-loader *ngIf="loading" label="Loading recruiter dashboard..." />
      <ng-container *ngIf="!loading">
        <div class="metric-grid">
          <app-recruiter-stat-card *ngFor="let metric of metrics" [label]="metric.label" [value]="metric.value" />
        </div>
        <div class="content-grid">
          <app-recruiter-performance-chart title="Weekly Activity" [items]="dashboard?.charts?.weeklyRecruiterActivity || []" />
          <app-recruiter-performance-chart title="Match Generation Trend" [items]="dashboard?.charts?.matchGenerationTrend || []" />
          <app-recruiter-performance-chart title="Skill Demand" [items]="dashboard?.charts?.skillDemandChart || []" />
          <app-activity-timeline [items]="dashboard?.widgets?.recentActivity || []" />
        </div>
        <div class="split-grid">
          <div>
            <h2>Top Matched Candidates</h2>
            <app-candidate-card *ngFor="let candidate of dashboard?.widgets?.suggestedCandidates || []" [candidate]="candidate" />
          </div>
          <div>
            <h2>Pending Follow-ups</h2>
            <app-shortlist-card *ngFor="let item of dashboard?.widgets?.pendingFollowUps || []" [item]="item" />
          </div>
        </div>
      </ng-container>
    </section>
  `,
  styles: [`.hub-page{display:flex;flex-direction:column;gap:1rem}.hub-header h1{margin:0;color:#f8fafc}.hub-header p{margin:.35rem 0 0;color:#94a3b8}.metric-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:.85rem}.content-grid,.split-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1rem}h2{margin:0 0 .75rem;color:#e2e8f0;font-size:1rem}`]
})
export class RecruiterDashboardComponent implements OnInit {
  loading = true;
  dashboard: any = null;
  metrics: Array<{ label: string; value: number | string }> = [];

  constructor(private readonly hubService: RecruiterHubService) {}

  ngOnInit(): void {
    this.hubService.getDashboard().subscribe({
      next: (dashboard) => {
        this.dashboard = dashboard;
        const metricSource = dashboard?.metrics || {};
        this.metrics = [
          { label: 'Assigned Teams', value: metricSource.assignedTeams || 0 },
          { label: 'Candidates Viewed', value: metricSource.candidatesViewed || 0 },
          { label: 'Candidates Analyzed', value: metricSource.candidatesAnalyzed || 0 },
          { label: 'Active Jobs', value: metricSource.activeJobs || 0 },
          { label: 'Matches Generated', value: metricSource.matchesGenerated || 0 },
          { label: 'Shortlisted', value: metricSource.shortlistedCandidates || 0 },
          { label: 'Success Rate', value: `${metricSource.successRate || 0}%` },
          { label: 'Activity Score', value: metricSource.recruiterActivityScore || 0 }
        ];
        this.loading = false;
      },
      error: () => {
        this.loading = false;
      }
    });
  }
}
