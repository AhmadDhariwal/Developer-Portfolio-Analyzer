import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { finalize, shareReplay, tap } from 'rxjs/operators';
import { AuthService } from './auth.service';
import { environment } from '../../../environments/environment';
import { FrontendAnalysisCacheService } from './frontend-analysis-cache.service';
import { FrontendCacheInvalidationService } from './frontend-cache-invalidation.service';

const SKILL_GAP_CACHE_PREFIX = 'skill_gap_cache:';
const SKILL_GAP_CACHE_INDEX_PREFIX = 'skill_gap_cache_index:';
const SKILL_GAP_TTL_MS = 24 * 60 * 60 * 1000;

export type SkillPriority = 'High' | 'Medium' | 'Low';

export interface SkillEvidence {
  source?: string;
  confidenceScore?: number;
  evidence?: string[];
  detectionMethod?: string;
  whyExists?: string;
  whyItMatters?: string;
  businessImpact?: string;
}

export interface CurrentSkill extends SkillEvidence {
  name: string;
  category: string;
  proficiency: number;
  isFoundational: boolean;
  priority?: SkillPriority;
}

export interface MissingSkill extends SkillEvidence {
  name: string;
  category: string;
  priority: SkillPriority;
  jobDemand: number;
  levelRelevance: 'Current' | 'Next Level' | 'Advanced';
  learningEffort?: {
    weeks?: number;
    label?: string;
    level?: string;
  };
  recommendedResources?: Array<{ title: string; url: string } | string>;
  suggestedProject?: SuggestedSkillProject;
}

export type SkillTimelineItem = CurrentSkill | MissingSkill;

export interface RoadmapPhase {
  phase: string;
  duration: string;
  title: string;
  description: string;
  skills: string[];
  resources: Array<{ title: string; url: string } | string>;
  color: 'purple' | 'blue' | 'green' | 'orange';
  topSkill: string;
  objective?: string;
  expectedOutcome?: string;
  measurableDeliverable?: string;
}

export interface CoverageBreakdown {
  knownSkillCount?: number;
  missingSkillCount?: number;
  averageProficiency?: number;
  balanceFactor?: number;
  resumeFactor?: number;
  integrationFactor?: number;
  formula?: string;
}

export interface SkillGapCacheMetadata {
  loadedFromCache?: boolean;
  cacheKey?: {
    githubUsername?: string;
    careerStack?: string;
    experienceLevel?: string;
    resumeHash?: string;
    resumeAnalysisId?: string;
    signalHash?: string;
    analysisVersion?: string;
  };
  signalHash?: string;
  analysisVersion?: string;
  temporary?: boolean;
  cachedAt?: string | null;
}

export interface SuggestedSkillProject {
  title: string;
  skill: string;
  difficulty?: string;
  estimatedWeeks?: number;
  outcome?: string;
  deliverable?: string;
}

export interface SkillGapResult {
  username: string;
  careerStack: string;
  experienceLevel: string;
  coverage: number;
  missing: number;
  yourSkills: CurrentSkill[];
  missingSkills: MissingSkill[];
  resumeSkills?: string[];
  githubSkills?: string[];
  provenSkills?: string[];
  claimedButNotProvenSkills?: string[];
  weakSkills?: SkillTimelineItem[];
  highDemandSkills?: MissingSkill[];
  immediateSkills?: SkillTimelineItem[];
  shortTermSkills?: SkillTimelineItem[];
  midTermSkills?: SkillTimelineItem[];
  longTermSkills?: SkillTimelineItem[];
  prerequisites?: Record<string, string | string[]>;
  estimatedWeeks?: number;
  suggestedProjects?: SuggestedSkillProject[];
  coverageBreakdown?: CoverageBreakdown;
  cacheMetadata?: SkillGapCacheMetadata;
  skillGapSignals?: unknown;
  fromCache?: boolean;
  fromFrontendCache?: boolean;
  levelAssessment: string;
  analysisSummary?: string;
  roadmap: RoadmapPhase[];
  skillGraph?: {
    nodes: SkillGraphNode[];
    edges: SkillGraphEdge[];
  };
  weeklyRoadmap?: WeeklyRoadmapWeek[];
  signalsUsed?: {
    github: {
      connected: boolean;
      username: string;
      repoCount: number;
      developerLevel: string;
    };
    resume: {
      analyzed: boolean;
      analysisId?: string;
      atsScore: number;
      experienceLevel: string;
      fileName?: string;
      lastAnalyzedAt?: string | null;
      extractedSkills?: string[];
      experienceKeywords?: string[];
      strengths?: string[];
      weaknesses?: string[];
      missingSections?: string[];
      statusMessage?: string;
    };
    portfolio: {
      present: boolean;
      completenessScore: number;
      projectCount: number;
      liveLinkCount: number;
    };
    integrations: {
      providers: string[];
      score: number;
      strongestProof: string[];
    };
    weeklyProgress: {
      status: string;
      score: number;
      trendDelta: number;
    };
    careerSprint: {
      consistencyScore: number;
      streak: number;
      activeLearningFocus: string;
    };
    careerProfile?: {
      careerStack: string;
      experienceLevel: string;
      careerGoal: string;
    };
    jobsDemand?: {
      sampledJobs: number;
      topSkills: Array<{ name: string; demandScore: number; postings: number }>;
    };
  };
  analysisBasedOn?: {
    githubUsername: string;
    resumeAnalyzed: boolean;
    resumeStatus: string;
    careerStack: string;
    experienceLevel: string;
    lastAnalyzedAt?: string | null;
  };
  resumeStatusMessage?: string;
  totalWeeks: string;
  data?: any;
  result?: any;
}

