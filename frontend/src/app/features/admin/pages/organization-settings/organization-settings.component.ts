import { CommonModule } from '@angular/common';
import {
  Component,
  DestroyRef,
  HostListener,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { OrganizationShellComponent } from '../../components/organization-shell/organization-shell.component';
import { OrganizationConfigurationStore } from '../../services/organization-configuration.store';
import {
  organizationTimezoneError,
  organizationUrlError,
} from '../../utils/organization-settings-validation';
import { AdminConsoleService, ConsolePreferences } from '../admin-console/admin-console.service';

type GeneralDraft = {
  name: string;
  description: string;
  industry: string;
  website: string;
  timezone: string;
  logoUrl: string;
};

type DashboardDraft = NonNullable<ConsolePreferences['organization']['dashboardConfig']>;

@Component({
  selector: 'app-organization-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, OrganizationShellComponent],
  templateUrl: './organization-settings.component.html',
  styleUrl: './organization-settings.component.scss',
})
export class OrganizationSettingsComponent {
  readonly store = inject(OrganizationConfigurationStore);
  private readonly console = inject(AdminConsoleService);
  private readonly destroy = inject(DestroyRef);

  readonly message = signal('');
  readonly conflict = signal(false);
  readonly teams = signal<Array<{ _id: string; name: string }>>([]);
  general: GeneralDraft | null = null;
  dashboard: DashboardDraft | null = null;
  attempted = false;
  readonly fields = [
    { key: 'name', label: 'Organization name', limit: 80 },
    { key: 'description', label: 'Description', limit: 500 },
    { key: 'industry', label: 'Industry', limit: 100 },
    { key: 'website', label: 'Website', limit: 500 },
    { key: 'timezone', label: 'Timezone', limit: 100 },
    { key: 'logoUrl', label: 'Branding logo URL', limit: 500 },
  ] as const;
  readonly visibility = [
    { key: 'showKpiCards', label: 'KPI cards' },
    { key: 'showTeamAnalytics', label: 'Team analytics' },
    { key: 'showRecruiterPerformance', label: 'Recruiter performance' },
    { key: 'showJobTrends', label: 'Job trends' },
    { key: 'showActivityFeed', label: 'Activity feed' },
  ] as const;

  private baselineGeneral = '';
  private baselineDashboard = '';

  constructor() {
    effect(() => {
      this.store.context();
      untracked(() => {
        this.general = null;
        this.dashboard = null;
        if (this.store.context()) this.load();
      });
    });
  }

  get dirty(): boolean {
    return (
      !!this.general &&
      (JSON.stringify(this.general) !== this.baselineGeneral ||
        JSON.stringify(this.dashboard) !== this.baselineDashboard)
    );
  }

  get generalDirty(): boolean {
    return !!this.general && JSON.stringify(this.general) !== this.baselineGeneral;
  }

  get dashboardDirty(): boolean {
    return !!this.dashboard && JSON.stringify(this.dashboard) !== this.baselineDashboard;
  }

  get dashboardReview(): Array<{ label: string; draft: string; server: string }> {
    const server = this.store.preferences()?.organization.dashboardConfig;
    const name = (id: string | undefined) =>
      !id ? 'All teams' : this.teams().find((team) => team._id === id)?.name || 'Team unavailable';
    return [
      {
        label: 'Preferred date range',
        draft: `${this.dashboard?.preferredDateRangeDays} days`,
        server: `${server?.preferredDateRangeDays} days`,
      },
      {
        label: 'Default team',
        draft: name(this.dashboard?.defaultTeamId),
        server: name(server?.defaultTeamId),
      },
      ...this.visibility.map((field) => ({
        label: field.label,
        draft: this.dashboard?.[field.key] ? 'Shown' : 'Hidden',
        server: server?.[field.key] ? 'Shown' : 'Hidden',
      })),
    ];
  }

  @HostListener('window:beforeunload', ['$event']) beforeUnload(event: BeforeUnloadEvent): void {
    if (this.dirty) {
      event.preventDefault();
      event.returnValue = '';
    }
  }

  serverField(key: keyof GeneralDraft): string {
    const value = this.store.committed()!.organization;
    return key === 'logoUrl' ? value.branding.logoUrl : value[key];
  }

  load(preserve = false): void {
    if (
      !preserve &&
      this.dirty &&
      !window.confirm('Discard unsaved organization changes and refresh?')
    )
      return;
    const context = this.store.context();
    this.store
      .load()
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: () => {
          if (context !== this.store.context()) return;
          if (!preserve) this.reset();
        },
        error: () => {},
      });
    this.console
      .getTeams()
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: (result) => {
          if (context === this.store.context()) this.teams.set(result.teams);
        },
        error: () => this.teams.set([]),
      });
  }

  reset(): void {
    const organization = this.store.committed()?.organization;
    if (!organization) return;
    this.general = {
      name: organization.name,
      description: organization.description,
      industry: organization.industry,
      website: organization.website,
      timezone: organization.timezone,
      logoUrl: organization.branding.logoUrl,
    };
    const dashboard = this.store.preferences()?.organization.dashboardConfig;
    this.dashboard = {
      preferredDateRangeDays: dashboard?.preferredDateRangeDays ?? 30,
      defaultTeamId: dashboard?.defaultTeamId ?? '',
      showKpiCards: dashboard?.showKpiCards !== false,
      showTeamAnalytics: dashboard?.showTeamAnalytics !== false,
      showRecruiterPerformance: dashboard?.showRecruiterPerformance !== false,
      showJobTrends: dashboard?.showJobTrends !== false,
      showActivityFeed: dashboard?.showActivityFeed !== false,
    };
    this.baselineGeneral = JSON.stringify(this.general);
    this.baselineDashboard = JSON.stringify(this.dashboard);
    this.conflict.set(false);
    this.attempted = false;
  }

  fieldError(key: keyof GeneralDraft): string {
    const value = this.general?.[key] ?? '';
    if (key === 'name' && (value.trim().length < 2 || value.trim().length > 80))
      return 'Use 2–80 characters for the organization name.';
    const limit = this.fields.find((field) => field.key === key)!.limit;
    if (value.length > limit) return `Use at most ${limit} characters.`;
    if (key === 'website' || key === 'logoUrl') return organizationUrlError(value);
    if (key === 'timezone') return organizationTimezoneError(value);
    return '';
  }

  saveGeneral(): void {
    this.attempted = true;
    if (
      !this.general ||
      !this.generalDirty ||
      this.conflict() ||
      this.fields.some((field) => this.fieldError(field.key))
    )
      return;
    const { logoUrl, ...general } = this.general;
    const context = this.store.context();
    this.message.set('');
    this.store
      .save({ general: { ...general, branding: { logoUrl } } })
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: () => {
          if (context !== this.store.context()) return;
          const saved = this.store.committed()!.organization;
          this.general = {
            name: saved.name,
            description: saved.description,
            industry: saved.industry,
            website: saved.website,
            timezone: saved.timezone,
            logoUrl: saved.branding.logoUrl,
          };
          this.baselineGeneral = JSON.stringify(this.general);
          this.message.set('Organization settings saved.');
        },
        error: (error) => {
          if (context === this.store.context()) this.saveError(error);
        },
      });
  }

  saveDashboard(): void {
    if (!this.dashboard || !this.dashboardDirty || this.conflict() || this.generalDirty) return;
    this.message.set('');
    const context = this.store.context();
    this.store
      .saveDashboard(this.dashboard)
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: () => {
          if (context !== this.store.context()) return;
          this.dashboard = { ...this.store.preferences()!.organization.dashboardConfig! };
          this.baselineDashboard = JSON.stringify(this.dashboard);
          this.message.set('Organization-wide Admin dashboard configuration saved.');
        },
        error: (error) => {
          if (context === this.store.context()) this.saveError(error);
        },
      });
  }

  private saveError(error: { status?: number; error?: { message?: string } }): void {
    if (error.status === 409) {
      this.conflict.set(true);
      this.message.set(
        'The server configuration changed. Your unsaved edits are preserved. Review the current values, then explicitly save again.',
      );
      this.load(true);
    } else if (error.status === 403) {
      this.message.set('Permission denied. Your unsaved edits are preserved for review.');
      this.load(true);
    } else this.message.set(error.error?.message || 'Unable to save. Your edits are preserved.');
  }
}
