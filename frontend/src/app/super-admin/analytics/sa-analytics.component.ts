import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SuperAdminService } from '../shared/super-admin.service';

@Component({
  selector: 'app-sa-analytics',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './sa-analytics.component.html',
  styleUrls: ['./sa-analytics.component.scss']
})
export class SaAnalyticsComponent implements OnInit {
  loading = true;
  metrics: any = {};
  latestOrgs: any[] = [];
  topDevelopers: any[] = [];

  constructor(private readonly sa: SuperAdminService) {}

  ngOnInit(): void {
    this.sa.getMetrics().subscribe({
      next: (res) => { this.metrics = res?.metrics ?? {}; this.latestOrgs = res?.latestOrgs ?? []; this.topDevelopers = res?.topDevelopers ?? []; this.loading = false; },
      error: () => { this.loading = false; }
    });
  }

  get statRows() {
    return [
      { label: 'Total Organizations', value: this.metrics.totalOrgs },
      { label: 'Total Admins',         value: this.metrics.totalAdmins },
      { label: 'Total Recruiters',     value: this.metrics.totalRecruiters },
      { label: 'Total Developers',     value: this.metrics.totalDevelopers },
      { label: 'Total Teams',          value: this.metrics.totalTeams },
      { label: 'Total AI Analyses',    value: this.metrics.totalAnalyses },
      { label: 'New Orgs (30 days)',   value: this.metrics.recentOrgs },
      { label: 'New Users (30 days)',  value: this.metrics.recentUsers },
    ];
  }
}
