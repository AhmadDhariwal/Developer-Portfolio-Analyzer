import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { of } from 'rxjs';
import { catchError, map, switchMap, take } from 'rxjs/operators';
import { AuthService } from '../shared/services/auth.service';
import { TenantContextService } from '../shared/services/tenant-context.service';
import { ApiService } from '../shared/services/api.service';

/**
 * Guards the /app/admin-console route.
 * Allows ONLY org-level admins (role === 'admin').
 * Super admins are explicitly redirected to /super-admin.
 * Recruiters and developers are redirected to /app/dashboard.
 */
export const adminConsoleGuard: CanActivateFn = () => {
  const router = inject(Router);
  const authService = inject(AuthService);
  const tenantContext = inject(TenantContextService);
  const apiService = inject(ApiService);

  const storedUser = authService.getCurrentUser();
  const role = String(storedUser?.role || '').toLowerCase();

  // Super admins must use /super-admin — never the org admin console
  if (role === 'super_admin' || role === 'superadmin') {
    router.navigate(['/super-admin']);
    return false;
  }

  // Recruiters and developers have no access
  if (role === 'recruiter' || role === 'developer' || role === 'user') {
    router.navigate(['/app/dashboard']);
    return false;
  }

  // Admin role — verify they have an org context
  return tenantContext.state$.pipe(
    take(1),
    switchMap((ctx) => {
      if (ctx.myRole === 'admin' && ctx.organizationId) {
        return of(true);
      }

      if (role === 'admin') {
        // Try to resolve org from API
        return apiService.getOrganizations().pipe(
          map((res) => {
            const orgs = Array.isArray(res?.organizations) ? res.organizations : [];
            const adminOrg = orgs.find((o: any) => o.myRole === 'admin');
            if (adminOrg) {
              tenantContext.setOrganization({
                id: adminOrg._id,
                name: adminOrg.name,
                myRole: 'admin'
              });
              return true;
            }
            router.navigate(['/app/dashboard']);
            return false;
          }),
          catchError(() => {
            router.navigate(['/app/dashboard']);
            return of(false);
          })
        );
      }

      router.navigate(['/app/dashboard']);
      return of(false);
    })
  );
};
