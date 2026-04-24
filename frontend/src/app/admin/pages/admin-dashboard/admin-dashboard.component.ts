import { Component, OnInit } from '@angular/core';

import { AdminHiringService, AdminOverview } from '../../services/admin-hiring.service';

@Component({
  selector: 'app-admin-dashboard-page',
  standalone: false,
  templateUrl: './admin-dashboard.component.html',
  styleUrls: ['./admin-dashboard.component.scss']
})
export class AdminDashboardPageComponent implements OnInit {
  loading = false;
  error = '';
  overview: AdminOverview = {
    organizationId: '',
    recruitersCount: 0,
    jobsCount: 0,
    globalDevelopersCount: 0
  };

  constructor(private readonly adminService: AdminHiringService) {}

  ngOnInit(): void {
    this.loadOverview();
  }

  loadOverview(): void {
    this.loading = true;
    this.error = '';

    this.adminService.getOverview().subscribe({
      next: (overview) => {
        this.overview = overview;
        this.loading = false;
      },
      error: () => {
        this.error = 'Failed to load organization overview.';
        this.loading = false;
      }
    });
  }
}
