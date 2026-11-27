import { inject } from '@angular/core';
import { CanActivateChildFn, Router } from '@angular/router';
import { map, take } from 'rxjs/operators';

import { AuthService } from '../../../shared/services/auth.service';

export const organizationAdminGuard: CanActivateChildFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.currentUser$.pipe(
    take(1),
    map((user) =>
      String(user?.role).toLowerCase() === 'admin'
        ? true
        : router.parseUrl(auth.getHomeRoute(user)),
    ),
  );
};
