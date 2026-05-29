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
        router.navigateByUrl(authService.getHomeRoute());
        return false;
      } else {
        return true;
      }
    })
  );
};
