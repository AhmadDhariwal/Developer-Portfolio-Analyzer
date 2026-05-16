import { Component, OnInit } from '@angular/core';
import { RecruiterHubService } from '../../services/recruiter-hub.service';

@Component({
  selector: 'app-recruiter-analytics',
  standalone: false,
  template: `
    <section class="hub-page">
      <div class="hub-header"><h1>Recruiter Analytics</h1><p>Performance, AI usage, and hiring activity in one view.</p></div>
      <app-recruiter-loader *ngIf="loading" label="Loading recruiter analytics..." />
      <ng-container *ngIf="!loading && analytics">
        <div class="metric-grid">
          <app-recruiter-stat-card label="Candidates Viewed" [value]="analytics.metrics?.candidatesViewed || 0" />
          <app-recruiter-stat-card label="Analyzed" [value]="analytics.metrics?.candidatesAnalyzed || 0" />
          <app-recruiter-stat-card label="Matches" [value]="analytics.metrics?.matchesGenerated || 0" />
          <app-recruiter-stat-card label="Shortlists" [value]="analytics.metrics?.shortlistedCandidates || 0" />
          <app-recruiter-stat-card label="Activity Score" [value]="analytics.metrics?.recruiterActivityScore || 0" />
          <app-recruiter-stat-card label="Success Rate" [value]="(analytics.metrics?.successRate || 0) + '%'" />
        </div>
        <div class="content-grid">
          <app-recruiter-performance-chart title="Candidate Activity Trend" [items]="analytics.charts?.candidateActivityTrend || []" />
          <app-recruiter-performance-chart title="AI Usage Graph" [items]="analytics.charts?.aiUsageGraph || []" />
          <app-recruiter-performance-chart title="Match Generation Trend" [items]="analytics.charts?.matchGenerationTrend || []" />
          <app-recruiter-performance-chart title="Most Matched Skills" [items]="analytics.highlights?.mostMatchedSkills || []" />
        </div>
      </ng-container>
    </section>
  `,
  styles: [`.hub-page{display:flex;flex-direction:column;gap:1rem}.hub-header h1{margin:0;color:#f8fafc}.hub-header p{margin:.35rem 0 0;color:#94a3b8}.metric-grid,.content-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1rem}`]
})
export class RecruiterAnalyticsComponent implements OnInit {
  loading = true;
  analytics: any = null;

  constructor(private readonly hubService: RecruiterHubService) {}

  ngOnInit(): void {
    this.hubService.getAnalytics().subscribe({
      next: (analytics) => {
        this.analytics = analytics;
        this.loading = false;
      },
      error: () => {
        this.loading = false;
      }
    });
  }
}
