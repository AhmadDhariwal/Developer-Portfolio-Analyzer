import { Injectable } from '@angular/core';
import { finalize, Observable, of, shareReplay, tap } from 'rxjs';
import { ApiService } from './api.service';
import { FrontendCacheInvalidationService } from './frontend-cache-invalidation.service';

export type TaskPriority = 'high' | 'medium' | 'low';
export type TaskCategory = 'learning' | 'project' | 'practice';
export type TaskType = 'ai' | 'manual';
export type StreakStatus = 'active' | 'warning' | 'broken';
export type PlannerFilter = 'all' | 'sprint' | 'today' | 'week' | 'overdue' | 'custom';

export interface SprintTask {
  _id?: string;
  title: string;
  description: string;
  points: number;
  priority: TaskPriority;
  category: TaskCategory;
  taskType: TaskType;
  isCompleted: boolean;
  completedAt?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  dueDate?: string | null;
  deadline?: string | null;
}

export interface AiPlanDraft {
  _id: string;
  name: string;
  source: 'ai' | 'scenario';
  generatorType?: 'deterministic' | 'llm' | 'scenario';
  goalStack?: string;
  goalTechnology?: string;
  goalExperienceLevel?: string;
  summary: string;
  confidenceScore: number;
  consistencyScore: number;
  signalsUsed: string[];
  tasks: SprintTask[];
  createdAt: string;
}

export interface SprintAnalytics {
  totalTasks: number;
  completedTasks: number;
  pendingTasks: number;
  overdueTasks: number;
  totalPoints: number;
  completedPoints: number;
  progressPercent: number;
  consistencyScore: number;
  productivityScore: number;
  activeWindowDays: number;
  aiTaskCount: number;
  manualTaskCount: number;
  completedInLastSevenDays: number;
  dailyActivity: Array<{ date: string; count: number; active: boolean }>;
}

export interface SprintComparison {
  progressDelta: number;
  completedTasksDelta: number;
  streakDelta: number;
  xpDelta: number;
}

export interface SprintRestoreMeta {
  canRestore: boolean;
  remainingRestoreDays: number;
  reason: string;
}

export interface SprintSignalsUsed {
  careerSprint: {
    consistencyScore: number;
    activeLearningFocus: string;
    streak: number;
  };
  weeklyReport: {
    status: string;
    weeklyProgressScore: number;
    repeatedWeakAreas: string[];
  };
  portfolio: {
    completenessScore: number;
    projectPresentationQuality: number;
  };
  integrations: {
    usedProviders: string[];
    strongestProof: string[];
  };
}

export interface CareerSprint {
  _id: string;
  title: string;
  sprintStartDate?: string | null;
  sprintEndDate?: string | null;
  weekStartDate: string;
  weekEndDate: string;
  weeklyGoal: number;
  currentStreak: number;
  longestStreak: number;
  lastActiveDate?: string | null;
  streak: number;
  lastCompletedWeekAt?: string | null;
  streakBroken?: boolean;
  streakBrokenAt?: string | null;
  streakWarning?: boolean;
  streakStatus?: StreakStatus;
  xpPoints: number;
  level: number;
  goalStack?: string;
  goalTechnology?: string;
  goalTitle?: string;
  goalExperienceLevel?: string;
  tasks: SprintTask[];
  aiPlans?: AiPlanDraft[];
  analytics?: SprintAnalytics;
  comparison?: SprintComparison;
  restoreMeta?: SprintRestoreMeta;
  signalsUsed?: SprintSignalsUsed;
  insights?: string[];
  summary?: {
    progressPercent: number;
    completedTasks: number;
    totalTasks: number;
    overdueTasks: number;
    consistencyScore: number;
  };
  _canRestore?: boolean;
}

export interface GenerateAiTasksPayload {
  stack?: string;
  technology?: string;
  experienceLevel?: string;
  sprintStartDate?: string;
  sprintEndDate?: string;
}

interface SprintCacheEntry<T> {
  value: T;
  expiresAt: number;
}

export interface GenerateAiTasksResponse {
  tasks: SprintTask[];
  planMeta: {
    summary: string;
    confidenceScore: number;
    consistencyScore: number;
    signalsUsed: string[];
    generationMode?: 'deterministic' | 'llm';
    providerLabel?: string;
  };
}

@Injectable({ providedIn: 'root' })
export class CareerSprintService {
  private readonly cacheTtlMs = 12 * 60 * 1000;
  private readonly maxCacheEntries = 50;
  private readonly inflight = new Map<string, Observable<any>>();
  private readonly cache = new Map<string, SprintCacheEntry<unknown>>();
  private readonly activeSprintByProfile = new Map<string, string>();

  constructor(private readonly api: ApiService, private readonly cacheInvalidation: FrontendCacheInvalidationService) {
    this.cacheInvalidation.register('career-sprint', () => this.clearCache());
  }

  clearCache(): void {
    this.cache.clear();
    this.activeSprintByProfile.clear();
    this.inflight.clear();
  }

  private profileKey(profileSignature = ''): string {
    return profileSignature.trim() || 'anonymous-profile';
  }

  private currentKey(profileSignature = '', activeSprintId = ''): string {
    const profile = this.profileKey(profileSignature);
    const active = activeSprintId || this.activeSprintByProfile.get(profile) || 'active';
    return `current:${profile}:${active}`;
  }

  private historyKey(profileSignature = '', limit = 6): string {
    return `history:${this.profileKey(profileSignature)}:${limit}`;
  }

  private readCache<T>(key: string): T | null {
    const entry = this.cache.get(key) as SprintCacheEntry<T> | undefined;
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.cache.delete(key);
      return null;
    }
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  private writeCache<T>(key: string, value: T): void {
    this.cache.delete(key);
    this.cache.set(key, { value, expiresAt: Date.now() + this.cacheTtlMs });
    while (this.cache.size > this.maxCacheEntries) {
      const oldestKey = this.cache.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.cache.delete(oldestKey);
    }
  }

