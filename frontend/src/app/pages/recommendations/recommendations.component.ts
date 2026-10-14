import { RecommendationResourcesComponent } from './components/recommendation-resources.component';
import { recommendationCategoryLabel } from './utils/recommendation-presentation';
import { RecommendationRowComponent } from './components/recommendation-row.component';
import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  RecommendationsService,
  RecommendationsResult,
  RecommendationCard,
  SavedPreview,
} from '../../shared/services/recommendations.service';
import { GithubService } from '../../shared/services/github.service';
import { CareerProfileService } from '../../shared/services/career-profile.service';
import {
  buildCareerProfileSignature,
  CareerStack,
  ExperienceLevel,
} from '../../shared/models/career-profile.model';
import { FrontendAnalysisCacheService } from '../../shared/services/frontend-analysis-cache.service';
import { AuthService } from '../../shared/services/auth.service';
import { ResumeService } from '../../shared/services/resume.service';
import { Subscription } from 'rxjs';
import { distinctUntilChanged } from 'rxjs/operators';

type LoadingState = 'empty' | 'loading' | 'refreshing' | 'cache-hit' | 'stale' | 'error' | 'ready';

@Component({
  selector: 'app-recommendations',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    RecommendationRowComponent,
    RecommendationResourcesComponent,
  ],
  templateUrl: './recommendations.component.html',
  styleUrl: './recommendations.component.scss',
})
export class RecommendationsComponent implements OnInit, OnDestroy {
  username = '';
  defaultUsername = '';
  viewedUsername = '';
  isLoading = false;
  loadingState: LoadingState = 'empty';
  errorMessage = '';
  isTemporaryView = false;
  isPreviewMode = false;
  previewGithubUsername = '';
  previewResumeText = '';
  previewResumeId = '';
  previewResumeHash = '';
  previewCareerStack = 'Full Stack';
  previewExperienceLevel = 'Student';
  previewFileName = '';
  isUploading = false;
  profileResultBackup: RecommendationsResult | null = null;
  savedPreviews: SavedPreview[] = [];
  selectedSavedPreviewId = '';
  isSavedPreviewsLoading = false;
  isSavingPreview = false;
  previewSaveMessage = '';

  result: RecommendationsResult | null = null;
  private readonly subscriptions = new Subscription();
  private lastProfileKey = '';
  private activeRequest?: Subscription;

  constructor(
    private readonly recService: RecommendationsService,
    private readonly githubService: GithubService,
    private readonly careerProfileService: CareerProfileService,
    private readonly frontendCache: FrontendAnalysisCacheService,
    private readonly authService: AuthService,
    private readonly resumeService: ResumeService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.lastProfileKey = buildCareerProfileSignature(this.careerProfileService.snapshot);
    this.subscriptions.add(
      this.careerProfileService.careerProfile$
        .pipe(
          distinctUntilChanged(
            (a, b) => buildCareerProfileSignature(a) === buildCareerProfileSignature(b),
          ),
        )
        .subscribe(() => {
          const nextKey = buildCareerProfileSignature(this.careerProfileService.snapshot);
          if (nextKey === this.lastProfileKey) return;
          const hadProfile = Boolean(this.lastProfileKey);
          this.lastProfileKey = nextKey;
          const activeUsername = this.getStoredActiveUsername();
          if (activeUsername) this.applyDefaultUsername(activeUsername);
          if (hadProfile && !this.isPreviewMode) {
            this.frontendCache.clear({ module: 'recommendations', canonicalSignalKey: true });
            this.recService.clearCache();
            this.analyze(false, true);
          }
        }),
    );
    const storedUsername = this.getStoredActiveUsername();
    if (storedUsername) {
      this.applyDefaultUsername(storedUsername);
      this.loadProfile();
      this.cdr.detectChanges();
      return;
    }

    this.subscriptions.add(
      this.githubService.getActiveUsername().subscribe({
        next: (res: { username: string; isDefault?: boolean } | null) => {
          if (res?.username) {
            this.applyDefaultUsername(res.username);
            this.loadProfile();
          }
          if (!res?.username) this.loadProfile();
          this.cdr.detectChanges();
        },
        error: () => {
          this.loadProfile();
          this.cdr.detectChanges();
        },
      }),
    );
  }

  private getStoredActiveUsername(): string {
    const user = this.authService.getCurrentUser();
    return String(user?.activeGithubUsername || user?.githubUsername || '')
      .trim()
      .replace(/^@/, '');
  }

