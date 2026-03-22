import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { of } from 'rxjs';
import { catchError, map, switchMap, take } from 'rxjs/operators';
import { TenantContextService } from '../shared/services/tenant-context.service';
import { ApiService } from '../shared/services/api.service';

export const adminSettingsGuard: CanActivateFn = () => {
  const router = inject(Router);
  const tenantContext = inject(TenantContextService);
  const apiService = inject(ApiService);

  return tenantContext.state$.pipe(
    take(1),
    switchMap((ctx) => {
      if (ctx.myRole === 'admin') {
        return of(true);
      }

      return apiService.getOrganizations().pipe(
        map((res) => {
          const organizations = Array.isArray(res?.organizations) ? res.organizations : [];
          const adminOrg = organizations.find((org: { _id: string; name: string; myRole: string }) => org.myRole === 'admin');

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
    })
  );
};
