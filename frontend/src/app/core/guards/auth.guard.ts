import { inject } from '@angular/core';
import {
  Router,
  CanActivateFn,
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
} from '@angular/router';
import { AuthService } from '../../shared/services/auth.service';
import { map, take } from 'rxjs/operators';

export const authGuard: CanActivateFn = (
  route: ActivatedRouteSnapshot,
  state: RouterStateSnapshot,
) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.isLoggedIn$.pipe(
    take(1),
    map((isLoggedIn) => {
      if (isLoggedIn) {
        const user = authService.getCurrentUser();
        if (user?.role === 'recruiter' && state.url === '/app/profile?onboarding=recruiter') {
          return router.createUrlTree(['/app/recruiter/profile'], {
            queryParams: { onboarding: 'recruiter' },
          });
        }
        if (!authService.canAccessUrl(state.url, user)) {
          return router.parseUrl(authService.getHomeRoute(user));
        }
        return true;
      } else {
        // Store the URL the user was trying to access
        return router.createUrlTree(['/auth/login'], { queryParams: { returnUrl: state.url } });
      }
    }),
  );
};
