import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, mergeMap, of, throwError } from 'rxjs';
import { OrganizationPolicyState } from '../../shared/services/organization-policy-state.service';

// One scoped capability request serves the workspace. Every resource still uses
// backend authorization and its own access flags; this interceptor grants nothing.
export const organizationPolicyInterceptor: HttpInterceptorFn = (request, next) => {
  if (
    !/\/api\/recruiter(?:-hub)?\//.test(request.url) ||
    request.url.split('?')[0].endsWith('/capabilities')
  )
    return next(request);
  const state = inject(OrganizationPolicyState);
  state.refresh().subscribe();
  const scope = state.scope();
  const revision = state.revision();
  return next(request).pipe(
    mergeMap((event) =>
      scope === state.scope() && revision === state.revision()
        ? of(event)
        : throwError(
            () =>
              new HttpErrorResponse({
                status: 403,
                error: {
                  code: 'CONTEXT_CHANGED',
                  message: 'Access changed. Refresh the authorized workspace.',
                },
              }),
          ),
    ),
    catchError((error: HttpErrorResponse) => {
      if (
        [403, 404, 409].includes(error.status) &&
        error.error?.code !== 'CONTEXT_CHANGED' &&
        scope === state.scope() &&
        revision === state.revision()
      ) {
        state.recover().subscribe();
      }
      return throwError(() => error);
    }),
  );
};
