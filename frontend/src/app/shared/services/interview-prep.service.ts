import { Injectable, OnDestroy } from '@angular/core';
import {
  EMPTY,
  Observable,
  Subject,
  defer,
  distinctUntilChanged,
  finalize,
  map,
  shareReplay,
  takeUntil,
  timeout,
} from 'rxjs';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { FrontendCacheInvalidationService } from './frontend-cache-invalidation.service';
import {
  InterviewCatalogParams,
  InterviewQuestion,
  InterviewQuestionListResponse,
  InterviewSession,
} from '../models/interview-prep.model';

export type {
  InterviewQuestion,
  InterviewQuestionListResponse,
  InterviewSession,
} from '../models/interview-prep.model';

@Injectable({ providedIn: 'root' })
export class InterviewPrepService implements OnDestroy {
  private readonly inflight = new Map<string, Observable<unknown>>();
  private readonly cancel = new Subject<void>();
  private epoch = 0;
  readonly owner$;
  private readonly ownerSubscription;

  constructor(
    private readonly api: ApiService,
    auth: AuthService,
    invalidation: FrontendCacheInvalidationService,
  ) {
    this.owner$ = auth.currentUser$.pipe(
      map((user) => String(user?._id || '')),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true }),
    );
    this.ownerSubscription = this.owner$.subscribe(() => this.clearCache());
    invalidation.register('interview-prep', () => this.clearCache());
  }

  // Share active requests only. Completed reads revalidate through the backend's
  // revision-aware cache; a browser TTL must not hide a backend revision.
  private once<T>(kind: string, params: object, load: () => Observable<T>): Observable<T> {
    const key = JSON.stringify([
      kind,
      Object.entries(params).sort(([a], [b]) => a.localeCompare(b)),
    ]);
    const existing = this.inflight.get(key);
    if (existing) return existing as Observable<T>;
    const epoch = this.epoch;
    let guarded: Observable<T>;
    const shared = defer(load).pipe(
      timeout(kind === 'ask' || kind === 'generate' || kind === 'session' ? 20000 : 12000),
      takeUntil(this.cancel),
      finalize(() => {
        if (this.inflight.get(key) === guarded) this.inflight.delete(key);
      }),
      shareReplay({ bufferSize: 1, refCount: true }),
    );
    guarded = defer(() => (epoch === this.epoch ? shared : EMPTY));
    this.inflight.set(key, guarded);
    return guarded;
  }

  clearCache(): void {
    this.epoch++;
    this.cancel.next();
    this.inflight.clear();
  }
  ngOnDestroy(): void {
    this.ownerSubscription.unsubscribe();
    this.clearCache();
    this.cancel.complete();
  }
  reset(): void {
    this.clearCache();
  }
  invalidate(_prefixes?: string[]): void {
    this.clearCache();
  }

  getTopQuestions(params: InterviewCatalogParams): Observable<InterviewQuestionListResponse> {
    return this.once('top', params, () =>
      this.api.getInterviewPrepQuestions({ ...params, block: 'top' }),
    );
  }
  getAllQuestions(params: InterviewCatalogParams): Observable<InterviewQuestionListResponse> {
    return this.once('all', params, () =>
      this.api.getInterviewPrepQuestions({ ...params, block: 'all' }),
    );
  }
  searchQuestions(params: {
    q: string;
    skill?: string;
    difficulty?: string;
    tags?: string[];
    page?: number;
    limit?: number;
    lookupOnly?: boolean;
  }): Observable<InterviewQuestionListResponse> {
    return this.once('search', params, () =>
      this.api.searchInterviewPrepQuestions({ ...params, lookupOnly: true }),
    );
  }
  generateQuestions(payload: {
    skill: string;
    query?: string;
    difficulty?: string;
    page?: number;
    limit?: number;
    target?: number;
  }): Observable<InterviewQuestionListResponse> {
    return this.once('generate', payload, () => this.api.generateInterviewPrepQuestions(payload));
  }
  askQuestion(payload: {
    question: string;
    skill?: string;
    topic?: string;
    stack?: string;
    technology?: string;
    language?: string;
    framework?: string;
  }): Observable<InterviewQuestion> {
    return this.once('ask', payload, () => this.api.askInterviewPrepQuestion(payload));
  }
  startSession(skill: string): Observable<InterviewQuestionListResponse> {
    const payload = { skill, skillGaps: [] };
    return this.once('session', payload, () => this.api.generateInterviewPrep(payload));
  }
  getSessions(limit = 10): Observable<InterviewSession[]> {
    return this.once<{ sessions?: InterviewSession[] }>('history', { limit }, () =>
      this.api.getInterviewPrepHistory(limit),
    ).pipe(
      map((response) =>
        Array.isArray(response?.sessions)
          ? response.sessions.filter((session) => Array.isArray(session.questions))
          : [],
      ),
    );
  }
  getHistory(limit = 10): Observable<InterviewQuestion[]> {
    return this.getSessions(limit).pipe(
      map((sessions) => sessions.flatMap((session) => session.questions)),
    );
  }
}