  private applyDefaultUsername(username: string): void {
    this.defaultUsername = String(username || '')
      .trim()
      .replace(/^@/, '');
    this.username = this.defaultUsername;
  }

  ngOnDestroy(): void {
    this.activeRequest?.unsubscribe();
    this.subscriptions.unsubscribe();
  }

  setMode(preview: boolean): void {
    if (this.isLoading) return;
    this.isPreviewMode = preview;
    if (preview) {
      if (this.result && !this.isTemporaryView) {
        this.profileResultBackup = this.result;
      }
      this.result = null;
      this.loadingState = 'empty';
      this.errorMessage = '';
      this.loadSavedPreviews();
    } else {
      if (this.profileResultBackup) {
        this.applyResult(
          this.profileResultBackup,
          this.defaultUsername,
          this.profileResultBackup.careerStack,
          this.profileResultBackup.experienceLevel,
          false,
          'cache-hit',
        );
      } else {
        this.username = this.defaultUsername;
        this.loadProfile();
      }
    }
    this.cdr.detectChanges();
  }

  loadProfile(forceRefresh = false): void {
    this.analyze(forceRefresh);
  }

  onFileSelected(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;

    if (file.type !== 'application/pdf') {
      this.errorMessage = 'Only PDF files are allowed.';
      this.loadingState = 'error';
      this.cdr.detectChanges();
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      this.errorMessage = 'File is too large. Max size is 5MB.';
      this.loadingState = 'error';
      this.cdr.detectChanges();
      return;
    }

    this.isUploading = true;
    this.previewFileName = file.name;
    this.errorMessage = '';
    this.cdr.detectChanges();

    this.resumeService.parsePreviewResumeText(file).subscribe({
      next: (res) => {
        this.previewResumeText = '';
        this.previewResumeId = res.previewResumeId;
        this.previewResumeHash = res.resumeHash;
        this.isUploading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.isUploading = false;
        this.previewFileName = '';
        this.previewResumeText = '';
        this.previewResumeId = '';
        this.previewResumeHash = '';
        this.errorMessage = err?.error?.message || 'Failed to parse resume file.';
        this.loadingState = 'error';
        this.cdr.detectChanges();
      },
    });
  }

  clearPreviewFile(): void {
    this.previewFileName = '';
    this.previewResumeText = '';
    this.previewResumeId = '';
    this.previewResumeHash = '';
    this.cdr.detectChanges();
  }

  returnToDefaultProfile(): void {
    if (this.isLoading) return;
    this.setMode(false);
  }

  get currentCareerStack(): string {
    return this.careerProfileService.careerStack;
  }

  get currentExperienceLevel(): string {
    return this.careerProfileService.experienceLevel;
  }

