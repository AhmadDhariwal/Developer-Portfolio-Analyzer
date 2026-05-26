import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

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
  constructor(private readonly api: ApiService) {}

  getCurrent(): Observable<CareerSprint> {
    return this.api.getCurrentCareerSprint();
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
    return this.api.createCareerSprint(payload);
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
    return this.api.addCareerSprintTask(sprintId, payload);
  }

  toggleTask(sprintId: string, taskId: string, isCompleted: boolean): Observable<CareerSprint> {
    return this.api.updateCareerSprintTask(sprintId, taskId, isCompleted);
  }

  getHistory(limit = 6): Observable<{ history: CareerSprint[] }> {
    return this.api.getCareerSprintHistory(limit);
  }

  restoreStreak(sprintId: string): Observable<CareerSprint> {
    return this.api.restoreCareerStreak(sprintId);
  }

  generateAiTasks(payload: GenerateAiTasksPayload): Observable<GenerateAiTasksResponse> {
    return this.api.generateAiTasks(payload);
  }

  generateTrueAiPlan(payload: GenerateAiTasksPayload): Observable<GenerateAiTasksResponse> {
    return this.api.generateCareerSprintAiPlan(payload);
  }

  saveAiPlan(sprintId: string, payload: Record<string, unknown>): Observable<CareerSprint> {
    return this.api.saveCareerSprintAiPlan(sprintId, payload);
  }

  importScenarioPlan(sprintId: string, scenarioId?: string): Observable<CareerSprint> {
    return this.api.importCareerSprintScenarioPlan(sprintId, scenarioId);
  }

  updateSprintDates(sprintId: string, sprintStartDate: string, sprintEndDate: string): Observable<CareerSprint> {
    return this.api.updateSprintDates(sprintId, sprintStartDate, sprintEndDate);
  }
}
