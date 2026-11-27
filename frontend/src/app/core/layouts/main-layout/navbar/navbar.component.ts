import { notificationTarget } from '../../../../shared/utils/notification-navigation';
import {
  Component,
  OnInit,
  Input,
  Output,
  EventEmitter,
  DestroyRef,
  inject,
  HostListener,
  ViewChild,
  ElementRef,
  ChangeDetectorRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../../shared/services/auth.service';
import { Observable, Subject } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  NotificationService,
  AppNotification,
  NotificationResponse,
} from '../../../../shared/services/notification.service';
import {
  TenantContextService,
  TenantContextState,
} from '../../../../shared/services/tenant-context.service';
import { ApiService } from '../../../../shared/services/api.service';
import { ProfileService } from '../../../../shared/services/profile.service';
import { ThemeService } from '../../../../shared/services/theme.service';

interface SearchSuggestion {
  type: 'page' | 'repo' | 'skill';
  label: string;
  sublabel?: string;
  route?: string;
  url?: string;
}

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule],
  templateUrl: './navbar.component.html',
  styleUrl: './navbar.component.scss',
})
export class Navbar implements OnInit {
  // MainLayout creates the sidebar closed.  Keep this initial value aligned so
  // the class binding is stable during the first development-mode check.
  @Input() sidebarOpen: boolean = false;
  @Output() sidebarToggle = new EventEmitter<void>();

  @ViewChild('notificationButton') notificationButton?: ElementRef<HTMLElement>;
  @ViewChild('notificationDropdown') notificationDropdown?: ElementRef<HTMLElement>;

  readonly themeService = inject(ThemeService);

  isLoggedIn$: Observable<boolean>;
  userName = 'Developer';
  userHandle = 'developer';
  userInitial = 'D';
  userAvatar = '';
  private avatarPreview: string | null = null;
  avatarSrc = '';
  avatarVersion = Date.now();
  showUserMenu = false;
  showNotifications = false;
  unreadNotifications = 0;
  notifications: AppNotification[] = [];
  totalNotifications = 0;
  private notificationSummaryVersion = 0;

  activeSuggestion = -1;
  searchQuery = '';
  suggestions: SearchSuggestion[] = [];
  showSuggestions = false;
  organizations: Array<{
    _id: string;
    name: string;
    myRole: 'admin' | 'manager' | 'member' | 'recruiter';
  }> = [];
  teams: Array<{ _id: string; name: string }> = [];
  recruiterTeams: Array<{ _id: string; name: string }> = [];
  recruiterOrganizationName = '';
  selectedOrganizationId = '';
  selectedTeamId = '';
  selectedRole: 'admin' | 'manager' | 'member' | 'recruiter' | '' = '';
  private loadedTenantUserId = '';

  private cachedRepos: any[] = [];
  private cachedSkills: SearchSuggestion[] = [];
  private lastLoadedGithubHandle = '';
  private readonly searchSubject = new Subject<string>();
  private readonly destroyRef = inject(DestroyRef);

