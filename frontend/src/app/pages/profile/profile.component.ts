import { Component, OnInit, ChangeDetectorRef, DestroyRef, inject } from '@angular/core';
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
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  CAREER_STACKS,
  EXPERIENCE_LEVELS,
  CAREER_GOALS,
  CareerStack,
  ExperienceLevel,
  CareerGoal,
} from '../../shared/models/career-profile.model';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './profile.component.html',
  styleUrl: './profile.component.scss',
})
export class ProfileComponent implements OnInit {
  readonly careerStacks: CareerStack[] = CAREER_STACKS;
  readonly experienceLevels: ExperienceLevel[] = EXPERIENCE_LEVELS;
  readonly careerGoals: CareerGoal[] = CAREER_GOALS;
  private readonly githubUsernamePattern = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

  isLoading = true;
  isSaving = false;
  isSavingCareer = false;
  isChangingPwd = false;
  showDeleteConfirm = false;
  successMessage = '';
  errorMessage = '';
  pwdError = '';
  pwdSuccess = '';
  careerSuccess = '';
  isUploadingAvatar = false;
  avatarVersion = Date.now();
  isTogglingVisibility = false;
  visibilityMessage = '';
  private avatarPreviewUrl: string | null = null;
  private readonly destroyRef = inject(DestroyRef);

  profile: UserProfile = {
    _id: '', name: '', email: '', githubUsername: '',
    phoneNumber: '',
    countryCode: '',
    activeGithubUsername: '',
    avatar: '', jobTitle: '', location: '', bio: '',
    website: '', twitter: '', linkedin: '',
    careerStack: 'Full Stack',
    experienceLevel: 'Student',
    careerGoal: '',
    isConfigured: false,
    isPublic: false,
    role: 'developer',
    profileCompleted: true,
    defaultResume: null,
    activeResume: null,
    notifications: {
      weeklyScoreReport: true,
      skillTrendAlerts: true,
      newRecommendations: false,
      jobMatchAlerts: true,
    },
    stats: { developerScore: 0, reposAnalyzed: 0, skillsDetected: 0, memberSince: '' },
  };

  passwordForm = { currentPassword: '', newPassword: '', confirmPassword: '' };

  private snapshot: UserProfile = this.cloneProfile(this.profile);

  constructor(
    private readonly profileService: ProfileService,
    private readonly authService: AuthService,
    private readonly careerProfileService: CareerProfileService,
    private readonly router: Router,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.loadProfile();

    this.authService.currentUser$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((user) => {
        const nextAvatar = this.profileService.resolveAvatarUrl(String(user?.avatar || ''));
        if (!nextAvatar || this.isUploadingAvatar || this.profile.avatar === nextAvatar) {
          return;
        }

        this.profile.avatar = nextAvatar;
        this.bumpAvatarVersion();
        this.cdr.detectChanges();
      });
  }

  loadProfile(forceRefresh = false): void {
    this.isLoading = true;
    this.profileService.getProfile({ forceRefresh }).subscribe({
      next: (data) => {
        this.profile = this.normalizeProfile(data);
        this.snapshot = this.cloneProfile(this.profile);
        this.bumpAvatarVersion();
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        const cached = this.authService.getCurrentUser();
        if (cached) {
          this.profile.name = cached.name ?? '';
          this.profile.email = cached.email ?? '';
          this.profile.githubUsername = cached.githubUsername ?? '';
          this.profile.activeGithubUsername = cached.activeGithubUsername ?? cached.githubUsername ?? '';
          this.profile.avatar = this.profileService.resolveAvatarUrl(String(cached.avatar || ''));
          this.profile.careerStack = (cached.careerStack as CareerStack) || this.profile.careerStack;
          this.profile.experienceLevel = (cached.experienceLevel as ExperienceLevel) || this.profile.experienceLevel;
          this.profile.activeCareerStack = (cached.activeCareerStack as CareerStack) || this.profile.activeCareerStack || this.profile.careerStack;
          this.profile.activeExperienceLevel = (cached.activeExperienceLevel as ExperienceLevel) || this.profile.activeExperienceLevel || this.profile.experienceLevel;
          this.profile.careerGoal = (cached.careerGoal as CareerGoal) || '';
          this.bumpAvatarVersion();
        }
        this.errorMessage = err?.error?.message || 'Could not load profile from server.';
        this.isLoading = false;
        this.cdr.detectChanges();
      },
    });
  }

