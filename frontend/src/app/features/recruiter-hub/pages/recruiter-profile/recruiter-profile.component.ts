import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { AuthService } from '../../../../shared/services/auth.service';
import { TenantContextService } from '../../../../shared/services/tenant-context.service';
import { RecruiterHubService } from '../../services/recruiter-hub.service';
import { RecruiterProfile } from '../../models/recruiter.model';

@Component({
  selector: 'app-recruiter-profile',
  standalone: false,
  templateUrl: './recruiter-profile.component.html',
  styleUrl: './recruiter-profile.component.scss',
})
export class RecruiterProfileComponent implements OnInit {
  private readonly fb = inject(FormBuilder);

  loading = true;
  saving = false;
  profile: RecruiterProfile | null = null;
  error = '';
  notice = '';
  fieldErrors: Record<string, string> = {};
  organizationName = '';
  connectedTeams: string[] = [];
  readonly recruiterRoleLabel = 'Recruiter';

  readonly profileForm = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(120)]],
    email: [{ value: '', disabled: true }, [Validators.required, Validators.email]],
    avatar: [''],
    jobTitle: [''],
    location: [''],
    phoneNumber: [''],
    githubUsername: [''],
    linkedin: [''],
    website: ['', [Validators.maxLength(240)]],
    bio: ['', [Validators.maxLength(600)]],
    education: ['', [Validators.maxLength(180)]],
    yearsOfExperience: [0, [Validators.min(0), Validators.max(50)]],
    experienceSummary: ['', [Validators.maxLength(1200)]],
    certifications: [''],
    specialties: [''],
    toolsAndPlatforms: [''],
    languages: [''],
    preferredStacks: [''],
    preferredLocations: [''],
    preferredJobTypes: [''],
    noteTemplate: [''],
    activityDigest: [true],
  });

  constructor(
    private readonly hubService: RecruiterHubService,
    private readonly authService: AuthService,
    private readonly tenantContext: TenantContextService,
  ) {}

  ngOnInit(): void {
    this.loadProfile();
  }

  get isSubmitDisabled(): boolean {
    return this.loading || this.saving || this.profileForm.invalid;
  }

  save(): void {
    this.error = '';
    this.notice = '';
    this.fieldErrors = {};

    if (this.profileForm.invalid || !this.profile) {
      this.profileForm.markAllAsTouched();
      return;
    }

    this.saving = true;
    const raw = this.profileForm.getRawValue();
    const payload = {
      ...this.profile,
      name: raw.name,
      avatar: raw.avatar,
      jobTitle: raw.jobTitle,
      location: raw.location,
      phoneNumber: raw.phoneNumber,
      githubUsername: raw.githubUsername,
      linkedin: raw.linkedin,
      website: raw.website,
      bio: raw.bio,
      recruiterDetails: {
        education: raw.education,
        yearsOfExperience: Number(raw.yearsOfExperience || 0),
        experienceSummary: raw.experienceSummary,
        certifications: this.toArray(raw.certifications),
        specialties: this.toArray(raw.specialties),
        toolsAndPlatforms: this.toArray(raw.toolsAndPlatforms),
        languages: this.toArray(raw.languages),
      },
      recruiterPreferences: {
        preferredStacks: this.toArray(raw.preferredStacks),
        preferredLocations: this.toArray(raw.preferredLocations),
        preferredJobTypes: this.toArray(raw.preferredJobTypes),
        noteTemplate: raw.noteTemplate,
        activityDigest: raw.activityDigest,
      },
    };

    this.hubService.updateProfile(payload).subscribe({
      next: (response) => {
        this.profile = (response?.profile as RecruiterProfile) || this.profile;
        this.patchForm(this.profile);
        this.authService.updateCurrentUser({
          name: this.profile?.name,
          avatar: this.profile?.avatar,
          githubUsername: this.profile?.githubUsername,
        });
        this.notice = 'Recruiter profile updated successfully.';
        this.saving = false;
        this.hubService.clearCache();
      },
      error: (err) => {
        this.saving = false;
        this.error = this.extractApiError(err, 'Unable to update recruiter profile.');
        const errors = err?.error?.errors;
        if (errors && typeof errors === 'object') {
          this.fieldErrors = Object.fromEntries(
            Object.entries(errors).map(([key, value]) => [key, String(value || '')]),
          );
        }
      },
    });
  }

  showControlError(controlName: string): boolean {
    const control = this.profileForm.get(controlName);
    return Boolean(
      this.fieldErrors[controlName] ||
        (control && control.invalid && (control.touched || control.dirty)),
    );
  }

  controlError(controlName: string, fallback = 'This field is required.'): string {
    if (this.fieldErrors[controlName]) return this.fieldErrors[controlName];
    const control = this.profileForm.get(controlName);
    if (!control?.errors) return '';
    if (control.errors['required']) return fallback;
    if (control.errors['email']) return 'Enter a valid email address.';
    if (control.errors['maxlength']) return 'Value is too long.';
    if (control.errors['min'] || control.errors['max']) {
      return 'Enter a value within the allowed range.';
    }
    return fallback;
  }

  private loadProfile(): void {
    this.loading = true;
    this.error = '';
    this.hubService.getProfile().subscribe({
      next: (response) => {
        this.profile = (response?.profile as RecruiterProfile) || null;
        this.patchForm(this.profile);
        this.loading = false;
      },
      error: (err) => {
        this.error = this.extractApiError(err, 'Unable to load recruiter profile.');
        this.loading = false;
      },
    });
  }

  get profileCompletionItems(): Array<{ label: string; done: boolean }> {
    const current = this.profile;
    return [
      { label: 'Identity', done: Boolean(current?.name && current?.email) },
      { label: 'Contact', done: Boolean(current?.phoneNumber || current?.linkedin || current?.githubUsername) },
      { label: 'Background', done: Boolean(current?.recruiterDetails?.education || current?.recruiterDetails?.yearsOfExperience || current?.recruiterDetails?.certifications?.length) },
      { label: 'Sourcing Preferences', done: Boolean(current?.recruiterPreferences?.preferredStacks?.length || current?.recruiterPreferences?.preferredLocations?.length) },
    ];
  }

  private patchForm(profile: RecruiterProfile | null): void {
    if (profile?.organization?._id || profile?.organization?.name) {
      this.tenantContext.syncOrganization({
        id: String(profile?.organization?._id || this.tenantContext.snapshot.organizationId || ''),
        name: String(profile?.organization?.name || this.tenantContext.snapshot.organizationName || ''),
        myRole: 'recruiter'
      });
    }

    this.organizationName =
      profile?.organization?.name ||
      this.tenantContext.snapshot.organizationName ||
      '';
    this.connectedTeams = Array.isArray(profile?.teams)
      ? profile.teams.map((team) => team.name).filter(Boolean)
      : [];

    this.profileForm.reset({
      name: profile?.name || '',
      email: profile?.email || '',
      avatar: profile?.avatar || '',
      jobTitle: profile?.jobTitle || '',
      location: profile?.location || '',
      phoneNumber: profile?.phoneNumber || '',
      githubUsername: profile?.githubUsername || '',
      linkedin: profile?.linkedin || '',
      website: profile?.website || '',
      bio: profile?.bio || '',
      education: profile?.recruiterDetails?.education || '',
      yearsOfExperience: Number(profile?.recruiterDetails?.yearsOfExperience || 0),
      experienceSummary: profile?.recruiterDetails?.experienceSummary || '',
      certifications: (profile?.recruiterDetails?.certifications || []).join(', '),
      specialties: (profile?.recruiterDetails?.specialties || []).join(', '),
      toolsAndPlatforms: (profile?.recruiterDetails?.toolsAndPlatforms || []).join(', '),
      languages: (profile?.recruiterDetails?.languages || []).join(', '),
      preferredStacks: (profile?.recruiterPreferences?.preferredStacks || []).join(', '),
      preferredLocations: (profile?.recruiterPreferences?.preferredLocations || []).join(', '),
      preferredJobTypes: (profile?.recruiterPreferences?.preferredJobTypes || []).join(', '),
      noteTemplate: profile?.recruiterPreferences?.noteTemplate || '',
      activityDigest: profile?.recruiterPreferences?.activityDigest !== false,
    });
    this.profileForm.markAsPristine();
    this.profileForm.markAsUntouched();
  }

  private extractApiError(err: any, fallbackMessage: string): string {
    return String(err?.error?.message || err?.message || fallbackMessage);
  }

  private toArray(value: string): string[] {
    return String(value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
}
