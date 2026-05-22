import { Component, OnInit } from '@angular/core';
import { RecruiterHubService } from '../../services/recruiter-hub.service';

@Component({
  selector: 'app-recruiter-analytics',
  standalone: false,
  template: `
    <section class="hub-page">
      <header class="hero">
        <div>
          <span class="hero__kicker">Recruiter Analytics</span>
          <h1>Performance and pipeline analytics</h1>
          <p>Live recruiter activity, AI usage, job trends, and candidate supply versus demand.</p>
        </div>
      </header>

      <div class="message message--error" *ngIf="error">{{ error }}</div>
      <app-recruiter-loader *ngIf="loading" label="Loading recruiter analytics..." />

      <ng-container *ngIf="!loading && analytics">
        <div class="metric-grid">
          <app-recruiter-stat-card label="Viewed" [value]="analytics.metrics?.candidatesViewed || 0" />
          <app-recruiter-stat-card label="Analyzed" [value]="analytics.metrics?.candidatesAnalyzed || 0" />
          <app-recruiter-stat-card label="Matches" [value]="analytics.metrics?.matchesGenerated || 0" />
          <app-recruiter-stat-card label="Shortlists" [value]="analytics.metrics?.shortlistedCandidates || 0" />
          <app-recruiter-stat-card label="Success Rate" [value]="(analytics.metrics?.successRate || 0) + '%'" />
          <app-recruiter-stat-card label="Activity Score" [value]="analytics.metrics?.recruiterActivityScore || 0" />
        </div>

        <div class="content-grid">
          <app-recruiter-performance-chart title="Candidate Activity Trend" [items]="analytics.charts?.candidateActivityTrend || []" />
          <app-recruiter-performance-chart title="Match Generation Trend" [items]="analytics.charts?.matchGenerationTrend || []" />
          <app-recruiter-performance-chart title="AI Usage Trend" [items]="analytics.charts?.aiUsageGraph || []" />
          <app-recruiter-performance-chart title="Top Skills Demand" [items]="analytics.charts?.topSkillsDemand || []" />
          <app-recruiter-performance-chart title="Supply vs Demand" [items]="analytics.charts?.supplyVsDemand || []" />
          <app-recruiter-performance-chart title="Weekly Activity" [items]="analytics.charts?.weeklyRecruiterActivity || []" />
        </div>
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
    .metric-grid,.content-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1rem}
  `]
})
export class RecruiterAnalyticsComponent implements OnInit {
  loading = true;
  error = '';
  analytics: any = null;

  constructor(private readonly hubService: RecruiterHubService) {}

  ngOnInit(): void {
    this.hubService.getAnalytics().subscribe({
      next: (analytics) => {
        this.analytics = analytics;
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.message || 'Unable to load recruiter analytics.';
        this.loading = false;
      }
    });
  }
}
