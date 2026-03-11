import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  ProfileService,
  UserProfile,
  NotificationPrefs,
  UpdateProfilePayload,
} from '../../shared/services/profile.service';
import { AuthService } from '../../shared/services/auth.service';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './profile.component.html',
  styleUrl: './profile.component.scss',
})
export class ProfileComponent implements OnInit {
  // ── State ──────────────────────────────────────────────────────────────
  isLoading         = true;
  isSaving          = false;
  isChangingPwd     = false;
  showDeleteConfirm = false;
  successMessage    = '';
  errorMessage      = '';
  pwdError          = '';
  pwdSuccess        = '';

  // ── Profile data (bound to form) ───────────────────────────────────────
  profile: UserProfile = {
    _id: '', name: '', email: '', githubUsername: '',
    avatar: '', jobTitle: '', location: '', bio: '',
    website: '', twitter: '', linkedin: '',
    notifications: {
      weeklyScoreReport:  true,
      skillTrendAlerts:   true,
      newRecommendations: false,
      jobMatchAlerts:     true,
    },
    stats: { developerScore: 0, reposAnalyzed: 0, skillsDetected: 0, memberSince: '' },
  };

  // ── Password form ──────────────────────────────────────────────────────
  passwordForm = { currentPassword: '', newPassword: '', confirmPassword: '' };

  constructor(
    private readonly profileService: ProfileService,
    private readonly authService: AuthService,
    private readonly router: Router,
  ) {}

  ngOnInit(): void {
    this.loadProfile();
  }

  // ── Load from backend ──────────────────────────────────────────────────
  loadProfile(): void {
    this.isLoading = true;
    this.profileService.getProfile().subscribe({
      next: (data) => {
        this.profile   = data;
        this.isLoading = false;
      },
      error: (err) => {
        const cached = this.authService.getCurrentUser();
        if (cached) {
          this.profile.name           = cached.name           ?? '';
          this.profile.email          = cached.email          ?? '';
          this.profile.githubUsername = cached.githubUsername ?? '';
        }
        this.errorMessage = err?.error?.message || 'Could not load profile from server.';
        this.isLoading    = false;
      },
    });
  }

  // ── Save profile + notifications ───────────────────────────────────────
  saveChanges(): void {
    this.isSaving       = true;
    this.successMessage = '';
    this.errorMessage   = '';

    const payload: UpdateProfilePayload = {
      name:          this.profile.name,
      jobTitle:      this.profile.jobTitle,
      location:      this.profile.location,
      bio:           this.profile.bio,
      website:       this.profile.website,
      twitter:       this.profile.twitter,
      linkedin:      this.profile.linkedin,
      notifications: this.profile.notifications,
    };

    this.profileService.updateProfile(payload).subscribe({
      next: () => {
        this.successMessage = 'Profile saved successfully!';
        this.isSaving       = false;
        setTimeout(() => { this.successMessage = ''; }, 3000);
      },
      error: (err) => {
        this.errorMessage = err?.error?.message || 'Failed to save profile.';
        this.isSaving     = false;
      },
    });
  }

  // ── Change password ────────────────────────────────────────────────────
  toggleChangePassword(): void {
    this.isChangingPwd = !this.isChangingPwd;
    this.passwordForm  = { currentPassword: '', newPassword: '', confirmPassword: '' };
    this.pwdError      = '';
    this.pwdSuccess    = '';
  }

  submitPasswordChange(): void {
    this.pwdError   = '';
    this.pwdSuccess = '';

    if (!this.passwordForm.currentPassword || !this.passwordForm.newPassword) {
      this.pwdError = 'All fields are required.'; return;
    }
    if (this.passwordForm.newPassword !== this.passwordForm.confirmPassword) {
      this.pwdError = 'New passwords do not match.'; return;
    }
    if (this.passwordForm.newPassword.length < 6) {
      this.pwdError = 'Password must be at least 6 characters.'; return;
    }

    this.profileService.updatePassword({
      currentPassword: this.passwordForm.currentPassword,
      newPassword:     this.passwordForm.newPassword,
    }).subscribe({
      next: () => {
        this.pwdSuccess    = 'Password updated successfully!';
        this.isChangingPwd = false;
        this.passwordForm  = { currentPassword: '', newPassword: '', confirmPassword: '' };
      },
      error: (err) => {
        this.pwdError = err?.error?.message || 'Failed to update password.';
      },
    });
  }

  // ── Delete account ─────────────────────────────────────────────────────
  confirmDelete(): void {
    this.profileService.deleteAccount().subscribe({
      next: () => {
        this.authService.logout();
        this.router.navigate(['/']);
      },
      error: (err) => {
        this.errorMessage      = err?.error?.message || 'Failed to delete account.';
        this.showDeleteConfirm = false;
      },
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────
  getInitials(): string {
    return this.profileService.getInitials(this.profile.name || 'U');
  }

  getScoreClass(score: number): string {
    if (score >= 75) return 'score-green';
    if (score >= 50) return 'score-yellow';
    return 'score-red';
  }

  toggleNotification(key: keyof NotificationPrefs): void {
    this.profile.notifications[key] = !this.profile.notifications[key];
  }
}