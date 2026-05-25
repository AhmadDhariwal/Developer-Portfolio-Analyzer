import { Injectable } from '@angular/core';
import { forkJoin, map, Observable } from 'rxjs';
import { ApiService } from './api.service';

export interface WeeklyReportDataSourceStatus {
  connected?: boolean;
  analyzed?: boolean;
  available?: boolean;
  lastAnalyzedAt: string | null;
  status: string;
}

export interface WeeklyReport {
  _id: string;
  weekStartDate: string;
  weekEndDate: string;
  score: number;
  progressSummary: string;
  insights: string[];
  recommendations: string[];
  topAchievements: string[];
  biggestRiskArea: string;
  predictedHiringReadiness: { score: number; reason: string };
  reportText: string;
  emailStatus: 'sent' | 'skipped' | 'failed';
  emailedAt: string | null;
  emailError: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  meta: {
    githubScore: number;
    resumeScore: number;
    skillFocus: string[];
    activity: {
      repositoriesTracked: number;
      activeRepositories: number;
      commits: number;
      weeklyCommitSignal: number;
      stars: number;
      forks: number;
    };
    sprint: {
      tasksCompleted: number;
      tasksTotal: number;
      completionRate: number;
      weeklyGoal: number;
      streak: number;
    };
    interview: {
      sessions: number;
      questionsGenerated: number;
    };
    comparisons: {
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
    dataSourcesUsed: {
      github: WeeklyReportDataSourceStatus;
      resume: WeeklyReportDataSourceStatus;
      skillGap: WeeklyReportDataSourceStatus;
      recommendations: WeeklyReportDataSourceStatus;
      careerSprint: WeeklyReportDataSourceStatus;
      interviewPrep: WeeklyReportDataSourceStatus;
      portfolio: WeeklyReportDataSourceStatus;
      integrations: WeeklyReportDataSourceStatus;
    };
  };
}

export interface WeeklyReportDashboard {
  latest: WeeklyReport | null;
  history: WeeklyReport[];
}

@Injectable({
  providedIn: 'root'
})
export class WeeklyReportService {
  constructor(private readonly api: ApiService) {}

  generateReport(forceRefresh = true): Observable<WeeklyReport> {
    return this.api.generateWeeklyReport(forceRefresh).pipe(map((report) => this.normalizeReport(report)));
  }

  getLatest(): Observable<WeeklyReport | null> {
    return this.api.getWeeklyReportLatest().pipe(
      map((report) => (report ? this.normalizeReport(report) : null))
    );
  }

  getHistory(limit = 6): Observable<{ reports: WeeklyReport[] }> {
    return this.api.getWeeklyReportHistory(limit).pipe(
      map((response) => ({
        reports: Array.isArray(response?.reports) ? response.reports.map((report: unknown) => this.normalizeReport(report)) : []
      }))
    );
  }

  getDashboard(limit = 6): Observable<WeeklyReportDashboard> {
    return forkJoin({
      latest: this.getLatest(),
      history: this.getHistory(limit)
    }).pipe(
      map(({ latest, history }) => ({
        latest,
        history: history.reports
      }))
    );
  }

