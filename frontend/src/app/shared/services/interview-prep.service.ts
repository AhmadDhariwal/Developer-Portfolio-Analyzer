import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { shareReplay } from 'rxjs/operators';
import { ApiService } from './api.service';

export interface InterviewQuestion {
  _id?: string;
  skill?: string;
  topicKey?: string;
  topicType?: 'stack' | 'technology' | 'language' | 'framework';
  question: string;
  answer: string;
  answerSections?: {
    shortAnswer?: string;
    summary?: string;
    keyPoints?: string[];
    explanation?: string;
    bulletPoints?: string[];
    example?: string;
    codeExample?: string;
    realWorldUseCase?: string;
    realWorldContext?: string;
    commonMistakes?: string[];
    interviewTip?: string;
    [key: string]: string | string[] | undefined;
  };
  difficulty: 'easy' | 'medium' | 'hard';
  category?: 'conceptual' | 'scenario_based' | 'code_output' | 'best_practice' | 'system_design' | 'behavioral';
  qualityScore?: number;
  answerFormat?: 'structured' | 'plain';
  isEnriched?: boolean;
  tags: string[];
  source?: 'verified_seed' | 'prebuilt' | 'ai' | 'ai_generated' | 'scraped' | 'user_asked' | 'seed' | 'db' | 'scrape' | 'hybrid';
  sourceType?: 'verified_seed' | 'prebuilt' | 'ai' | 'ai_generated' | 'scraped' | 'user_asked' | 'seed' | 'db' | 'scrape' | 'hybrid';
  sourceLabel?: string;
  popularity?: number;
  confidenceScore?: number;
  relevanceScore?: number;
  createdAt?: string;
  stored?: boolean;
  duplicate?: boolean;
  fromCache?: boolean;
}

export interface InterviewQuestionListResponse {
  questions: InterviewQuestion[];
  total: number;
  totalAvailable?: number;
  page: number;
  limit: number;
  totalPages: number;
  source?: string;
  aiGeneratedCount?: number;
  scrapedGeneratedCount?: number;
  enrichedCount?: number;
  sourceMix?: Record<string, number>;
  partial?: boolean;
  fromCache?: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class InterviewPrepService {
  /** 
   * Shared-replay cache. Keys are deterministic (params-based).
   * refCount: false ensures the replay survives when the component is destroyed
   * and recreated — no duplicate API calls when navigating back.
   */
  private readonly cache = new Map<string, Observable<any>>();

  constructor(private readonly api: ApiService) {}

  /** Build a deterministic cache key from params, stripping undefined values. */
  private buildKey(prefix: string, params: Record<string, unknown>): string {
    const sorted = Object.entries(params)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(',') : String(value)}`)
      .join('&');
    return `${prefix}:${sorted}`;
  }

  /** Returns a cached shared observable, or creates one with refCount: false. */
  private once<T>(key: string, source$: Observable<T>): Observable<T> {
    const existing = this.cache.get(key) as Observable<T> | undefined;
    if (existing) return existing;

    const shared$ = source$.pipe(
      shareReplay({ bufferSize: 1, refCount: false })
    );

    this.cache.set(key, shared$);
    return shared$;
  }

  /** Invalidate specific prefixes (called on filter change so stale data is refetched). */
  invalidate(prefixes: string[] = ['top', 'all']): void {
    for (const [key] of this.cache) {
      if (prefixes.some((prefix) => key.startsWith(prefix + ':'))) {
        this.cache.delete(key);
      }
    }
  }

  /** Clear all cached responses (called on logout / full reset). */
  reset(): void {
    this.cache.clear();
  }

  getTopQuestions(params: { skill: string; page?: number; limit?: number; difficulty?: string; tags?: string[] }): Observable<InterviewQuestionListResponse> {
    return this.once(this.buildKey('top', params), this.api.getInterviewPrepQuestions({ ...params, block: 'top' }));
  }

  getAllQuestions(params: { skill: string; page?: number; limit?: number; difficulty?: string; tags?: string[]; category?: string; source?: string }): Observable<InterviewQuestionListResponse> {
    return this.once(this.buildKey('all', params), this.api.getInterviewPrepQuestions({ ...params, block: 'all' }));
  }

  searchQuestions(params: { q: string; page?: number; limit?: number; skill?: string; difficulty?: string; tags?: string[]; lookupOnly?: boolean }): Observable<InterviewQuestionListResponse> {
    return this.once(this.buildKey('search', params), this.api.searchInterviewPrepQuestions(params));
  }

  generateQuestions(payload: { skill: string; query?: string; difficulty?: string; page?: number; limit?: number; target?: number }): Observable<InterviewQuestionListResponse> {
    return this.once(this.buildKey('generate', payload), this.api.generateInterviewPrepQuestions(payload));
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
    return this.once(this.buildKey('ask', payload), this.api.askInterviewPrepQuestion(payload));
  }
}