  refreshProfile(): void {
    if (this.isLoading) return;
    this.loadProfile(true);
  }

  saveChanges(): void {
    const githubUsername = this.normalizeGithubUsername(this.profile.githubUsername);
    if (!githubUsername || !this.githubUsernamePattern.test(githubUsername)) {
      this.errorMessage = 'Enter a valid GitHub username.';
      this.successMessage = '';
      return;
    }

    const payload: UpdateProfilePayload = {
      name: this.sanitizeText(this.profile.name),
      githubUsername,
      jobTitle: this.sanitizeText(this.profile.jobTitle),
      location: this.sanitizeText(this.profile.location),
      bio: this.sanitizeText(this.profile.bio),
      website: this.sanitizeText(this.profile.website),
      twitter: this.sanitizeText(this.profile.twitter),
      linkedin: this.sanitizeText(this.profile.linkedin),
      phoneNumber: this.sanitizeText(this.profile.phoneNumber),
      notifications: { ...(this.profile.notifications || {}) },
    };

    if (!payload.name) {
      this.errorMessage = 'Full name is required.';
      this.successMessage = '';
      return;
    }

    if (!this.hasProfileChanges(payload)) {
      this.errorMessage = 'No changes detected to save.';
      this.successMessage = '';
      return;
    }

    this.isSaving = true;
    this.successMessage = '';
    this.errorMessage = '';

    this.profileService.updateProfile(payload).subscribe({
      next: (updated) => {
        this.profile = this.normalizeProfile({
          ...this.profile,
          ...updated,
          ...payload,
          notifications: updated.notifications || payload.notifications || this.profile.notifications,
        });
        this.snapshot = this.cloneProfile(this.profile);
        this.successMessage = 'Profile saved successfully!';
        this.isSaving = false;
        this.cdr.detectChanges();
        setTimeout(() => { this.successMessage = ''; }, 3000);
      },
      error: (err) => {
        this.errorMessage = err?.error?.message || 'Failed to save profile.';
        this.isSaving = false;
        this.cdr.detectChanges();
      },
    });
  }

  normalizeProfile(data: any): UserProfile {
    if (!data || typeof data !== 'object') return this.cloneProfile(this.snapshot);
    return {
      _id: data._id || '',
      name: data.name || '',
      email: data.email || '',
      phoneNumber: data.phoneNumber || '',
      countryCode: data.countryCode || '',
      githubUsername: data.githubUsername || '',
      activeGithubUsername: data.activeGithubUsername || data.githubUsername || '',
      avatar: this.profileService.resolveAvatarUrl(data.avatar || ''),
      jobTitle: data.jobTitle || '',
      location: data.location || '',
      bio: data.bio || '',
      website: data.website || '',
      twitter: data.twitter || '',
      linkedin: data.linkedin || '',
      careerStack: data.careerStack || 'Full Stack',
      experienceLevel: data.experienceLevel || 'Student',
      activeCareerStack: data.activeCareerStack || data.careerStack || 'Full Stack',
      activeExperienceLevel: data.activeExperienceLevel || data.experienceLevel || 'Student',
      careerGoal: data.careerGoal || '',
      isConfigured: data.isConfigured ?? false,
      isPublic: data.isPublic ?? false,
      role: data.role || 'developer',
      profileCompleted: data.profileCompleted ?? true,
      defaultResume: data.defaultResume || null,
      activeResume: data.activeResume || null,
      notifications: {
        weeklyScoreReport: data.notifications?.weeklyScoreReport ?? true,
        skillTrendAlerts: data.notifications?.skillTrendAlerts ?? true,
        newRecommendations: data.notifications?.newRecommendations ?? false,
        jobMatchAlerts: data.notifications?.jobMatchAlerts ?? true,
      },
      stats: {
        developerScore: data.stats?.developerScore ?? 0,
        reposAnalyzed: data.stats?.reposAnalyzed ?? 0,
        skillsDetected: data.stats?.skillsDetected ?? 0,
        memberSince: data.stats?.memberSince ?? '',
      },
    };
  }

