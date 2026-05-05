import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../shared/services/auth.service';
import { map, take } from 'rxjs/operators';

// Guard to hide admin/recruiter tabs from Super Admin; redirects to /super-admin
export const noAdminTabsGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.currentUser$.pipe(
    take(1),
    map((user) => {
      const role = String(user?.role || '').toLowerCase();
      if (role === 'super_admin' || role === 'superadmin') {
        router.navigate(['/super-admin']);
        return false;
      }
      return true;
    })
  );
};
