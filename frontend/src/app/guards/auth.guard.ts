import { inject } from '@angular/core';
import { Router, CanActivateFn, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { AuthService } from '../shared/services/auth.service';
import { map, take } from 'rxjs/operators';

export const authGuard: CanActivateFn = (route: ActivatedRouteSnapshot, state: RouterStateSnapshot) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.isLoggedIn$.pipe(
    take(1),
    map((isLoggedIn) => {
      if (isLoggedIn) {
        return true;
      } else {
        // Store the URL the user was trying to access
        router.navigate(['/auth/login'], { queryParams: { returnUrl: state.url } });
        return false;
      }
    })
  );
};
