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
  topAchievements?: string[];
  biggestRiskArea?: string;
  predictedHiringReadiness?: { score: number; reason: string };
  reportText: string;
  meta?: {
    githubScore: number;
    resumeScore: number;
    skillFocus: string[];
    activity?: {
      repositoriesTracked: number;
      activeRepositories: number;
      commits: number;
      weeklyCommitSignal: number;
      stars: number;
      forks: number;
    };
    sprint?: {
      tasksCompleted: number;
      tasksTotal: number;
      completionRate: number;
      weeklyGoal: number;
      streak: number;
    };
    interview?: {
      sessions: number;
      questionsGenerated: number;
    };
    comparisons?: {
      scoreDelta: number;
      readinessDelta: number;
      githubDelta: number;
      resumeDelta: number;
      sprintCompletionDelta: number;
      tasksCompletedDelta: number;
      interviewSessionsDelta: number;
      interviewQuestionsDelta: number;
      activityCommitsDelta: number;
      activeReposDelta: number;
      missingSkillsDelta: number;
      coverageDelta: number;
    };
  };
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
