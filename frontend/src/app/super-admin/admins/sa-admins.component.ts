import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SuperAdminService } from '../shared/super-admin.service';

@Component({
  selector: 'app-sa-admins',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './sa-admins.component.html',
  styleUrls: ['./sa-admins.component.scss']
})
export class SaAdminsComponent implements OnInit {
  admins: any[] = [];
  total = 0; page = 1; totalPages = 1;
  loading = false; search = '';

  constructor(private readonly sa: SuperAdminService) {}
  ngOnInit(): void { this.load(); }

  load(page = 1): void {
    this.loading = true; this.page = page;
    const params: Record<string, string> = { page: String(page), limit: '20' };
    if (this.search) params['search'] = this.search;
    this.sa.getAdmins(params).subscribe({
      next: (res) => { this.admins = res.admins || []; this.total = res.total || 0; this.totalPages = res.totalPages || 1; this.loading = false; },
      error: () => { this.loading = false; }
    });
  }

  toggle(user: any): void {
    this.sa.toggleUserActive(user._id).subscribe({ next: () => this.load(this.page) });
  }
}
