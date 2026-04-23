import { Component, OnInit } from '@angular/core';

import { AdminHiringService, AdminRecruiter } from '../../services/admin-hiring.service';

@Component({
  selector: 'app-admin-recruiters-page',
  standalone: false,
  templateUrl: './admin-recruiters.component.html',
  styleUrls: ['./admin-recruiters.component.scss']
})
export class AdminRecruitersPageComponent implements OnInit {
  loading = false;
  message = '';
  messageType: 'success' | 'error' | 'warning' = 'success';
  recruiters: AdminRecruiter[] = [];

  form = {
    name: '',
    email: '',
    password: '',
    githubUsername: ''
  };

  constructor(private readonly adminService: AdminHiringService) {}

  ngOnInit(): void {
    this.loadRecruiters();
  }

  loadRecruiters(): void {
    this.loading = true;
    this.adminService.getRecruiters().subscribe({
      next: (recruiters) => {
        this.recruiters = recruiters;
        this.loading = false;
      },
      error: () => {
        this.messageType = 'error';
        this.message = 'Failed to load recruiters.';
        this.loading = false;
      }
    });
  }

  createRecruiter(): void {
    if (!this.form.name || !this.form.email || !this.form.password) {
      this.messageType = 'warning';
      this.message = 'Name, email, and password are required.';
      return;
    }

    this.loading = true;
    this.adminService.createRecruiter(this.form).subscribe({
      next: () => {
        this.form = { name: '', email: '', password: '', githubUsername: '' };
        this.messageType = 'success';
        this.message = 'Recruiter created successfully.';
        this.loadRecruiters();
      },
      error: (err) => {
        this.messageType = 'error';
        this.message = String(err?.error?.message || 'Failed to create recruiter.');
        this.loading = false;
      }
    });
  }
}
