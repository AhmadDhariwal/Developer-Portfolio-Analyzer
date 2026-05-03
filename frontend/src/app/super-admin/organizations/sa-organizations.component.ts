import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SuperAdminService } from '../shared/super-admin.service';

@Component({
  selector: 'app-sa-organizations',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './sa-organizations.component.html',
  styleUrls: ['../dashboard/super-admin-dashboard.component.scss']
})
export class SaOrganizationsComponent implements OnInit {
  organizations: any[] = [];
  total = 0; page = 1; totalPages = 1;
  loading = false;
  search = ''; suspended = '';

  constructor(private readonly sa: SuperAdminService) {}

  ngOnInit(): void { this.load(); }

  load(page = 1): void {
    this.loading = true;
    this.page = page;
    const params: Record<string, string> = { page: String(page), limit: '20' };
    if (this.search) params['search'] = this.search;
    if (this.suspended) params['suspended'] = this.suspended;
    this.sa.getOrganizations(params).subscribe({
      next: (res) => { this.organizations = res.organizations || []; this.total = res.total || 0; this.totalPages = res.totalPages || 1; this.loading = false; },
      error: () => { this.loading = false; }
    });
  }

  suspend(org: any): void {
    this.sa.suspendOrganization(org._id).subscribe({ next: () => this.load(this.page) });
  }

  activate(org: any): void {
    this.sa.activateOrganization(org._id).subscribe({ next: () => this.load(this.page) });
  }
}
