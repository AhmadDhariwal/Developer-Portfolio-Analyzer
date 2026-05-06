import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, DestroyRef, OnInit, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SuperAdminService } from '../shared/super-admin.service';

type SettingsTab = 'general' | 'ai' | 'organization' | 'recruiter' | 'developer' | 'security' | 'analytics' | 'notifications' | 'integrations';

@Component({
  selector: 'app-super-admin-settings',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './super-admin-settings.component.html',
  styleUrls: ['./super-admin-settings.component.scss']
})
export class SuperAdminSettingsComponent implements OnInit {
  private readonly fb = inject(FormBuilder);

  readonly tabs: Array<{ id: SettingsTab; label: string }> = [
    { id: 'general', label: 'General' },
    { id: 'ai', label: 'AI' },
    { id: 'organization', label: 'Organizations' },
    { id: 'recruiter', label: 'Recruiters' },
    { id: 'developer', label: 'Developers' },
    { id: 'security', label: 'Security' },
    { id: 'analytics', label: 'Analytics' },
    { id: 'notifications', label: 'Notifications' },
    { id: 'integrations', label: 'Integrations' }
  ];

  activeTab: SettingsTab = 'general';
  loading = true;
  saving = false;
  toast: { show: boolean; type: 'success' | 'error'; message: string } = { show: false, type: 'success', message: '' };
  secretStatus: Record<string, string> = {};
  lastUpdatedAt = '';
  private loadedSnapshot: any = null;

  readonly form = this.fb.group({
    general: this.fb.group({
      platformName: ['', Validators.required],
      logoUrl: [''],
      maintenanceMode: [false],
      defaultTimezone: ['Asia/Karachi', Validators.required],
      defaultLanguage: ['en', Validators.required]
    }),
    ai: this.fb.group({
      enabled: [true],
      provider: ['openai', Validators.required],
      model: ['gpt-4.1-mini', Validators.required],
      usageLimitPerDay: [5000, [Validators.min(0)]],
      recommendationLimit: [10, [Validators.min(1)]],
      promptTemplate: [''],
      providerApiKey: ['']
    }),
    organization: this.fb.group({
      allowOrgCreation: [false],
      maxTeamsPerOrganization: [10, [Validators.min(1)]],
      recruiterLimitPerOrg: [5, [Validators.min(1)]],
      adminInvitesRequireApproval: [true]
    }),
    recruiter: this.fb.group({
      enableRecruiterAccess: [true],
      candidateVisibility: ['public', Validators.required],
      activityThresholdDays: [14, [Validators.min(1)]]
    }),
    developer: this.fb.group({
      publicPortfolioVisibility: [true],
      githubRequirement: [true],
      profileCompletionRequirement: [70, [Validators.min(0), Validators.max(100)]]
    }),
    security: this.fb.group({
      jwtExpiresIn: ['20h', Validators.required],
      otpExpiryMinutes: [10, [Validators.min(1)]],
      otpMaxAttempts: [3, [Validators.min(1)]],
      passwordMinLength: [6, [Validators.min(6)]],
      requireStrongPassword: [false],
      loginMaxFailures: [6, [Validators.min(1)]],
      loginLockoutMinutes: [10, [Validators.min(1)]],
      globalRateLimitMax: [500, [Validators.min(10)]]
    }),
    analytics: this.fb.group({
      refreshIntervalMinutes: [30, [Validators.min(1)]],
      dashboardCacheMinutes: [10, [Validators.min(1)]],
      enableStructuredLogging: [true]
    }),
    notifications: this.fb.group({
      emailNotifications: [true],
      systemAlerts: [true],
      recruiterAlerts: [true],
      adminAlerts: [true]
    }),
    integrations: this.fb.group({
      github: this.fb.group({
        enabled: [true],
        apiKey: ['']
      }),
      news: this.fb.group({
        enabled: [true],
        apiKey: ['']
      }),
      jobs: this.fb.group({
        enabled: [true],
        apiKey: ['']
      })
    })
  });

  constructor(
    private readonly sa: SuperAdminService,
    private readonly destroyRef: DestroyRef,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.load();
  }

  selectTab(tab: SettingsTab): void {
    this.activeTab = tab;
  }

