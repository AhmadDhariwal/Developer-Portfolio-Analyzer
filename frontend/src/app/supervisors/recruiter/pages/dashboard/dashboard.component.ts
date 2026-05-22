import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';

import {
  RecruiterService,
  RecruiterDashboard,
  RecruiterCandidate,
  RecruiterJob,
  RankedCandidate,
  ScoreDistributionItem,
  StackBreakdownItem,
  ExperienceItem,
  JobsOverTimeItem,
  SkillDemandItem,
  SupplyDemandItem
} from '../../services/recruiter.service';

@Component({
  selector: 'app-recruiter-dashboard-page',
  standalone: false,
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class RecruiterDashboardPageComponent implements OnInit, OnDestroy {
  loading = false;
  error = '';

  // Stats
  totalCandidates = 0;
  averageScore = 0;
  totalJobs = 0;
  openJobs = 0;
  draftJobs = 0;
  closedJobs = 0;
  totalRecruiters = 0;

  // Lists
  topCandidates: RecruiterCandidate[] = [];
  recentJobs: RecruiterJob[] = [];
  recentMatches: RankedCandidate[] = [];

  // Chart data
  scoreDistribution: ScoreDistributionItem[] = [];
  stackBreakdown: StackBreakdownItem[] = [];
  experienceDistribution: ExperienceItem[] = [];
  jobsOverTime: JobsOverTimeItem[] = [];
  topSkillsDemand: SkillDemandItem[] = [];
  supplyDemand: SupplyDemandItem[] = [];

  // Chart max values for bar scaling
  get maxStackCount(): number { return Math.max(1, ...this.stackBreakdown.map(s => s.count)); }
  get maxSkillDemand(): number { return Math.max(1, ...this.topSkillsDemand.map(s => s.demand)); }
  get maxJobsMonth(): number  { return Math.max(1, ...this.jobsOverTime.map(j => j.count)); }
  get maxSupply(): number     { return Math.max(1, ...this.supplyDemand.map(s => Math.max(s.supply, s.demand))); }
  get maxScoreBucket(): number { return Math.max(1, ...this.scoreDistribution.map(s => s.count)); }

  private sub?: Subscription;

  constructor(public readonly recruiterService: RecruiterService) {}

  ngOnInit(): void {
    this.loadDashboard();
    this.sub = this.recruiterService.latestMatches$.subscribe(matches => {
      this.recentMatches = matches.slice(0, 5);
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  loadDashboard(): void {
    this.loading = true;
    this.error = '';
    this.recruiterService.getDashboard().subscribe({
      next: (data: RecruiterDashboard) => {
        this.totalCandidates   = data.stats.totalCandidates;
        this.averageScore      = data.stats.averageScore;
        this.totalJobs         = data.stats.totalJobs;
        this.openJobs          = data.stats.openJobs;
        this.draftJobs         = data.stats.draftJobs;
        this.closedJobs        = data.stats.closedJobs;
        this.totalRecruiters   = data.stats.totalRecruiters;
        this.topCandidates     = data.topCandidates || [];
        this.recentJobs        = data.recentJobs || [];
        this.scoreDistribution = data.charts.scoreDistribution || [];
        this.stackBreakdown    = data.charts.stackBreakdown || [];
        this.experienceDistribution = data.charts.experienceDistribution || [];
        this.jobsOverTime      = data.charts.jobsOverTime || [];
        this.topSkillsDemand   = data.charts.topSkillsDemand || [];
        this.supplyDemand      = data.charts.supplyDemand || [];
        this.loading = false;
      },
      error: () => {
        this.error = 'Failed to load dashboard data. Please try again.';
        this.loading = false;
      }
    });
  }

  getScoreColor(score: number): string {
    if (score >= 80) return '#22c55e';
    if (score >= 60) return '#3b82f6';
    if (score >= 40) return '#f59e0b';
    return '#ef4444';
  }

  getScoreLabel(score: number): string {
    if (score >= 80) return 'Excellent';
    if (score >= 60) return 'Good';
    if (score >= 40) return 'Average';
    return 'Low';
  }

  getJobStatusColor(status: string): string {
    if (status === 'open')   return '#22c55e';
    if (status === 'draft')  return '#f59e0b';
    if (status === 'closed') return '#ef4444';
    return '#64748b';
  }

  trackByStack(_: number, item: StackBreakdownItem): string { return item.stack; }
  trackBySkill(_: number, item: SkillDemandItem): string    { return item.skill; }
  trackByMonth(_: number, item: JobsOverTimeItem): string   { return item.month; }
  trackByRange(_: number, item: ScoreDistributionItem): string { return item.range; }
  trackByExp(_: number, item: ExperienceItem): string       { return item.range; }
  trackBySupply(_: number, item: SupplyDemandItem): string  { return item.stack; }
  trackByCandidate(_: number, c: RecruiterCandidate): string { return c.id; }
  trackByJob(_: number, j: RecruiterJob): string            { return j._id; }
}
