import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../shared/services/auth.service';
import { map, take } from 'rxjs/operators';

export const superAdminGuard: CanActivateFn = (route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.currentUser$.pipe(
    take(1),
    map((user) => {
      const role = String(user?.role || '').toLowerCase();
      if (role === 'super_admin' || role === 'superadmin') return true;
      router.navigateByUrl(auth.getHomeRoute(user));
      return false;
    })
  );
};