export interface SkillGraphNode {
  id: string;
  name: string;
  category: string;
  demandScore: number;
  proficiency: number;
  kind: 'current' | 'missing';
  relatedSkills: string[];
  confidenceScore?: number;
  source?: string;
  evidence?: string[];
  prerequisites?: string[];
  difficulty?: string;
  jobDemand?: number;
  learningOrder?: number;
  priority?: SkillPriority;
}

export interface SkillGraphEdge {
  from: string;
  to: string;
  type: 'prerequisite' | 'dependency' | 'related';
  weight: number;
}

export interface WeeklyRoadmapWeek {
  week: number;
  focusSkills: string[];
  reason: string;
  outcomes: string[];
}

@Injectable({ providedIn: 'root' })
export class SkillGapService {
  private readonly baseUrl = environment.apiBaseUrl;
  private readonly inflight = new Map<string, Observable<SkillGapResult>>();
  private profileCache: { value: SkillGapResult; cachedAt: number } | null = null;
  private profileCacheKey = '';

  constructor(
    private readonly http: HttpClient,
    private readonly auth: AuthService,
    private readonly frontendCache: FrontendAnalysisCacheService,
    private readonly cacheInvalidation: FrontendCacheInvalidationService
  ) {
    this.cacheInvalidation.register('skill-gap', () => this.clearCache());
  }

  private getProfileCacheKey(username: string): string {
    const userId = this.auth.getCurrentUser()?._id || 'anonymous';
    const cleanUsername = String(username || '').trim().toLowerCase().replace(/[^a-z0-9_.+-]+/g, '-');
    return `skillgap:profile:${userId}:${cleanUsername}`;
  }

  clearCache(): void {
    this.inflight.clear();
    this.profileCache = null;
    this.profileCacheKey = '';
    Object.keys(localStorage)
      .filter((key) => key.startsWith(SKILL_GAP_CACHE_PREFIX) || key.startsWith(SKILL_GAP_CACHE_INDEX_PREFIX))
      .forEach((key) => localStorage.removeItem(key));
  }

  analyze(
    username: string,
    careerStack: string,
    experienceLevel: string,
    isTemporary = false,
    forceRefresh = false,
    resumeText?: string,
    previewResumeId?: string,
    resumeHash?: string
  ): Observable<SkillGapResult> {
    const cacheKey = this.getProfileCacheKey(username);
    const ttlMs = 15 * 60 * 1000; // 15 minutes TTL
    if (!isTemporary && !forceRefresh && this.profileCache && this.profileCacheKey === cacheKey) {
      const age = Date.now() - this.profileCache.cachedAt;
      if (age < ttlMs) {
        return of(this.profileCache.value);
      }
    }

    const requestKey = this.buildRequestKey(username, careerStack, experienceLevel, isTemporary, forceRefresh, resumeText, resumeHash);
    const existing = this.inflight.get(requestKey);
    if (existing) return existing;

    const payload = isTemporary
      ? { username, careerStack, experienceLevel, isTemporary: true, forceRefresh, resumeText, previewResumeId, resumeHash }
      : { username, careerStack, experienceLevel, isTemporary: false, forceRefresh };
    const request$ = this.http.post<SkillGapResult>(`${this.baseUrl}/skillgap/skill-gap`, payload).pipe(
      tap((result) => {
        if (!isTemporary) {
          const raw = result?.data || result?.result || result;
          this.profileCache = { value: raw, cachedAt: Date.now() };
          this.profileCacheKey = cacheKey;

          this.cacheInvalidation.clearRecommendationsCaches();
          this.cacheInvalidation.clearScenarioCaches();
          this.cacheInvalidation.clearNewsCaches();
          this.cacheInvalidation.clearJobsCaches();
          this.cacheInvalidation.clearCoursesCaches();
          this.cacheInvalidation.clearDashboardCaches();
          this.cacheInvalidation.clearWeeklyReportCaches();
        }
      }),
      finalize(() => this.inflight.delete(requestKey)),
      shareReplay({ bufferSize: 1, refCount: false })
    );

    this.inflight.set(requestKey, request$);
    return request$;
  }

