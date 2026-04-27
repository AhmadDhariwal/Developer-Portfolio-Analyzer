import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../shared/services/auth.service';

const BACKEND_ORIGINS = ['http://localhost:5000', 'http://localhost:3000'];

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const isBackend = req.url.startsWith('/api') || BACKEND_ORIGINS.some((origin) => req.url.startsWith(origin));

  // X-Skip-Auth signals that this request must NOT carry a JWT
  // (used for public endpoints like invite-details that should work without auth)
  const skipAuth = req.headers.has('X-Skip-Auth');

  // Strip the internal header before sending — the backend doesn't need it
  const cleanReq = skipAuth ? req.clone({ headers: req.headers.delete('X-Skip-Auth') }) : req;

  const authService = inject(AuthService);
  const token = localStorage.getItem('token');

  const authReq = (isBackend && token && !skipAuth)
    ? cleanReq.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : cleanReq;

  return next(authReq).pipe(
    catchError((error: HttpErrorResponse) => {
      // Only treat 401 as session expiry for our own backend
      if (isBackend && !skipAuth && error.status === 401) {
        authService.logout();
      }
      return throwError(() => error);
    })
  );
};