  saveCareerProfile(): void {
    const careerStack = this.profile.careerStack;
    const experienceLevel = this.profile.experienceLevel;
    const careerGoal = (this.profile.careerGoal || '') as CareerGoal;

    if (!this.careerStacks.includes(careerStack) || !this.experienceLevels.includes(experienceLevel) || !['', ...this.careerGoals].includes(careerGoal)) {
      this.errorMessage = 'Choose a valid career profile.';
      this.careerSuccess = '';
      return;
    }

    if (
      careerStack === this.snapshot.careerStack &&
      experienceLevel === this.snapshot.experienceLevel &&
      careerGoal === this.snapshot.careerGoal
    ) {
      this.errorMessage = 'No career profile changes detected.';
      this.careerSuccess = '';
      return;
    }

    this.isSavingCareer = true;
    this.careerSuccess = '';
    this.errorMessage = '';

    this.careerProfileService.saveCareerProfile(careerStack, experienceLevel, careerGoal).subscribe({
      next: (response) => {
        this.profile.careerStack = response.activeCareerStack || response.careerStack || this.profile.careerStack;
        this.profile.experienceLevel = response.activeExperienceLevel || response.experienceLevel || this.profile.experienceLevel;
        this.profile.activeCareerStack = response.activeCareerStack || response.careerStack || this.profile.activeCareerStack;
        this.profile.activeExperienceLevel = response.activeExperienceLevel || response.experienceLevel || this.profile.activeExperienceLevel;
        this.profile.careerGoal = response.careerGoal ?? this.profile.careerGoal;
        this.profile.isConfigured = response.isConfigured ?? this.profile.isConfigured;
        this.snapshot = this.cloneProfile(this.profile);
        this.careerSuccess = 'Career profile saved!';
        this.isSavingCareer = false;
        this.cdr.detectChanges();
        setTimeout(() => { this.careerSuccess = ''; this.cdr.detectChanges(); }, 3000);
      },
      error: (err) => {
        this.errorMessage = err?.error?.message || 'Failed to save career profile.';
        this.isSavingCareer = false;
        this.cdr.detectChanges();
      },
    });
  }

  toggleChangePassword(): void {
    this.isChangingPwd = !this.isChangingPwd;
    this.passwordForm = { currentPassword: '', newPassword: '', confirmPassword: '' };
    this.pwdError = '';
    this.pwdSuccess = '';
  }

