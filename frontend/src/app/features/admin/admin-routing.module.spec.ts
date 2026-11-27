import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { describe, it, expect, vi } from 'vitest';
import { ADMIN_WORKSPACE_ROUTES } from './admin-routing.module';
import { organizationUnsavedGuard } from './guards/organization-unsaved.guard';
import { organizationAdminGuard } from './guards/organization-admin.guard';
import { AuthService } from '../../shared/services/auth.service';
import { of } from 'rxjs';
import { organizationAuditSummary } from './utils/organization-audit';

@Component({ standalone: true, template: '<h1>{{ route.snapshot.data["title"] }}</h1>' })
class DestinationComponent {
  readonly route = inject(ActivatedRoute);
  readonly dirty = false;
}
describe('Organization navigation contracts', () => {
  it.each([
    ['console?tab=overview', 'organization'],
    ['console?tab=preferences', 'organization/settings'],
    ['console?tab=invitations', 'organization/invitations'],
    ['console?tab=teams', 'teams'],
    ['console?tab=recruiters', 'recruiters'],
    ['console?tab=activity', 'activity-logs'],
    ['console/performance-statistics', 'performance'],
    ['organization/members', 'organization/members'],
    ['organization/usage', 'organization/usage'],
    ['organization/policies', 'organization/policies'],
  ])('renders the canonical destination for %s', async (legacy, canonical) => {
    const routes = ADMIN_WORKSPACE_ROUTES.map((route) =>
      route.component
        ? {
            ...route,
            component: DestinationComponent,
            data: { title: route.title || route.path },
            canDeactivate: [],
          }
        : route,
    );
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: 'app/admin', children: routes }])],
    });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(
      `/app/admin/${legacy}${legacy.includes('?') ? '&' : '?'}source=bookmark`,
    );
    expect(TestBed.inject(Router).url).toBe(`/app/admin/${canonical}?source=bookmark`);
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toBeTruthy();
  });
  it('does not infer organization settings access from a non-Admin account', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: {
            currentUser$: of({ role: 'recruiter' }),
            getHomeRoute: () => '/app/recruiter/dashboard',
          },
        },
      ],
    });
    const result = TestBed.runInInjectionContext(() =>
      organizationAdminGuard({} as any, {} as any),
    );
    expect(await new Promise((resolve) => (result as any).subscribe(resolve))).not.toBe(true);
  });
  it('requires explicit discard confirmation for a dirty settings editor', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    expect(organizationUnsavedGuard({ dirty: true }, {} as any, {} as any, {} as any)).toBe(false);
    expect(confirm).toHaveBeenCalledOnce();
    confirm.mockRestore();
  });
  it('presents only exposed governance history and keeps redacted values redacted', () => {
    const summary = organizationAuditSummary({
      action: 'ORGANIZATION_CONFIGURATION_UPDATED',
      before: { version: 1, values: { candidateMatching: true } },
      after: {
        version: 2,
        values: {
          candidateMatching: false,
          general: { description: '[REDACTED]' },
          dashboardConfig: '[REDACTED]',
        },
      },
    });
    expect(summary?.policies[0]).toEqual({
      title: 'Allow candidate matching and ranking',
      previous: true,
      value: false,
    });
    expect(summary?.metadataFields).toEqual(['description']);
    expect(summary?.dashboardChanged).toBe(true);
    expect(JSON.stringify(summary)).not.toContain('description value');
  });
});