  analyze(
    forceRefresh = false,
    profileChanged = false,
    knownSkills?: string[],
    missingSkills?: string[],
  ): void {
    const user = this.isPreviewMode ? this.previewGithubUsername.trim() : this.username.trim();
    if (!user && this.isPreviewMode) {
      if (this.isPreviewMode) {
        this.errorMessage = 'GitHub username is required for preview.';
        this.loadingState = 'error';
      }
      return;
    }
    if (this.isLoading && !profileChanged) return;
    if (profileChanged) this.activeRequest?.unsubscribe();

    const careerStack = (
      this.isPreviewMode ? this.previewCareerStack : this.careerProfileService.careerStack
    ) as CareerStack;
    const experienceLevel = (
      this.isPreviewMode ? this.previewExperienceLevel : this.careerProfileService.experienceLevel
    ) as ExperienceLevel;
    const isTemporary = this.isPreviewMode;
    const resumeText = this.isPreviewMode ? this.previewResumeText : '';
    const previewResumeId = isTemporary && !resumeText.trim() ? this.previewResumeId : '';
    const previewResumeHash = previewResumeId ? this.previewResumeHash : '';

    this.lastProfileKey = buildCareerProfileSignature({
      careerStack,
      experienceLevel,
      careerGoal: '',
    });

    if (!isTemporary && !forceRefresh) {
      const cachedSignalHash = this.frontendCache.getLatestSignalHash({
        module: 'recommendations',
        careerStack,
        experienceLevel,
      });
      const currentSignalHash = this.frontendCache.getCurrentSignalHash({
        module: 'developer-signals',
        careerStack,
        experienceLevel,
      });
      const cached = this.frontendCache.get<RecommendationsResult>({
        module: 'recommendations',
        canonicalSignalKey: true,
        signalHash: cachedSignalHash || undefined,
        careerStack,
        experienceLevel,
      });
      const cachedResultSignalHash = this.extractSignalHash(cached);
      if (cached && (!currentSignalHash || cachedResultSignalHash === currentSignalHash)) {
        this.applyResult(cached, user, careerStack, experienceLevel, isTemporary, 'cache-hit');
        return;
      }
      if (
        cached &&
        currentSignalHash &&
        cachedResultSignalHash &&
        cachedResultSignalHash !== currentSignalHash
      ) {
        this.frontendCache.clear({
          module: 'recommendations',
          canonicalSignalKey: true,
          careerStack,
          experienceLevel,
        });
      }
    }

    this.isLoading = true;
    this.loadingState = forceRefresh ? 'refreshing' : 'loading';
    this.errorMessage = '';
    const previousResult = this.result;
    const preservePrevious = Boolean(previousResult) && (forceRefresh || !isTemporary);
    if (!preservePrevious) {
      this.result = null;
    }
    this.cdr.detectChanges();

    this.activeRequest = this.recService
      .getRecommendations(
        user,
        careerStack,
        experienceLevel,
        knownSkills,
        missingSkills,
        isTemporary,
        forceRefresh,
        this.lastProfileKey,
        resumeText,
        previewResumeId,
        previewResumeHash,
      )
      .subscribe({
        next: (data) => {
          const normalized = this.normalizeResult(data, user, careerStack, experienceLevel);
          this.applyResult(
            normalized,
            user,
            careerStack,
            experienceLevel,
            isTemporary,
            normalized.fromCache ? 'cache-hit' : 'ready',
          );
          if (!isTemporary && normalized.cacheMetadata) {
            const key = normalized.cacheMetadata.cacheKey || {};
            const signalHash = key.signalHash || normalized.cacheMetadata.signalHash;
            this.frontendCache.setCurrentSignalHash(
              {
                module: 'developer-signals',
                careerStack: key.careerStack || normalized.careerStack,
                experienceLevel: key.experienceLevel || normalized.experienceLevel,
              },
              signalHash || '',
            );
            this.frontendCache.set(
              {
                module: 'recommendations',
                canonicalSignalKey: true,
                careerStack: key.careerStack || normalized.careerStack,
                experienceLevel: key.experienceLevel || normalized.experienceLevel,
                signalHash,
              },
              normalized,
            );
          }
        },
        error: (err) => {
          this.errorMessage =
            err?.error?.message || 'Failed to fetch recommendations. Please try again.';
          this.isLoading = false;
          if (preservePrevious && previousResult) {
            this.result = previousResult;
            this.loadingState = forceRefresh ? 'stale' : 'error';
          } else {
            this.result = null;
            this.loadingState = 'error';
          }
          this.cdr.detectChanges();
        },
      });
  }

  get isAuthenticated(): boolean {
    return Boolean(this.authService.getCurrentUser()?._id);
  }

  loadSavedPreviews(forceRefresh = false): void {
    if (!this.isAuthenticated || this.isSavedPreviewsLoading) return;
    this.isSavedPreviewsLoading = true;
    this.recService.listSavedPreviews(forceRefresh).subscribe({
      next: ({ previews }) => {
        this.savedPreviews = Array.isArray(previews) ? previews : [];
        this.isSavedPreviewsLoading = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.isSavedPreviewsLoading = false;
        this.previewSaveMessage =
          'Saved previews could not be loaded. Return to My Profile or try Preview Candidate again.';
        this.cdr.detectChanges();
      },
    });
  }

  savePreview(): void {
    if (!this.result || !this.isTemporaryView || !this.isAuthenticated || this.isSavingPreview)
      return;
    const resumeHash = String(
      (this.result.cacheMetadata?.cacheKey as any)?.resumeHash || 'no-resume',
    );
    this.isSavingPreview = true;
    this.previewSaveMessage = '';
    this.recService
      .savePreview({
        module: 'recommendations',
        title: `${this.result.username} Recommendations Preview`,
        githubUsername: this.result.username,
        careerStack: this.result.careerStack,
        experienceLevel: this.result.experienceLevel,
        resumeHash,
        result: this.result,
      })
      .subscribe({
        next: ({ preview }) => {
          this.savedPreviews = this.recService.cacheSavedPreview(preview);
          this.selectedSavedPreviewId = preview._id;
          this.isSavingPreview = false;
          this.previewSaveMessage = 'Preview saved.';
          this.cdr.detectChanges();
        },
        error: (err) => {
          this.isSavingPreview = false;
          this.previewSaveMessage = err?.error?.message || 'Unable to save preview.';
          this.cdr.detectChanges();
        },
      });
  }

