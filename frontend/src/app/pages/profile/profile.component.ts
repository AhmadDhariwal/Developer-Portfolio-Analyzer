import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
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
import { CareerProfileService } from '../../shared/services/career-profile.service';
import {
  CAREER_STACKS,
  EXPERIENCE_LEVELS,
  CareerStack,
  ExperienceLevel,
} from '../../shared/models/career-profile.model';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './profile.component.html',
  styleUrl: './profile.component.scss',
})
export class ProfileComponent implements OnInit {
  // ── Constants for template selects ────────────────────────────────────
  readonly careerStacks:     CareerStack[]     = CAREER_STACKS;
  readonly experienceLevels: ExperienceLevel[] = EXPERIENCE_LEVELS;

  // ── State ──────────────────────────────────────────────────────────────
  isLoading         = true;
  isSaving          = false;
  isSavingCareer    = false;
  isChangingPwd     = false;
  showDeleteConfirm = false;
  successMessage    = '';
  errorMessage      = '';
  pwdError          = '';
  pwdSuccess        = '';
  careerSuccess     = '';

  // ── Profile data (bound to form) ───────────────────────────────────────
  profile: UserProfile = {
    _id: '', name: '', email: '', githubUsername: '',
    avatar: '', jobTitle: '', location: '', bio: '',
    website: '', twitter: '', linkedin: '',
    careerStack:     'Full Stack',
    experienceLevel: 'Student',
    careerGoal:      '',
    isConfigured:    false,
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

  private snapshot: UserProfile = {
    _id: '', name: '', email: '', githubUsername: '',
    avatar: '', jobTitle: '', location: '', bio: '',
    website: '', twitter: '', linkedin: '',
    careerStack:     'Full Stack',
    experienceLevel: 'Student',
    careerGoal:      '',
    isConfigured:    false,
    notifications: {
      weeklyScoreReport:  true,
      skillTrendAlerts:   true,
      newRecommendations: false,
      jobMatchAlerts:     true,
    },
    stats: { developerScore: 0, reposAnalyzed: 0, skillsDetected: 0, memberSince: '' },
  };

  constructor(
    private readonly profileService:      ProfileService,
    private readonly authService:         AuthService,
    private readonly careerProfileService: CareerProfileService,
    private readonly router:              Router,
    private readonly cdr:                 ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.loadProfile();
  }

  // ── Load from backend ──────────────────────────────────────────────────
  loadProfile(): void {
    this.isLoading = true;
    this.profileService.getProfile().subscribe({
      next: (data) => {
        this.profile = this.normalizeProfile(data);
        this.snapshot = { ...this.profile };
        this.isLoading = false;
        this.cdr.detectChanges();
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
        this.cdr.detectChanges();
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
        this.loadProfile(); // reload profile from backend for real-time sync
        this.cdr.detectChanges();
        setTimeout(() => { this.successMessage = ''; }, 3000);
      },
      error: (err) => {
        this.errorMessage = err?.error?.message || 'Failed to save profile.';
        this.isSaving     = false;
        this.cdr.detectChanges();
      },
    });
  }
  // Defensive normalization: always return object with expected keys
  normalizeProfile(data: any): UserProfile {
    if (!data || typeof data !== 'object') return { ...this.snapshot };
    return {
      _id: data._id || '',
      name: data.name || '',
      email: data.email || '',
      githubUsername: data.githubUsername || '',
      avatar: data.avatar || '',
      jobTitle: data.jobTitle || '',
      location: data.location || '',
      bio: data.bio || '',
      website: data.website || '',
      twitter: data.twitter || '',
      linkedin: data.linkedin || '',
      careerStack:     data.careerStack     || 'Full Stack',
      experienceLevel: data.experienceLevel || 'Student',
      careerGoal:      data.careerGoal      || '',
      isConfigured:    data.isConfigured    ?? false,
      notifications: {
        weeklyScoreReport:  data.notifications?.weeklyScoreReport ?? true,
        skillTrendAlerts:   data.notifications?.skillTrendAlerts ?? true,
        newRecommendations: data.notifications?.newRecommendations ?? false,
        jobMatchAlerts:     data.notifications?.jobMatchAlerts ?? true,
      },
      stats: {
        developerScore: data.stats?.developerScore ?? 0,
        reposAnalyzed:  data.stats?.reposAnalyzed ?? 0,
        skillsDetected: data.stats?.skillsDetected ?? 0,
        memberSince:    data.stats?.memberSince ?? '',
      },
    };
  }

  // ── Save career profile ────────────────────────────────────────────────
  saveCareerProfile(): void {
    this.isSavingCareer = true;
    this.careerSuccess  = '';

    this.careerProfileService.saveCareerProfile(
      this.profile.careerStack,
      this.profile.experienceLevel,
      this.profile.careerGoal
    ).subscribe({
      next: () => {
        this.isSavingCareer = true;
        this.careerSuccess  = 'Career profile saved!';
        this.isSavingCareer = false;
        this.cdr.detectChanges();
        setTimeout(() => { this.careerSuccess = ''; this.cdr.detectChanges(); }, 3000);
      },
      error: (err) => {
        this.errorMessage   = err?.error?.message || 'Failed to save career profile.';
        this.isSavingCareer = false;
        this.cdr.detectChanges();
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