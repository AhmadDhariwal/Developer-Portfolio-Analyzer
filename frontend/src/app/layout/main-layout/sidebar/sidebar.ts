import { ChangeDetectionStrategy, ChangeDetectorRef, Component, DestroyRef, EventEmitter, Input, OnInit, Output, inject } from '@angular/core';
import { NavigationEnd, RouterLink, RouterLinkActive, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { AuthService } from '../../../shared/services/auth.service';
import { TenantContextService } from '../../../shared/services/tenant-context.service';
import { ProfileService } from '../../../shared/services/profile.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs/operators';

type NavItem = { label: string; route: string; icon: SafeHtml };
type NavGroup = { label: string; route?: string; icon: SafeHtml; items: NavItem[] };
type RawNavItem = { label: string; route: string; icon: string };
type RawNavGroup = { label: string; route?: string; icon: string; items: RawNavItem[] };

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, CommonModule],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Sidebar implements OnInit {
  @Input() isOpen: boolean = true;
  @Output() collapse = new EventEmitter<void>();

  openGroups = new Set<string>(['Analysis', 'Growth', 'Opportunities', 'Insights', 'System']);
  userName = 'Developer';
  userHandle = 'developer';
  userInitial = 'D';
  userAvatar = '';
  avatarSrc = '';
  avatarVersion = Date.now();
  currentUrl = '';
  private readonly destroyRef = inject(DestroyRef);
  private currentRole = '';

  visibleNavItems: NavItem[] = [];
  visibleNavGroups: NavGroup[] = [];

  private readonly baseNavItems: RawNavItem[] = [
    {
      label: 'Dashboard',
      route: '/app/dashboard',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>`
    },
    {
      label: 'Notifications',
      route: '/app/notifications',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>`
    }
  ];

  private readonly baseNavGroups: RawNavGroup[] = [
    {
      label: 'Analysis',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"></path><path d="M22 12A10 10 0 0 0 12 2v10z"></path></svg>`,
      items: [
        {
          label: 'GitHub Analyzer',
          route: '/app/github-analyzer',
          icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path></svg>`
        },
        {
          label: 'Resume Analyzer',
          route: '/app/resume-analyzer',
          icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`
        },
        {
          label: 'Skill Gap',
          route: '/app/skill-gap',
          icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polygon points="10 8 16 12 10 16 10 8"></polygon></svg>`
        }
      ]
    },
    {
      label: 'Growth',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"></path></svg>`,
      items: [
        {
          label: 'Recommendations',
          route: '/app/recommendations',
          icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`
        },
        {
          label: 'Learning Hub',
          route: '/app/courses',
          icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>`
        },
        {
          label: 'Career Sprint',
          route: '/app/career-sprint',
          icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12h18"></path><path d="M12 3v18"></path><path d="M7 7h10v10H7z"></path></svg>`
        },
        {
          label: 'Interview Prep',
          route: '/app/interview-prep',
          icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v12H4z"></path><path d="M8 20h8"></path><path d="M12 16v4"></path></svg>`
        }
      ]
    },
    {
      label: 'Opportunities',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M12 8v4l3 3"></path></svg>`,
      items: [
        {
          label: 'Jobs Hub',
          route: '/app/jobs',
          icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path></svg>`
        },
        {
          label: 'Recruiter Hub',
          route: '/app/recruiter',
          icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="8" cy="8" r="3"></circle><circle cx="17" cy="7" r="2"></circle><path d="M3 20a5 5 0 0 1 10 0"></path><path d="M14 20a4 4 0 0 1 8 0"></path></svg>`
        },
        {
          label: 'Public Portfolio',
          route: '/app/portfolio',
          icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 4h18v16H3z"></path><path d="M7 8h10"></path><path d="M7 12h6"></path></svg>`
        }
      ]
    },
    {
      label: 'Insights',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>`,
      items: [
        {
          label: 'Tech News',
          route: '/app/news',
          icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 5h16v14H4z"></path><path d="M8 9h8"></path><path d="M8 13h5"></path><circle cx="16.5" cy="13.5" r="2.5"></circle></svg>`
        },
        {
          label: 'Scenario Simulator',
          route: '/app/scenario-simulator',
          icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"></path><path d="M7 14l3-3 3 2 4-5"></path><circle cx="7" cy="14" r="1"></circle><circle cx="10" cy="11" r="1"></circle><circle cx="13" cy="13" r="1"></circle><circle cx="17" cy="8" r="1"></circle></svg>`
        },
        {
          label: 'Weekly Reports',
          route: '/app/weekly-reports',
          icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M7 8h10"></path><path d="M7 12h6"></path><path d="M7 16h8"></path></svg>`
        }
      ]
    },
    {
      label: 'System',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`,
      items: [
        {
          label: 'Org Console',
          route: '/app/admin/console',
          icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 21v-4h6v4"/></svg>`
        },
        {
          label: 'Performance & Statistics',
          route: '/app/admin/console/performance-statistics',
          icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>`
        },
        {
          label: 'Admin Console',
          route: '/app/admin',
          icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="14" rx="2"></rect><path d="M7 20h10"></path><path d="M8 8h8"></path><path d="M8 12h5"></path></svg>`
        },
        {
          label: 'Integrations',
          route: '/app/integrations',
          icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="14" width="7" height="7" rx="1"></rect><line x1="10" y1="6.5" x2="14" y2="6.5"></line><line x1="17.5" y1="10" x2="17.5" y2="14"></line></svg>`
        },
        {
          label: 'Profile',
          route: '/app/profile',
          icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`
        },
        {
          label: 'Settings',
          route: '/app/settings',
          icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><path d="M20 8v6"></path><path d="M23 11h-6"></path></svg>`
        }
      ]
    }
  ];

  constructor(
    private readonly authService: AuthService,
    private readonly router: Router,
    private readonly tenantContext: TenantContextService,
    private readonly profileService: ProfileService,
    private readonly cdr: ChangeDetectorRef,
    private readonly sanitizer: DomSanitizer
  ) {}

  ngOnInit(): void {
    this.currentUrl = this.router.url || '';
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((event) => {
        this.currentUrl = event.urlAfterRedirects || event.url || '';
        this.cdr.markForCheck();
      });

    this.syncUserState(this.authService.getCurrentUser());
    this.authService.currentUser$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((user) => {
        this.syncUserState(user);
      });

    // Subscribe to avatar version changes to force refresh
    this.authService.avatarVersion$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((version) => {
        this.avatarVersion = version;
        this.updateAvatarSrc();
        this.cdr.markForCheck();
      });
  }

  private recomputeNav(): void {
    const role = this.currentRole;
    const isSuperAdmin = role === 'super_admin' || role === 'superadmin';
    const isRecruiter = role === 'recruiter' || this.tenantContext.snapshot.myRole === 'recruiter';
    const isAdmin = role === 'admin' || this.tenantContext.snapshot.myRole === 'admin';

    if (isRecruiter) {
      this.openGroups.add('Recruiter Hub');
      this.openGroups.add('Workspace');
      this.visibleNavItems = [
        {
          label: 'Notifications',
          route: '/app/notifications',
          icon: this.trustSvg(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>`)
        }
      ];
      this.visibleNavGroups = [
        {
          label: 'Recruiter Hub',
          route: '',
          icon: this.trustSvg(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="8" cy="8" r="3"></circle><circle cx="17" cy="7" r="2"></circle><path d="M3 20a5 5 0 0 1 10 0"></path><path d="M14 20a4 4 0 0 1 8 0"></path></svg>`),
          items: [
            { label: 'Dashboard', route: '/app/recruiter/dashboard', icon: this.trustSvg(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>`) },
            { label: 'Candidates', route: '/app/recruiter/candidates', icon: this.trustSvg(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><path d="M20 8v6"></path><path d="M23 11h-6"></path></svg>`) },
            { label: 'Jobs', route: '/app/recruiter/jobs', icon: this.trustSvg(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"></rect><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path></svg>`) },
            { label: 'Match Results', route: '/app/recruiter/matches', icon: this.trustSvg(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 12h8"></path><path d="M12 8l4 4-4 4"></path><path d="M4 6h6"></path><path d="M14 18h6"></path></svg>`) },
            { label: 'Shortlists', route: '/app/recruiter/shortlists', icon: this.trustSvg(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>`) },
            { label: 'Comparison', route: '/app/recruiter/comparison', icon: this.trustSvg(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 4H4v16h6"></path><path d="M14 4h6v16h-6"></path><path d="M9 12h6"></path></svg>`) },
            { label: 'Analytics', route: '/app/recruiter/analytics', icon: this.trustSvg(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>`) },
            { label: 'Activity Logs', route: '/app/recruiter/activity-logs', icon: this.trustSvg(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`) },
            { label: 'Profile Settings', route: '/app/recruiter/profile', icon: this.trustSvg(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`) }
          ]
        },
        {
          label: 'Workspace',
          route: '',
          icon: this.trustSvg(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="14" rx="2"></rect><path d="M8 20h8"></path><path d="M12 18v2"></path></svg>`),
          items: [
            { label: 'Integrations', route: '/app/integrations', icon: this.trustSvg(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="14" width="7" height="7" rx="1"></rect><line x1="10" y1="6.5" x2="14" y2="6.5"></line><line x1="17.5" y1="10" x2="17.5" y2="14"></line></svg>`) },
            { label: 'My Profile', route: '/app/profile', icon: this.trustSvg(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`) }
          ]
        }
      ];
      return;
    }

    const allItems: NavItem[] = this.baseNavItems.map((item) => ({
      label: item.label,
      route: item.route,
      icon: this.trustSvg(item.icon),
    }));

    this.visibleNavItems = isSuperAdmin
      ? allItems
      : allItems.filter((item) => item.route !== '/app/settings');

    this.visibleNavGroups = this.baseNavGroups.map((group) => {
      let filteredItems: NavItem[] = group.items
        .filter((item) => {
        // Special logic for Super Admin
        if (isSuperAdmin) {
          // Hide Recruiter Hub and Admin Console for Super Admin in the main project
          if (item.route === '/app/recruiter' || item.route === '/app/admin' || item.route === '/app/admin/console') {
            return false;
          }
          // Everything else is visible to Super Admin
          return true;
        }

        // Standard RBAC for other roles
        if (item.route === '/app/recruiter') return isRecruiter;
        if (item.route === '/app/admin') return isAdmin;
        if (item.route === '/app/admin/console' || item.route === '/app/admin/console/performance-statistics') return isAdmin;
        if (item.route === '/app/settings') return false;

        return true;
        })
        .map((item) => ({
          label: item.label,
          route: item.route,
          icon: this.trustSvg(item.icon),
        }));

      // If this is the 'System' group and user is Super Admin, add the Super Admin Dashboard link
      if (group.label === 'System' && isSuperAdmin) {
        const hasSaLink = filteredItems.some((i) => i.route === '/super-admin/dashboard');
        if (!hasSaLink) {
          filteredItems = [
            {
              label: 'Super Admin',
              route: '/super-admin/dashboard',
              icon: this.trustSvg(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"></path></svg>`),
            },
            ...filteredItems,
          ];
        }
      }

      return {
        label: group.label,
        route: group.route,
        icon: this.trustSvg(group.icon),
        items: filteredItems,
      };
    });
  }

  toggleGroup(label: string): void {
    if (this.openGroups.has(label)) {
      this.openGroups.delete(label);
    } else {
      this.openGroups.add(label);
    }
  }

  isGroupOpen(label: string): boolean {
    return this.openGroups.has(label);
  }

  logout() {
    this.authService.logout();
    this.router.navigate(['/auth/login']);
  }

  isAdminConsoleActive(): boolean {
    const path = this.normalizePath(this.currentUrl || this.router.url || '');
    return path.startsWith('/app/admin') && !path.startsWith('/app/admin/console');
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
    console.error('[Sidebar] Avatar failed to load:', img.src);
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
      this.userName = 'Developer';
      this.userHandle = 'developer';
      this.userInitial = 'D';
      this.userAvatar = '';
      this.currentRole = '';
      this.updateAvatarSrc();
      this.recomputeNav();
      this.cdr.markForCheck();
      return;
    }

    const previousAvatar = this.userAvatar;
    this.userName = user.name || 'Developer';
    const normalizedRole = this.getNormalizedRole(user?.role);
    this.userHandle = this.formatRoleLabel(normalizedRole) || user.githubUsername || 'developer';
    this.userInitial = this.profileService.getInitials(this.userName || 'Developer') || 'D';
    this.userAvatar = this.profileService.resolveAvatarUrl(user.avatar || '');
    this.currentRole = normalizedRole;

    this.updateAvatarSrc();
    this.recomputeNav();

    // Bump version if avatar changed
    if (previousAvatar !== this.userAvatar) {
      this.bumpAvatarVersion();
      this.updateAvatarSrc();
    }

    this.cdr.markForCheck();
  }

  private getNormalizedRole(role: unknown): string {
    const value = typeof role === 'string' ? role.toLowerCase() : '';
    if (value === 'user') return 'developer';
    return value;
  }

  private formatRoleLabel(role: string): string {
    if (!role) return '';
    return role
      .replace(/_/g, ' ')
      .split(' ')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  private trustSvg(svg: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(svg);
  }

  private normalizePath(url: string): string {
    const withoutQuery = url.split('?')[0] ?? '';
    return (withoutQuery.split('#')[0] ?? '').trim();
  }
}
