import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../shared/services/auth.service';
import { map, take } from 'rxjs/operators';

export const publicGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.isLoggedIn$.pipe(
    take(1),
    map((isLoggedIn) => {
      if (isLoggedIn) {
        // If already logged in, redirect to dashboard
        router.navigate(['/app/dashboard']);
        return false;
      } else {
        // Allow access to login/signup pages
        return true;
      }
    })
  );
};
