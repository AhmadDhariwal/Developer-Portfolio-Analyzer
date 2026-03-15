import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../shared/services/auth.service';

const BACKEND_ORIGIN = 'http://localhost:5000';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const isBackend = req.url.startsWith(BACKEND_ORIGIN);
  const authService = inject(AuthService);
  const token = localStorage.getItem('token');

  const authReq = (isBackend && token)
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : req;

  return next(authReq).pipe(
    catchError((error: HttpErrorResponse) => {
      // Only treat 401 as session expiry for our own backend
      if (isBackend && error.status === 401) {
        authService.logout();
      }
      return throwError(() => error);
    })
  );
};
