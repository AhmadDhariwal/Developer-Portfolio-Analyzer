import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthService } from '../shared/services/auth.service';

export const recruiterRoleGuard: CanActivateFn = () => {
  const router = inject(Router);
  const authService = inject(AuthService);

  const currentUser = authService.getCurrentUser();
  const role = String(currentUser?.role || '').trim().toLowerCase();

  if (role === 'recruiter') {
    return true;
  }

  router.navigateByUrl(authService.getHomeRoute(currentUser));
  return false;
};
