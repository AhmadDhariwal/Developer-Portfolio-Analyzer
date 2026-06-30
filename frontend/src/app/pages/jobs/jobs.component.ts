import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { distinctUntilChanged } from 'rxjs/operators';
import { JobService } from '../../shared/services/job.service';
import { CareerProfileService } from '../../shared/services/career-profile.service';
import {
  ActiveJobFilterChip,
  DEFAULT_JOB_FILTERS,
  Job,
  JobFilters,
  JobsResponse,
  JobRecommendedBasedOn,
  JobUiState,
  normalizeJobFilters
} from '../../shared/models/job.model';
import { JobCardComponent } from '../../shared/components/job-card/job-card';
import { JobFiltersComponent } from '../../shared/components/job-filters/job-filters';
import { AuthService } from '../../shared/services/auth.service';

const INITIAL_DISPLAY = 10;
const PAGE_SIZE = 10;
const JOB_STATE_STORAGE_KEY = 'devinsight_public_jobs_state';
const MAX_UI_STATE_ENTRIES = 200;
const UI_STATE_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const SOURCE_LABELS: Record<string, string> = {
  jsearch: 'JSearch',
  jooble: 'Jooble',
  adzuna: 'Adzuna',
  remotive: 'Remotive',
  arbeitnow: 'ArbeitNow',
  remoteok: 'RemoteOK'
};

