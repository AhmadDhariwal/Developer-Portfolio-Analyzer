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
      if (user?.role === 'super_admin') return true;
      // If not super admin, redirect to standard dashboard
      router.navigate(['/app/dashboard']);
      return false;
    })
  );
};