  private normalizeReport(raw: any): WeeklyReport {
    const comparisons = raw?.meta?.comparisons || {};
    const dataSources = raw?.meta?.dataSourcesUsed || {};

    return {
      _id: String(raw?._id || ''),
      weekStartDate: String(raw?.weekStartDate || ''),
      weekEndDate: String(raw?.weekEndDate || ''),
      score: this.clamp(raw?.score),
      progressSummary: String(raw?.progressSummary || 'Weekly insights are being prepared.'),
      insights: this.normalizeStrings(raw?.insights, 6),
      recommendations: this.normalizeStrings(raw?.recommendations, 6),
      topAchievements: this.normalizeStrings(raw?.topAchievements, 4),
      biggestRiskArea: String(raw?.biggestRiskArea || 'No major risk identified for this period.'),
      predictedHiringReadiness: {
        score: this.clamp(raw?.predictedHiringReadiness?.score),
        reason: String(
          raw?.predictedHiringReadiness?.reason || 'Hiring readiness remains stable based on the available weekly signals.'
        )
      },
      reportText: String(raw?.reportText || ''),
      emailStatus: ['sent', 'skipped', 'failed'].includes(String(raw?.emailStatus || ''))
        ? raw.emailStatus
        : 'skipped',
      emailedAt: raw?.emailedAt || null,
      emailError: String(raw?.emailError || ''),
      createdAt: raw?.createdAt || null,
      updatedAt: raw?.updatedAt || null,
      meta: {
        githubScore: this.clamp(raw?.meta?.githubScore),
        resumeScore: this.clamp(raw?.meta?.resumeScore),
        skillFocus: this.normalizeStrings(raw?.meta?.skillFocus, 8),
        activity: {
          repositoriesTracked: this.number(raw?.meta?.activity?.repositoriesTracked),
          activeRepositories: this.number(raw?.meta?.activity?.activeRepositories),
          commits: this.number(raw?.meta?.activity?.commits),
          weeklyCommitSignal: this.number(raw?.meta?.activity?.weeklyCommitSignal),
          stars: this.number(raw?.meta?.activity?.stars),
          forks: this.number(raw?.meta?.activity?.forks)
        },
        sprint: {
          tasksCompleted: this.number(raw?.meta?.sprint?.tasksCompleted),
          tasksTotal: this.number(raw?.meta?.sprint?.tasksTotal),
          completionRate: this.clamp(raw?.meta?.sprint?.completionRate),
          weeklyGoal: this.number(raw?.meta?.sprint?.weeklyGoal),
          streak: this.number(raw?.meta?.sprint?.streak)
        },
        interview: {
          sessions: this.number(raw?.meta?.interview?.sessions),
          questionsGenerated: this.number(raw?.meta?.interview?.questionsGenerated)
        },
        comparisons: {
          scoreDelta: this.number(comparisons.scoreDelta),
          readinessDelta: this.number(comparisons.readinessDelta),
          githubDelta: this.number(comparisons.githubDelta),
          resumeDelta: this.number(comparisons.resumeDelta),
          sprintCompletionDelta: this.number(comparisons.sprintCompletionDelta),
          tasksCompletedDelta: this.number(comparisons.tasksCompletedDelta),
          interviewSessionsDelta: this.number(comparisons.interviewSessionsDelta),
          interviewQuestionsDelta: this.number(comparisons.interviewQuestionsDelta),
          activityCommitsDelta: this.number(comparisons.activityCommitsDelta),
          activeReposDelta: this.number(comparisons.activeReposDelta),
          missingSkillsDelta: this.number(comparisons.missingSkillsDelta),
          coverageDelta: this.number(comparisons.coverageDelta)
        },
        dataSourcesUsed: {
          github: this.normalizeSourceStatus(dataSources.github, false, true),
          resume: this.normalizeSourceStatus(dataSources.resume, true, false),
          skillGap: this.normalizeSourceStatus(dataSources.skillGap, true, false),
          recommendations: this.normalizeSourceStatus(dataSources.recommendations, false, false),
          careerSprint: this.normalizeSourceStatus(dataSources.careerSprint, false, true),
          interviewPrep: this.normalizeSourceStatus(dataSources.interviewPrep, true, false),
          portfolio: this.normalizeSourceStatus(dataSources.portfolio, false, true),
          integrations: this.normalizeSourceStatus(dataSources.integrations, false, true)
        }
      }
    };
  }

  private normalizeSourceStatus(raw: any, analyzed = false, connected = false): WeeklyReportDataSourceStatus {
    return {
      connected: connected ? Boolean(raw?.connected) : undefined,
      analyzed: analyzed ? Boolean(raw?.analyzed) : undefined,
      available: !analyzed && !connected ? Boolean(raw?.available) : undefined,
      lastAnalyzedAt: raw?.lastAnalyzedAt || null,
      status: String(raw?.status || 'Unavailable')
    };
  }

  private normalizeStrings(values: any, limit: number): string[] {
    if (!Array.isArray(values)) return [];
    return values
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .slice(0, limit);
  }

  private clamp(value: any): number {
    const numeric = Number(value || 0);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, Math.min(100, Math.round(numeric)));
  }

  private number(value: any): number {
    const numeric = Number(value || 0);
    return Number.isFinite(numeric) ? numeric : 0;
  }
}
