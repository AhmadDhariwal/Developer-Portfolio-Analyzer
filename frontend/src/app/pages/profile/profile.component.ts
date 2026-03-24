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
  isUploadingAvatar = false;

  // ── Profile data (bound to form) ───────────────────────────────────────
  profile: UserProfile = {
    _id: '', name: '', email: '', githubUsername: '',
    activeGithubUsername: '',
    avatar: '', jobTitle: '', location: '', bio: '',
    website: '', twitter: '', linkedin: '',
    careerStack:     'Full Stack',
    experienceLevel: 'Student',
    careerGoal:      '',
    isConfigured:    false,
    defaultResume: null,
    activeResume: null,
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
    activeGithubUsername: '',
    avatar: '', jobTitle: '', location: '', bio: '',
    website: '', twitter: '', linkedin: '',
    careerStack:     'Full Stack',
    experienceLevel: 'Student',
    careerGoal:      '',
    isConfigured:    false,
    defaultResume: null,
    activeResume: null,
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
    if (!this.hasProfileChanges()) {
      this.errorMessage = 'No changes detected to save.';
      this.successMessage = '';
      return;
    }
    this.isSaving       = true;
    this.successMessage = '';
    this.errorMessage   = '';

    const payload: UpdateProfilePayload = {
      name:          this.profile.name,
      githubUsername: this.profile.githubUsername,
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

  private hasProfileChanges(): boolean {
    const current = this.profile;
    const snapshot = this.snapshot;
    const fields: Array<keyof UserProfile> = [
      'name',
      'githubUsername',
      'jobTitle',
      'location',
      'bio',
      'website',
      'twitter',
      'linkedin'
    ];

    const fieldChanged = fields.some((key) => current[key] !== snapshot[key]);
    const notificationsChanged = JSON.stringify(current.notifications || {}) !== JSON.stringify(snapshot.notifications || {});
    return fieldChanged || notificationsChanged;
  }
  // Defensive normalization: always return object with expected keys
  normalizeProfile(data: any): UserProfile {
    if (!data || typeof data !== 'object') return { ...this.snapshot };
    return {
      _id: data._id || '',
      name: data.name || '',
      email: data.email || '',
      githubUsername: data.githubUsername || '',
      activeGithubUsername: data.activeGithubUsername || data.githubUsername || '',
      avatar: data.avatar || '',
      jobTitle: data.jobTitle || '',
      location: data.location || '',
      bio: data.bio || '',
      website: data.website || '',
      twitter: data.twitter || '',
      linkedin: data.linkedin || '',
      careerStack:     data.careerStack     || 'Full Stack',
      experienceLevel: data.experienceLevel || 'Student',
      activeCareerStack: data.activeCareerStack || data.careerStack || 'Full Stack',
      activeExperienceLevel: data.activeExperienceLevel || data.experienceLevel || 'Student',
      careerGoal:      data.careerGoal      || '',
      isConfigured:    data.isConfigured    ?? false,
      defaultResume: data.defaultResume || null,
      activeResume: data.activeResume || null,
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

  onAvatarFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const isImage = ['image/jpeg', 'image/png', 'image/webp'].includes(file.type);
    if (!isImage) {
      this.errorMessage = 'Only JPG, PNG, and WEBP files are allowed.';
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      this.errorMessage = 'Avatar must be 2MB or smaller.';
      return;
    }

    this.isUploadingAvatar = true;
    this.errorMessage = '';
    this.successMessage = '';
    this.cdr.detectChanges();

    this.profileService.uploadAvatar(file).subscribe({
      next: (res) => {
        this.profile.avatar = res.avatar;
        this.snapshot = { ...this.profile };
        this.isUploadingAvatar = false;
        this.successMessage = 'Profile photo updated successfully.';
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.isUploadingAvatar = false;
        this.errorMessage = err?.error?.message || 'Failed to upload profile photo.';
        this.cdr.detectChanges();
      }
    });
  }
}