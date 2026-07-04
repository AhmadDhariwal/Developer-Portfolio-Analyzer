import { Component, OnInit, Input, Output, EventEmitter, DestroyRef, inject, HostListener, ViewChild, ElementRef, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../shared/services/auth.service';
import { Observable, Subject } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NotificationService, AppNotification, NotificationResponse } from '../../../shared/services/notification.service';
import { TenantContextService } from '../../../shared/services/tenant-context.service';
import { ApiService } from '../../../shared/services/api.service';
import { ProfileService } from '../../../shared/services/profile.service';

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
  templateUrl: './navbar.html',
  styleUrl: './navbar.scss',
})
export class Navbar implements OnInit {
  @Input() sidebarOpen: boolean = true;
  @Output() sidebarToggle = new EventEmitter<void>();

  @ViewChild('notificationButton') notificationButton?: ElementRef<HTMLElement>;
  @ViewChild('notificationDropdown') notificationDropdown?: ElementRef<HTMLElement>;

  isLoggedIn$: Observable<boolean>;
  userName = 'Developer';
  userHandle = 'developer';
  userInitial = 'D';
  userAvatar = '';
  avatarSrc = '';
  avatarVersion = Date.now();
  showUserMenu = false;
  showNotifications = false;
  unreadNotifications = 0;
  notifications: AppNotification[] = [];
  totalNotifications = 0;

  searchQuery = '';
  suggestions: SearchSuggestion[] = [];
  showSuggestions = false;
  organizations: Array<{ _id: string; name: string; myRole: 'admin' | 'manager' | 'member' | 'recruiter' }> = [];
  teams: Array<{ _id: string; name: string }> = [];
  selectedOrganizationId = '';
  selectedTeamId = '';
  selectedRole: 'admin' | 'manager' | 'member' | 'recruiter' | '' = '';

  private cachedRepos: any[] = [];
  private cachedSkills: SearchSuggestion[] = [];
  private lastLoadedGithubHandle = '';
  private readonly searchSubject = new Subject<string>();
  private readonly destroyRef = inject(DestroyRef);

  private readonly navPages: SearchSuggestion[] = [
    { type: 'page', label: 'Dashboard', sublabel: 'Portfolio overview', route: '/app/dashboard' },
    { type: 'page', label: 'GitHub Analyzer', sublabel: 'Analyze GitHub repositories', route: '/app/github-analyzer' },
    { type: 'page', label: 'Resume Analyzer', sublabel: 'Analyze your resume', route: '/app/resume-analyzer' },
    { type: 'page', label: 'Skill Gap Analysis', sublabel: 'Find skills to learn', route: '/app/skill-gap' },
    { type: 'page', label: 'Recommendations', sublabel: 'Personalized career advice', route: '/app/recommendations' },
    { type: 'page', label: 'Recruiter Hub', sublabel: 'Candidate matching workspace', route: '/app/recruiter' },
    { type: 'page', label: 'Integrations', sublabel: 'Connect LinkedIn, GitHub, LeetCode, Kaggle', route: '/app/integrations' },
    { type: 'page', label: 'Scenario Simulator', sublabel: 'What-if score and job match simulator', route: '/app/scenario-simulator' },
    { type: 'page', label: 'Admin Console', sublabel: 'Organization hiring control center', route: '/app/admin' },
    { type: 'page', label: 'Activity Logs', sublabel: 'My logs, team filters, and date filters', route: '/app/admin/activity-logs' },
    { type: 'page', label: 'Profile', sublabel: 'Account settings', route: '/app/profile' },
    { type: 'page', label: 'Settings', sublabel: 'Admin configuration sections', route: '/app/settings' },
    { type: 'page', label: 'User Management', sublabel: 'Org overview, teams, roles, and invitations', route: '/app/admin/console' },
    { type: 'page', label: 'AI Versions', sublabel: 'Versioning and rollback controls', route: '/app/settings/ai-versions' },
  ];