  submitPasswordChange(): void {
    this.pwdError = '';
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
      newPassword: this.passwordForm.newPassword,
    }).subscribe({
      next: () => {
        this.pwdSuccess = 'Password updated successfully!';
        this.isChangingPwd = false;
        this.passwordForm = { currentPassword: '', newPassword: '', confirmPassword: '' };
      },
      error: (err) => {
        this.pwdError = err?.error?.message || 'Failed to update password.';
      },
    });
  }

  confirmDelete(): void {
    this.profileService.deleteAccount().subscribe({
      next: () => {
        this.authService.logout();
        this.router.navigate(['/']);
      },
      error: (err) => {
        this.errorMessage = err?.error?.message || 'Failed to delete account.';
        this.showDeleteConfirm = false;
      },
    });
  }

  get isAdmin(): boolean {
    return this.profile.role === 'admin';
  }

  toggleVisibility(): void {
    if (this.isAdmin || this.isTogglingVisibility) return;

    const next = !this.profile.isPublic;
    this.isTogglingVisibility = true;
    this.visibilityMessage = '';

    this.profileService.updateVisibility(next).subscribe({
      next: (res) => {
        this.profile.isPublic = res.isPublic;
        this.snapshot.isPublic = res.isPublic;
        this.visibilityMessage = res.isPublic
          ? 'Your profile is now visible to recruiters.'
          : 'Your profile is now hidden from the talent pool.';
        this.isTogglingVisibility = false;
        this.cdr.detectChanges();
        setTimeout(() => { this.visibilityMessage = ''; this.cdr.detectChanges(); }, 3000);
      },
      error: (err) => {
        this.visibilityMessage = err?.error?.message || 'Failed to update visibility.';
        this.isTogglingVisibility = false;
        this.cdr.detectChanges();
      }
    });
  }

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

    const previousAvatar = this.profile.avatar;

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
    this.releaseAvatarPreviewUrl();
    this.avatarPreviewUrl = URL.createObjectURL(file);
    this.profile.avatar = this.avatarPreviewUrl;
    this.bumpAvatarVersion();
    this.cdr.detectChanges();

    this.profileService.uploadAvatar(file).subscribe({
      next: (res) => {
        this.releaseAvatarPreviewUrl();
        this.profile.avatar = this.profileService.resolveAvatarUrl(res.avatar);
        this.authService.updateCurrentUser({ avatar: this.profile.avatar });
        this.bumpAvatarVersion();
        this.snapshot = this.cloneProfile(this.profile);
        this.isUploadingAvatar = false;
        this.successMessage = 'Profile photo updated successfully.';
        input.value = '';
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.releaseAvatarPreviewUrl();
        this.profile.avatar = previousAvatar;
        this.bumpAvatarVersion();
        this.isUploadingAvatar = false;
        this.errorMessage = err?.error?.message || 'Failed to upload profile photo.';
        input.value = '';
        this.cdr.detectChanges();
      }
    });
  }

  getAvatarSrc(): string {
    const raw = String(this.profile.avatar || '').trim();
    if (!raw) return '';
    if (/^data:/i.test(raw) || raw.startsWith('blob:')) return raw;
    const separator = raw.includes('?') ? '&' : '?';
    return `${raw}${separator}v=${this.avatarVersion}`;
  }

  onAvatarError(event: Event): void {
    const img = event.target as HTMLImageElement;
    console.error('[Profile] Avatar failed to load:', img.src);
    this.profile.avatar = '';
    this.cdr.detectChanges();
  }

  private hasProfileChanges(payload: UpdateProfilePayload): boolean {
    const snapshot = this.snapshot;
    return [
      payload.name !== snapshot.name,
      payload.githubUsername !== snapshot.githubUsername,
      payload.jobTitle !== snapshot.jobTitle,
      payload.location !== snapshot.location,
      payload.bio !== snapshot.bio,
      payload.website !== snapshot.website,
      payload.twitter !== snapshot.twitter,
      payload.linkedin !== snapshot.linkedin,
      payload.phoneNumber !== snapshot.phoneNumber,
      JSON.stringify(payload.notifications || {}) !== JSON.stringify(snapshot.notifications || {})
    ].some(Boolean);
  }

  private normalizeGithubUsername(value: string): string {
    return String(value || '').trim().replace(/^@+/, '');
  }

  private sanitizeText(value: string | undefined | null): string {
    return String(value || '').trim();
  }

  private cloneProfile(profile: UserProfile): UserProfile {
    return {
      ...profile,
      notifications: { ...(profile.notifications || {}) },
      stats: { ...(profile.stats || {}) },
      defaultResume: profile.defaultResume ? { ...profile.defaultResume } : null,
      activeResume: profile.activeResume ? { ...profile.activeResume } : null
    };
  }

  private bumpAvatarVersion(): void {
    this.avatarVersion = Date.now();
  }

  private releaseAvatarPreviewUrl(): void {
    if (this.avatarPreviewUrl) {
      URL.revokeObjectURL(this.avatarPreviewUrl);
      this.avatarPreviewUrl = null;
    }
  }
}
