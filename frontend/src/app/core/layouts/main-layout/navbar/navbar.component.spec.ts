import { Subject, of } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { vi } from 'vitest';
import { Router } from '@angular/router';
import { NotificationService } from '../../../../shared/services/notification.service';
import { AuthService } from '../../../../shared/services/auth.service';
import { ApiService } from '../../../../shared/services/api.service';
import { TenantContextService } from '../../../../shared/services/tenant-context.service';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Navbar } from './navbar.component';

describe('Navbar', () => {
  let component: Navbar;
  let fixture: ComponentFixture<Navbar>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Navbar],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(Navbar);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
  it('supports arrow navigation and Escape in workspace search', () => {
    component.suggestions = [
      { type: 'page', label: 'Skill Gap', route: '/app/skill-gap' },
      { type: 'page', label: 'Profile', route: '/app/profile' },
    ];
    component.onSearchKeydown(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    expect(component.activeSuggestion).toBe(1);
    component.onSearchKeydown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(component.activeSuggestion).toBe(0);
    expect(component.showSuggestions).toBe(true);
    component.onSearchKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(component.showSuggestions).toBe(false);
  });
  it('restores concurrent failed optimistic reads without losing unread counts', () => {
    const first = new Subject<any>();
    const second = new Subject<any>();
    vi.spyOn(TestBed.inject(NotificationService), 'markAsRead')
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    component.notifications = [
      { _id: 'first', isRead: false, type: 'info' },
      { _id: 'second', isRead: false, type: 'info' },
    ] as any;
    component.unreadNotifications = 2;
    component.markNotificationRead(component.notifications[0]);
    component.markNotificationRead(component.notifications[1]);
    first.error(new Error('Unavailable'));
    second.error(new Error('Unavailable'));
    expect(component.unreadNotifications).toBe(2);
    expect(component.notifications.every((item) => !item.isRead)).toBe(true);
  });
  it('does not restore an old mark-all snapshot after newer shared server state arrives', async () => {
    const pending = new Subject<any>();
    vi.spyOn(TestBed.inject(NotificationService), 'markAllAsRead').mockReturnValueOnce(pending);
    component.notifications = [{ _id: 'notice', isRead: false, type: 'info' }] as any;
    component.unreadNotifications = 1;
    component.markAllNotificationsRead();
    vi.spyOn(TestBed.inject(HttpClient), 'get').mockReturnValueOnce(
      of({ notifications: [], unreadCount: 2, total: 2 }) as any,
    );
    component.loadNotifications(true);
    await fixture.whenStable();
    pending.error(new Error('Unavailable'));
    expect(component.unreadNotifications).toBe(2);
  });

  it('scopes admin navbar routes and search suggestions strictly to permitted Admin pages', () => {
    const auth = TestBed.inject(AuthService);
    const userSpy = vi.spyOn(auth, 'getCurrentUser').mockReturnValue({
      _id: 'admin-1',
      role: 'admin',
      name: 'Org Admin',
      email: 'admin@nexora.dev',
    } as any);

    expect(component.isAdmin).toBe(true);
    expect(component.searchPlaceholder).toBe('Search admin workspace...');
    expect(component.dashboardRoute).toBe('/app/admin/dashboard');
    expect(component.profileRoute).toBe('/app/admin/console');
    expect(component.notificationsRoute).toBe('/app/admin/activity-logs');

    component.searchQuery = 'dash';
    component.runSearch('dash');
    expect(component.suggestions.some((s) => s.route === '/app/admin/dashboard')).toBe(true);
    expect(component.suggestions.some((s) => s.route === '/app/dashboard')).toBe(false);

    userSpy.mockRestore();
  });

  it('shows Admin only their organization pill and Admin badge without global team dropdown', async () => {
    const auth = TestBed.inject(AuthService);
    const api = TestBed.inject(ApiService);
    const tenant = TestBed.inject(TenantContextService);

    vi.spyOn(auth, 'isLoggedIn').mockReturnValue(true);
    vi.spyOn(auth, 'getCurrentUser').mockReturnValue({
      _id: 'admin-1',
      role: 'admin',
      name: 'Ahmad Hassan',
      email: 'ahmad@icommunix.com',
    } as any);
    vi.spyOn(api, 'getOrganizations').mockReturnValue(
      of({ organizations: [{ _id: 'org-1', name: 'icommunix', myRole: 'admin' }] }),
    );
    const getTeamsSpy = vi.spyOn(api, 'getTeams');

    component.loadOrganizations();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('.team-switcher')).toBeTruthy();
    expect(host.querySelector('.org-scope-pill')?.textContent?.trim()).toBe('icommunix');
    expect(host.querySelector('#organization-switch')).toBeNull();
    expect(host.querySelector('#team-switch')).toBeNull();
    expect(host.querySelector('.org-scope-pill--team')).toBeNull();
    expect(host.querySelector('.role-badge')?.textContent?.trim()).toBe('Admin');
    expect(getTeamsSpy).not.toHaveBeenCalled();
    expect(tenant.snapshot.myRole).toBe('admin');
  });

  it('shows Recruiter read-only organization, assigned teams pill, and consistent Recruiter badge', async () => {
    const auth = TestBed.inject(AuthService);
    const api = TestBed.inject(ApiService);
    const tenant = TestBed.inject(TenantContextService);

    vi.spyOn(auth, 'isLoggedIn').mockReturnValue(true);
    vi.spyOn(auth, 'getCurrentUser').mockReturnValue({
      _id: 'rec-1',
      role: 'recruiter',
      name: 'Ava Recruiter',
      email: 'ava@nexora.test',
    } as any);
    vi.spyOn(api, 'getOrganizations').mockReturnValue(
      of({ organizations: [{ _id: 'org-1', name: 'Nexora Systems', myRole: 'member' }] }),
    );
    vi.spyOn(api, 'getRecruiterHubProfile').mockReturnValue(
      of({
        profile: {
          organization: { _id: 'org-1', name: 'Nexora Systems' },
          teams: [
            { _id: 't-1', name: 'Platform Core' },
            { _id: 't-2', name: 'Applied AI' },
          ],
        },
      }),
    );
    const getTeamsSpy = vi.spyOn(api, 'getTeams');

    component.loadOrganizations();
    component.loadRecruiterTeams();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('.team-switcher')).toBeTruthy();
    expect(host.querySelector('.org-scope-pill')?.textContent?.trim()).toBe('Nexora Systems');
    expect(host.querySelector('#organization-switch')).toBeNull();
    expect(host.querySelector('#team-switch')).toBeNull();
    const teamPill = host.querySelector('.org-scope-pill--team') as HTMLElement;
    expect(teamPill?.textContent?.trim()).toBe('Platform Core +1');
    expect(teamPill?.getAttribute('title')).toContain('Applied AI');
    expect(host.querySelector('.role-badge')?.textContent?.trim()).toBe('Recruiter');
    expect(getTeamsSpy).not.toHaveBeenCalled();
    expect(tenant.snapshot.myRole).toBe('recruiter');
  });

  it('shows Super Admin platform console link and Platform Scope without org/team tenant dropdowns', async () => {
    const auth = TestBed.inject(AuthService);
    const api = TestBed.inject(ApiService);

    vi.spyOn(auth, 'isLoggedIn').mockReturnValue(true);
    vi.spyOn(auth, 'getCurrentUser').mockReturnValue({
      _id: 'sa-1',
      role: 'super_admin',
      name: 'Platform Admin',
      email: 'super@platform.test',
    } as any);
    const getOrgsSpy = vi.spyOn(api, 'getOrganizations');

    fixture.destroy();
    const saFixture = TestBed.createComponent(Navbar);
    const saComponent = saFixture.componentInstance;
    await saFixture.whenStable();
    await Promise.resolve();
    saFixture.detectChanges();

    const host: HTMLElement = saFixture.nativeElement;
    expect(host.querySelector('.team-switcher')).toBeTruthy();
    expect(host.querySelector('.sa-console-btn')?.textContent).toContain('Super Admin');
    expect(host.querySelector('.org-scope-pill--platform')?.textContent?.trim()).toBe(
      'Platform Scope',
    );
    expect(host.querySelector('#organization-switch')).toBeNull();
    expect(host.querySelector('#team-switch')).toBeNull();
    expect(host.querySelector('.role-badge')?.textContent?.trim()).toBe('Super Admin');
    expect(saComponent.searchPlaceholder).toBe('Search platform workspace...');
    expect(saComponent.profileRoute).toBe('/app/settings');
    expect(saComponent.dashboardRoute).toBe('/super-admin/dashboard');
    expect(getOrgsSpy).not.toHaveBeenCalled();
  });

  it('hides workspace context bar for standalone Developers without organization memberships', () => {
    const auth = TestBed.inject(AuthService);
    vi.spyOn(auth, 'getCurrentUser').mockReturnValue({
      _id: 'dev-1',
      role: 'developer',
      name: 'Omar Developer',
      email: 'omar@dev.test',
    } as any);
    component.organizations = [];
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    expect(component.showWorkspaceScopeBar).toBe(false);
    expect(host.querySelector('.team-switcher')).toBeNull();
  });
});
