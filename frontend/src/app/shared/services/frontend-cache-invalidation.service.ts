import { Injectable, OnDestroy } from '@angular/core';
import { FrontendAnalysisCacheService } from './frontend-analysis-cache.service';

type CacheOwner =
  | 'github'
  | 'resume'
  | 'skill-gap'
  | 'recommendations'
  | 'scenario'
  | 'news'
  | 'jobs'
  | 'courses'
  | 'public-portfolio'
  | 'career-sprint'
  | 'weekly-reports'
  | 'profile'
  | 'career-profile'
  | 'interview-prep'
  | 'notifications'
  | 'support'
  | 'saved-previews'
  | 'organizations';

@Injectable({ providedIn: 'root' })
export class FrontendCacheInvalidationService implements OnDestroy {
  private readonly clearCallbacks = new Map<CacheOwner, () => void>();
  private readonly revisionKey = 'devinsight_developer_revision';
  private readonly onStorage = (event: StorageEvent): void => {
    if (event.key !== this.revisionKey || !event.newValue) return;
    try {
      const revision = JSON.parse(event.newValue);
      if (!revision.owner || revision.owner !== this.currentOwner()) return;
      if (revision.scope === 'dashboard') {
        this.clearDashboardCaches(false);
        return;
      }
      this.clearDeveloperSignalCaches(false);
    } catch {
      /* Invalid storage events cannot invalidate another account. */
    }
  };

  constructor(private readonly frontendCache: FrontendAnalysisCacheService) {
    globalThis.addEventListener?.('storage', this.onStorage);
  }

  ngOnDestroy(): void {
    globalThis.removeEventListener?.('storage', this.onStorage);
  }

  private currentOwner(): string {
    try {
      const user = JSON.parse(localStorage.getItem('user') || 'null');
      return user?._id
        ? `${user._id}:${localStorage.getItem('devinsight_tenant_context') || ''}`
        : '';
    } catch {
      return '';
    }
  }

  register(owner: CacheOwner, clear: () => void): void {
    this.clearCallbacks.set(owner, clear);
  }

  clearAllUserCaches(): void {
    [
      'devinsight_profile_cache',
      'devinsight_career_profile',
      'devinsight_news_signal_hash',
      'devinsight_news_bookmarks',
      'devinsight_news_read_later',
    ].forEach((key) => localStorage.removeItem(key));
    this.removeStoragePrefixes([
      'resume_analysis_cache:',
      'skill_gap_cache:',
      'skill_gap_cache_index:',
      'frontend_analysis_cache:',
      'frontend_analysis_cache_index:',
      'frontend_analysis_cache_signal_index:',
      'frontend_analysis_current_signal:',
      // Account-scoped Jobs activity must survive logout until explicit migration.
    ]);
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
    this.run('organizations');
  }

  clearProfileCache(): void {
    this.run('profile');
  }

  clearDeveloperSignalCaches(broadcast = true): void {
    this.frontendCache.clearCurrentSignalHash();
    this.frontendCache.clearModule('developer-signals');
    this.clearSkillGapCaches();
    this.clearRecommendationsCaches();
    this.clearScenarioCaches();
    this.clearNewsCaches();
    this.clearJobsCaches();
    this.clearCoursesCaches();
    this.clearDashboardCaches(broadcast, 'sources');
    this.clearWeeklyReportCaches();
    this.clearCareerSprintCaches();
    this.run('interview-prep');
  }

  clearGithubCaches(): void {
    this.run('github');
  }
  clearResumeCaches(): void {
    this.run('resume');
  }

  clearDashboardCaches(broadcast = true, scope: 'dashboard' | 'sources' = 'dashboard'): void {
    [
      'dashboardSummary',
      'dashboardContributions',
      'dashboardLanguages',
      'dashboardSkills',
      'dashboardRecommendations',
      'dashboardIntegrationAnalytics',
    ].forEach((module) => this.frontendCache.clearModule(module));
    const owner = this.currentOwner();
    if (broadcast && owner) {
      try {
        localStorage.setItem(
          this.revisionKey,
          JSON.stringify({ owner, scope, revision: crypto.randomUUID() }),
        );
      } catch {
        /* Same-tab invalidation remains available when storage is denied. */
      }
    }
    globalThis.dispatchEvent?.(
      new CustomEvent('devinsight:developer-data-changed', { detail: { scope } }),
    );
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

  clearScenarioCaches(): void {
    this.run('scenario');
  }

  clearNewsCaches(): void {
    ['news', 'news-feed', 'news-saved'].forEach((module) => this.frontendCache.clearModule(module));
    this.run('news');
  }

  clearJobsCaches(): void {
    this.run('jobs');
  }
  clearCoursesCaches(): void {
    this.run('courses');
  }
  clearPublicPortfolioCaches(): void {
    this.run('public-portfolio');
  }
  clearCareerSprintCaches(): void {
    this.run('career-sprint');
  }
  clearSupportCaches(): void {
    this.run('support');
  }

  clearWeeklyReportCaches(): void {
    ['weeklyReports', 'weeklyReports:latest', 'weeklyReports:history'].forEach((module) =>
      this.frontendCache.clearModule(module),
    );
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