  getCachedResult(username: string, careerStack: string, experienceLevel: string): SkillGapResult | null {
    const signalHash = this.getLatestSignalHash(careerStack, experienceLevel);
    const cacheKey = this.buildCacheKey(signalHash || 'no-signals', careerStack, experienceLevel);

    try {
      const raw = localStorage.getItem(cacheKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.result || Number(parsed.expiresAt || 0) <= Date.now()) {
        localStorage.removeItem(cacheKey);
        this.clearSignalIndexIfCurrent(careerStack, experienceLevel, cacheKey);
        return null;
      }
      return { ...parsed.result, fromFrontendCache: true } as SkillGapResult;
    } catch {
      localStorage.removeItem(cacheKey);
      this.clearSignalIndexIfCurrent(careerStack, experienceLevel, cacheKey);
      return null;
    }
  }

  cacheResult(result: SkillGapResult, isTemporary = false): void {
    if (isTemporary || result.cacheMetadata?.temporary) return;
    const signalHash = this.resultSignalHash(result);
    const key = this.buildCacheKey(signalHash, result.careerStack, result.experienceLevel);

    localStorage.setItem(this.buildSignalIndexKey(result.careerStack, result.experienceLevel), signalHash);
    this.frontendCache.setCurrentSignalHash({
      module: 'developer-signals',
      careerStack: result.careerStack,
      experienceLevel: result.experienceLevel
    }, signalHash);
    localStorage.setItem(key, JSON.stringify({
      cachedAt: Date.now(),
      expiresAt: Date.now() + SKILL_GAP_TTL_MS,
      result
    }));
  }

  invalidateCachedResult(careerStack: string, experienceLevel: string): void {
    const userId = this.auth.getCurrentUser()?._id || 'anonymous';
    const suffix = `:${this.clean(careerStack || 'Full Stack')}:${this.clean(experienceLevel || 'Student')}`;
    Object.keys(localStorage)
      .filter((key) => key.startsWith(`${SKILL_GAP_CACHE_PREFIX}${userId}:`) && key.endsWith(suffix))
      .forEach((key) => localStorage.removeItem(key));
    localStorage.removeItem(this.buildSignalIndexKey(careerStack, experienceLevel));
  }

  extractSignalHash(result: SkillGapResult | null | undefined): string {
    if (!result) return '';
    return this.resultSignalHash(result);
  }

  private buildRequestKey(
    username: string,
    careerStack: string,
    experienceLevel: string,
    isTemporary: boolean,
    forceRefresh: boolean,
    resumeText?: string,
    resumeHash?: string
  ): string {
    const userId = this.auth.getCurrentUser()?._id || 'anonymous';
    const signalHash = this.getLatestSignalHash(careerStack, experienceLevel) || 'no-signals';
    return [
      isTemporary ? this.clean(username || 'temporary') : userId,
      this.clean(signalHash),
      this.clean(careerStack || 'Full Stack'),
      this.clean(experienceLevel || 'Student'),
      isTemporary ? 'temporary' : 'saved',
      forceRefresh ? 'refresh' : 'normal',
      resumeHash ? `resume-${resumeHash}` : (resumeText ? `inline-${resumeText.length}` : 'no-resume')
    ].join(':');
  }

  private buildSignalIndexKey(careerStack: string, experienceLevel: string): string {
    const userId = this.auth.getCurrentUser()?._id || 'anonymous';
    return [
      `${SKILL_GAP_CACHE_INDEX_PREFIX}${userId}`,
      this.clean(careerStack || 'Full Stack'),
      this.clean(experienceLevel || 'Student')
    ].join(':');
  }

  private getLatestSignalHash(careerStack: string, experienceLevel: string): string | null {
    return localStorage.getItem(this.buildSignalIndexKey(careerStack, experienceLevel));
  }

  private buildCacheKey(signalHash: string, careerStack: string, experienceLevel: string): string {
    const userId = this.auth.getCurrentUser()?._id || 'anonymous';
    return [
      `${SKILL_GAP_CACHE_PREFIX}${userId}`,
      this.clean(signalHash || 'no-signals'),
      this.clean(careerStack || 'Full Stack'),
      this.clean(experienceLevel || 'Student')
    ].join(':');
  }

  private resultSignalHash(result: SkillGapResult): string {
    const meta = result.cacheMetadata?.cacheKey || {};
    return this.clean(meta.signalHash || result.cacheMetadata?.signalHash || 'no-signals');
  }

  private clearSignalIndexIfCurrent(careerStack: string, experienceLevel: string, cacheKey: string): void {
    const indexKey = this.buildSignalIndexKey(careerStack, experienceLevel);
    const signalHash = localStorage.getItem(indexKey);
    if (!signalHash) return;
    if (this.buildCacheKey(signalHash, careerStack, experienceLevel) === cacheKey) {
      localStorage.removeItem(indexKey);
    }
  }

  private clean(value: string): string {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_.+-]+/g, '-');
  }
}