  private readonly navPages: SearchSuggestion[] = [
    { type: 'page', label: 'Dashboard', sublabel: 'Portfolio overview', route: '/app/dashboard' },
    {
      type: 'page',
      label: 'GitHub Analyzer',
      sublabel: 'Analyze GitHub repositories',
      route: '/app/github-analyzer',
    },
    {
      type: 'page',
      label: 'Resume Analyzer',
      sublabel: 'Analyze your resume',
      route: '/app/resume-analyzer',
    },
    {
      type: 'page',
      label: 'Skill Gap Analysis',
      sublabel: 'Find skills to learn',
      route: '/app/skill-gap',
    },
    {
      type: 'page',
      label: 'Recommendations',
      sublabel: 'Personalized career advice',
      route: '/app/recommendations',
    },
    {
      type: 'page',
      label: 'Recruiter Hub',
      sublabel: 'Candidate matching workspace',
      route: '/app/recruiter',
    },
    {
      type: 'page',
      label: 'Integrations',
      sublabel: 'Connect LinkedIn, GitHub, LeetCode, Kaggle',
      route: '/app/integrations',
    },
    {
      type: 'page',
      label: 'Scenario Simulator',
      sublabel: 'What-if score and job match simulator',
      route: '/app/scenario-simulator',
    },
    {
      type: 'page',
      label: 'Admin Dashboard',
      sublabel: 'Organization command overview',
      route: '/app/admin/dashboard',
    },
    {
      type: 'page',
      label: 'Recruiters',
      sublabel: 'Recruiter seats and invitations',
      route: '/app/admin/recruiters',
    },
    {
      type: 'page',
      label: 'Teams',
      sublabel: 'Hiring teams and memberships',
      route: '/app/admin/teams',
    },
    {
      type: 'page',
      label: 'Developers',
      sublabel: 'Public talent directory and assessments',
      route: '/app/admin/developers',
    },
    {
      type: 'page',
      label: 'Organization Jobs',
      sublabel: 'Active postings and candidate matching',
      route: '/app/admin/jobs',
    },
    {
      type: 'page',
      label: 'Performance & Statistics',
      sublabel: 'Team velocity and hiring effectiveness',
      route: '/app/admin/console/performance-statistics',
    },
    {
      type: 'page',
      label: 'Activity Logs',
      sublabel: 'Organization audit trail and filters',
      route: '/app/admin/activity-logs',
    },
    { type: 'page', label: 'Profile', sublabel: 'Account settings', route: '/app/profile' },
    {
      type: 'page',
      label: 'Settings',
      sublabel: 'Admin configuration sections',
      route: '/app/settings',
    },
    {
      type: 'page',
      label: 'Org Console',
      sublabel: 'Organization preferences, teams, and invitations',
      route: '/app/admin/console',
    },
    {
      type: 'page',
      label: 'AI Versions',
      sublabel: 'Versioning and rollback controls',
      route: '/app/settings/ai-versions',
    },
  ];

  get isSuperAdmin(): boolean {
    const role = String(this.authService.getCurrentUser()?.role || '').toLowerCase();
    return role === 'super_admin' || role === 'superadmin';
  }

  get isAdmin(): boolean {
    return String(this.authService.getCurrentUser()?.role || '').toLowerCase() === 'admin';
  }

  get isRecruiter(): boolean {
    return String(this.authService.getCurrentUser()?.role || '').toLowerCase() === 'recruiter';
  }

  get searchPlaceholder(): string {
    if (this.isSuperAdmin) {
      return 'Search platform workspace...';
    }
    if (this.isAdmin) {
      return 'Search admin workspace...';
    }
    if (this.isRecruiter) {
      return 'Search recruiter workspace...';
    }
    return 'Search repositories, skills...';
  }

  get profileLabel(): string {
    if (this.isSuperAdmin) return 'Platform Settings';
    return this.isAdmin ? 'Org Console' : 'Profile';
  }

  get notificationsActionLabel(): string {
    return this.isSuperAdmin || this.isAdmin ? 'View Activity Logs' : 'View All Activities';
  }

  get profileRoute(): string {
    if (this.isSuperAdmin) return '/app/settings';
    if (this.isAdmin) return '/app/admin/console';
    return this.isRecruiter ? '/app/recruiter/profile' : '/app/profile';
  }

  get dashboardRoute(): string {
    if (this.isSuperAdmin) return '/super-admin/dashboard';
    if (this.isAdmin) return '/app/admin/dashboard';
    return this.isRecruiter ? '/app/recruiter/dashboard' : '/app/dashboard';
  }

  get notificationsRoute(): string {
    if (this.isSuperAdmin) return '/app/settings/activity-logs';
    if (this.isAdmin) return '/app/admin/activity-logs';
    return this.isRecruiter ? '/app/recruiter/notifications' : '/app/notifications';
  }

  get activeOrgName(): string {
    const selected = this.organizations.find((org) => org._id === this.selectedOrganizationId);
    return (
      selected?.name ||
      this.organizations[0]?.name ||
      this.recruiterOrganizationName ||
      this.tenantContext.snapshot.organizationName ||
      ''
    );
  }

  get showWorkspaceScopeBar(): boolean {
    if (this.isSuperAdmin) return true;
    if (this.isAdmin || this.isRecruiter) {
      return this.organizations.length > 0 || Boolean(this.activeOrgName);
    }
    return this.organizations.length > 0;
  }

