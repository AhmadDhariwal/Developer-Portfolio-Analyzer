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
  editingRecruiterId = '';

  form = {
    name: '',
    email: ''
  };

  editForm = {
    name: '',
    email: '',
    githubUsername: '',
    linkedin: '',
    phoneNumber: ''
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

  inviteRecruiter(): void {
    if (!this.form.name || !this.form.email) {
      this.messageType = 'warning';
      this.message = 'Name and email are required.';
      return;
    }

    this.loading = true;
    this.adminService.inviteRecruiter({
      name: this.form.name,
      email: this.form.email,
      role: 'recruiter'
    }).subscribe({
      next: (result) => {
        this.form = { name: '', email: '' };
        this.messageType = 'success';
        this.message = result.emailSent
          ? 'Recruiter invitation sent successfully.'
          : `Invitation created. Share this link manually: ${result.invitationLink}`;
        this.loadRecruiters();
      },
      error: (err) => {
        this.messageType = 'error';
        this.message = String(err?.error?.message || 'Failed to invite recruiter.');
        this.loading = false;
      }
    });
  }

  startEdit(recruiter: AdminRecruiter): void {
    this.editingRecruiterId = recruiter._id;
    this.editForm = {
      name: recruiter.name || '',
      email: recruiter.email || '',
      githubUsername: recruiter.githubUsername || '',
      linkedin: recruiter.linkedin || '',
      phoneNumber: recruiter.phoneNumber || ''
    };
  }

  cancelEdit(): void {
    this.editingRecruiterId = '';
    this.editForm = {
      name: '',
      email: '',
      githubUsername: '',
      linkedin: '',
      phoneNumber: ''
    };
  }

  saveRecruiter(recruiterId: string): void {
    if (!this.editForm.name || !this.editForm.email) {
      this.messageType = 'warning';
      this.message = 'Name and email are required.';
      return;
    }

    this.loading = true;
    this.adminService.updateRecruiter(recruiterId, {
      name: this.editForm.name,
      email: this.editForm.email,
      githubUsername: this.editForm.githubUsername,
      linkedin: this.editForm.linkedin,
      phoneNumber: this.editForm.phoneNumber
    }).subscribe({
      next: () => {
        this.messageType = 'success';
        this.message = 'Recruiter updated successfully.';
        this.cancelEdit();
        this.loadRecruiters();
      },
      error: (err) => {
        this.messageType = 'error';
        this.message = String(err?.error?.message || 'Failed to update recruiter.');
        this.loading = false;
      }
    });
  }

  toggleActive(recruiter: AdminRecruiter): void {
    this.loading = true;
    this.adminService.setRecruiterActive(recruiter._id, !recruiter.isActive).subscribe({
      next: () => {
        this.messageType = 'success';
        this.message = recruiter.isActive ? 'Recruiter deactivated.' : 'Recruiter activated.';
        this.loadRecruiters();
      },
      error: (err) => {
        this.messageType = 'error';
        this.message = String(err?.error?.message || 'Failed to update recruiter status.');
        this.loading = false;
      }
    });
  }

  revokeAccess(recruiter: AdminRecruiter): void {
    this.loading = true;
    this.adminService.revokeRecruiterAccess(recruiter._id).subscribe({
      next: () => {
        this.messageType = 'success';
        this.message = 'Recruiter access revoked.';
        this.loadRecruiters();
      },
      error: (err) => {
        this.messageType = 'error';
        this.message = String(err?.error?.message || 'Failed to revoke recruiter access.');
        this.loading = false;
      }
    });
  }

  deleteRecruiter(recruiter: AdminRecruiter): void {
    const confirmed = globalThis.confirm(`Delete recruiter ${recruiter.name}? This cannot be undone.`);
    if (!confirmed) return;

    this.loading = true;
    this.adminService.deleteRecruiter(recruiter._id).subscribe({
      next: () => {
        this.messageType = 'success';
        this.message = 'Recruiter deleted successfully.';
        this.loadRecruiters();
      },
      error: (err) => {
        this.messageType = 'error';
        this.message = String(err?.error?.message || 'Failed to delete recruiter.');
        this.loading = false;
      }
    });
  }
}