  load(): void {
    this.loading = true;
    this.sa.getSettings().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        const settings = res?.settings || {};
        this.loadedSnapshot = settings;
        this.secretStatus = settings?.secretStatus || {};
        this.lastUpdatedAt = settings?.updatedAt || '';
        this.patchForm(settings);
        this.loading = false;
        try { this.cdr.detectChanges(); } catch {}
      },
      error: (err) => {
        this.loading = false;
        this.showToast('error', err?.error?.message || 'Failed to load settings.');
        try { this.cdr.detectChanges(); } catch {}
      }
    });
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.showToast('error', 'Please fix the highlighted fields.');
      return;
    }

    this.saving = true;
    const payload = this.form.getRawValue();
    this.sa.updateSettings(payload as Record<string, any>).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        const settings = res?.settings || {};
        this.loadedSnapshot = settings;
        this.secretStatus = settings?.secretStatus || {};
        this.lastUpdatedAt = settings?.updatedAt || '';
        this.patchForm(settings);
        this.saving = false;
        this.showToast('success', 'Settings saved successfully.');
        try { this.cdr.detectChanges(); } catch {}
      },
      error: (err) => {
        this.saving = false;
        this.showToast('error', err?.error?.message || 'Failed to save settings.');
        try { this.cdr.detectChanges(); } catch {}
      }
    });
  }

  reset(): void {
    if (this.loadedSnapshot) {
      this.patchForm(this.loadedSnapshot);
      this.showToast('success', 'Form reset to last saved values.');
    }
  }

  hasSecret(section: string): string {
    return this.secretStatus?.[section] || '';
  }

  private patchForm(settings: any): void {
    this.form.reset({
      general: {
        platformName: settings?.general?.platformName || 'DevInsight AI',
        logoUrl: settings?.general?.logoUrl || '',
        maintenanceMode: Boolean(settings?.general?.maintenanceMode),
        defaultTimezone: settings?.general?.defaultTimezone || 'Asia/Karachi',
        defaultLanguage: settings?.general?.defaultLanguage || 'en'
      },
      ai: {
        enabled: settings?.ai?.enabled !== false,
        provider: settings?.ai?.provider || 'openai',
        model: settings?.ai?.model || 'gpt-4.1-mini',
        usageLimitPerDay: settings?.ai?.usageLimitPerDay ?? 5000,
        recommendationLimit: settings?.ai?.recommendationLimit ?? 10,
        promptTemplate: settings?.ai?.promptTemplate || '',
        providerApiKey: ''
      },
      organization: {
        allowOrgCreation: Boolean(settings?.organization?.allowOrgCreation),
        maxTeamsPerOrganization: settings?.organization?.maxTeamsPerOrganization ?? 10,
        recruiterLimitPerOrg: settings?.organization?.recruiterLimitPerOrg ?? 5,
        adminInvitesRequireApproval: settings?.organization?.adminInvitesRequireApproval !== false
      },
      recruiter: {
        enableRecruiterAccess: settings?.recruiter?.enableRecruiterAccess !== false,
        candidateVisibility: settings?.recruiter?.candidateVisibility || 'public',
        activityThresholdDays: settings?.recruiter?.activityThresholdDays ?? 14
      },
      developer: {
        publicPortfolioVisibility: settings?.developer?.publicPortfolioVisibility !== false,
        githubRequirement: settings?.developer?.githubRequirement !== false,
        profileCompletionRequirement: settings?.developer?.profileCompletionRequirement ?? 70
      },
      security: {
        jwtExpiresIn: settings?.security?.jwtExpiresIn || '20h',
        otpExpiryMinutes: settings?.security?.otpExpiryMinutes ?? 10,
        otpMaxAttempts: settings?.security?.otpMaxAttempts ?? 3,
        passwordMinLength: settings?.security?.passwordMinLength ?? 6,
        requireStrongPassword: Boolean(settings?.security?.requireStrongPassword),
        loginMaxFailures: settings?.security?.loginMaxFailures ?? 6,
        loginLockoutMinutes: settings?.security?.loginLockoutMinutes ?? 10,
        globalRateLimitMax: settings?.security?.globalRateLimitMax ?? 500
      },
      analytics: {
        refreshIntervalMinutes: settings?.analytics?.refreshIntervalMinutes ?? 30,
        dashboardCacheMinutes: settings?.analytics?.dashboardCacheMinutes ?? 10,
        enableStructuredLogging: settings?.analytics?.enableStructuredLogging !== false
      },
      notifications: {
        emailNotifications: settings?.notifications?.emailNotifications !== false,
        systemAlerts: settings?.notifications?.systemAlerts !== false,
        recruiterAlerts: settings?.notifications?.recruiterAlerts !== false,
        adminAlerts: settings?.notifications?.adminAlerts !== false
      },
      integrations: {
        github: {
          enabled: settings?.integrations?.github?.enabled !== false,
          apiKey: ''
        },
        news: {
          enabled: settings?.integrations?.news?.enabled !== false,
          apiKey: ''
        },
        jobs: {
          enabled: settings?.integrations?.jobs?.enabled !== false,
          apiKey: ''
        }
      }
    });
  }

  private showToast(type: 'success' | 'error', message: string): void {
    this.toast = { show: true, type, message };
    setTimeout(() => {
      this.toast.show = false;
      try { this.cdr.detectChanges(); } catch {}
    }, 2800);
  }
}
