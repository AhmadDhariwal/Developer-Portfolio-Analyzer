import { Injectable } from '@angular/core';
import { AuthService } from './auth.service';

const CACHE_PREFIX = 'frontend_analysis_cache:';
const INDEX_PREFIX = 'frontend_analysis_cache_index:';
const TTL_MS = 24 * 60 * 60 * 1000;

export interface FrontendAnalysisCacheKey {
  module: string;
  userId?: string;
  githubUsername?: string;
  resumeHash?: string;
  resumeAnalysisId?: string;
  careerStack?: string;
  experienceLevel?: string;
  signalHash?: string;
  version?: string;
  weekStartDate?: string;
  limit?: number | string;
  ttlMs?: number;
}

@Injectable({ providedIn: 'root' })
export class FrontendAnalysisCacheService {
  constructor(private readonly auth: AuthService) {}

  get<T>(lookup: FrontendAnalysisCacheKey): T | null {
    const indexKey = this.buildIndexKey(lookup);
    const exactKey = localStorage.getItem(indexKey);
    if (!exactKey) return null;

    try {
      const raw = localStorage.getItem(exactKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.value || Number(parsed.expiresAt || 0) <= Date.now()) {
        localStorage.removeItem(exactKey);
        localStorage.removeItem(indexKey);
        return null;
      }
      return {
        ...parsed.value,
        fromFrontendCache: true,
        cacheState: 'cache-hit',
        cachedAt: parsed.cachedAt || null,
        cacheExpiresAt: parsed.expiresAt || null
      } as T;
    } catch {
      localStorage.removeItem(exactKey);
      localStorage.removeItem(indexKey);
      return null;
    }
  }

  set<T>(lookup: FrontendAnalysisCacheKey, value: T): void {
    const exactKey = this.buildExactKey(lookup);
    const indexKey = this.buildIndexKey(lookup);
    localStorage.setItem(indexKey, exactKey);
    localStorage.setItem(exactKey, JSON.stringify({
      cachedAt: Date.now(),
      expiresAt: Date.now() + Math.max(60_000, Number(lookup.ttlMs || TTL_MS)),
      value
    }));
  }

  clearModule(module: string): void {
    Object.keys(localStorage)
      .filter((key) => key.startsWith(`${CACHE_PREFIX}${module}:`) || key.startsWith(`${INDEX_PREFIX}${module}:`))
      .forEach((key) => localStorage.removeItem(key));
  }

  private buildIndexKey(key: FrontendAnalysisCacheKey): string {
    const userId = key.userId || this.auth.getCurrentUser()?._id || 'anonymous';
    return [
      `${INDEX_PREFIX}${key.module}`,
      userId,
      this.clean(key.githubUsername || 'no-github'),
      this.clean(key.careerStack || 'Full Stack'),
      this.clean(key.experienceLevel || 'Student'),
      this.clean(key.weekStartDate || 'no-week'),
      this.clean(String(key.limit || 'no-limit')),
      this.clean(key.version || 'unknown')
    ].join(':');
  }

  private buildExactKey(key: FrontendAnalysisCacheKey): string {
    const userId = key.userId || this.auth.getCurrentUser()?._id || 'anonymous';
    return [
      `${CACHE_PREFIX}${key.module}`,
      userId,
      this.clean(key.githubUsername || 'no-github'),
      this.clean(key.resumeHash || 'no-resume'),
      this.clean(key.resumeAnalysisId || 'no-resume'),
      this.clean(key.careerStack || 'Full Stack'),
      this.clean(key.experienceLevel || 'Student'),
      this.clean(key.signalHash || 'no-signals'),
      this.clean(key.weekStartDate || 'no-week'),
      this.clean(String(key.limit || 'no-limit')),
      this.clean(key.version || 'unknown')
    ].join(':');
  }

  private clean(value: string): string {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_.+-]+/g, '-');
  }
}
