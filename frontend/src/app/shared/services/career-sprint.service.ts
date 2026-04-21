import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

export type TaskPriority = 'high' | 'medium' | 'low';
export type TaskCategory = 'learning' | 'project' | 'practice';
export type TaskType     = 'ai' | 'manual';
export type StreakStatus = 'active' | 'warning' | 'broken';

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
  dueDate?: string | null;
  deadline?: string | null;
}

export interface CareerSprint {
  _id: string;
  title: string;
  weekStartDate: string;
  weekEndDate: string;
  weeklyGoal: number;
  streak: number;
  longestStreak: number;
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
}

export interface GenerateAiTasksPayload {
  stack?: string;
  technology?: string;
  experienceLevel?: string;
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
}