  get showOrgSelect(): boolean {
    return !this.isSuperAdmin && !this.isAdmin && this.organizations.length > 1;
  }

  get showOrgPill(): boolean {
    return !this.isSuperAdmin && !this.showOrgSelect && Boolean(this.activeOrgName);
  }

  get showRecruiterTeamPill(): boolean {
    return this.isRecruiter && !this.isAdmin && !this.isSuperAdmin && Boolean(this.activeOrgName);
  }

  get showTeamSelect(): boolean {
    return (
      !this.isSuperAdmin &&
      !this.isAdmin &&
      !this.isRecruiter &&
      this.organizations.length > 0 &&
      this.teams.length > 0
    );
  }

  get recruiterTeamLabel(): string {
    if (this.recruiterTeams.length === 0) return 'Org-wide';
    if (this.recruiterTeams.length === 1) return this.recruiterTeams[0].name;
    return `${this.recruiterTeams[0].name} +${this.recruiterTeams.length - 1}`;
  }

  get recruiterTeamTitle(): string {
    if (this.recruiterTeams.length === 0) {
      return 'Organization-wide recruiter scope (no specific team assignment)';
    }
    return `Assigned teams: ${this.recruiterTeams.map((team) => team.name).join(', ')}`;
  }

  get roleBadgeLabel(): string {
    if (this.isSuperAdmin) return 'Super Admin';
    if (this.isAdmin) return 'Admin';
    if (this.isRecruiter) return 'Recruiter';
    return this.selectedRole || '';
  }

  private get searchablePages(): SearchSuggestion[] {
    const role = this.selectedRole;
    const sessionRole = String(this.authService.getCurrentUser()?.role || '').toLowerCase();
    const isSuperAdmin = sessionRole === 'super_admin' || sessionRole === 'superadmin';
    const isAdminSession = sessionRole === 'admin';
    const isAdmin = role === 'admin' || isAdminSession;
    const isRecruiter = sessionRole === 'recruiter';

    if (isAdminSession) {
      return this.navPages.filter(
        (page) =>
          String(page.route || '').startsWith('/app/admin') &&
          this.authService.canAccessUrl(page.route || ''),
      );
    }

    if (isRecruiter) {
      return [
        ...this.navPages.filter((page) => this.authService.canAccessUrl(page.route || '')),
        {
          type: 'page',
          label: 'Profile',
          sublabel: 'Recruiter details',
          route: '/app/recruiter/profile',
        },
      ];
    }

    const roleScoped = this.navPages.filter((page) => {
      if (String(page.route || '').startsWith('/app/admin') && !isAdmin) return false;
      if (String(page.route || '').startsWith('/app/admin') && isSuperAdmin) return false;
      if (String(page.route || '').startsWith('/app/recruiter')) return false;
      return true;
    });

    if (isSuperAdmin) {
      return roleScoped;
    }

    return roleScoped.filter((page) => {
      const route = String(page.route || '');
      return !route.startsWith('/app/settings');
    });
  }

  constructor(
    private readonly authService: AuthService,
    private readonly router: Router,
    private readonly http: HttpClient,
    private readonly notificationService: NotificationService,
    private readonly tenantContext: TenantContextService,
    private readonly apiService: ApiService,
    private readonly profileService: ProfileService,
    private readonly cdr: ChangeDetectorRef,
  ) {
    this.isLoggedIn$ = this.authService.isLoggedIn$;
    // Hydrate avatar/name before the first template check to avoid NG0100
    // (ExpressionChangedAfterItHasBeenCheckedError) on *ngIf="userAvatar".
    this.syncUserState(this.authService.getCurrentUser());

    this.searchSubject
      .pipe(debounceTime(250), takeUntilDestroyed(this.destroyRef))
      .subscribe((query) => this.runSearch(query));

    this.destroyRef.onDestroy(() => {
      this.notificationService.disconnectStream();
    });
  }

