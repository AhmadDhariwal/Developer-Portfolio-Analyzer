import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

export interface WeeklyReport {
  _id: string;
  weekStartDate: string;
  weekEndDate: string;
  score: number;
  progressSummary: string;
  insights: string[];
  recommendations: string[];
  reportText: string;
  meta?: { githubScore: number; resumeScore: number; skillFocus: string[] };
}

@Injectable({
  providedIn: 'root'
})
export class WeeklyReportService {
  constructor(private readonly api: ApiService) {}

  generateReport(): Observable<WeeklyReport> {
    return this.api.generateWeeklyReport();
  }

  getLatest(): Observable<WeeklyReport | null> {
    return this.api.getWeeklyReportLatest();
  }

  getHistory(limit = 6): Observable<{ reports: WeeklyReport[] }> {
    return this.api.getWeeklyReportHistory(limit);
  }
}
