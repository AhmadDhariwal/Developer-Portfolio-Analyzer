import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthService, SessionUser } from '../../../../shared/services/auth.service';
import { ProfileService } from '../../../../shared/services/profile.service';
import { TenantContextService } from '../../../../shared/services/tenant-context.service';

import { Sidebar } from './sidebar.component';

describe('Sidebar', () => {
  let component: Sidebar;
  let fixture: ComponentFixture<Sidebar>;
  let user: SessionUser | null;
  let auth: AuthService;

  beforeEach(async () => {
    user = { role: 'admin', name: 'Organization Admin' };
    auth = Object.assign(Object.create(AuthService.prototype), {
      getCurrentUser: () => user,
      currentUser$: of(user),
      avatarPreview$: of(null),
      avatarVersion$: of(0),
    });
    await TestBed.configureTestingModule({
      imports: [Sidebar],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: auth },
        { provide: TenantContextService, useValue: { snapshot: { myRole: 'admin' } } },
        {
          provide: ProfileService,
          useValue: { getInitials: () => 'OA', resolveAvatarUrl: () => '' },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(Sidebar);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('shows the Admin destinations allowed by the route access policy', () => {
    const routes = component.visibleNavGroups.flatMap((group) =>
      group.items.map((item) => item.route),
    );
    expect(routes.filter((route) => !auth.canAccessUrl(route, user))).toEqual([]);
    expect(routes).toEqual([
      '/app/admin/dashboard',
      '/app/admin/organization',
      '/app/admin/organization/settings',
      '/app/admin/organization/policies',
      '/app/admin/organization/members',
      '/app/admin/organization/invitations',
      '/app/admin/organization/usage',
      '/app/admin/recruiters',
      '/app/admin/teams',
      '/app/admin/jobs',
      '/app/admin/developers',
      '/app/admin/performance',
      '/app/admin/activity-logs',
    ]);
    expect(auth.canAccessUrl('/app/profile', user)).toBe(false);
    expect(auth.canAccessUrl('/app/integrations', user)).toBe(false);
  });

  it('opens all Admin sidebar groups by default with distinct item icons', () => {
    expect(component.visibleNavGroups.map((group) => group.label)).toEqual([
      'Workspace',
      'Organization Management',
      'Recruitment Management',
      'Insights & Governance',
    ]);

    for (const group of component.visibleNavGroups) {
      expect(component.isGroupOpen(group.label)).toBe(true);
    }

    const itemIcons = fixture.nativeElement.querySelectorAll('.nav-sublink .nav-icon svg');
    expect(itemIcons.length).toBe(13);
    const serialized = Array.from(itemIcons as NodeListOf<SVGElement>).map((svg) => svg.innerHTML);
    expect(new Set(serialized).size).toBe(13);
  });
});