  ngOnInit() {
    this.authService.currentUser$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((user) => {
      this.scheduleUi(() => {
        this.syncUserState(user);
        this.syncWorkspaceContext(user);
        if (user && this.authService.isLoggedIn()) {
          const token = this.authService.getToken();
          if (token)
            this.notificationService.connectStream(
              String(user._id || user.email || 'current-user'),
              token,
            );
        } else {
          this.notificationService.disconnectStream();
          this.notifications = [];
          this.unreadNotifications = 0;
          this.totalNotifications = 0;
        }
      });
    });

    this.notificationService.streamEvents$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (!this.notificationService.hasUnscopedFeed) this.loadNotifications();
      });

    this.notificationService.summary$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((summary) => this.applyNotificationSummary(summary));

    this.authService.avatarPreview$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((preview) => {
        this.scheduleUi(() => {
          this.avatarPreview = preview;
          this.syncUserState(this.authService.getCurrentUser());
        });
      });

    // Subscribe to avatar version changes to force refresh
    this.authService.avatarVersion$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((version) => {
        this.scheduleUi(() => {
          this.avatarVersion = version;
          this.updateAvatarSrc();
        });
      });

    if (this.authService.isLoggedIn()) {
      this.loadNotifications();
      const token = this.authService.getToken();
      const user = this.authService.getCurrentUser();
      if (token && user)
        this.notificationService.connectStream(
          String(user._id || user.email || 'current-user'),
          token,
        );
      this.syncWorkspaceContext(user);
    }

    this.tenantContext.state$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((ctx) => {
      this.scheduleUi(() => {
        this.selectedOrganizationId = ctx.organizationId;
        this.selectedTeamId = ctx.teamId;
        this.selectedRole = this.resolveEffectiveRole(ctx.myRole);
        if (ctx.organizationId && !this.isAdmin && !this.isRecruiter && !this.isSuperAdmin) {
          this.loadTeams(ctx.organizationId);
        }
      });
    });
  }

  private resolveEffectiveRole(orgRole?: string): TenantContextState['myRole'] {
    if (this.isSuperAdmin) return '';
    if (this.isAdmin) return 'admin';
    if (this.isRecruiter) return 'recruiter';
    return (orgRole || '') as TenantContextState['myRole'];
  }

  private syncWorkspaceContext(user: any): void {
    if (!user || !this.authService.isLoggedIn()) {
      this.loadedTenantUserId = '';
      this.organizations = [];
      this.teams = [];
      this.recruiterTeams = [];
      this.recruiterOrganizationName = '';
      this.selectedOrganizationId = '';
      this.selectedTeamId = '';
      this.selectedRole = '';
      return;
    }

    const uid = String(user._id || user.id || user.email || 'session');
    if (this.loadedTenantUserId === uid) {
      return;
    }
    this.loadedTenantUserId = uid;
    this.organizations = [];
    this.teams = [];
    this.recruiterTeams = [];
    this.recruiterOrganizationName = '';

    if (this.isSuperAdmin) {
      this.selectedOrganizationId = '';
      this.selectedTeamId = '';
      this.selectedRole = '';
      return;
    }

    this.loadOrganizations();
    if (this.isRecruiter && !this.isAdmin) {
      this.loadRecruiterTeams();
    }
  }

  private scheduleUi(update: () => void): void {
    queueMicrotask(() => {
      update();
      this.cdr.markForCheck();
    });
  }

  loadRecruiterTeams(): void {
    this.apiService
      .getRecruiterHubProfile()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.scheduleUi(() => {
            const profile = res?.profile;
            this.recruiterOrganizationName = String(profile?.organization?.name || '').trim();
            this.recruiterTeams = Array.isArray(profile?.teams)
              ? profile.teams
                  .map((team: any) => ({
                    _id: String(team?._id || ''),
                    name: String(team?.name || '').trim(),
                  }))
                  .filter((team: { _id: string; name: string }) => Boolean(team.name))
              : [];
          });
        },
        error: () => {
          this.scheduleUi(() => {
            this.recruiterTeams = [];
          });
        },
      });
  }

  loadOrganizations(): void {
    if (this.isSuperAdmin) {
      return;
    }

    this.apiService
      .getOrganizations()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.scheduleUi(() => {
            this.organizations = Array.isArray(res?.organizations) ? res.organizations : [];
            if (!this.selectedOrganizationId && this.organizations.length > 0) {
              const first = this.organizations[0];
              const effectiveRole = this.resolveEffectiveRole(first.myRole);
              this.selectedOrganizationId = first._id;
              this.selectedRole = effectiveRole;
              this.tenantContext.setOrganization({
                id: first._id,
                name: first.name,
                myRole: effectiveRole,
              });
            }

            if (
              this.selectedOrganizationId &&
              !this.organizations.some((org) => org._id === this.selectedOrganizationId)
            ) {
              this.selectedOrganizationId = '';
              this.selectedRole = this.resolveEffectiveRole('');
              this.selectedTeamId = '';
              this.teams = [];
              this.tenantContext.clearAll();
            }

            const selectedOrg = this.organizations.find(
              (org) => org._id === this.selectedOrganizationId,
            );
            if (selectedOrg) {
              const effectiveRole = this.resolveEffectiveRole(selectedOrg.myRole);
              this.selectedRole = effectiveRole;
              this.tenantContext.syncOrganization({
                id: selectedOrg._id,
                name: selectedOrg.name,
                myRole: effectiveRole,
              });
            }

            if (this.selectedOrganizationId && !this.isAdmin && !this.isRecruiter) {
              this.loadTeams(this.selectedOrganizationId);
            }
          });
        },
        error: () => {
          this.scheduleUi(() => {
            this.organizations = [];
          });
        },
      });
  }

  loadTeams(organizationId: string): void {
    if (!organizationId) {
      this.teams = [];
      return;
    }

    this.apiService
      .getTeams(organizationId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.teams = Array.isArray(res?.teams) ? res.teams : [];
          if (this.selectedTeamId && !this.teams.some((team) => team._id === this.selectedTeamId)) {
            this.selectedTeamId = '';
            this.tenantContext.clearTeam();
          }
        },
        error: () => {
          this.teams = [];
        },
      });
  }

  onOrganizationSwitch(orgId: string): void {
    this.selectedOrganizationId = orgId;
    const selectedOrg = this.organizations.find((org) => org._id === orgId);
    this.selectedRole = selectedOrg?.myRole || '';
    this.selectedTeamId = '';

    if (!selectedOrg) {
      this.tenantContext.clearAll();
      return;
    }

    this.tenantContext.setOrganization({
      id: selectedOrg._id,
      name: selectedOrg.name,
      myRole: selectedOrg.myRole,
    });

    this.loadTeams(orgId);
  }

  onTeamSwitch(teamId: string): void {
    this.selectedTeamId = teamId;
    if (!teamId) {
      this.tenantContext.clearTeam();
      return;
    }

    const selectedTeam = this.teams.find((team) => team._id === teamId);
    this.tenantContext.setTeam({ id: teamId, name: selectedTeam?.name || '' });
  }

  loadNotifications(forceRefresh = false): void {
    const user = this.authService.getCurrentUser();
    const signature = String(user?._id || user?.email || 'current-user');
    this.notificationService
      .getNotifications({ limit: 10, page: 1 }, signature, forceRefresh)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: () => this.cdr.markForCheck() });
  }

  private applyNotificationSummary(res: NotificationResponse | null): void {
    this.notificationSummaryVersion++;
    this.scheduleUi(() => {
      this.notifications = (res?.notifications || []).slice(0, 5);
      this.unreadNotifications = Number(res?.unreadCount || 0);
      this.totalNotifications = Number(res?.total || 0);
    });
  }

  private loadGithubRepos(username: string): void {
    if (this.isAdmin || this.isRecruiter) {
      return;
    }
    const handle = String(username || '').trim();
    // Skip emails / blank handles — GitHub usernames cannot contain '@'.
    if (!handle || handle.includes('@') || /\s/.test(handle)) return;

    this.http
      .get<any[]>(
        `https://api.github.com/users/${encodeURIComponent(handle)}/repos?per_page=100&sort=updated`,
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (repos) => {
          this.cachedRepos = repos;
          // Extract unique languages as skill suggestions
          const langs = new Set<string>();
          repos.forEach((r) => {
            if (r.language) langs.add(r.language);
          });
          this.cachedSkills = Array.from(langs).map((lang) => ({
            type: 'skill' as const,
            label: lang,
            sublabel: `Used in ${repos.filter((r) => r.language === lang).length} repo(s)`,
            route: '/app/skill-gap',
          }));
        },
        error: () => {
          /* ignore rate limit / network errors */
        },
      });
  }

  onSearchInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.searchQuery = value;
    this.searchSubject.next(value);
  }

  runSearch(query: string): void {
    this.activeSuggestion = -1;
    const q = query.trim().toLowerCase();
    if (!q) {
      this.suggestions = [];
      this.showSuggestions = false;
      this.cdr.markForCheck();
      return;
    }

    const results: SearchSuggestion[] = [];

    // Pages
    this.searchablePages
      .filter((p) => p.label.toLowerCase().includes(q) || p.sublabel?.toLowerCase().includes(q))
      .forEach((p) => results.push(p));

    if (!this.isAdmin && !this.isRecruiter) {
      // Repositories
      this.cachedRepos
        .filter((r) => r.name.toLowerCase().includes(q) || r.description?.toLowerCase().includes(q))
        .slice(0, 5)
        .forEach((r) =>
          results.push({
            type: 'repo',
            label: r.name,
            sublabel: r.description || r.language || '',
            url: r.html_url,
          }),
        );

      // Skills (languages from repos)
      this.cachedSkills
        .filter((s) => s.label.toLowerCase().includes(q))
        .slice(0, 4)
        .forEach((s) => results.push(s));
    }

    this.suggestions = results;
    this.showSuggestions = results.length > 0;
    this.cdr.markForCheck();
  }

  selectSuggestion(suggestion: SearchSuggestion): void {
    if (suggestion.route) {
      this.router.navigate([suggestion.route]);
    } else if (suggestion.url) {
      window.open(suggestion.url, '_blank', 'noopener,noreferrer');
    }
    this.searchQuery = '';
    this.suggestions = [];
    this.showSuggestions = false;
  }

  onSearchKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.showSuggestions = false;
      this.activeSuggestion = -1;
      return;
    }
    if (!this.suggestions.length) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      this.showSuggestions = true;
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      this.activeSuggestion =
        this.activeSuggestion < 0
          ? direction > 0
            ? 0
            : this.suggestions.length - 1
          : (this.activeSuggestion + direction + this.suggestions.length) % this.suggestions.length;
    } else if (event.key === 'Enter' && this.showSuggestions && this.activeSuggestion >= 0) {
      event.preventDefault();
      this.selectSuggestion(this.suggestions[this.activeSuggestion]);
    }
  }

  @HostListener('document:keydown.escape')
  closeToolbarPopovers(): void {
    if (this.showUserMenu) document.querySelector<HTMLElement>('.avatar-button')?.focus();
    if (this.showNotifications) this.notificationButton?.nativeElement.focus();
    this.showUserMenu = this.showNotifications = this.showSuggestions = false;
  }

  closeSearch(): void {
    setTimeout(() => {
      this.showSuggestions = false;
    }, 150);
  }

  toggleSidebar() {
    this.sidebarToggle.emit();
  }

  toggleUserMenu() {
    this.syncUserState(this.authService.getCurrentUser());
    this.showUserMenu = !this.showUserMenu;
    if (this.showUserMenu) this.showNotifications = false;
  }

  @HostListener('window:storage', ['$event'])
  onStorageChanged(event: StorageEvent): void {
    if (event.key === 'user') {
      this.syncUserState(this.authService.getCurrentUser());
    }
  }

  toggleNotifications(): void {
    this.showNotifications = !this.showNotifications;
    if (this.showNotifications) {
      this.showUserMenu = false;
      this.loadNotifications();
    }
  }

  closeNotifications(): void {
    this.showNotifications = false;
  }

  markNotificationRead(notification: AppNotification): void {
    if (notification.isRead) {
      this.closeNotifications();
      void this.router.navigateByUrl(
        notificationTarget(notification, this.authService.getCurrentUser()?.role),
      );
      return;
    }
    const version = this.notificationSummaryVersion;
    const previousUnread = this.unreadNotifications;
    this.notifications = this.notifications.map((item) =>
      item._id === notification._id ? { ...item, isRead: true } : item,
    );
    this.unreadNotifications = Math.max(0, previousUnread - 1);
    this.notificationService
      .markAsRead(notification._id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.cdr.markForCheck(),
        error: () => {
          if (version !== this.notificationSummaryVersion) return;
          if (this.notifications.some((item) => item._id === notification._id && item.isRead)) {
            this.notifications = this.notifications.map((item) =>
              item._id === notification._id ? { ...item, isRead: false } : item,
            );
            this.unreadNotifications++;
          }
        },
      });
    this.closeNotifications();
    void this.router.navigateByUrl(
      notificationTarget(notification, this.authService.getCurrentUser()?.role),
    );
  }

  markAllNotificationsRead(): void {
    const version = this.notificationSummaryVersion;
    const previous = this.notifications.map((item) => ({ ...item }));
    const previousUnread = this.unreadNotifications;
    this.notifications = this.notifications.map((item) => ({ ...item, isRead: true }));
    this.unreadNotifications = 0;
    this.notificationService
      .markAllAsRead()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.cdr.markForCheck(),
        error: () => {
          if (version !== this.notificationSummaryVersion) return;
          this.notifications = previous;
          this.unreadNotifications = previousUnread;
        },
      });
    this.closeNotifications();
  }

  formatNotificationTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'just now';
    const diffMin = Math.floor((Date.now() - date.getTime()) / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  closeUserMenu() {
    this.showUserMenu = false;
  }

  logout() {
    this.notificationService.disconnectStream();
    this.authService.logout();
    this.showUserMenu = false;
    this.router.navigate(['/']);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.showNotifications) return;
    const target = event.target as Node | null;
    if (!target) {
      this.closeNotifications();
      return;
    }

    const clickedButton = this.notificationButton?.nativeElement.contains(target) ?? false;
    const clickedDropdown = this.notificationDropdown?.nativeElement.contains(target) ?? false;

    if (!clickedButton && !clickedDropdown) {
      this.closeNotifications();
    }
  }

  private updateAvatarSrc(): void {
    const raw = String(this.userAvatar || '').trim();
    if (!raw) {
      this.avatarSrc = '';
      return;
    }
    if (/^data:/i.test(raw) || raw.startsWith('blob:')) {
      this.avatarSrc = raw;
      return;
    }

    const separator = raw.includes('?') ? '&' : '?';
    this.avatarSrc = `${raw}${separator}v=${this.avatarVersion}`;
  }

  onAvatarError(event: Event): void {
    const img = event.target as HTMLImageElement;
    console.error('[Navbar] Avatar failed to load:', img.src);
    // Hide broken img and show initials fallback
    this.userAvatar = '';
    this.updateAvatarSrc();
    this.cdr.markForCheck();
  }

  private bumpAvatarVersion(): void {
    this.avatarVersion = Date.now();
  }

  private syncUserState(user: any): void {
    if (!user) {
      this.userName = 'User';
      this.userHandle = '';
      this.userInitial = 'U';
      this.userAvatar = '';
      this.updateAvatarSrc();
      this.cachedRepos = [];
      this.cachedSkills = [];
      this.lastLoadedGithubHandle = '';
      this.cdr.markForCheck();
      return;
    }

    const previousAvatar = this.userAvatar;
    const roleLabel = String(user.role || '')
      .trim()
      .toLowerCase();
    this.userName = user.name || roleLabel || 'User';
    this.userHandle = user.githubUsername || user.email || '';
    this.userInitial = this.profileService.getInitials(this.userName || 'User') || 'U';
    this.userAvatar = this.profileService.resolveAvatarUrl(this.avatarPreview || user.avatar || '');

    this.updateAvatarSrc();

    // Bump version if avatar changed
    if (previousAvatar !== this.userAvatar) {
      this.bumpAvatarVersion();
      this.updateAvatarSrc();
    }

    this.cdr.markForCheck();

    if (this.userHandle && this.lastLoadedGithubHandle !== this.userHandle) {
      this.lastLoadedGithubHandle = this.userHandle;
      this.loadGithubRepos(this.userHandle);
    }
  }
}
