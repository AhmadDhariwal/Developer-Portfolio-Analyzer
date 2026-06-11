import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { finalize, shareReplay } from 'rxjs/operators';

export interface RecommendedProject {
  id:             string;
  title:          string;
  description:    string;
  tech:           string[];
  newTech:        string[];   // subset of tech[] that are new to the user
  difficulty:     'Beginner' | 'Intermediate' | 'Advanced';
  estimatedWeeks: string;
  impact:         number;
  whyThisProject: string;     // explanation of level fit
  triggerSkills:  string[];
  startUrl?:      string;
  priority?: string;
  confidenceScore?: number;
  reason?: string;
  evidence?: string[];
  sourceSignalsUsed?: string[];
  estimatedImpact?: number;
  estimatedEffort?: string;
}

export interface RecommendedTechnology {
  name:        string;
  category:    string;
  priority:    string;
  priorityRaw: 'High' | 'Medium' | 'Low';
  jobDemand:   number;
  description: string;
  confidenceScore?: number;
  reason?: string;
  evidence?: string[];
  sourceSignalsUsed?: string[];
  estimatedImpact?: number;
  estimatedEffort?: string;
}

export interface CareerPath {
  id:              string;
  title:           string;
  salaryRange:     string;
  timeline:        string;
  description:     string;
  hiringCompanies: string[];
  actionItems:     string[];
  boostSkills:     string[];
  match:           number;
  exploreUrl?:     string;
  priority?: string;
  confidenceScore?: number;
  reason?: string;
  evidence?: string[];
  sourceSignalsUsed?: string[];
  estimatedImpact?: number;
  estimatedEffort?: string;
}

export interface RecommendationCard {
  id: string;
  category: string;
  title: string;
  description: string;
  priority: 'High' | 'Medium' | 'Low' | string;
  confidenceScore: number;
  reason: string;
  evidence: string[];
  sourceSignalsUsed: string[];
  estimatedImpact: number;
  estimatedEffort: string;
  actionUrl?: string;
  actionLabel?: string;
}

export interface RecommendationScores {
  readinessScore: number;
  portfolioScore: number;
  learningScore: number;
  interviewScore: number;
  marketReadinessScore: number;
  careerGrowthScore: number;
  overallRecommendationScore: number;
  explanation?: Record<string, string>;
}

export interface RecommendationRoadmap {
  immediateActions: RecommendationCard[];
  next30Days: RecommendationCard[];
  next60Days: RecommendationCard[];
  next90Days: RecommendationCard[];
  longTermGrowth: RecommendationCard[];
  suggestedProjects: RecommendedProject[];
  suggestedCertifications: RecommendationCard[];
  suggestedTechnologies: RecommendedTechnology[];
  suggestedLearningPath: string[];
  timeline?: Array<{ label: string; items: string[] }>;
}

export interface RecommendationCacheMetadata {
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
  recommendationVersion?: string;
  temporary?: boolean;
  ttlHours?: number;
  cachedAt?: string | null;
}

export interface RecommendationSignalsUsed {
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
  skillGap?: {
    present: boolean;
    coverage: number;
    knownSkills: string[];
    missingSkills: string[];
    weakSkills: string[];
    highDemandSkills: Array<{ name: string; demandScore?: number; postings?: number }>;
    updatedAt?: string | null;
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
}

export interface AnalysisBasedOn {
  githubUsername: string;
  resumeAnalyzed: boolean;
  resumeStatus: string;
  careerStack: string;
  experienceLevel: string;
  lastAnalyzedAt?: string | null;
}

export interface RecommendationsResult {
  username:        string;
  careerStack:     string;
  experienceLevel: string;
  projects:        RecommendedProject[];
  technologies:    RecommendedTechnology[];
  careerPaths:     CareerPath[];
  analysisSummary?: string;
  portfolioRecommendations?: string[];
  resumeRecommendations?: string[];
  learningActions?: string[];
  interviewReadinessActions?: string[];
  signalsUsed?: RecommendationSignalsUsed;
  analysisBasedOn?: AnalysisBasedOn;
  resumeStatusMessage?: string;
  claimedButNotProvenSkills?: string[];
  githubSkills?: string[];
  resumeSkills?: string[];
  recommendationScores?: RecommendationScores;
  structuredRecommendations?: Record<string, RecommendationCard[]>;
  roadmap?: RecommendationRoadmap;
  recommendationSignals?: Record<string, unknown>;
  recommendationVersioning?: {
    currentRecommendation?: Record<string, unknown>;
    previousRecommendation?: Record<string, unknown> | null;
    delta?: Record<string, number>;
    newRecommendations?: RecommendationCard[];
    completedRecommendations?: RecommendationCard[];
    obsoleteRecommendations?: RecommendationCard[];
  };
  cacheMetadata?: RecommendationCacheMetadata;
  fromCache?: boolean;
  fromFrontendCache?: boolean;
  cacheState?: 'cache-hit' | 'refreshing' | 'loading' | 'error' | 'empty';
}

@Injectable({ providedIn: 'root' })
export class RecommendationsService {
  private readonly baseUrl = 'http://localhost:5000/api';
  private readonly inflight = new Map<string, Observable<RecommendationsResult>>();

  constructor(private readonly http: HttpClient) {}

  getRecommendations(
    username:        string,
    careerStack:     string,
    experienceLevel: string,
    knownSkills?:    string[],
    missingSkills?:  string[],
    isTemporary = false,
    forceRefresh = false
  ): Observable<RecommendationsResult> {
    const key = [
      username,
      careerStack,
      experienceLevel,
      isTemporary ? 'temporary' : 'saved',
      forceRefresh ? 'refresh' : 'normal',
      (knownSkills || []).join(','),
      (missingSkills || []).join(',')
    ].join(':').toLowerCase();
    const existing = this.inflight.get(key);
    if (existing) return existing;

    const request$ = this.http.post<RecommendationsResult>(
      isTemporary ? `${this.baseUrl}/recommendations/generate` : `${this.baseUrl}/recommendations`,
      isTemporary
        ? { githubUsername: username, careerStack, experienceLevel, knownSkills, missingSkills, isTemporary: true, forceRefresh }
        : { username, careerStack, experienceLevel, knownSkills, missingSkills, forceRefresh }
    ).pipe(
      finalize(() => this.inflight.delete(key)),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.inflight.set(key, request$);
    return request$;
  }
}
