import { ProfileAccountTelemetryComponent } from './components/profile-account-telemetry/profile-account-telemetry.component';
import { ProfileAvatarUploaderComponent } from './components/profile-avatar-uploader/profile-avatar-uploader.component';
import { ProfilePageHeaderComponent } from './components/profile-page-header/profile-page-header.component';
import {
  Component,
  OnInit,
  ChangeDetectorRef,
  DestroyRef,
  HostListener,
  ElementRef,
  ViewChild,
  inject,
} from '@angular/core';
import { finalize } from 'rxjs/operators';
import { CommonModule } from '@angular/common';
import { ProfileSecuritySettingsComponent } from './components/profile-security-settings/profile-security-settings.component';
import { ProfileVisibilitySettingsComponent } from './components/profile-visibility-settings/profile-visibility-settings.component';
import { ProfileAppearanceSettingsComponent } from './components/profile-appearance-settings/profile-appearance-settings.component';
import { ProfileNotificationSettingsComponent } from './components/profile-notification-settings/profile-notification-settings.component';
import { ProfileCareerPreferencesComponent } from './components/profile-career-preferences/profile-career-preferences.component';
import { ProfileConnectedAccountsComponent } from './components/profile-connected-accounts/profile-connected-accounts.component';
import { ProfilePersonalInformationComponent } from './components/profile-personal-information/profile-personal-information.component';
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
import { ThemeService, ThemePreference } from '../../shared/services/theme.service';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [
    ProfileAccountTelemetryComponent,
    ProfileAvatarUploaderComponent,
    ProfilePageHeaderComponent,
    CommonModule,
    ProfileSecuritySettingsComponent,
    ProfileVisibilitySettingsComponent,
    ProfileAppearanceSettingsComponent,
    ProfileNotificationSettingsComponent,
    ProfileCareerPreferencesComponent,
    ProfileConnectedAccountsComponent,
    ProfilePersonalInformationComponent,
  ],
  templateUrl: './profile.component.html',
  styleUrl: './profile.component.scss',
})
export class ProfileComponent implements OnInit {
  readonly themeService = inject(ThemeService);
  readonly careerStacks: CareerStack[] = CAREER_STACKS;
  readonly experienceLevels: ExperienceLevel[] = EXPERIENCE_LEVELS;
  readonly targetTimelines = ['Immediately', '1-3 months', '3-6 months', '6+ months'];
  readonly learningPreferences = [
    'Project-based',
    'Reading',
    'Video courses',
    'Mentorship',
    'Mixed',
  ];
  readonly careerGoals: CareerGoal[] = CAREER_GOALS;
  private readonly githubUsernamePattern = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

  isLoading = true;
  isSaving = false;
  isSavingCareer = false;
  isChangingPwd = false;
  isSavingPassword = false;
  isDeleting = false;
  showDeleteConfirm = false;
  @ViewChild('deleteDialog') private deleteDialog?: ElementRef<HTMLDialogElement>;
  successMessage = '';
  errorMessage = '';
  pwdError = '';
  pwdSuccess = '';
  careerSuccess = '';
  isUploadingAvatar = false;
  avatarUploadProgress: number | null = null;
  isAvatarChangePending = false;
  isAvatarPreviewOpen = false;
  avatarVersion = Date.now();
  isTogglingVisibility = false;
  visibilityMessage = '';
  private avatarPreviewUrl: string | null = null;
  private pendingAvatarFile: File | null = null;
  private readonly destroyRef = inject(DestroyRef);

