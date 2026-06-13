import { Injectable } from '@angular/core';
import { AuthService } from './auth.service';

const CACHE_PREFIX = 'frontend_analysis_cache:';
const INDEX_PREFIX = 'frontend_analysis_cache_index:';
const SIGNAL_INDEX_PREFIX = 'frontend_analysis_cache_signal_index:';
const CURRENT_SIGNAL_PREFIX = 'frontend_analysis_current_signal:';
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
  canonicalSignalKey?: boolean;
}

@Injectable({ providedIn: 'root' })
export class FrontendAnalysisCacheService {
  constructor(private readonly auth: AuthService) {}

  get<T>(lookup: FrontendAnalysisCacheKey): T | null {
    const exactKey = lookup.canonicalSignalKey
      ? this.buildCanonicalSignalKey(lookup)
      : localStorage.getItem(this.buildIndexKey(lookup));
    if (!exactKey) return null;

    try {
      const raw = localStorage.getItem(exactKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.value || Number(parsed.expiresAt || 0) <= Date.now()) {
        localStorage.removeItem(exactKey);
        if (lookup.canonicalSignalKey) this.clearSignalIndexIfCurrent(lookup, exactKey);
        else localStorage.removeItem(this.buildIndexKey(lookup));
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
      if (lookup.canonicalSignalKey) this.clearSignalIndexIfCurrent(lookup, exactKey);
      else localStorage.removeItem(this.buildIndexKey(lookup));
      return null;
    }
  }

  set<T>(lookup: FrontendAnalysisCacheKey, value: T): void {
    const exactKey = lookup.canonicalSignalKey ? this.buildCanonicalSignalKey(lookup) : this.buildExactKey(lookup);
    if (lookup.canonicalSignalKey) {
      localStorage.setItem(this.buildSignalIndexKey(lookup), this.clean(lookup.signalHash || 'no-signals'));
    } else {
      localStorage.setItem(this.buildIndexKey(lookup), exactKey);
    }
    localStorage.setItem(exactKey, JSON.stringify({
      cachedAt: Date.now(),
      expiresAt: Date.now() + Math.max(60_000, Number(lookup.ttlMs || TTL_MS)),
      value
    }));
  }

  clearModule(module: string): void {
    Object.keys(localStorage)
      .filter((key) =>
        key.startsWith(`${CACHE_PREFIX}${module}:`) ||
        key.startsWith(`${INDEX_PREFIX}${module}:`) ||
        key.startsWith(`${SIGNAL_INDEX_PREFIX}${module}:`)
      )
      .forEach((key) => localStorage.removeItem(key));
  }

  getLatestSignalHash(lookup: FrontendAnalysisCacheKey): string | null {
    return localStorage.getItem(this.buildSignalIndexKey(lookup));
  }

  getCurrentSignalHash(lookup: FrontendAnalysisCacheKey): string | null {
    return localStorage.getItem(this.buildCurrentSignalKey(lookup));
  }

  setCurrentSignalHash(lookup: FrontendAnalysisCacheKey, signalHash: string): void {
    const normalized = this.clean(signalHash || '');
    if (!normalized || normalized === 'no-signals') return;
    localStorage.setItem(this.buildCurrentSignalKey(lookup), normalized);
  }

  clearCurrentSignalHash(lookup?: FrontendAnalysisCacheKey): void {
    if (lookup) {
      localStorage.removeItem(this.buildCurrentSignalKey(lookup));
      return;
    }

    const userId = this.auth.getCurrentUser()?._id || 'anonymous';
    Object.keys(localStorage)
      .filter((key) => key.startsWith(`${CURRENT_SIGNAL_PREFIX}${userId}:`))
      .forEach((key) => localStorage.removeItem(key));
  }

  clear(lookup: FrontendAnalysisCacheKey): void {
    if (lookup.canonicalSignalKey) {
      const signalHash = localStorage.getItem(this.buildSignalIndexKey(lookup));
      if (signalHash) {
        localStorage.removeItem(this.buildCanonicalSignalKey({ ...lookup, signalHash }));
      }
      localStorage.removeItem(this.buildSignalIndexKey(lookup));
      return;
    }

    const indexKey = this.buildIndexKey(lookup);
    const exactKey = localStorage.getItem(indexKey);
    if (exactKey) localStorage.removeItem(exactKey);
    localStorage.removeItem(indexKey);
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

  private buildSignalIndexKey(key: FrontendAnalysisCacheKey): string {
    const userId = key.userId || this.auth.getCurrentUser()?._id || 'anonymous';
    return [
      `${SIGNAL_INDEX_PREFIX}${key.module}`,
      userId,
      this.clean(key.careerStack || 'Full Stack'),
      this.clean(key.experienceLevel || 'Student')
    ].join(':');
  }

  private buildCurrentSignalKey(key: FrontendAnalysisCacheKey): string {
    const userId = key.userId || this.auth.getCurrentUser()?._id || 'anonymous';
    return [
      `${CURRENT_SIGNAL_PREFIX}${userId}`,
      this.clean(key.careerStack || 'Full Stack'),
      this.clean(key.experienceLevel || 'Student')
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

  private buildCanonicalSignalKey(key: FrontendAnalysisCacheKey): string {
    const userId = key.userId || this.auth.getCurrentUser()?._id || 'anonymous';
    return [
      `${CACHE_PREFIX}${key.module}`,
      userId,
      this.clean(key.signalHash || 'no-signals'),
      this.clean(key.careerStack || 'Full Stack'),
      this.clean(key.experienceLevel || 'Student')
    ].join(':');
  }

  private clearSignalIndexIfCurrent(lookup: FrontendAnalysisCacheKey, exactKey: string): void {
    const indexKey = this.buildSignalIndexKey(lookup);
    const signalHash = localStorage.getItem(indexKey);
    if (!signalHash) return;
    const indexedKey = this.buildCanonicalSignalKey({ ...lookup, signalHash });
    if (indexedKey === exactKey) localStorage.removeItem(indexKey);
  }

  private clean(value: string): string {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_.+-]+/g, '-');
  }
}
