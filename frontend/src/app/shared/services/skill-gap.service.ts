import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AuthService } from './auth.service';

const SKILL_GAP_CACHE_PREFIX = 'skill_gap_cache:';
const SKILL_GAP_CACHE_INDEX_PREFIX = 'skill_gap_cache_index:';

export type SkillPriority = 'High' | 'Medium' | 'Low';

export interface SkillEvidence {
  source?: string;
  confidenceScore?: number;
  evidence?: string[];
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
  private readonly baseUrl = 'http://localhost:5000/api';

  constructor(
    private readonly http: HttpClient,
    private readonly auth: AuthService
  ) {}

  analyze(
    username: string,
    careerStack: string,
    experienceLevel: string,
    isTemporary = false,
    forceRefresh = false
  ): Observable<SkillGapResult> {
    return this.http.post<SkillGapResult>(
      `${this.baseUrl}/skillgap/skill-gap`,
      { username, careerStack, experienceLevel, isTemporary, forceRefresh }
    );
  }

  getCachedResult(username: string, careerStack: string, experienceLevel: string): SkillGapResult | null {
    const indexKey = this.buildIndexKey(username, careerStack, experienceLevel);
    const cacheKey = localStorage.getItem(indexKey);
    if (!cacheKey) return null;

    try {
      const raw = localStorage.getItem(cacheKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.result) return null;
      return { ...parsed.result, fromFrontendCache: true } as SkillGapResult;
    } catch {
      localStorage.removeItem(cacheKey);
      localStorage.removeItem(indexKey);
      return null;
    }
  }

  cacheResult(result: SkillGapResult, isTemporary = false): void {
    if (isTemporary || result.cacheMetadata?.temporary) return;
    const key = this.buildResultCacheKey(result);
    if (!key) return;

    const indexKey = this.buildIndexKey(result.username, result.careerStack, result.experienceLevel);
    localStorage.setItem(indexKey, key);
    localStorage.setItem(key, JSON.stringify({ cachedAt: Date.now(), result }));
  }

  private buildIndexKey(username: string, careerStack: string, experienceLevel: string): string {
    const userId = this.auth.getCurrentUser()?._id || 'anonymous';
    return `${SKILL_GAP_CACHE_INDEX_PREFIX}${userId}:${String(username || '').toLowerCase()}:${careerStack}:${experienceLevel}`;
  }

  private buildResultCacheKey(result: SkillGapResult): string {
    const userId = this.auth.getCurrentUser()?._id || 'anonymous';
    const meta = result.cacheMetadata?.cacheKey || {};
    const githubUsername = meta.githubUsername || result.username || 'no-github';
    const careerStack = meta.careerStack || result.careerStack || 'Full Stack';
    const experienceLevel = meta.experienceLevel || result.experienceLevel || 'Student';
    const resumeHash = meta.resumeHash || 'no-resume';
    const resumeId = meta.resumeAnalysisId || 'no-resume';
    const signalHash = meta.signalHash || result.cacheMetadata?.signalHash || 'no-signals';
    const version = meta.analysisVersion || result.cacheMetadata?.analysisVersion || 'unknown';
    return `${SKILL_GAP_CACHE_PREFIX}${userId}:${githubUsername}:${resumeId}:${resumeHash}:${careerStack}:${experienceLevel}:${signalHash}:${version}`;
  }
}