  openSavedPreview(id: string): void {
    const preview = this.savedPreviews.find((item) => item._id === id);
    if (!preview || this.isLoading) return;
    this.selectedSavedPreviewId = id;
    if (this.result && !this.isTemporaryView) this.profileResultBackup = this.result;
    this.isPreviewMode = true;
    this.previewGithubUsername = preview.githubUsername;
    this.previewCareerStack = preview.careerStack;
    this.previewExperienceLevel = preview.experienceLevel;
    this.previewSaveMessage = '';

    if (preview.module === 'recommendations') {
      this.applyResult(
        {
          ...preview.resultSummary,
          username: preview.githubUsername,
          careerStack: preview.careerStack,
          experienceLevel: preview.experienceLevel,
        } as RecommendationsResult,
        preview.githubUsername,
        preview.careerStack,
        preview.experienceLevel,
        true,
        'ready',
      );
      return;
    }

    const knownSkills = (preview.resultSummary?.['knownSkills'] || [])
      .map((skill: any) => (typeof skill === 'string' ? skill : skill?.name))
      .filter(Boolean);
    const missingSkills = (preview.resultSummary?.['missingSkills'] || [])
      .map((skill: any) => (typeof skill === 'string' ? skill : skill?.name))
      .filter(Boolean);
    this.result = null;
    this.analyze(false, false, knownSkills, missingSkills);
  }

  deleteSavedPreview(): void {
    const id = this.selectedSavedPreviewId;
    if (!id || this.isLoading) return;
    this.recService.deleteSavedPreview(id).subscribe({
      next: () => {
        this.savedPreviews = this.recService.removeSavedPreviewFromCache(id);
        this.selectedSavedPreviewId = '';
        this.previewSaveMessage = 'Saved preview removed.';
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.previewSaveMessage = err?.error?.message || 'Unable to remove saved preview.';
        this.cdr.detectChanges();
      },
    });
  }

  private extractSignalHash(result: RecommendationsResult | null | undefined): string {
    const meta = result?.cacheMetadata?.cacheKey || {};
    return String(meta.signalHash || result?.cacheMetadata?.signalHash || '')
      .trim()
      .toLowerCase();
  }

  readonly categoryLabel = recommendationCategoryLabel;
  includeFeatured = false;
  search = '';
  category = '';
  priority = '';
  source = '';
  visibleCount = 8;
  sprintStates: Record<string, { loading: boolean; message: string; success: boolean }> = {};