  get isSuperAdmin(): boolean {
    const role = String(this.authService.getCurrentUser()?.role || '').toLowerCase();
    return role === 'super_admin' || role === 'superadmin';
  }

  private get searchablePages(): SearchSuggestion[] {
    const role = this.selectedRole;
    const sessionRole = String(this.authService.getCurrentUser()?.role || '').toLowerCase();
    const isSuperAdmin = sessionRole === 'super_admin' || sessionRole === 'superadmin';
    const isAdmin = role === 'admin' || sessionRole === 'admin';
    const isRecruiter = sessionRole === 'recruiter';

    const roleScoped = this.navPages.filter((page) => {
      if (String(page.route || '').startsWith('/app/admin') && !isAdmin) return false;
      if (String(page.route || '').startsWith('/app/admin') && isSuperAdmin) return false;
      if (String(page.route || '').startsWith('/app/recruiter') && isSuperAdmin) return false;
      if (String(page.route || '').startsWith('/app/recruiter') && !isRecruiter) return false;
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
    private readonly cdr: ChangeDetectorRef
  ) {
    this.isLoggedIn$ = this.authService.isLoggedIn$;

    this.searchSubject.pipe(
      debounceTime(250),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(query => this.runSearch(query));

    this.destroyRef.onDestroy(() => {
      this.notificationService.disconnectStream();
    });
  }

  ngOnInit() {
    this.syncUserState(this.authService.getCurrentUser());

    this.authService.currentUser$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((user) => {
        this.syncUserState(user);
        if (user && this.authService.isLoggedIn()) {
          const token = this.authService.getToken();
          if (token) this.notificationService.connectStream(String(user._id || user.email || 'current-user'), token);
        } else {
          this.notificationService.disconnectStream();
          this.notifications = [];
          this.unreadNotifications = 0;
          this.totalNotifications = 0;
        }
      });

    this.notificationService.streamEvents$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.loadNotifications(true));

    // Subscribe to avatar version changes to force refresh
    this.authService.avatarVersion$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((version) => {
        this.avatarVersion = version;
        this.updateAvatarSrc();
        this.cdr.markForCheck();
      });

    if (this.authService.isLoggedIn()) {
      this.loadNotifications();
      const token = this.authService.getToken();
      const user = this.authService.getCurrentUser();
      if (token && user) this.notificationService.connectStream(String(user._id || user.email || 'current-user'), token);
      this.loadOrganizations();
    }

    this.tenantContext.state$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((ctx) => {
      this.selectedOrganizationId = ctx.organizationId;
      this.selectedTeamId = ctx.teamId;
      this.selectedRole = ctx.myRole;
      if (ctx.organizationId) {
        this.loadTeams(ctx.organizationId);
      }
    });
  }

  loadOrganizations(): void {
    this.apiService.getOrganizations().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        this.organizations = Array.isArray(res?.organizations) ? res.organizations : [];
        if (!this.selectedOrganizationId && this.organizations.length > 0) {
          const first = this.organizations[0];
          this.selectedOrganizationId = first._id;
          this.selectedRole = first.myRole;
          this.tenantContext.setOrganization({
            id: first._id,
            name: first.name,
            myRole: first.myRole
          });
        }

        if (this.selectedOrganizationId && !this.organizations.some((org) => org._id === this.selectedOrganizationId)) {
          this.selectedOrganizationId = '';
          this.selectedRole = '';
          this.selectedTeamId = '';
          this.teams = [];
          this.tenantContext.clearAll();
        }

        const selectedOrg = this.organizations.find((org) => org._id === this.selectedOrganizationId);
        if (selectedOrg) {
          this.selectedRole = selectedOrg.myRole;
          this.tenantContext.syncOrganization({
            id: selectedOrg._id,
            name: selectedOrg.name,
            myRole: selectedOrg.myRole
          });
        }

        if (this.selectedOrganizationId) {
          this.loadTeams(this.selectedOrganizationId);
        }
      },
      error: () => {
        this.organizations = [];
      }
    });
  }

  loadTeams(organizationId: string): void {
    if (!organizationId) {
      this.teams = [];
      return;
    }

    this.apiService.getTeams(organizationId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        this.teams = Array.isArray(res?.teams) ? res.teams : [];
        if (this.selectedTeamId && !this.teams.some((team) => team._id === this.selectedTeamId)) {
          this.selectedTeamId = '';
          this.tenantContext.clearTeam();
        }
      },
      error: () => {
        this.teams = [];
      }
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
      myRole: selectedOrg.myRole
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
    this.notificationService.getNotifications({ limit: 5, page: 1 }, signature, forceRefresh)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res: NotificationResponse) => {
          this.notifications = Array.isArray(res?.notifications) ? res.notifications : [];
          this.unreadNotifications = Number(res?.unreadCount || 0);
          this.totalNotifications = Number(res?.total || this.notifications.length || 0);
        },
        error: () => {
          this.notifications = [];
          this.unreadNotifications = 0;
          this.totalNotifications = 0;
        }
      });
  }

  private loadGithubRepos(username: string): void {
    this.http.get<any[]>(
      `https://api.github.com/users/${username}/repos?per_page=100&sort=updated`
    ).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: repos => {
        this.cachedRepos = repos;
        // Extract unique languages as skill suggestions
        const langs = new Set<string>();
        repos.forEach(r => { if (r.language) langs.add(r.language); });
        this.cachedSkills = Array.from(langs).map(lang => ({
          type: 'skill' as const,
          label: lang,
          sublabel: `Used in ${repos.filter(r => r.language === lang).length} repo(s)`,
          route: '/app/skill-gap',
        }));
      },
      error: () => { /* ignore rate limit / network errors */ }
    });
  }

  onSearchInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.searchQuery = value;
    this.searchSubject.next(value);
  }

  runSearch(query: string): void {
    const q = query.trim().toLowerCase();
    if (!q) {
      this.suggestions = [];
      this.showSuggestions = false;
      return;
    }

    const results: SearchSuggestion[] = [];

    // Pages
    this.searchablePages
      .filter(p => p.label.toLowerCase().includes(q) || p.sublabel?.toLowerCase().includes(q))
      .forEach(p => results.push(p));

    // Repositories
    this.cachedRepos
      .filter(r => r.name.toLowerCase().includes(q) || r.description?.toLowerCase().includes(q))
      .slice(0, 5)
      .forEach(r => results.push({
        type: 'repo',
        label: r.name,
        sublabel: r.description || r.language || '',
        url: r.html_url,
      }));

    // Skills (languages from repos)
    this.cachedSkills
      .filter(s => s.label.toLowerCase().includes(q))
      .slice(0, 4)
      .forEach(s => results.push(s));

    this.suggestions = results;
    this.showSuggestions = results.length > 0;
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

  closeSearch(): void {
    setTimeout(() => { this.showSuggestions = false; }, 150);
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
    if (notification.isRead) return;
    const previousUnread = this.unreadNotifications;
    notification.isRead = true;
    this.unreadNotifications = Math.max(0, previousUnread - 1);
    this.notificationService.markAsRead(notification._id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.loadNotifications(true),
        error: () => {
          notification.isRead = false;
          this.unreadNotifications = previousUnread;
        }
      });
    this.closeNotifications();
  }

  markAllNotificationsRead(): void {
    const previous = this.notifications.map((item) => ({ ...item }));
    const previousUnread = this.unreadNotifications;
    this.notifications = this.notifications.map((item) => ({ ...item, isRead: true }));
    this.unreadNotifications = 0;
    this.notificationService.markAllAsRead()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.loadNotifications(true),
        error: () => {
          this.notifications = previous;
          this.unreadNotifications = previousUnread;
        }
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
    const roleLabel = String(user.role || '').trim().toLowerCase();
    this.userName = user.name || roleLabel || 'User';
    this.userHandle = user.githubUsername || user.email || '';
    this.userInitial = this.profileService.getInitials(this.userName || 'User') || 'U';
    this.userAvatar = this.profileService.resolveAvatarUrl(user.avatar || '');

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
