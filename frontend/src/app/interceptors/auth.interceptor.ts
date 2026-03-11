import { HttpInterceptorFn } from '@angular/common/http';

/**
 * Global HTTP interceptor — automatically attaches the JWT Bearer token
 * to every outgoing request if one exists in localStorage.
 * This ensures ALL services (dashboard, profile, github, resume, etc.)
 * send the auth header without each service having to manage it manually.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = localStorage.getItem('token');

  if (token) {
    const cloned = req.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`
      }
    });
    return next(cloned);
  }

  return next(req);
};