  private dedupe<T>(key: string, source$: Observable<T>): Observable<T> {
    const existing = this.inflight.get(key) as Observable<T> | undefined;
    if (existing) return existing;
    const shared$ = source$.pipe(
      shareReplay({ bufferSize: 1, refCount: false }),
      finalize(() => this.inflight.delete(key))
    );
    this.inflight.set(key, shared$);
    return shared$;
  }

  getCurrent(profileSignature = '', activeSprintId = '', forceRefresh = false): Observable<CareerSprint> {
    const profile = this.profileKey(profileSignature);
    const key = this.currentKey(profile, activeSprintId);
    const cached = forceRefresh ? null : this.readCache<CareerSprint>(key);
    if (cached) return of(cached);

    const source$ = this.api.getCurrentCareerSprint(forceRefresh).pipe(
      tap((sprint: CareerSprint) => {
        const sprintId = sprint?._id || activeSprintId;
        if (sprintId) this.activeSprintByProfile.set(profile, sprintId);
        this.writeCache(this.currentKey(profile, sprintId), sprint);
        this.writeCache(this.currentKey(profile, 'active'), sprint);
      })
    );
    return forceRefresh ? source$ : this.dedupe(key, source$);
  }

  getCurrentCached(profileSignature = '', activeSprintId = ''): CareerSprint | null {
    return this.readCache<CareerSprint>(this.currentKey(profileSignature, activeSprintId));
  }

  invalidateCurrentCache(): void {
    Array.from(this.cache.keys()).filter((key) => key.startsWith('current:')).forEach((key) => this.cache.delete(key));
  }

  invalidateHistoryCache(): void {
    Array.from(this.cache.keys()).filter((key) => key.startsWith('history:')).forEach((key) => this.cache.delete(key));
  }

  create(payload: {
    title?: string;
    weeklyGoal?: number;
    tasks?: Array<{ title: string; description?: string; points?: number; priority?: string; category?: string; taskType?: string }>;
    goalStack?: string;
    goalTechnology?: string;
    goalTitle?: string;
    goalExperienceLevel?: string;
    sprintStartDate?: string;
    sprintEndDate?: string;
  }): Observable<CareerSprint> {
    return this.api.createCareerSprint(payload).pipe(tap(() => this.invalidateMutationCaches()));
  }

  addTask(sprintId: string, payload: {
    title: string;
    description?: string;
    points?: number;
    priority?: TaskPriority;
    category?: TaskCategory;
    taskType?: TaskType;
    startDate?: string;
    endDate?: string;
  }): Observable<CareerSprint> {
    return this.api.addCareerSprintTask(sprintId, payload).pipe(tap(() => this.invalidateMutationCaches()));
  }

  toggleTask(sprintId: string, taskId: string, isCompleted: boolean): Observable<CareerSprint> {
    return this.api.updateCareerSprintTask(sprintId, taskId, isCompleted).pipe(tap(() => this.invalidateMutationCaches()));
  }

  getHistory(limit = 6, profileSignature = '', forceRefresh = false): Observable<{ history: CareerSprint[] }> {
    const key = this.historyKey(profileSignature, limit);
    const cached = forceRefresh ? null : this.readCache<{ history: CareerSprint[] }>(key);
    if (cached) return of(cached);
    const source$ = this.api.getCareerSprintHistory(limit).pipe(
      tap((data) => this.writeCache(key, { history: data.history || [] }))
    );
    return forceRefresh ? source$ : this.dedupe(key, source$);
  }

  getHistoryCached(limit = 6, profileSignature = ''): CareerSprint[] | null {
    const cached = this.readCache<{ history: CareerSprint[] }>(this.historyKey(profileSignature, limit));
    return cached ? [...cached.history] : null;
  }

  restoreStreak(sprintId: string): Observable<CareerSprint> {
    return this.api.restoreCareerStreak(sprintId).pipe(tap(() => this.invalidateMutationCaches()));
  }

  generateAiTasks(payload: GenerateAiTasksPayload): Observable<GenerateAiTasksResponse> {
    return this.api.generateAiTasks(payload);
  }

  generateTrueAiPlan(payload: GenerateAiTasksPayload): Observable<GenerateAiTasksResponse> {
    return this.api.generateCareerSprintAiPlan(payload);
  }

  saveAiPlan(sprintId: string, payload: Record<string, unknown>): Observable<CareerSprint> {
    return this.api.saveCareerSprintAiPlan(sprintId, payload).pipe(tap(() => this.invalidateMutationCaches()));
  }

  importScenarioPlan(sprintId: string, scenarioId?: string): Observable<CareerSprint> {
    return this.api.importCareerSprintScenarioPlan(sprintId, scenarioId).pipe(tap(() => this.invalidateMutationCaches()));
  }

  private invalidateMutationCaches(): void {
    this.cacheInvalidation.clearCareerSprintCaches();
    this.cacheInvalidation.clearScenarioCaches();
    this.cacheInvalidation.clearDashboardCaches();
    this.cacheInvalidation.clearRecommendationsCaches();
    this.cacheInvalidation.clearSkillGapCaches();
    this.cacheInvalidation.clearWeeklyReportCaches();
    this.cacheInvalidation.clearNewsCaches();
    this.cacheInvalidation.clearCoursesCaches();
  }

  updateSprintDates(sprintId: string, sprintStartDate: string, sprintEndDate: string): Observable<CareerSprint> {
    return this.api.updateSprintDates(sprintId, sprintStartDate, sprintEndDate).pipe(tap(() => this.invalidateMutationCaches()));
  }
}
