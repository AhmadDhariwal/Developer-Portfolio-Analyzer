import { Component, OnInit } from '@angular/core';
import { RecruiterHubService } from '../../services/recruiter-hub.service';

@Component({
  selector: 'app-recruiter-analytics',
  standalone: false,
  templateUrl: './recruiter-analytics.component.html',
  styleUrl: './recruiter-analytics.component.scss',
})
export class RecruiterAnalyticsComponent implements OnInit {
  loading = true;
  error = '';
  analytics: any = this.defaultAnalytics();

  constructor(private readonly hubService: RecruiterHubService) {}

  ngOnInit(): void {
    this.hubService.getAnalytics().subscribe({
      next: (analytics) => {
        this.analytics = this.normalizeAnalytics(analytics);
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.message || 'Unable to load recruiter analytics.';
        this.loading = false;
      },
    });
  }

  get topJobs(): any[] {
    return this.analytics?.highlights?.mostActiveJobs || [];
  }

  get successGaugeItems(): Array<{ label: string; value: number }> {
    return [{ label: 'Success', value: Number(this.analytics?.metrics?.successRate || 0) }];
  }

  get successRateHint(): string {
    const shortlistCount = Number(this.analytics?.metrics?.shortlistedCandidates || 0);
    return `${shortlistCount} shortlisted`;
  }

  trendLabelFor(items: any[]): string {
    const list = Array.isArray(items) ? items : [];
    if (list.length < 2) return 'Current cycle';
    const latest = Number(list[list.length - 1]?.count || list[list.length - 1]?.value || 0);
    const previous = Number(list[list.length - 2]?.count || list[list.length - 2]?.value || 0);
    if (previous <= 0) return latest > 0 ? '+100%' : 'Stable';
    const delta = Math.round(((latest - previous) / previous) * 100);
    return `${delta > 0 ? '+' : ''}${delta}%`;
  }

  totalFor(items: any[]): number {
    return (Array.isArray(items) ? items : []).reduce((sum, item) => {
      const value = Number(item?.count ?? item?.value ?? 0);
      return sum + (Number.isFinite(value) ? value : 0);
    }, 0);
  }

  private normalizeAnalytics(response: any): any {
    const payload = response?.analytics || response || {};
    const defaults = this.defaultAnalytics();
    return {
      metrics: {
        ...defaults.metrics,
        ...(payload?.metrics || {}),
      },
      charts: {
        candidateActivityTrend: this.asArray(payload?.charts?.candidateActivityTrend),
        matchGenerationTrend: this.asArray(payload?.charts?.matchGenerationTrend),
        aiUsageGraph: this.asArray(payload?.charts?.aiUsageGraph),
        topSkillsDemand: this.asArray(payload?.charts?.topSkillsDemand),
        supplyVsDemand: this.asArray(payload?.charts?.supplyVsDemand),
        weeklyRecruiterActivity: this.asArray(payload?.charts?.weeklyRecruiterActivity),
        skillDemandChart: this.asArray(payload?.charts?.skillDemandChart),
      },
      highlights: {
        mostActiveJobs: this.asArray(payload?.highlights?.mostActiveJobs),
      },
    };
  }

  private defaultAnalytics(): any {
    return {
      metrics: {
        candidatesViewed: 0,
        candidatesAnalyzed: 0,
        matchesGenerated: 0,
        shortlistedCandidates: 0,
        successRate: 0,
        recruiterActivityScore: 0,
        openJobs: 0,
      },
      charts: {
        candidateActivityTrend: [],
        matchGenerationTrend: [],
        aiUsageGraph: [],
        topSkillsDemand: [],
        supplyVsDemand: [],
        weeklyRecruiterActivity: [],
        skillDemandChart: [],
      },
      highlights: {
        mostActiveJobs: [],
      },
    };
  }

  private asArray<T = any>(value: unknown): T[] {
    return Array.isArray(value) ? value : [];
  }
}
