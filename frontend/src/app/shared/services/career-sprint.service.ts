import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

export interface SprintTask {
  _id: string;
  title: string;
  description: string;
  points: number;
  isCompleted: boolean;
  completedAt?: string | null;
  dueDate?: string | null;
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
  tasks: SprintTask[];
}

@Injectable({
  providedIn: 'root'
})
export class CareerSprintService {
  constructor(private readonly api: ApiService) {}

  getCurrent(): Observable<CareerSprint> {
    return this.api.getCurrentCareerSprint();
  }

  create(payload: { title?: string; weeklyGoal?: number; tasks?: Array<{ title: string; description?: string; points?: number }> }): Observable<CareerSprint> {
    return this.api.createCareerSprint(payload);
  }

  addTask(sprintId: string, payload: { title: string; description?: string; points?: number }): Observable<CareerSprint> {
    return this.api.addCareerSprintTask(sprintId, payload);
  }

  toggleTask(sprintId: string, taskId: string, isCompleted: boolean): Observable<CareerSprint> {
    return this.api.updateCareerSprintTask(sprintId, taskId, isCompleted);
  }

  getHistory(limit = 6): Observable<{ history: CareerSprint[] }> {
    return this.api.getCareerSprintHistory(limit);
  }
}