@Component({
  selector: 'app-jobs',
  standalone: true,
  imports: [CommonModule, FormsModule, JobCardComponent, JobFiltersComponent],
  templateUrl: './jobs.component.html',
  styleUrl: './jobs.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class JobsComponent implements OnInit, OnDestroy {
  allJobs: Job[] = [];
  displayCount = INITIAL_DISPLAY;
  isLoading = false;
  isLoadingMore = false;
  errorMessage = '';
  currentPage = 0;
  totalPages = 1;
  totalJobs = 0;
  activeFilters: JobFilters = { ...DEFAULT_JOB_FILTERS };
  pendingFilters: JobFilters = { ...DEFAULT_JOB_FILTERS };
  recommendedBasedOn: JobRecommendedBasedOn | null = null;
  sourceMessage = '';
  primarySource = '';
  sourceSummary: Record<string, number> = {};
  sourceFailures: JobsResponse['sourceFailures'] = [];
  jsearchConfigured = true;
  fromCache = false;
  frontendCached = false;
  isStale = false;
  isMobileFiltersOpen = false;
  isMobileInsightsOpen = false;

  readonly INITIAL_DISPLAY = INITIAL_DISPLAY;
  readonly PAGE_SIZE = PAGE_SIZE;

  private readonly subscriptions = new Subscription();
  private readonly uiStateMap = new Map<string, JobUiState>();
  private requestToken = 0;
  private lastProfileSignature = '';
  private activeRequestKey = '';

  constructor(
    private readonly jobService: JobService,
    private readonly careerProfileService: CareerProfileService,
    private readonly authService: AuthService,
    private readonly cdr: ChangeDetectorRef
  ) {
    this.hydrateUiState();
  }

  get displayedJobs(): Job[] {
    return this.visibleJobs.slice(0, this.displayCount);
  }

  get visibleJobs(): Job[] {
    return this.allJobs.filter((job) => !this.getUiState(job.id).hidden);
  }

  get hasHiddenJobs(): boolean {
    return this.displayCount < this.visibleJobs.length;
  }

  get hasMorePages(): boolean {
    return !this.hasHiddenJobs && this.currentPage > 0 && this.currentPage < this.totalPages;
  }

  get canShowLoadMore(): boolean {
    return !this.isLoading && (this.hasHiddenJobs || this.hasMorePages);
  }

  get hiddenCount(): number {
    return Math.max(0, this.visibleJobs.length - this.displayCount);
  }

  get currentCareerStack(): string {
    return this.careerProfileService.careerStack;
  }

  get currentExperienceLevel(): string {
    return this.careerProfileService.experienceLevel;
  }

  get hasActiveFilters(): boolean {
    return this.activeFilterChips.length > 0;
  }

  get hasPendingFilterChanges(): boolean {
    return JSON.stringify(this.pendingFilters) !== JSON.stringify(this.activeFilters);
  }

  get sourceSummaryItems(): Array<{ label: string; count: number }> {
    return Object.entries(this.sourceSummary || {})
      .map(([label, count]) => ({
        label: SOURCE_LABELS[label] || label,
        count: Number(count || 0)
      }))
      .filter((item) => item.count > 0);
  }

  get sourceFailureItems(): Array<{ label: string; reason: string }> {
    return (this.sourceFailures || [])
      .map((failure) => ({
        label: SOURCE_LABELS[String(failure?.source || '').toLowerCase()] || String(failure?.source || 'Source').trim(),
        reason: String(failure?.reason || failure?.detail || 'failed').trim()
      }))
      .filter((item) => item.label)
      .slice(0, 4);
  }

  get activeFilterChips(): ActiveJobFilterChip[] {
    const filters = this.activeFilters;
    const chips: ActiveJobFilterChip[] = [];

    if (filters.platform !== 'All') chips.push({ key: 'platform', label: 'Platform', value: filters.platform });
    if (filters.location !== 'All') chips.push({ key: 'location', label: 'Location', value: filters.location });
    if (filters.jobType !== 'All') chips.push({ key: 'jobType', label: 'Type', value: filters.jobType });
    if (filters.experienceLevel !== 'All') chips.push({ key: 'experienceLevel', label: 'Exp', value: filters.experienceLevel });
    if (filters.skills) chips.push({ key: 'skills', label: 'Skill', value: filters.skills });

    return chips;
  }

  get recommendationSummary(): string {
    return this.recommendedBasedOn?.summary
      || `Jobs are personalized for your ${this.currentCareerStack} path and ${this.currentExperienceLevel} experience level.`;
  }

  get skeletonItems(): number[] {
    return Array.from({ length: PAGE_SIZE }, (_, index) => index);
  }

  ngOnInit(): void {
    this.pendingFilters = { ...this.activeFilters };
    this.subscriptions.add(
      this.careerProfileService.careerProfile$.pipe(
        distinctUntilChanged(
          (left, right) => left.careerStack === right.careerStack && left.experienceLevel === right.experienceLevel
        )
      ).subscribe((profile) => {
        const nextSignature = `${profile.careerStack}|${profile.experienceLevel}`.toLowerCase();
        if (this.lastProfileSignature && this.lastProfileSignature !== nextSignature) {
          this.jobService.clearCache();
        }
        this.lastProfileSignature = nextSignature;
        this.resetAndFetch();
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  onFiltersChange(filters: JobFilters): void {
    this.pendingFilters = normalizeJobFilters(filters);
    this.cdr.markForCheck();
  }

  applyFilters(): void {
    this.activeFilters = normalizeJobFilters(this.pendingFilters);
    this.isMobileFiltersOpen = false;
    this.resetAndFetch();
  }

  onFiltersReset(): void {
    this.pendingFilters = { ...DEFAULT_JOB_FILTERS };
    this.activeFilters = { ...DEFAULT_JOB_FILTERS };
    this.jobService.clearCache();
    this.resetAndFetch();
  }

  clearFilter(key: keyof JobFilters): void {
    const nextFilters: JobFilters = { ...this.activeFilters };
    if (key === 'platform') nextFilters.platform = DEFAULT_JOB_FILTERS.platform;
    if (key === 'location') nextFilters.location = DEFAULT_JOB_FILTERS.location;
    if (key === 'jobType') nextFilters.jobType = DEFAULT_JOB_FILTERS.jobType;
    if (key === 'experienceLevel') nextFilters.experienceLevel = DEFAULT_JOB_FILTERS.experienceLevel;
    if (key === 'skills') nextFilters.skills = DEFAULT_JOB_FILTERS.skills;
    this.pendingFilters = normalizeJobFilters(nextFilters);
    this.activeFilters = normalizeJobFilters(nextFilters);
    this.resetAndFetch();
  }

  loadMore(): void {
    if (this.isLoadingMore) return;

    if (this.hasHiddenJobs) {
      this.displayCount = this.visibleJobs.length;
      this.cdr.markForCheck();
      return;
    }

    if (this.hasMorePages) {
      this.fetchPage(this.currentPage + 1, true);
    }
  }

  toggleMobileFilters(): void {
    this.isMobileFiltersOpen = !this.isMobileFiltersOpen;
    this.cdr.markForCheck();
  }

  retry(): void {
    this.jobService.clearCache();
    this.resetAndFetch();
  }

  toggleMobileInsights(): void {
    this.isMobileInsightsOpen = !this.isMobileInsightsOpen;
    this.cdr.markForCheck();
  }

  refreshJobs(): void {
    this.jobService.clearCache();
    this.resetAndFetch();
  }

  onSave(job: Job): void {
    const state = this.getUiState(job.id);
    this.setUiState(job.id, { ...state, saved: !state.saved });
  }

  onMarkApplied(job: Job): void {
    const state = this.getUiState(job.id);
    this.setUiState(job.id, { ...state, applied: !state.applied, saved: state.saved || !state.applied });
  }

  onHide(job: Job): void {
    const state = this.getUiState(job.id);
    this.setUiState(job.id, { ...state, hidden: true });
    this.displayCount = Math.min(this.displayCount, this.visibleJobs.length);
    this.cdr.markForCheck();
  }

  onSimilar(job: Job): void {
    const focusSkill = job.skills?.[0] || job.missingSkills?.[0] || '';
    this.pendingFilters = normalizeJobFilters({
      ...this.pendingFilters,
      skills: focusSkill,
      platform: focusSkill ? this.pendingFilters.platform : (job.platform || this.pendingFilters.platform)
    });
    this.applyFilters();
  }

  getUiState(jobId: string): JobUiState {
    return this.uiStateMap.get(jobId) || { saved: false, applied: false, hidden: false };
  }

  trackById(_: number, job: Job): string {
    return job.id;
  }

  private resetAndFetch(): void {
    this.requestToken += 1;
    this.activeRequestKey = '';
    this.allJobs = [];
    this.displayCount = INITIAL_DISPLAY;
    this.currentPage = 0;
    this.totalPages = 1;
    this.totalJobs = 0;
    this.errorMessage = '';
    this.recommendedBasedOn = null;
    this.sourceMessage = '';
    this.primarySource = '';
    this.sourceSummary = {};
    this.sourceFailures = [];
    this.fromCache = false;
    this.frontendCached = false;
    this.isStale = false;
    this.fetchPage(1, false);
  }

  private fetchPage(page: number, append: boolean): void {
    const requestKey = JSON.stringify({ filters: this.activeFilters, page, limit: PAGE_SIZE });
    if (this.activeRequestKey === requestKey) return;
    this.activeRequestKey = requestKey;
    const currentRequest = ++this.requestToken;
    if (append) {
      this.isLoadingMore = true;
    } else {
      this.isLoading = true;
      this.isLoadingMore = false;
    }
    this.errorMessage = '';
    this.cdr.markForCheck();

    this.jobService.getJobs(this.activeFilters, page, PAGE_SIZE).subscribe({
      next: (response) => {
        if (currentRequest !== this.requestToken) return;
        this.activeRequestKey = '';
        this.applyResponse(response, append, page);
      },
      error: (error) => {
        if (currentRequest !== this.requestToken) return;
        this.activeRequestKey = '';
        this.errorMessage = error?.error?.message || 'Failed to load jobs. Please try again.';
        this.isLoading = false;
        this.isLoadingMore = false;
        this.cdr.markForCheck();
      }
    });
  }

  private applyResponse(response: JobsResponse, append: boolean, page: number): void {
    const incoming = Array.isArray(response.jobs) ? response.jobs : [];
    this.allJobs = append ? this.mergeJobs(this.allJobs, incoming) : incoming;
    this.currentPage = response.page ?? page;
    this.totalPages = response.totalPages ?? 1;
    this.totalJobs = response.total ?? this.allJobs.length;
    this.recommendedBasedOn = response.recommendedBasedOn ?? null;
    this.sourceMessage = response.sourceMessage || '';
    this.primarySource = response.primarySource || '';
    this.sourceSummary = response.sourceSummary || {};
    this.sourceFailures = response.sourceFailures || [];
    this.jsearchConfigured = response.jsearchConfigured ?? true;
    this.fromCache = Boolean(response.fromCache);
    this.frontendCached = Boolean(response.frontendCached);
    this.isStale = Boolean(response.diagnostics?.cacheFallback?.stale);
    this.displayCount = append ? this.visibleJobs.length : Math.min(INITIAL_DISPLAY, this.visibleJobs.length);
    this.isLoading = false;
    this.isLoadingMore = false;
    this.cdr.markForCheck();
  }

  private mergeJobs(existing: Job[], incoming: Job[]): Job[] {
    const seen = new Set(existing.map((job) => `${job.id}|${job.url}`.toLowerCase()));
    const merged = [...existing];

    for (const job of incoming) {
      const key = `${job.id}|${job.url}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(job);
    }

    return merged;
  }

  private hydrateUiState(): void {
    try {
      const raw = localStorage.getItem(this.stateStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, JobUiState>;
      const cutoff = Date.now() - UI_STATE_TTL_MS;
      Object.entries(parsed)
        .filter(([id, state]) => Boolean(id) && state && (state.saved || state.applied || state.hidden))
        .filter(([, state]) => !state.updatedAt || state.updatedAt >= cutoff)
        .sort((left, right) => Number(right[1].updatedAt || 0) - Number(left[1].updatedAt || 0))
        .slice(0, MAX_UI_STATE_ENTRIES)
        .forEach(([id, state]) => this.uiStateMap.set(id, state));
      this.persistUiState();
    } catch {
      this.uiStateMap.clear();
    }
  }

  private setUiState(jobId: string, state: JobUiState): void {
    this.uiStateMap.delete(jobId);
    if (state.saved || state.applied || state.hidden) {
      this.uiStateMap.set(jobId, { ...state, updatedAt: Date.now() });
    }
    while (this.uiStateMap.size > MAX_UI_STATE_ENTRIES) {
      const oldestId = this.uiStateMap.keys().next().value as string | undefined;
      if (!oldestId) break;
      this.uiStateMap.delete(oldestId);
    }
    this.persistUiState();
    this.cdr.markForCheck();
  }

  private persistUiState(): void {
    try {
      localStorage.setItem(this.stateStorageKey, JSON.stringify(Object.fromEntries(this.uiStateMap.entries())));
    } catch {
      // Preferences are optional; storage failures must not break the feed.
    }
  }

  private get stateStorageKey(): string {
    const user = this.authService.getCurrentUser() as { _id?: string; id?: string; email?: string } | null;
    const userKey = String(user?._id || user?.id || user?.email || 'anonymous').trim() || 'anonymous';
    return `${JOB_STATE_STORAGE_KEY}:${userKey}`;
  }
}
