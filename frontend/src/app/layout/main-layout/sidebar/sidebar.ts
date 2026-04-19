import { Component, Input, Output, EventEmitter, OnInit, DestroyRef, inject, ChangeDetectorRef } from '@angular/core';
import { RouterLink, RouterLinkActive, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../../shared/services/auth.service';
import { TenantContextService } from '../../../shared/services/tenant-context.service';
import { ProfileService } from '../../../shared/services/profile.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, CommonModule],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.scss',
})
export class Sidebar implements OnInit {
  @Input() isOpen: boolean = true;
  @Output() collapse = new EventEmitter<void>();

  openGroups = new Set<string>(['Interviews & Reports']);
  userName = 'Developer';
  userHandle = 'developer';
  userInitial = 'D';
  userAvatar = '';
  avatarVersion = Date.now();
  private readonly destroyRef = inject(DestroyRef);

  navItems = [
    {
      label: 'Dashboard',
      route: '/app/dashboard',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>`
    },
    {
      label: 'Notifications',
      route: '/app/notifications',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>`
    },
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
      label: 'Skill Gap Analysis',
      route: '/app/skill-gap',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polygon points="10 8 16 12 10 16 10 8"></polygon></svg>`
    },
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
      label: 'Jobs Hub',
      route: '/app/jobs',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path></svg>`
    },
    {
      label: 'Integrations',
      route: '/app/integrations',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="14" width="7" height="7" rx="1"></rect><line x1="10" y1="6.5" x2="14" y2="6.5"></line><line x1="17.5" y1="10" x2="17.5" y2="14"></line></svg>`
    },
    {
      label: 'Scenario Simulator',
      route: '/app/scenario-simulator',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"></path><path d="M7 14l3-3 3 2 4-5"></path><circle cx="7" cy="14" r="1"></circle><circle cx="10" cy="11" r="1"></circle><circle cx="13" cy="13" r="1"></circle><circle cx="17" cy="8" r="1"></circle></svg>`
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
  ];

  navGroups = [
    {
      label: 'Interviews & Reports',
      route: '/app/interviews-reports',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M7 8h10"></path><path d="M7 12h6"></path></svg>`,
      items: [
        {
          label: 'Overview',
          route: '/app/interviews-reports',
          icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v16H4z"></path><path d="M8 10h8"></path><path d="M8 14h6"></path></svg>`
        },
        {
          label: 'Public Portfolio',
          route: '/app/portfolio',
          icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 4h18v16H3z"></path><path d="M7 8h10"></path><path d="M7 12h6"></path></svg>`
        },
        {
          label: 'Weekly Reports',
          route: '/app/weekly-reports',
          icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M7 8h10"></path><path d="M7 12h6"></path><path d="M7 16h8"></path></svg>`
        },
        {
          label: 'Interview Prep',
          route: '/app/interview-prep',
          icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v12H4z"></path><path d="M8 20h8"></path><path d="M12 16v4"></path></svg>`
        },
        {
          label: 'Career Sprint',
          route: '/app/career-sprint',
          icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12h18"></path><path d="M12 3v18"></path><path d="M7 7h10v10H7z"></path></svg>`
        }
      ]
    }
  ];

  constructor(
    private readonly authService: AuthService,
    private readonly router: Router,
    private readonly tenantContext: TenantContextService,
    private readonly profileService: ProfileService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
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
        this.cdr.detectChanges();
      });
  }

  get visibleNavItems(): Array<{ label: string; route: string; icon: string }> {
    const role = this.tenantContext.snapshot.myRole;
    const storedUser = this.authService.getCurrentUser();
    const isAdmin = role === 'admin' || storedUser?.role === 'admin';
    if (isAdmin) {
      return this.navItems;
    }
    return this.navItems.filter((item) => item.route !== '/app/settings');
  }

  get visibleNavGroups(): Array<{ label: string; route: string; icon: string; items: Array<{ label: string; route: string; icon: string }> }> {
    return this.navGroups;
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

  getAvatarSrc(): string {
    const raw = String(this.userAvatar || '').trim();
    if (!raw) return '';
    if (/^data:/i.test(raw) || raw.startsWith('blob:')) return raw;
    
    const separator = raw.includes('?') ? '&' : '?';
    return `${raw}${separator}v=${this.avatarVersion}`;
  }

  onAvatarError(event: Event): void {
    const img = event.target as HTMLImageElement;
    console.error('[Sidebar] Avatar failed to load:', img.src);
    // Hide broken img and show initials fallback
    this.userAvatar = '';
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
      this.cdr.detectChanges();
      return;
    }

    const previousAvatar = this.userAvatar;
    this.userName = user.name || 'Developer';
    this.userHandle = user.githubUsername || 'developer';
    this.userInitial = this.profileService.getInitials(this.userName || 'Developer') || 'D';
    this.userAvatar = this.profileService.resolveAvatarUrl(user.avatar || '');

    console.log('[Sidebar] syncUserState — avatar:', this.userAvatar);

    // Bump version if avatar changed
    if (previousAvatar !== this.userAvatar) {
      this.bumpAvatarVersion();
    }

    this.cdr.detectChanges();
  }
}