  get allCards(): RecommendationCard[] {
    if (Array.isArray(this.result?.recommendations)) return this.result!.recommendations!;
    const structured = Object.values(this.result?.structuredRecommendations || {}).flat();
    if (structured.length) return structured;
    if (this.result?.actions?.length) return this.result.actions;
    const roadmap = this.result?.roadmap;
    const recorded = [
      ...(roadmap?.immediateActions || []),
      ...(roadmap?.next30Days || []),
      ...(roadmap?.next60Days || []),
      ...(roadmap?.next90Days || []),
      ...(roadmap?.longTermGrowth || []),
      ...(roadmap?.suggestedCertifications || []),
    ];
    return recorded.filter(
      (card, index) => recorded.findIndex((item) => item.id === card.id) === index,
    );
  }
  get topActions(): RecommendationCard[] {
    return this.allCards.slice(0, 3);
  }
  get categories(): string[] {
    return [...new Set(this.allCards.map((c) => c.category).filter(Boolean))];
  }
  get priorities(): string[] {
    return [...new Set(this.allCards.map((c) => c.priority).filter(Boolean))];
  }
  get sources(): string[] {
    return [...new Set(this.allCards.flatMap((c) => c.sources?.map((s) => s.type) || []))];
  }
  get filteredCards(): RecommendationCard[] {
    const search = this.search.trim().toLowerCase();
    return this.allCards.filter(
      (c) =>
        (!this.category || c.category === this.category) &&
        (!this.priority || c.priority === this.priority) &&
        (!this.source || c.sources?.some((s) => s.type === this.source)) &&
        (!search ||
          [c.title, c.description, c.reason, c.actionableNextStep, ...(c.evidence || [])]
            .join(' ')
            .toLowerCase()
            .includes(search)),
    );
  }
  get explorerCards(): RecommendationCard[] {
    if (this.includeFeatured) return this.filteredCards;
    const featured = new Set(this.topActions.map((card) => card.id));
    return this.filteredCards.filter((card) => !featured.has(card.id));
  }
  get availableSourceCount(): number {
    return this.sourceEntries.filter((source) => source.available === true).length;
  }
  onFiltersChanged(): void {
    this.visibleCount = 8;
    this.includeFeatured = true;
  }
  exploreCategory(category: string): void {
    this.resetFilters();
    this.category = category;
    this.onFiltersChanged();
    requestAnimationFrame(() =>
      document.getElementById('all-title')?.scrollIntoView({ block: 'start' }),
    );
  }
  resetFilters(): void {
    this.includeFeatured = false;
    this.search = '';
    this.category = '';
    this.priority = '';
    this.source = '';
    this.visibleCount = 8;
  }
  get legacy(): boolean {
    return (
      !!this.result &&
      (!Array.isArray(this.result.recommendations) || this.result.verified === false)
    );
  }
  get sourceEntries() {
    return Object.entries(this.result?.sourceMetadata || {}).map(([key, value]) => ({
      ...value,
      type: key,
    }));
  }
  get stale(): boolean {
    return this.loadingState === 'stale' || this.sourceEntries.some((s) => s.freshness === 'STALE');
  }
  get lastUpdated(): string | null {
    return (
      this.result?.cacheMetadata?.cachedAt || this.result?.analysisBasedOn?.lastAnalyzedAt || null
    );
  }
  get focusGroups() {
    return [
      {
        title: 'Skills',
        categories: ['learning', 'Learning Recommendations', 'Certification Recommendations'],
        route: '/app/skill-gap',
        label: 'Inspect Skill Gap evidence',
      },
      {
        title: 'GitHub & portfolio',
        categories: ['projects', 'Portfolio Recommendations'],
        route: '/app/github-analyzer',
        label: 'Inspect GitHub analysis',
      },
      {
        title: 'Resume',
        categories: ['resume', 'Resume Recommendations'],
        route: '/app/resume-analyzer',
        label: 'Inspect Resume analysis',
      },
      {
        title: 'Career & interviews',
        categories: [
          'careerPaths',
          'Career Growth Recommendations',
          'Interview Recommendations',
          'Job Readiness Recommendations',
        ],
        route: '/app/profile',
        label: 'Review career context',
      },
    ]
      .map((g) => ({ ...g, cards: this.allCards.filter((c) => g.categories.includes(c.category)) }))
      .filter((g) => g.cards.length);
  }
  canSprint(card: RecommendationCard): boolean {
    return (
      !this.isPreviewMode &&
      !this.isTemporaryView &&
      !this.legacy &&
      !this.isLoading &&
      this.isAuthenticated &&
      !!card.navigation?.careerSprint?.api &&
      /^[a-f0-9]{64}$/.test(this.extractSignalHash(this.result))
    );
  }
  startSprint(card: RecommendationCard): void {
    if (!this.canSprint(card) || this.sprintStates[card.id]?.loading) return;
    this.sprintStates[card.id] = {
      loading: true,
      message: 'Adding to Career Sprint…',
      success: false,
    };
    this.subscriptions.add(
      this.recService.handoffToSprint(card.id, this.extractSignalHash(this.result)).subscribe({
        next: (response) => {
          this.sprintStates[card.id] = {
            loading: false,
            message: response.alreadyAdded
              ? 'Already in your Career Sprint.'
              : 'Added to your Career Sprint.',
            success: true,
          };
          this.cdr.detectChanges();
        },
        error: (error) => {
          this.sprintStates[card.id] = {
            loading: false,
            message: error?.error?.message || 'Could not add this action. Try again.',
            success: false,
          };
          this.cdr.detectChanges();
        },
      }),
    );
  }
  private applyResult(
    data: RecommendationsResult,
    user: string,
    careerStack: string,
    experienceLevel: string,
    isTemporary: boolean,
    state: LoadingState,
  ): void {
    this.result = this.normalizeResult(data, user, careerStack, experienceLevel);
    this.viewedUsername = user;
    this.isTemporaryView = isTemporary;
    this.isLoading = false;
    this.loadingState = state;
    this.sprintStates = {};
    this.resetFilters();
    this.cdr.detectChanges();
  }
  private normalizeResult(
    data: RecommendationsResult | null,
    user: string,
    careerStack: string,
    experienceLevel: string,
  ): RecommendationsResult {
    return {
      ...data,
      username: data?.username ?? user,
      careerStack: data?.careerStack ?? careerStack,
      experienceLevel: data?.experienceLevel ?? experienceLevel,
      projects: data?.projects ?? [],
      technologies: data?.technologies ?? [],
      careerPaths: data?.careerPaths ?? [],
    };
  }
}
