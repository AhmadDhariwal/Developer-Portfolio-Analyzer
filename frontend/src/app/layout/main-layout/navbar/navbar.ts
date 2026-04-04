import { Component, OnInit, Input, Output, EventEmitter, DestroyRef, inject, HostListener, ViewChild, ElementRef } from '@angular/core';
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
  avatarVersion = Date.now();
  showUserMenu = false;
  showNotifications = false;
  unreadNotifications = 0;
  notifications: AppNotification[] = [];
  totalNotifications = 0;

  searchQuery = '';
  suggestions: SearchSuggestion[] = [];
  showSuggestions = false;
  organizations: Array<{ _id: string; name: string; myRole: 'admin' | 'manager' | 'member' }> = [];
  teams: Array<{ _id: string; name: string }> = [];
  selectedOrganizationId = '';
  selectedTeamId = '';
  selectedRole: 'admin' | 'manager' | 'member' | '' = '';

  private cachedRepos: any[] = [];
  private cachedSkills: SearchSuggestion[] = [];
  private lastLoadedGithubHandle = '';
  private readonly searchSubject = new Subject<string>();
  private readonly destroyRef = inject(DestroyRef);
  private notificationStream: EventSource | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly navPages: SearchSuggestion[] = [
    { type: 'page', label: 'Dashboard', sublabel: 'Portfolio overview', route: '/app/dashboard' },
    { type: 'page', label: 'GitHub Analyzer', sublabel: 'Analyze GitHub repositories', route: '/app/github-analyzer' },
    { type: 'page', label: 'Resume Analyzer', sublabel: 'Analyze your resume', route: '/app/resume-analyzer' },
    { type: 'page', label: 'Skill Gap Analysis', sublabel: 'Find skills to learn', route: '/app/skill-gap' },
    { type: 'page', label: 'Recommendations', sublabel: 'Personalized career advice', route: '/app/recommendations' },
    { type: 'page', label: 'Integrations', sublabel: 'Connect LinkedIn, GitHub, LeetCode, Kaggle', route: '/app/integrations' },
    { type: 'page', label: 'Scenario Simulator', sublabel: 'What-if score and job match simulator', route: '/app/scenario-simulator' },
  { type: 'page', label: 'Activity Logs', sublabel: 'Audit activity and delivery traces', route: '/app/settings/activity-logs' },
    { type: 'page', label: 'Profile', sublabel: 'Account settings', route: '/app/profile' },
    { type: 'page', label: 'Settings', sublabel: 'Admin configuration sections', route: '/app/settings' },
    { type: 'page', label: 'User Management', sublabel: 'Organizations and teams', route: '/app/settings/user-management' },
    { type: 'page', label: 'AI Versions', sublabel: 'Versioning and rollback controls', route: '/app/settings/ai-versions' },
  ];

  private get searchablePages(): SearchSuggestion[] {
    const role = this.selectedRole;
    if (role === 'admin') {
      return this.navPages;
    }

    return this.navPages.filter((page) => !String(page.route || '').startsWith('/app/settings'));
  }

  constructor(
    private readonly authService: AuthService,
    private readonly router: Router,
    private readonly http: HttpClient,
    private readonly notificationService: NotificationService,
    private readonly tenantContext: TenantContextService,
    private readonly apiService: ApiService,
    private readonly profileService: ProfileService
  ) {
    this.isLoggedIn$ = this.authService.isLoggedIn$;

    this.searchSubject.pipe(
      debounceTime(250),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(query => this.runSearch(query));

    this.destroyRef.onDestroy(() => {
      this.closeNotificationStream();
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
      }
    });
  }

  ngOnInit() {
    this.syncUserState(this.authService.getCurrentUser());

    this.authService.currentUser$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((user) => {
        setTimeout(() => this.syncUserState(user));
      });

    if (this.authService.isLoggedIn()) {
      this.loadNotifications();
      this.connectNotificationStream();
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

  private connectNotificationStream(): void {
    if (!this.authService.isLoggedIn()) return;
    const token = this.authService.getToken();
    if (!token) return;

    this.closeNotificationStream();
    this.notificationStream = this.notificationService.createStream(token);

    this.notificationStream.addEventListener('notification', () => {
      this.loadNotifications();
    });

    this.notificationStream.onerror = () => {
      this.closeNotificationStream();
      if (!this.authService.isLoggedIn()) return;
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      this.reconnectTimer = setTimeout(() => this.connectNotificationStream(), 10000);
    };
  }

  private closeNotificationStream(): void {
    if (this.notificationStream) {
      this.notificationStream.close();
      this.notificationStream = null;
    }
  }

  loadNotifications(): void {
    this.notificationService.getNotifications({ limit: 5, page: 1 })
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
    this.notificationService.markAsRead(notification._id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.loadNotifications(),
        error: () => null
      });
    this.closeNotifications();
  }

  markAllNotificationsRead(): void {
    this.notificationService.markAllAsRead()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.loadNotifications(),
        error: () => null
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
    this.closeNotificationStream();
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

  getAvatarSrc(): string {
    const raw = String(this.userAvatar || '').trim();
    if (!raw) return '';
    if (/^data:/i.test(raw) || raw.startsWith('blob:')) return raw;
    
    const separator = raw.includes('?') ? '&' : '?';
    return `${raw}${separator}v=${this.avatarVersion}`;
  }

  private bumpAvatarVersion(): void {
    this.avatarVersion = Date.now();
  }

  private syncUserState(user: any): void {
    if (!user) {
      this.userName = 'Developer';
      this.userHandle = 'developer';
      this.userInitial = 'D';
      this.userAvatar = '';
      this.cachedRepos = [];
      this.cachedSkills = [];
      this.lastLoadedGithubHandle = '';
      return;
    }

    const previousAvatar = this.userAvatar;
    this.userName = user.name || 'Developer';
    this.userHandle = user.githubUsername || 'developer';
    this.userInitial = this.userName.charAt(0).toUpperCase();
    this.userAvatar = this.profileService.resolveAvatarUrl(user.avatar || '');

    // Bump version if avatar changed
    if (previousAvatar !== this.userAvatar) {
      this.bumpAvatarVersion();
    }

    if (this.userHandle && this.userHandle !== 'developer' && this.lastLoadedGithubHandle !== this.userHandle) {
      this.lastLoadedGithubHandle = this.userHandle;
      this.loadGithubRepos(this.userHandle);
    }
  }
}
