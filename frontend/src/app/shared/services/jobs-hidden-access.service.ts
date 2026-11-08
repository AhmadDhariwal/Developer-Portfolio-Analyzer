import { Injectable, OnDestroy } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Subject, Observable, takeUntil, tap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from './auth.service';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class JobsHiddenAccessService implements OnDestroy {
  private readonly url = `${environment.apiBaseUrl}/jobs/hidden-access`;
  private readonly cancelled = new Subject<void>();
  readonly changes$ = new Subject<boolean>();
  private grant = '';
  private expiresAt = 0;
  private identity = '';
  private timer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly http: HttpClient,
    private readonly auth: AuthService,
  ) {
    this.auth.currentUser$.pipe(takeUntilDestroyed()).subscribe(() => {
      const user = this.auth.getCurrentUser();
      const next = `${user?._id || user?.['id'] || ''}:${this.auth.getToken?.() || ''}`;
      if (next === this.identity) return;
      this.identity = next;
      this.cancelled.next();
      this.clear();
    });
  }

  get unlocked(): boolean {
    return !!this.grant && this.expiresAt > Date.now();
  }
  headers(): HttpHeaders {
    return this.unlocked
      ? new HttpHeaders({ 'X-Jobs-Hidden-Token': this.grant })
      : new HttpHeaders();
  }
  unlock(password: string): Observable<{ token: string; expiresAt: number }> {
    const identity = this.identity;
    return this.http
      .post<{ token: string; expiresAt: number }>(`${this.url}/unlock`, { password })
      .pipe(
        takeUntil(this.cancelled),
        tap((result) => {
          if (identity !== this.identity) return;
          if (
            typeof result.token !== 'string' ||
            result.token.length !== 43 ||
            !/^[A-Za-z0-9_-]{43}$/.test(result.token) ||
            !Number.isFinite(result.expiresAt) ||
            result.expiresAt <= Date.now() ||
            result.expiresAt > Date.now() + 300000
          )
            throw new Error('Invalid hidden jobs confirmation response.');
          this.clear(false);
          this.grant = result.token;
          this.expiresAt = result.expiresAt;
          this.timer = setTimeout(() => this.clear(), Math.max(0, result.expiresAt - Date.now()));
          this.changes$.next(true);
        }),
      );
  }
  lock(): void {
    const headers = this.headers();
    const revoke = this.unlocked;
    this.cancelled.next();
    this.clear();
    if (revoke) this.http.post(`${this.url}/lock`, {}, { headers }).subscribe({ error: () => {} });
  }
  private clear(notify = true): void {
    const hadGrant = !!this.grant;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.grant = '';
    this.expiresAt = 0;
    if (notify && hadGrant) this.changes$.next(false);
  }
  ngOnDestroy(): void {
    this.cancelled.next();
    this.cancelled.complete();
    this.clear(false);
    this.changes$.complete();
  }
}
