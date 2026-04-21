import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

export type TaskPriority = 'high' | 'medium' | 'low';
export type TaskCategory = 'learning' | 'project' | 'practice';
export type TaskType     = 'ai' | 'manual';
export type StreakStatus = 'active' | 'warning' | 'broken';
export type PlannerFilter = 'all' | 'sprint' | 'today' | 'week' | 'overdue' | 'custom';

export interface SprintTask {
  _id: string;
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

export interface CareerSprint {
  _id: string;
  title: string;
  // Sprint date range (user-selectable)
  sprintStartDate?: string | null;
  sprintEndDate?: string | null;
  // Legacy week fields
  weekStartDate: string;
  weekEndDate: string;
  weeklyGoal: number;
  // Day-based streak
  currentStreak: number;
  longestStreak: number;
  lastActiveDate?: string | null;
  // Legacy
  streak: number;
  lastCompletedWeekAt?: string | null;
  streakBroken?: boolean;
  streakBrokenAt?: string | null;
  streakWarning?: boolean;
  streakStatus?: StreakStatus;
  // XP
  xpPoints: number;
  level: number;
  // Goal
  goalStack?: string;
  goalTechnology?: string;
  goalTitle?: string;
  goalExperienceLevel?: string;
  tasks: SprintTask[];
  // Virtual (set by backend, not persisted)
  _canRestore?: boolean;
}

export interface GenerateAiTasksPayload {
  stack?: string;
  technology?: string;
  experienceLevel?: string;
  sprintStartDate?: string;
  sprintEndDate?: string;
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

  generateAiTasks(payload: GenerateAiTasksPayload): Observable<{ tasks: SprintTask[] }> {
    return this.api.generateAiTasks(payload);
  }

  updateSprintDates(sprintId: string, sprintStartDate: string, sprintEndDate: string): Observable<CareerSprint> {
    return this.api.updateSprintDates(sprintId, sprintStartDate, sprintEndDate);
  }
}
