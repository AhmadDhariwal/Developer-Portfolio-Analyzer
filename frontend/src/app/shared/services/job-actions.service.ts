import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import {
  BehaviorSubject,
  Observable,
  Subject,
  defer,
  finalize,
  firstValueFrom,
  map,
  takeUntil,
  tap,
  throwError,
} from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from './auth.service';
import { JobService } from './job.service';
import { environment } from '../../../environments/environment';
import { Job, JobActionsResponse, JobActionRecord, JobUiState } from '../models/job.model';
import { jobRequestError } from '../utils/job-presentation';

@Injectable({ providedIn: 'root' })
export class JobActionsService {
  private readonly url = `${environment.apiBaseUrl}/jobs`;
  private readonly states = new Map<string, JobUiState>();
  private readonly busy = new Set<string>();
  private readonly unavailableLegacy = new Set<string>();
  private readonly cancelled = new Subject<void>();
  readonly changes$ = new BehaviorSubject(0);
  retryAt = 0;
  migrationRetryAt = 0;
  private owner = '';

  constructor(
    private readonly http: HttpClient,
    private readonly auth: AuthService,
    private readonly jobs: JobService,
  ) {
    this.auth.currentUser$.pipe(takeUntilDestroyed()).subscribe(() => {
      const user = this.auth.getCurrentUser();
      const owner = String(user?._id || user?.['id'] || '');
      if (owner === this.owner) return;
      this.cancelled.next();
      this.owner = owner;
      this.states.clear();
      this.busy.clear();
      this.unavailableLegacy.clear();
      this.retryAt = 0;
      this.migrationRetryAt = 0;
      this.changed();
    });
  }

  state(id: string): JobUiState {
    return this.states.get(id) || { saved: false, applied: false, hidden: false };
  }
  isBusy(id: string): boolean {
    return this.busy.has(id);
  }
  seed(jobs: Job[]): void {
    for (const job of jobs) if (job.actions) this.store(job.id, { ...job.actions });
  }
  private store(id: string, state: JobUiState): void {
    this.states.delete(id);
    this.states.set(id, state);
    while (this.states.size > 500) this.states.delete(this.states.keys().next().value!);
  }
  private changed(): void {
    this.changes$.next(this.changes$.value + 1);
  }

  list(
    state?: 'saved' | 'applied' | 'hidden',
    page = 1,
    limit = 10,
  ): Observable<JobActionsResponse> {
    let params = new HttpParams().set('page', page).set('limit', limit);
    if (state) params = params.set('state', state);
    const owner = this.owner;
    if (!owner) return throwError(() => new Error('Authentication required.'));
    return this.http.get<JobActionsResponse>(`${this.url}/actions`, { params }).pipe(
      takeUntil(this.cancelled),
      tap((response) => {
        if (owner === this.owner)
          for (const action of response.actions) this.store(action.jobId, action);
      }),
    );
  }

  update(
    id: string,
    patch: Partial<Pick<JobUiState, 'saved' | 'applied' | 'hidden'>>,
  ): Observable<JobActionRecord> {
    return defer(() => {
      if (!this.owner || this.busy.has(id) || Date.now() < this.retryAt)
        return throwError(() => new Error('Wait before changing this job again.'));
      const owner = this.owner;
      this.busy.add(id);
      this.changed();
      return this.http
        .put<{ action: JobActionRecord }>(`${this.url}/${encodeURIComponent(id)}/actions`, patch)
        .pipe(
          takeUntil(this.cancelled),
          map((response) => response.action),
          tap({
            next: (action) => {
              if (owner !== this.owner) return;
              this.store(action.jobId, action);
              this.jobs.clearCache();
            },
            error: (error) => {
              if (owner === this.owner) this.retryAt = jobRequestError(error).retryAt;
            },
          }),
          finalize(() => {
            if (owner === this.owner) {
              this.busy.delete(id);
              this.changed();
            }
          }),
        );
    });
  }

  private get legacyKey(): string {
    return `devinsight_public_jobs_state:${this.owner}`;
  }
  get legacyImportableCount(): number {
    return Object.keys(this.legacy()).filter((id) => !this.unavailableLegacy.has(id)).length;
  }
  legacy(): Record<string, JobUiState> {
    if (!this.owner) return {};
    try {
      const value = JSON.parse(localStorage.getItem(this.legacyKey) || '{}');
      if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
      return Object.fromEntries(
        Object.entries(value)
          .filter(
            ([id, state]) =>
              id.length <= 200 &&
              !/[\s\x00-\x1f]/.test(id) &&
              !!state &&
              typeof state === 'object' &&
              ['saved', 'applied', 'hidden'].some(
                (field) => (state as Record<string, unknown>)[field] === true,
              ),
          )
          .slice(0, 200),
      ) as Record<string, JobUiState>;
    } catch {
      return {};
    }
  }

  async importLegacy(): Promise<{ imported: number; reconciled: number; unavailable: number }> {
    if (Date.now() < this.migrationRetryAt) throw new Error('Wait before importing another batch.');
    const owner = this.owner;
    const key = this.legacyKey;
    const entries = Object.entries(this.legacy())
      .filter(([id]) => !this.unavailableLegacy.has(id))
      .slice(0, 10);
    const server = new Set<string>();
    // Reconcile a bounded complete history. Never resurrect a remote false flag.
    for (let page = 1; page <= 20; page++) {
      const response = await firstValueFrom(this.list(undefined, page, 50));
      if (owner !== this.owner) throw new Error('Account changed. Import stopped.');
      response.actions.forEach((action) => server.add(action.jobId));
      if (!response.hasMore) break;
      if (page === 20)
        throw new Error(
          'Your account history is too large to reconcile safely. Browser activity was kept.',
        );
    }
    const result = { imported: 0, reconciled: 0, unavailable: 0 };
    this.migrationRetryAt = Date.now() + 60000;
    for (const [id, state] of entries) {
      if (owner !== this.owner) throw new Error('Account changed. Import stopped.');
      if (!server.has(id)) {
        const patch = Object.fromEntries(
          ['saved', 'applied', 'hidden']
            .filter((field) => state[field as keyof JobUiState] === true)
            .map((field) => [field, true]),
        );
        try {
          // Older clients could retain an external alias. Resolve it before
          // reconciling so aliases cannot overwrite canonical account history.
          const job = await firstValueFrom(
            this.jobs.getJobById(id).pipe(takeUntil(this.cancelled)),
          );
          if (owner !== this.owner) throw new Error('Account changed. Import stopped.');
          if (!job.id)
            throw new Error('The listing could not be reconciled. Browser activity was kept.');
          if (server.has(job.id)) result.reconciled++;
          else {
            await firstValueFrom(this.update(job.id, patch));
            server.add(job.id);
            result.imported++;
          }
        } catch (error) {
          if ((error as { status?: number }).status === 404) {
            this.unavailableLegacy.add(id);
            result.unavailable++;
            continue;
          }
          throw error;
        }
      } else result.reconciled++;
      // Remove only this acknowledged entry, preserving malformed/unrelated data.
      if (owner === this.owner)
        try {
          const remaining = JSON.parse(localStorage.getItem(key) || '{}');
          delete remaining[id];
          localStorage.setItem(key, JSON.stringify(remaining));
        } catch {
          /* Acknowledged writes are idempotent if storage is unavailable. */
        }
    }
    this.changed();
    return result;
  }
}
