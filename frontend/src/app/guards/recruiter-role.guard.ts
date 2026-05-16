import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthService } from '../shared/services/auth.service';

const normalizeRole = (role: unknown): string => {
  const value = typeof role === 'string' ? role.toLowerCase() : '';
  if (value === 'user') return 'developer';
  return value;
};

export const recruiterRoleGuard: CanActivateFn = () => {
  const router = inject(Router);
  const authService = inject(AuthService);

  const currentUser = authService.getCurrentUser();
  const role = normalizeRole(currentUser?.role);

  if (role === 'recruiter') {
    return true;
  }

  router.navigate(['/app/dashboard']);
  return false;
};
