import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../../shared/services/auth.service';

export const adminSettingsGuard: CanActivateFn = () => {
  const router = inject(Router);
  const auth = inject(AuthService);
  const user = auth.getCurrentUser();
  return user?.role === 'admin' ? true : router.parseUrl(auth.getHomeRoute(user));
};
