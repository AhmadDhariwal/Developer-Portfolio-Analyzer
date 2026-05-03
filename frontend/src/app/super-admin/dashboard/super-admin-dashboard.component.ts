import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { SuperAdminService } from '../shared/super-admin.service';

@Component({
  selector: 'app-super-admin-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './super-admin-dashboard.component.html',
  styleUrls: ['./super-admin-dashboard.component.scss']
})
export class SuperAdminDashboardComponent implements OnInit {
  loading = true;
  metrics: any = {};
  latestOrgs: any[] = [];
  topDevelopers: any[] = [];
  activeAdmins: any[] = [];

  constructor(private readonly sa: SuperAdminService) {}

  ngOnInit(): void {
    this.sa.getMetrics().subscribe({
      next: (res) => {
        this.metrics = res.metrics || {};
        this.latestOrgs = res.latestOrgs || [];
        this.topDevelopers = res.topDevelopers || [];
        this.activeAdmins = res.activeAdmins || [];
        this.loading = false;
      },
      error: () => { this.loading = false; }
    });
  }

  get metricCards() {
    return [
      { label: 'Organizations',  value: this.metrics.totalOrgs       ?? 0, link: '../organizations', color: 'blue' },
      { label: 'Admins',         value: this.metrics.totalAdmins      ?? 0, link: '../admins',         color: 'purple' },
      { label: 'Recruiters',     value: this.metrics.totalRecruiters  ?? 0, link: '../recruiters',     color: 'green' },
      { label: 'Developers',     value: this.metrics.totalDevelopers  ?? 0, link: '../developers',     color: 'orange' },
      { label: 'Teams',          value: this.metrics.totalTeams       ?? 0, link: null,                color: 'teal' },
      { label: 'AI Analyses',    value: this.metrics.totalAnalyses    ?? 0, link: null,                color: 'red' },
      { label: 'New Orgs (30d)', value: this.metrics.recentOrgs       ?? 0, link: null,                color: 'indigo' },
      { label: 'New Users (30d)',value: this.metrics.recentUsers      ?? 0, link: null,                color: 'pink' },
    ];
  }
}
