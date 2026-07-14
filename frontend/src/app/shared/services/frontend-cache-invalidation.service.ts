import { Injectable } from '@angular/core';
import { FrontendAnalysisCacheService } from './frontend-analysis-cache.service';

type CacheOwner =
  | 'github' | 'resume' | 'skill-gap' | 'recommendations' | 'scenario'
  | 'news' | 'jobs' | 'courses' | 'public-portfolio' | 'career-sprint'
  | 'weekly-reports' | 'profile' | 'career-profile' | 'interview-prep' | 'notifications' | 'support' | 'saved-previews';

@Injectable({ providedIn: 'root' })
export class FrontendCacheInvalidationService {
  private readonly clearCallbacks = new Map<CacheOwner, () => void>();

  constructor(private readonly frontendCache: FrontendAnalysisCacheService) {}

  register(owner: CacheOwner, clear: () => void): void {
    this.clearCallbacks.set(owner, clear);
  }

  clearAllUserCaches(): void {
    ['devinsight_profile_cache', 'devinsight_career_profile', 'devinsight_news_signal_hash',
      'devinsight_news_bookmarks', 'devinsight_news_read_later']
      .forEach((key) => localStorage.removeItem(key));
    this.removeStoragePrefixes(['resume_analysis_cache:', 'skill_gap_cache:', 'skill_gap_cache_index:']);
    this.clearGithubCaches();
    this.clearResumeCaches();
    this.clearDeveloperSignalCaches();
    this.clearCareerSprintCaches();
    this.clearWeeklyReportCaches();
    this.clearPublicPortfolioCaches();
    this.run('notifications');
    this.run('interview-prep');
    this.run('profile');
    this.run('career-profile');
    this.run('support');
    this.run('saved-previews');
  }

  clearDeveloperSignalCaches(): void {
    this.frontendCache.clearCurrentSignalHash();
    this.frontendCache.clearModule('developer-signals');
    this.clearSkillGapCaches();
    this.clearRecommendationsCaches();
    this.clearScenarioCaches();
    this.clearNewsCaches();
    this.clearJobsCaches();
    this.clearCoursesCaches();
    this.clearDashboardCaches();
    this.clearWeeklyReportCaches();
    this.clearCareerSprintCaches();
  }

  clearGithubCaches(): void { this.run('github'); }
  clearResumeCaches(): void { this.run('resume'); }

  clearDashboardCaches(): void {
    [
      'dashboardSummary', 'dashboardContributions', 'dashboardLanguages',
      'dashboardSkills', 'dashboardRecommendations', 'dashboardIntegrationAnalytics'
    ].forEach((module) => this.frontendCache.clearModule(module));
  }

  clearSkillGapCaches(): void {
    this.frontendCache.clearModule('skillGap');
    this.frontendCache.clearPrefixes(['skill_gap_cache:', 'skill_gap_cache_index:']);
    this.run('skill-gap');
  }

  clearRecommendationsCaches(): void {
    this.frontendCache.clearModule('recommendations');
    this.run('recommendations');
  }

  clearScenarioCaches(): void { this.run('scenario'); }

  clearNewsCaches(): void {
    ['news', 'news-feed', 'news-saved'].forEach((module) => this.frontendCache.clearModule(module));
    this.run('news');
  }

  clearJobsCaches(): void { this.run('jobs'); }
  clearCoursesCaches(): void { this.run('courses'); }
  clearPublicPortfolioCaches(): void { this.run('public-portfolio'); }
  clearCareerSprintCaches(): void { this.run('career-sprint'); }
  clearSupportCaches(): void { this.run('support'); }

  clearWeeklyReportCaches(): void {
    ['weeklyReports', 'weeklyReports:latest', 'weeklyReports:history']
      .forEach((module) => this.frontendCache.clearModule(module));
    this.run('weekly-reports');
  }

  private removeStoragePrefixes(prefixes: string[]): void {
    Object.keys(localStorage)
      .filter((key) => prefixes.some((prefix) => key.startsWith(prefix)))
      .forEach((key) => localStorage.removeItem(key));
  }

  private run(owner: CacheOwner): void {
    this.clearCallbacks.get(owner)?.();
  }
}