  profile: UserProfile = {
    _id: '',
    name: '',
    email: '',
    githubUsername: '',
    phoneNumber: '',
    countryCode: '',
    activeGithubUsername: '',
    avatar: '',
    jobTitle: '',
    location: '',
    bio: '',
    website: '',
    twitter: '',
    linkedin: '',
    careerStack: 'Full Stack',
    experienceLevel: 'Student',
    careerGoal: '',
    targetTimeline: '',
    learningPreference: '',
    profileHash: '',
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

  private snapshot: UserProfile = {
    _id: '',
    name: '',
    email: '',
    githubUsername: '',
    phoneNumber: '',
    countryCode: '',
    activeGithubUsername: '',
    avatar: '',
    jobTitle: '',
    location: '',
    bio: '',
    website: '',
    twitter: '',
    linkedin: '',
    careerStack: 'Full Stack',
    experienceLevel: 'Student',
    careerGoal: '',
    targetTimeline: '',
    learningPreference: '',
    profileHash: '',
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

  constructor(
    private readonly profileService: ProfileService,
    private readonly authService: AuthService,
    private readonly careerProfileService: CareerProfileService,
    private readonly router: Router,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => {
      this.authService.clearAvatarPreview();
      this.releaseAvatarPreviewUrl();
    });
    this.loadProfile();

    this.authService.currentUser$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((user) => {
      const nextAvatar = this.profileService.resolveAvatarUrl(String(user?.avatar || ''));
      if (
        !nextAvatar ||
        this.isUploadingAvatar ||
        this.isAvatarChangePending ||
        this.profile.avatar === nextAvatar
      ) {
        return;
      }

      this.profile.avatar = nextAvatar;
      this.bumpAvatarVersion();
      this.cdr.detectChanges();
    });
  }

  // ── Load from backend ──────────────────────────────────────────────────
  loadProfile(forceRefresh = false): void {
    this.isLoading = true;
    this.profileService.getProfile(forceRefresh).subscribe({
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
          this.profile.activeGithubUsername =
            cached.activeGithubUsername ?? cached.githubUsername ?? '';
          this.profile.avatar = this.profileService.resolveAvatarUrl(String(cached.avatar || ''));
          this.profile.careerStack =
            (cached.careerStack as CareerStack) || this.profile.careerStack;
          this.profile.experienceLevel =
            (cached.experienceLevel as ExperienceLevel) || this.profile.experienceLevel;
          this.profile.activeCareerStack =
            (cached.activeCareerStack as CareerStack) ||
            this.profile.activeCareerStack ||
            this.profile.careerStack;
          this.profile.activeExperienceLevel =
            (cached.activeExperienceLevel as ExperienceLevel) ||
            this.profile.activeExperienceLevel ||
            this.profile.experienceLevel;
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
    if (this.isLoading || this.isSaving || this.isAvatarChangePending) return;
    this.loadProfile(true);
  }

  saveChanges(): void {
    if (this.isSaving) return;
    const githubUsername = this.normalizeGithubUsername(this.profile.githubUsername);
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
    const hasProfileChanges = this.hasProfileChanges(payload);

    if (
      hasProfileChanges &&
      (!githubUsername || !this.githubUsernamePattern.test(githubUsername))
    ) {
      this.errorMessage = 'Enter a valid GitHub username.';
      this.successMessage = '';
      return;
    }
    if (hasProfileChanges && !payload.name) {
      this.errorMessage = 'Full name is required.';
      this.successMessage = '';
      return;
    }
    if (!hasProfileChanges && !this.pendingAvatarFile) {
      this.errorMessage = 'No changes detected to save.';
      this.successMessage = '';
      return;
    }

    for (const key of Object.keys(payload) as (keyof UpdateProfilePayload)[]) {
      if (key === 'notifications') continue;
      if (payload[key] === this.snapshot[key as keyof UserProfile]) delete payload[key];
    }
    payload.notifications = Object.fromEntries(
      Object.entries(payload.notifications || {}).filter(
        ([key, value]) => value !== this.snapshot.notifications[key as keyof NotificationPrefs],
      ),
    );
    this.isSaving = true;
    this.errorMessage = '';
    this.successMessage = '';

    if (!hasProfileChanges) {
      this.savePendingAvatar();
      return;
    }

    this.profileService
      .updateProfile(payload)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated: Partial<UserProfile>) => {
          const persistedProfile = this.normalizeProfile({
            ...this.profile,
            ...updated,
            avatar: this.snapshot.avatar,
          });
          this.snapshot = this.cloneProfile(persistedProfile);
          this.profile = {
            ...persistedProfile,
            avatar: this.avatarPreviewUrl || persistedProfile.avatar,
          };
          if (this.pendingAvatarFile) {
            this.savePendingAvatar();
            return;
          }
          this.finishProfileSave();
        },
        error: (err: any) => {
          this.errorMessage = err?.error?.message || 'Failed to save profile.';
          this.isSaving = false;
          this.cdr.detectChanges();
        },
      });
  }

