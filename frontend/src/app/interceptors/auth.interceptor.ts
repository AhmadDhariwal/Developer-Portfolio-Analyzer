import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../shared/services/auth.service';
import { Router } from '@angular/router';
import { MaintenanceModeService } from '../shared/services/maintenance-mode.service';
import { environment } from '../../environments/environment';

const BACKEND_ORIGINS = [environment.apiOrigin].filter(Boolean);

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const isBackend = req.url.startsWith('/api') || BACKEND_ORIGINS.some((origin) => req.url.startsWith(origin));

  // X-Skip-Auth signals that this request must NOT carry a JWT
  // (used for public endpoints like invite-details that should work without auth)
  const skipAuth = req.headers.has('X-Skip-Auth');

  // Strip the internal header before sending — the backend doesn't need it
  const cleanReq = skipAuth ? req.clone({ headers: req.headers.delete('X-Skip-Auth') }) : req;

  const authService = inject(AuthService);
  const router = inject(Router);
  const maintenanceMode = inject(MaintenanceModeService);

  // Ignore 401s from login/register/auth endpoints so credential errors display on the login form
  const isAuthEndpoint = req.url.includes('/auth/login') ||
    req.url.includes('/auth/register') ||
    req.url.includes('/auth/verify-otp') ||
    req.url.includes('/auth/forgot-password') ||
    req.url.includes('/auth/reset-password') ||
    req.url.includes('/auth/send-otp');

  const token = localStorage.getItem('token');

  // Cancel/reject protected API calls early if token is missing or session is logged out
  if (isBackend && !skipAuth && !isAuthEndpoint && !authService.isLoggedIn()) {
    const currentUrl = router.url;
    if (!currentUrl.startsWith('/auth/')) {
      authService.logout(true, currentUrl);
    }
    return throwError(() => new HttpErrorResponse({
      error: { message: 'Session expired' },
      status: 401,
      statusText: 'Unauthorized',
      url: req.url
    }));
  }

  const authReq = (isBackend && token && !skipAuth)
    ? cleanReq.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : cleanReq;

  return next(authReq).pipe(
    catchError((error: HttpErrorResponse) => {
      // Only treat 401 as session expiry for our own backend protected endpoints
      if (isBackend && !skipAuth && !isAuthEndpoint && error.status === 401) {
        const currentUrl = router.url;
        const isAlreadyOnAuth = currentUrl.startsWith('/auth/');
        authService.logout(true, isAlreadyOnAuth ? undefined : currentUrl);
      }
      if (isBackend && error.status === 503 && String(error.error?.message || '').toLowerCase().includes('maintenance')) {
        authService.logout(false);
        maintenanceMode.open('Application is under maintenance. Go back to sign in because access is disabled while maintenance mode is active.');
        router.navigate(['/auth/login']);
      }
      return throwError(() => error);
    })
  );
};
