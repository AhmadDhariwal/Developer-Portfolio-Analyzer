import { Component, OnInit } from '@angular/core';

import { AdminHiringService, AdminRecruiter, PendingInvitation } from '../../services/admin-hiring.service';

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
  pendingInvitations: PendingInvitation[] = [];
  editingRecruiterId = '';

  // ── Confirm dialog state ────────────────────────────────────────────────
  confirmOpen = false;
  confirmTitle = '';
  confirmMessage = '';
  confirmText = 'Delete';
  private pendingConfirmAction: (() => void) | null = null;

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
    this.loadAll();
  }

  loadAll(): void {
    this.loading = true;
    let done = 0;
    const finish = () => { if (++done === 2) this.loading = false; };

    this.adminService.getRecruiters().subscribe({
      next: (recruiters) => { this.recruiters = recruiters; finish(); },
      error: () => {
        this.messageType = 'error';
        this.message = 'Failed to load recruiters.';
        finish();
      }
    });

    this.adminService.getPendingInvitations().subscribe({
      next: (invitations) => { this.pendingInvitations = invitations; finish(); },
      error: () => { finish(); }
    });
  }

  loadRecruiters(): void {
    this.loadAll();
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
        this.loadAll();
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
        this.loadAll();
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
        this.loadAll();
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
        this.loadAll();
      },
      error: (err) => {
        this.messageType = 'error';
        this.message = String(err?.error?.message || 'Failed to revoke recruiter access.');
        this.loading = false;
      }
    });
  }

  deleteRecruiter(recruiter: AdminRecruiter): void {
    this.openConfirm(
      'Delete Recruiter',
      `Delete recruiter ${recruiter.name}? This cannot be undone.`,
      () => {
        this.loading = true;
        this.adminService.deleteRecruiter(recruiter._id).subscribe({
          next: () => {
            this.messageType = 'success';
            this.message = 'Recruiter deleted successfully.';
            this.loadAll();
          },
          error: (err) => {
            this.messageType = 'error';
            this.message = String(err?.error?.message || 'Failed to delete recruiter.');
            this.loading = false;
          }
        });
      }
    );
  }

  // ── Pending invitation actions ──────────────────────────────────────────

  revokeInvitation(inv: PendingInvitation): void {
    this.loading = true;
    this.adminService.revokeInvitation(inv._id).subscribe({
      next: () => {
        this.messageType = 'success';
        this.message = `Invitation for ${inv.email} revoked.`;
        this.loadAll();
      },
      error: (err) => {
        this.messageType = 'error';
        this.message = String(err?.error?.message || 'Failed to revoke invitation.');
        this.loading = false;
      }
    });
  }

  expireInvitation(inv: PendingInvitation): void {
    this.loading = true;
    this.adminService.expireInvitation(inv._id).subscribe({
      next: () => {
        this.messageType = 'success';
        this.message = `Invitation for ${inv.email} expired.`;
        this.loadAll();
      },
      error: (err) => {
        this.messageType = 'error';
        this.message = String(err?.error?.message || 'Failed to expire invitation.');
        this.loading = false;
      }
    });
  }

  deleteInvitation(inv: PendingInvitation): void {
    this.openConfirm(
      'Delete Invitation',
      `Delete invitation for ${inv.email}? This cannot be undone.`,
      () => {
        this.loading = true;
        this.adminService.deleteInvitation(inv._id).subscribe({
          next: () => {
            this.messageType = 'success';
            this.message = `Invitation for ${inv.email} deleted.`;
            this.loadAll();
          },
          error: (err) => {
            this.messageType = 'error';
            this.message = String(err?.error?.message || 'Failed to delete invitation.');
            this.loading = false;
          }
        });
      }
    );
  }

  isExpired(inv: PendingInvitation): boolean {
    return new Date(inv.expiresAt) < new Date();
  }

  // ── Confirm dialog helpers ──────────────────────────────────────────────

  private openConfirm(title: string, message: string, action: () => void): void {
    this.confirmTitle = title;
    this.confirmMessage = message;
    this.pendingConfirmAction = action;
    this.confirmOpen = true;
  }

  onConfirmed(): void {
    this.confirmOpen = false;
    if (this.pendingConfirmAction) {
      this.pendingConfirmAction();
      this.pendingConfirmAction = null;
    }
  }

  onCancelled(): void {
    this.confirmOpen = false;
    this.pendingConfirmAction = null;
  }
}