  // Defensive normalization: always return object with expected keys
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
      targetTimeline: data.targetTimeline || '',
      learningPreference: data.learningPreference || '',
      profileHash: data.profileHash || '',
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
    if (this.isSavingCareer) return;

    this.isSavingCareer = true;
    this.errorMessage = '';
    this.careerSuccess = '';
    this.careerProfileService
      .saveCareerProfile(
        this.profile.careerStack,
        this.profile.experienceLevel,
        this.profile.careerGoal,
        this.profile.targetTimeline || '',
        this.profile.learningPreference || '',
      )
      .subscribe({
        next: (updated) => {
          const careerKeys = [
            'careerStack',
            'experienceLevel',
            'careerGoal',
            'targetTimeline',
            'learningPreference',
          ] as const;
          this.profile.activeCareerStack =
            updated.activeCareerStack || this.profile.activeCareerStack;
          this.profile.activeExperienceLevel =
            updated.activeExperienceLevel || this.profile.activeExperienceLevel;
          for (const key of careerKeys) {
            if (updated[key] !== undefined) Object.assign(this.profile, { [key]: updated[key] });
          }
          for (const key of [
            'careerStack',
            'experienceLevel',
            'careerGoal',
            'targetTimeline',
            'learningPreference',
          ] as const) {
            Object.assign(this.snapshot, { [key]: this.profile[key] });
          }
          this.careerSuccess = 'Career profile saved!';
          this.isSavingCareer = false;
          this.cdr.detectChanges();
          setTimeout(() => {
            this.careerSuccess = '';
            this.cdr.detectChanges();
          }, 3000);
        },
        error: (err) => {
          this.errorMessage = err?.error?.message || 'Failed to save career profile.';
          this.isSavingCareer = false;
          this.cdr.detectChanges();
        },
      });
  }

  toggleChangePassword(): void {
    if (this.isSavingPassword) return;
    this.isChangingPwd = !this.isChangingPwd;
    this.passwordForm = { currentPassword: '', newPassword: '', confirmPassword: '' };
    this.pwdError = '';
    this.pwdSuccess = '';
  }

  submitPasswordChange(): void {
    if (this.isSavingPassword) return;
    this.pwdError = '';
    this.pwdSuccess = '';

    if (!this.passwordForm.currentPassword || !this.passwordForm.newPassword) {
      this.pwdError = 'All fields are required.';
      return;
    }
    if (this.passwordForm.newPassword !== this.passwordForm.confirmPassword) {
      this.pwdError = 'New passwords do not match.';
      return;
    }
    if (this.passwordForm.newPassword.length < 6) {
      this.pwdError = 'Password must be at least 6 characters.';
      return;
    }

    this.isSavingPassword = true;
    this.profileService
      .updatePassword({
        currentPassword: this.passwordForm.currentPassword,
        newPassword: this.passwordForm.newPassword,
      })
      .pipe(
        finalize(() => {
          this.isSavingPassword = false;
          this.cdr.detectChanges();
        }),
      )
      .subscribe({
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

  openDeleteConfirm(): void {
    this.showDeleteConfirm = true;
    this.cdr.detectChanges();
    this.deleteDialog?.nativeElement.showModal();
  }

  closeDeleteConfirm(event?: Event): void {
    if (this.isDeleting) {
      event?.preventDefault();
      return;
    }
    this.deleteDialog?.nativeElement.close();
    this.showDeleteConfirm = false;
  }

  confirmDelete(): void {
    if (this.isDeleting) return;
    this.isDeleting = true;
    this.profileService
      .deleteAccount()
      .pipe(
        finalize(() => {
          this.isDeleting = false;
          this.cdr.detectChanges();
        }),
      )
      .subscribe({
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
    return ['admin', 'super_admin'].includes(this.profile.role || '');
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
        setTimeout(() => {
          this.visibilityMessage = '';
          this.cdr.detectChanges();
        }, 3000);
      },
      error: (err) => {
        this.visibilityMessage = err?.error?.message || 'Failed to update visibility.';
        this.isTogglingVisibility = false;
        this.cdr.detectChanges();
      },
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
    input.value = '';
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

    this.errorMessage = '';
    this.successMessage = '';
    this.releaseAvatarPreviewUrl();
    this.pendingAvatarFile = file;
    this.isAvatarChangePending = true;
    this.avatarPreviewUrl = URL.createObjectURL(file);
    this.authService.setAvatarPreview(this.avatarPreviewUrl);
    this.profile.avatar = this.avatarPreviewUrl;
    this.bumpAvatarVersion();
    this.cdr.detectChanges();
  }

  discardAvatarChange(): void {
    if (!this.isAvatarChangePending || this.isSaving) return;
    this.releaseAvatarPreviewUrl();
    this.pendingAvatarFile = null;
    this.isAvatarChangePending = false;
    this.authService.clearAvatarPreview();
    this.profile.avatar = this.snapshot.avatar;
    this.errorMessage = '';
    this.bumpAvatarVersion();
    this.cdr.detectChanges();
  }

  private savePendingAvatar(): void {
    const file = this.pendingAvatarFile;
    if (!file) return this.finishProfileSave();

    this.isUploadingAvatar = true;
    this.avatarUploadProgress = null;
    this.profileService
      .uploadAvatar(file, (percent) => {
        this.avatarUploadProgress = percent;
        this.cdr.markForCheck();
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const savedAvatar = this.profileService.resolveAvatarUrl(res.avatar);
          this.releaseAvatarPreviewUrl();
          this.pendingAvatarFile = null;
          this.isAvatarChangePending = false;
          this.profile.avatar = savedAvatar;
          this.snapshot = this.cloneProfile(this.profile);
          this.authService.updateCurrentUser({ avatar: savedAvatar });
          this.authService.clearAvatarPreview();
          this.bumpAvatarVersion();
          this.isUploadingAvatar = false;
          this.finishProfileSave();
        },
        error: (err) => {
          this.isUploadingAvatar = false;
          this.isSaving = false;
          this.errorMessage = err?.error?.message || 'Failed to upload profile photo.';
          this.cdr.detectChanges();
        },
      });
  }

  private finishProfileSave(): void {
    this.successMessage = 'Profile changes saved successfully.';
    this.isSaving = false;
    this.cdr.detectChanges();
    setTimeout(() => {
      this.successMessage = '';
    }, 3000);
  }

  openAvatarPreview(): void {
    if (this.profile.avatar) this.isAvatarPreviewOpen = true;
  }

  closeAvatarPreview(): void {
    this.isAvatarPreviewOpen = false;
  }

  @HostListener('document:keydown.escape')
  onAvatarPreviewEscape(): void {
    this.closeAvatarPreview();
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
    this.profile.avatar = this.isAvatarChangePending ? this.snapshot.avatar : '';
    this.cdr.detectChanges();
  }

  private hasProfileChanges(payload: UpdateProfilePayload): boolean {
    return (Object.keys(payload) as (keyof UpdateProfilePayload)[]).some(
      (key) =>
        JSON.stringify(payload[key]) !== JSON.stringify(this.snapshot[key as keyof UserProfile]),
    );
  }

  private normalizeGithubUsername(value: string): string {
    return String(value || '')
      .trim()
      .replace(/^@+/, '');
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
      activeResume: profile.activeResume ? { ...profile.activeResume } : null,
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
