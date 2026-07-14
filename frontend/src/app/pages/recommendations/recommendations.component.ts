import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  RecommendationsService,
  RecommendationsResult,
  RecommendedProject,
  RecommendedTechnology,
  CareerPath,
  RecommendationSignalsUsed,
  AnalysisBasedOn,
  RecommendationCard,
  RecommendationScores,
  RecommendationRoadmap,
  SavedPreview,
} from '../../shared/services/recommendations.service';
import { GithubService } from '../../shared/services/github.service';
import { CareerProfileService } from '../../shared/services/career-profile.service';
import { buildCareerProfileSignature, CareerStack, ExperienceLevel } from '../../shared/models/career-profile.model';
import { FrontendAnalysisCacheService } from '../../shared/services/frontend-analysis-cache.service';
import { ApiService } from '../../shared/services/api.service';
import { AuthService } from '../../shared/services/auth.service';
import { ResumeService } from '../../shared/services/resume.service';
import { Subscription } from 'rxjs';
import { distinctUntilChanged } from 'rxjs/operators';

type AdvisorSection =
  | 'Career Overview'
  | 'Career Growth Priorities'
  | 'Learning Roadmap'
  | 'Interview Readiness'
  | 'Job Market Readiness'
  | 'Resume Optimization'
  | 'Portfolio Optimization'
  | 'Recommended Projects'
  | 'Career Timeline';
type LoadingState = 'empty' | 'loading' | 'refreshing' | 'cache-hit' | 'stale' | 'error' | 'ready';

@Component({
  selector: 'app-recommendations',
  standalone: true,
  imports: [CommonModule, FormsModule],
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
  actionMessage = '';
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

  activeSection: AdvisorSection = 'Career Overview';
  readonly sections: AdvisorSection[] = [
    'Career Overview',
    'Career Growth Priorities',
    'Learning Roadmap',
    'Job Market Readiness',
    'Resume Optimization',
    'Portfolio Optimization',
    'Recommended Projects',
  ];

  constructor(
    private readonly recService: RecommendationsService,
    private readonly githubService: GithubService,
    private readonly careerProfileService: CareerProfileService,
    private readonly frontendCache: FrontendAnalysisCacheService,
    private readonly api: ApiService,
    private readonly authService: AuthService,
    private readonly resumeService: ResumeService,
    private readonly router: Router,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.lastProfileKey = buildCareerProfileSignature(this.careerProfileService.snapshot);
    this.subscriptions.add(
      this.careerProfileService.careerProfile$.pipe(
        distinctUntilChanged((a, b) => buildCareerProfileSignature(a) === buildCareerProfileSignature(b))
      ).subscribe(() => {
        const nextKey = buildCareerProfileSignature(this.careerProfileService.snapshot);
        if (nextKey === this.lastProfileKey) return;
        const hadProfile = Boolean(this.lastProfileKey);
        this.lastProfileKey = nextKey;
        const activeUsername = this.getStoredActiveUsername();
        if (activeUsername) this.applyDefaultUsername(activeUsername);
        if (hadProfile && this.username) {
          this.frontendCache.clear({ module: 'recommendations', canonicalSignalKey: true });
          this.analyze(false, true);
        }
      })
    );

    if (this.isAuthenticated) this.loadSavedPreviews();

    const storedUsername = this.getStoredActiveUsername();
    if (storedUsername) {
      this.applyDefaultUsername(storedUsername);
      this.analyze();
      this.cdr.detectChanges();
      return;
    }

    this.subscriptions.add(
      this.githubService.getActiveUsername().subscribe({
        next: (res: { username: string; isDefault?: boolean } | null) => {
          if (res?.username) {
            this.applyDefaultUsername(res.username);
            this.analyze();
          }
          this.cdr.detectChanges();
        },
        error: () => this.cdr.detectChanges()
      })
    );
  }

  private getStoredActiveUsername(): string {
    const user = this.authService.getCurrentUser();
    return String(user?.activeGithubUsername || user?.githubUsername || '').trim().replace(/^@/, '');
  }

  private applyDefaultUsername(username: string): void {
    this.defaultUsername = String(username || '').trim().replace(/^@/, '');
    this.username = this.defaultUsername;
  }

  ngOnDestroy(): void {
    this.activeRequest?.unsubscribe();
    this.subscriptions.unsubscribe();
  }

  setSection(section: AdvisorSection): void {
    this.activeSection = section;
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
    } else {
      if (this.profileResultBackup) {
        this.applyResult(this.profileResultBackup, this.defaultUsername, this.profileResultBackup.careerStack, this.profileResultBackup.experienceLevel, false, 'cache-hit');
      } else {
        this.username = this.defaultUsername;
        this.analyze();
      }
    }
    this.cdr.detectChanges();
  }

  onFileSelected(event: any): void {
    const file = event.target.files?.[0];
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
      }
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

  analyze(forceRefresh = false, profileChanged = false, knownSkills?: string[], missingSkills?: string[]): void {
    const user = this.isPreviewMode ? this.previewGithubUsername.trim() : this.username.trim();
    if (!user) {
      if (this.isPreviewMode) {
        this.errorMessage = 'GitHub username is required for preview.';
        this.loadingState = 'error';
      }
      return;
    }
    if (this.isLoading && !profileChanged) return;
    if (profileChanged) this.activeRequest?.unsubscribe();

    const careerStack = (this.isPreviewMode ? this.previewCareerStack : this.careerProfileService.careerStack) as CareerStack;
    const experienceLevel = (this.isPreviewMode ? this.previewExperienceLevel : this.careerProfileService.experienceLevel) as ExperienceLevel;
    const isTemporary = this.isPreviewMode;
    const resumeText = this.isPreviewMode ? this.previewResumeText : '';
    const previewResumeId = isTemporary && !resumeText.trim() ? this.previewResumeId : '';
    const previewResumeHash = previewResumeId ? this.previewResumeHash : '';

    this.lastProfileKey = buildCareerProfileSignature({
      careerStack,
      experienceLevel,
      careerGoal: ''
    });

    if (!isTemporary && !forceRefresh) {
      const cachedSignalHash = this.frontendCache.getLatestSignalHash({
        module: 'recommendations',
        careerStack,
        experienceLevel
      });
      const currentSignalHash = this.frontendCache.getCurrentSignalHash({
        module: 'developer-signals',
        careerStack,
        experienceLevel
      });
      const cached = this.frontendCache.get<RecommendationsResult>({
        module: 'recommendations',
        canonicalSignalKey: true,
        signalHash: cachedSignalHash || undefined,
        careerStack,
        experienceLevel
      });
      const cachedResultSignalHash = this.extractSignalHash(cached);
      if (cached && currentSignalHash && cachedResultSignalHash === currentSignalHash) {
        this.applyResult(cached, user, careerStack, experienceLevel, isTemporary, 'cache-hit');
        return;
      }
      if (cached && currentSignalHash && cachedResultSignalHash && cachedResultSignalHash !== currentSignalHash) {
        this.frontendCache.clear({
          module: 'recommendations',
          canonicalSignalKey: true,
          careerStack,
          experienceLevel
        });
      }
    }

    this.isLoading = true;
    this.loadingState = forceRefresh ? 'refreshing' : 'loading';
    this.errorMessage = '';
    this.actionMessage = '';
    if (forceRefresh) this.result = this.result;
    else this.result = null;
    this.cdr.detectChanges();

    this.activeRequest = this.recService.getRecommendations(
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
      previewResumeHash
    ).subscribe({
      next: (data) => {
        const normalized = this.normalizeResult(data, user, careerStack, experienceLevel);
        this.applyResult(normalized, user, careerStack, experienceLevel, isTemporary, normalized.fromCache ? 'cache-hit' : 'ready');
        if (!isTemporary && normalized.cacheMetadata) {
          const key = normalized.cacheMetadata.cacheKey || {};
          const signalHash = key.signalHash || normalized.cacheMetadata.signalHash;
          this.frontendCache.setCurrentSignalHash({
            module: 'developer-signals',
            careerStack: key.careerStack || normalized.careerStack,
            experienceLevel: key.experienceLevel || normalized.experienceLevel
          }, signalHash || '');
          this.frontendCache.set({
            module: 'recommendations',
            canonicalSignalKey: true,
            careerStack: key.careerStack || normalized.careerStack,
            experienceLevel: key.experienceLevel || normalized.experienceLevel,
            signalHash
          }, normalized);
        }
      },
      error: (err) => {
        this.errorMessage = err?.error?.message || 'Failed to fetch recommendations. Please try again.';
        this.isLoading = false;
        this.loadingState = 'error';
        this.result = null;
        this.cdr.detectChanges();
      }
    });
  }

  get isAuthenticated(): boolean {
    return Boolean(this.authService.getCurrentUser()?._id);
  }

  loadSavedPreviews(): void {
    if (!this.isAuthenticated || this.isSavedPreviewsLoading) return;
    this.isSavedPreviewsLoading = true;
    this.recService.listSavedPreviews().subscribe({
      next: ({ previews }) => {
        this.savedPreviews = Array.isArray(previews) ? previews : [];
        this.isSavedPreviewsLoading = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.isSavedPreviewsLoading = false;

        this.cdr.detectChanges();
      }
    });
  }

  savePreview(): void {
    if (!this.result || !this.isTemporaryView || !this.isAuthenticated || this.isSavingPreview) return;
    const resumeHash = String((this.result.cacheMetadata?.cacheKey as any)?.resumeHash || 'no-resume');
    this.isSavingPreview = true;
    this.previewSaveMessage = '';
    this.recService.savePreview({
      module: 'recommendations',
      title: `${this.result.username} Recommendations Preview`,
      githubUsername: this.result.username,
      careerStack: this.result.careerStack,
      experienceLevel: this.result.experienceLevel,
      resumeHash,
      result: this.result
    }).subscribe({
      next: ({ preview }) => {
        this.savedPreviews = [preview, ...this.savedPreviews];
        this.selectedSavedPreviewId = preview._id;
        this.isSavingPreview = false;
        this.previewSaveMessage = 'Preview saved.';
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.isSavingPreview = false;
        this.previewSaveMessage = err?.error?.message || 'Unable to save preview.';
        this.cdr.detectChanges();
      }
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
      this.applyResult({ ...preview.resultSummary, username: preview.githubUsername, careerStack: preview.careerStack, experienceLevel: preview.experienceLevel } as RecommendationsResult, preview.githubUsername, preview.careerStack, preview.experienceLevel, true, 'ready');
      return;
    }

    const knownSkills = (preview.resultSummary?.['knownSkills'] || []).map((skill: any) => typeof skill === 'string' ? skill : skill?.name).filter(Boolean);
    const missingSkills = (preview.resultSummary?.['missingSkills'] || []).map((skill: any) => typeof skill === 'string' ? skill : skill?.name).filter(Boolean);
    this.result = null;
    this.analyze(false, false, knownSkills, missingSkills);
  }

  deleteSavedPreview(): void {
    const id = this.selectedSavedPreviewId;
    if (!id || this.isLoading) return;
    this.recService.deleteSavedPreview(id).subscribe({
      next: () => {
        this.savedPreviews = this.savedPreviews.filter((item) => item._id !== id);
        this.selectedSavedPreviewId = '';
        this.previewSaveMessage = 'Saved preview removed.';
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.previewSaveMessage = err?.error?.message || 'Unable to remove saved preview.';
        this.cdr.detectChanges();
      }
    });
  }

  private extractSignalHash(result: RecommendationsResult | null | undefined): string {
    const meta = result?.cacheMetadata?.cacheKey || {};
    return String(meta.signalHash || result?.cacheMetadata?.signalHash || '').trim().toLowerCase();
  }

  show(section: AdvisorSection): boolean {
    return this.activeSection === section;
  }

  jumpTo(section: AdvisorSection): void {
    this.activeSection = section;
    requestAnimationFrame(() => {
      document.querySelector('.advisor-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  get dataQuality() {
    return this.result?.dataQuality || {
      hasGitHubData: false, hasResumeData: false, hasSkillGapData: false, hasPortfolioData: false, hasJobMarketData: false,
      dataCompleteness: 0, scoreAvailability: {}
    };
  }

  scoreLabel(value: number | null | undefined, available: boolean): string {
    return available && Number.isFinite(Number(value)) ? `${Math.round(Number(value))}%` : 'Not enough data';
  }

  get overviewScores(): Array<{ label: string; value: number; hint: string }> {
    const scores = this.result?.recommendationScores;
    if (!scores) return [];
    return [
      { label: 'Overall', value: scores.overallRecommendationScore, hint: 'Advisor score' },
      { label: 'Readiness', value: scores.readinessScore, hint: 'GitHub, resume, skills' },
      { label: 'Portfolio', value: scores.portfolioScore, hint: 'Proof quality' },
      { label: 'Learning', value: scores.learningScore, hint: 'Skill momentum' },
      { label: 'Interview', value: scores.interviewScore, hint: 'Story readiness' },
      { label: 'Market', value: scores.marketReadinessScore, hint: 'Jobs alignment' },
      { label: 'Growth', value: scores.careerGrowthScore, hint: 'Career trajectory' }
    ];
  }

  get overviewHighlights(): Array<{ label: string; value: string; target: AdvisorSection }> {
    return [
      {
        label: 'Top Priority Actions',
        value: this.priorityActions.slice(0, 2).map((card) => card.title).join(' | ') || 'Review priority actions',
        target: 'Career Growth Priorities'
      },
      {
        label: 'Top Missing Skills',
        value: this.topMissingSkills.join(', ') || 'Open Skill Gap for latest gaps',
        target: 'Learning Roadmap'
      },
      {
        label: 'Recommended Career Path',
        value: this.recommendedCareerPath,
        target: 'Career Overview'
      },
      {
        label: 'Last Updated',
        value: this.analysisLastUpdatedLabel,
        target: 'Career Overview'
      }
    ];
  }

  get topMissingSkills(): string[] {
    return [
      ...(this.result?.signalsUsed?.skillGap?.missingSkills || []),
      ...((this.result?.recommendationSignals as any)?.skills?.missingSkills || []),
      ...(this.result?.technologies || []).map((tech) => tech.name)
    ].filter((skill, index, list) => skill && list.findIndex((item) => item.toLowerCase() === skill.toLowerCase()) === index).slice(0, 5);
  }

  get recommendedCareerPath(): string {
    return this.result?.careerPaths?.[0]?.title
      || this.careerCards[0]?.title
      || '';
  }

  get priorityActions(): RecommendationCard[] {
    const roadmap = this.result?.roadmap;
    return this.sortCards(roadmap?.immediateActions?.length ? roadmap.immediateActions : this.allCards).slice(0, 6);
  }

  get allCards(): RecommendationCard[] {
    return Object.values(this.result?.structuredRecommendations || {}).flat();
  }

  get learningCards(): RecommendationCard[] {
    return this.cardsFor('Learning Recommendations');
  }

  get interviewCards(): RecommendationCard[] {
    return this.cardsFor('Interview Recommendations');
  }

  get jobsCards(): RecommendationCard[] {
    return this.cardsFor('Job Readiness Recommendations');
  }

  get portfolioCards(): RecommendationCard[] {
    return this.cardsFor('Portfolio Recommendations');
  }

  get resumeCards(): RecommendationCard[] {
    return this.cardsFor('Resume Recommendations');
  }

  get careerCards(): RecommendationCard[] {
    return [
      ...this.cardsFor('Career Growth Recommendations'),
      ...(this.result?.careerPaths || []).map((path) => this.pathToCard(path))
    ].filter((card, index, list) => list.findIndex((item) => item.title === card.title) === index);
  }

  get roadmapTimeline(): Array<{ label: string; items: string[] }> {
    return this.result?.roadmap?.timeline || [];
  }

  get availableSections(): AdvisorSection[] {
    if (!this.result) return [];
    const available = new Set<AdvisorSection>(['Career Overview']);
    if (this.priorityActions.length) available.add('Career Growth Priorities');
    if (this.learningPlanCards.length || this.recommendedNextSkills.length) available.add('Learning Roadmap');
    if (this.interviewActionCards.length || this.result.interviewReadinessActions?.length) available.add('Interview Readiness');
    if (this.jobsActionCards.length || this.topDemandedSkills.length || this.result.careerPaths.length) available.add('Job Market Readiness');
    if (this.resumeActionCards.length || this.result.resumeRecommendations?.length) available.add('Resume Optimization');
    if (this.portfolioActionCards.length || this.result.portfolioRecommendations?.length) available.add('Portfolio Optimization');
    if (this.result.projects.length) available.add('Recommended Projects');
    if (this.roadmapTimeline.length) available.add('Career Timeline');
    return this.sections.filter((section) => available.has(section));
  }

  get overviewActionMetrics(): Array<{ label: string; value: string; hint: string; target: AdvisorSection }> {
    const current = this.currentReadiness;
    const target = this.targetReadiness;
    const gap = Math.max(0, target - current);
    const immediate = this.priorityActions[0];
    return [
      { label: 'Current Readiness', value: `${current}%`, hint: 'Composite score from resume, portfolio, jobs, learning, and interview signals.', target: 'Career Growth Priorities' },
      { label: 'Target Readiness', value: `${target}%`, hint: 'Near-term score target for a credible job-ready profile.', target: 'Learning Roadmap' },
      { label: 'Gap Remaining', value: `${gap} pts`, hint: gap ? 'Close this gap through the priority roadmap.' : 'You are at the current readiness target.', target: 'Career Growth Priorities' },
      { label: 'Priority Level', value: this.priorityLevel, hint: 'Based on readiness gap and highest-impact actions.', target: 'Career Growth Priorities' },
      { label: 'Estimated Completion', value: this.estimatedCompletionTime, hint: 'Derived from recommended effort and roadmap density.', target: 'Learning Roadmap' },
      { label: 'Top Missing Skills', value: this.topMissingSkills.join(', ') || 'No critical gaps detected', hint: 'Deduplicated from skill gap, recommendation, and market signals.', target: 'Learning Roadmap' },
      { label: 'Top Opportunities', value: this.topCareerOpportunities.join(', ') || this.recommendedCareerPath, hint: 'Career paths with the strongest match and market alignment.', target: 'Career Overview' },
      { label: 'Immediate Next Action', value: immediate?.title || 'Review priority actions', hint: immediate?.reason || 'Start with the highest-impact recommendation.', target: 'Career Growth Priorities' },
      { label: 'Last Updated', value: this.analysisLastUpdatedLabel, hint: this.cacheStateLabel, target: 'Career Overview' }
    ];
  }

  get executiveHeroMetrics(): Array<{ label: string; value: string; hint: string; target: AdvisorSection; featured?: boolean }> {
    const immediate = this.priorityActions[0];
    const metrics: Array<{ label: string; value: string; hint: string; target: AdvisorSection; featured?: boolean }> = [
      { label: 'Readiness Score', value: `${this.currentReadiness}%`, hint: 'Current composite career readiness.', target: 'Career Growth Priorities', featured: true },
      { label: 'Priority Focus Area', value: this.highestPrioritySkill, hint: 'Primary area to improve next.', target: 'Job Market Readiness' },
      { label: 'Next Best Action', value: immediate?.title || '', hint: immediate?.estimatedEffort || '', target: 'Career Growth Priorities' },
      { label: 'Last Updated', value: this.analysisLastUpdatedLabel, hint: this.cacheStateLabel, target: 'Career Overview' }
    ];
    return metrics.filter((metric) => metric.value && metric.value !== '0%');
  }

  get careerGoalLabel(): string {
    return this.result?.signalsUsed?.careerProfile?.careerGoal
      || this.result?.analysisBasedOn?.careerStack
      || this.currentCareerStack
      || '';
  }

  get highestPrioritySkill(): string {
    return this.topMissingSkills[0] || this.topDemandedSkills[0] || this.getSprintFocus() || '';
  }

  get executiveInsights(): Array<{ label: string; tone: string; items: string[] }> {
    const strengths = [
      ...(this.result?.signalsUsed?.resume?.strengths || []),
      this.signalProofList && !this.signalProofList.includes('No strong') ? this.signalProofList : '',
      this.currentReadiness >= 70 ? `${this.currentReadiness}% readiness baseline` : ''
    ].filter(Boolean).slice(0, 3);
    const risks = [
      ...this.resumeMissingItems,
      ...this.topMissingSkills,
      this.result?.signalsUsed?.portfolio?.liveLinkCount ? '' : 'Limited live portfolio proof'
    ].filter(Boolean).slice(0, 3);
    const opportunities = [
      ...this.topCareerOpportunities,
      ...this.topDemandedSkills,
      this.result?.signalsUsed?.jobsDemand?.sampledJobs ? `${this.result.signalsUsed.jobsDemand.sampledJobs} jobs sampled` : ''
    ].filter(Boolean).slice(0, 3);
    return [
      { label: 'Strengths', tone: 'strength', items: strengths },
      { label: 'Risks', tone: 'risk', items: risks },
      { label: 'Opportunities', tone: 'opportunity', items: opportunities }
    ].filter((group) => group.items.length);
  }

  get readinessCenterMetrics(): Array<{ label: string; score: number; hint: string; target: AdvisorSection }> {
    const scores = this.result?.recommendationScores;
    const metrics: Array<{ label: string; score: number; hint: string; target: AdvisorSection }> = [
      { label: 'Resume', score: Number(this.result?.signalsUsed?.resume?.atsScore || scores?.readinessScore || 0), hint: this.resumeStatusLabel, target: 'Resume Optimization' },
      { label: 'Portfolio', score: Number(this.result?.signalsUsed?.portfolio?.completenessScore || scores?.portfolioScore || 0), hint: `${this.result?.signalsUsed?.portfolio?.projectCount || 0} projects, ${this.result?.signalsUsed?.portfolio?.liveLinkCount || 0} live links`, target: 'Portfolio Optimization' },
      { label: 'Interview', score: Number(scores?.interviewScore || 0), hint: this.interviewTopics.slice(0, 2).join(', ') || 'Practice proof-backed stories', target: 'Career Growth Priorities' },
      { label: 'Jobs', score: Number(scores?.marketReadinessScore || 0), hint: `${this.jobsReadinessMetrics[0]?.value || 0} matched jobs`, target: 'Job Market Readiness' },
      { label: 'Learning', score: Number(scores?.learningScore || this.result?.signalsUsed?.skillGap?.coverage || 0), hint: this.recommendedNextSkills.slice(0, 2).join(', ') || this.getSprintFocus(), target: 'Learning Roadmap' }
    ];
    return metrics.filter((metric) => metric.score > 0);
  }

  get opportunityCenterMetrics(): Array<{ label: string; value: string; hint: string }> {
    const sampled = this.result?.signalsUsed?.jobsDemand?.sampledJobs || this.result?.careerPaths?.length || 0;
    const strong = (this.result?.careerPaths || []).filter((path) => Number(path.match || 0) >= 75).length;
    return [
      { label: 'Matched jobs', value: String(sampled), hint: 'Jobs Hub and career path signal volume.' },
      { label: 'Top demanded skills', value: this.topDemandedSkills.slice(0, 3).join(', ') || this.highestPrioritySkill, hint: 'Most useful skills to reinforce now.' },
      { label: 'Strongest opportunities', value: this.topCareerOpportunities.join(', ') || this.recommendedCareerPath, hint: `${strong} paths at 75% match or better.` },
    ].filter((metric) => metric.value && metric.value !== '0');
  }

  get estimatedGrowthLabel(): string {
    const gain = Math.min(24, Math.max(6, Math.round(this.priorityActions.slice(0, 3).reduce((sum, card) => sum + Number(card.estimatedImpact || 0), 0) / 12)));
    return `+${gain} readiness pts`;
  }

  get currentReadiness(): number {
    return Number(this.result?.recommendationScores?.overallRecommendationScore || this.result?.recommendationScores?.readinessScore || 0);
  }

  get targetReadiness(): number {
    return Math.min(95, Math.max(80, this.currentReadiness + (this.currentReadiness < 65 ? 20 : 12)));
  }

  get priorityLevel(): string {
    return String(this.priorityActions[0]?.priority || '');
  }

  get estimatedCompletionTime(): string {
    return String(this.priorityActions[0]?.estimatedEffort || this.result?.projects?.[0]?.estimatedWeeks || '');
  }

  get topCareerOpportunities(): string[] {
    return (this.result?.careerPaths || [])
      .slice()
      .sort((a, b) => Number(b.match || 0) - Number(a.match || 0))
      .map((path) => path.title)
      .filter(Boolean)
      .slice(0, 3);
  }

  get jobsReadinessMetrics(): Array<{ label: string; value: string; hint: string }> {
    const sampled = Number(this.result?.signalsUsed?.jobsDemand?.sampledJobs || 0);
    const paths = this.result?.careerPaths || [];
    const strong = paths.filter((path) => Number(path.match || 0) >= 75).length;
    const weak = Math.max(0, paths.length - strong);
    const demanded = this.topDemandedSkills.length;
    return [
      { label: 'Matched Jobs', value: String(sampled || paths.length || 0), hint: 'Jobs Hub market samples and matched role signals.' },
      { label: 'Strong Matches', value: String(strong), hint: 'Career paths with 75% or better alignment.' },
      { label: 'Weak Matches', value: String(weak), hint: 'Roles that need more proof, skills, or resume alignment.' },
      { label: 'Demanded Skills', value: String(demanded), hint: this.topDemandedSkills.join(', ') || 'No market skill samples yet.' }
    ];
  }

  get topDemandedSkills(): string[] {
    return [
      ...(this.result?.signalsUsed?.jobsDemand?.topSkills || []).map((skill) => skill.name),
      ...(this.result?.signalsUsed?.skillGap?.highDemandSkills || []).map((skill) => skill.name),
      ...(this.result?.technologies || []).map((tech) => tech.name)
    ].filter((skill, index, list) => skill && list.findIndex((item) => item.toLowerCase() === skill.toLowerCase()) === index).slice(0, 6);
  }

  get recommendedNextSkills(): string[] {
    return [
      ...this.topMissingSkills,
      ...this.topDemandedSkills
    ].filter((skill, index, list) => skill && list.findIndex((item) => item.toLowerCase() === skill.toLowerCase()) === index).slice(0, 6);
  }

  get interviewReadinessMetrics(): Array<{ label: string; value: number; hint: string }> {
    const scores = this.result?.recommendationScores;
    const technical = Math.round(((scores?.interviewScore || 0) + (this.result?.signalsUsed?.skillGap?.coverage || 0)) / 2);
    const behavioral = Math.round(((scores?.careerGrowthScore || 0) + (this.result?.signalsUsed?.resume?.atsScore || 0)) / 2);
    const designBoost = this.result?.signalsUsed?.github?.repoCount ? 8 : 0;
    const systemDesign = Math.min(100, Math.round((scores?.portfolioScore || 0) * 0.65 + designBoost));
    return [
      { label: 'Technical Readiness', value: technical, hint: 'Skill coverage plus interview score.' },
      { label: 'Behavioral Readiness', value: behavioral, hint: 'Resume story clarity plus career-growth signal.' },
      { label: 'System Design Readiness', value: systemDesign, hint: 'Portfolio architecture proof and repository depth.' }
    ];
  }

  get interviewTopics(): string[] {
    return [
      ...this.topMissingSkills,
      ...(this.result?.signalsUsed?.resume?.weaknesses || [])
    ].filter((topic, index, list) => topic && list.findIndex((item) => item.toLowerCase() === topic.toLowerCase()) === index).slice(0, 6);
  }

  get portfolioMetrics(): Array<{ label: string; value: string; hint: string }> {
    const portfolio = this.result?.signalsUsed?.portfolio;
    return [
      { label: 'Portfolio Score', value: this.scoreLabel(portfolio?.completenessScore, this.dataQuality.hasPortfolioData), hint: this.dataQuality.hasPortfolioData ? 'Current portfolio completeness and proof quality.' : 'Add portfolio projects to improve this.' },
      { label: 'Projects', value: String(portfolio?.projectCount || this.result?.projects?.length || 0), hint: 'Visible projects available for recruiter review.' },
      { label: 'Live Links', value: String(portfolio?.liveLinkCount || 0), hint: 'Deployments or demos that reduce reviewer friction.' },
      { label: 'Missing Sections', value: String(this.portfolioMissingSections.length), hint: this.portfolioMissingSections.join(', ') }
    ];
  }

  get portfolioMissingSections(): string[] {
    const missing = [];
    const portfolio = this.result?.signalsUsed?.portfolio;
    if (!portfolio?.liveLinkCount) missing.push('live demos');
    if ((portfolio?.projectCount || 0) < 3) missing.push('3 polished projects');
    if (!this.signalProofList || this.signalProofList.includes('No strong')) missing.push('external proof');
    if (this.topMissingSkills.length) missing.push('skill-gap project proof');
    return missing;
  }

  get resumeMetrics(): Array<{ label: string; value: string; hint: string }> {
    const resume = this.result?.signalsUsed?.resume;
    return [
      { label: 'Resume Score', value: this.scoreLabel(resume?.atsScore, this.dataQuality.hasResumeData), hint: this.dataQuality.hasResumeData ? 'ATS and profile readiness signal.' : 'Upload resume to improve this.' },
      { label: 'Missing Items', value: String(this.resumeMissingItems.length), hint: this.resumeMissingItems.join(', ') },
      { label: 'ATS Improvements', value: String(this.resumeAtsImprovements.length), hint: this.resumeAtsImprovements.join(', ') },
      { label: 'Recruiter Visibility', value: `${Math.min(100, Math.round((resume?.atsScore || 0) * 0.7 + (this.result?.signalsUsed?.integrations?.score || 0) * 0.3))}%`, hint: 'Resume plus external proof visibility.' }
    ];
  }

  get resumeMissingItems(): string[] {
    return [
      ...(this.result?.signalsUsed?.resume?.missingSections || []),
      ...(this.result?.signalsUsed?.resume?.weaknesses || [])
    ].filter((item, index, list) => item && list.findIndex((entry) => entry.toLowerCase() === item.toLowerCase()) === index).slice(0, 6);
  }

  get resumeAtsImprovements(): string[] {
    return (this.result?.resumeRecommendations || []).slice(0, 5);
  }

  get learningMetrics(): Array<{ label: string; value: string; hint: string }> {
    return [
      { label: 'Learning Score', value: this.scoreLabel(this.result?.recommendationScores?.learningScore, this.dataQuality.hasSkillGapData), hint: this.dataQuality.hasSkillGapData ? 'Momentum from skill coverage and weekly progress.' : 'Generate Skill Gap first.' },
      { label: 'Skill Coverage', value: this.scoreLabel(this.result?.signalsUsed?.skillGap?.coverage, this.dataQuality.hasSkillGapData), hint: this.dataQuality.hasSkillGapData ? 'Known skills compared with target role needs.' : 'Generate Skill Gap first.' },
      { label: 'Recommended Skills', value: String(this.recommendedNextSkills.length), hint: this.recommendedNextSkills.join(', ') },
      { label: 'Sprint Focus', value: this.getSprintFocus(), hint: `${this.result?.signalsUsed?.careerSprint?.streak || 0} day streak` }
    ];
  }

  get roadmapWeeks(): Array<{ label: string; milestone: string; actions: string[]; progress: number; sprint: string }> {
    return this.roadmapTimeline.map((phase) => ({
      label: phase.label,
      milestone: phase.items[0] || '',
      actions: phase.items,
      progress: 0,
      sprint: ''
    }));
  }

  get learningPlanCards(): RecommendationCard[] {
    return this.learningCards;
  }

  get portfolioActionCards(): RecommendationCard[] {
    return this.portfolioCards;
  }

  get resumeActionCards(): RecommendationCard[] {
    return this.resumeCards;
  }

  get jobsActionCards(): RecommendationCard[] {
    return this.jobsCards;
  }

  get interviewActionCards(): RecommendationCard[] {
    return this.interviewCards;
  }

  get hasActionPlan(): boolean {
    return this.allCards.length > 0;
  }

  get cacheStateLabel(): string {
    if (this.isCachedResultStale) return 'stale';
    if (this.loadingState === 'cache-hit' || this.result?.fromFrontendCache || this.result?.fromCache) return 'cache-hit';
    if (this.loadingState === 'refreshing') return 'refreshing';
    if (this.loadingState === 'loading') return 'loading';
    if (this.loadingState === 'error') return 'error';
    if (!this.result) return 'empty';
    return 'ready';
  }

  get isCachedResultStale(): boolean {
    const cachedAt = this.result?.cacheMetadata?.cachedAt;
    const ttlHours = Number(this.result?.cacheMetadata?.ttlHours || 0);
    if (!cachedAt || !ttlHours) return false;
    const timestamp = new Date(cachedAt).getTime();
    return Number.isFinite(timestamp) && Date.now() - timestamp > ttlHours * 60 * 60 * 1000;
  }

  get signalProviderList(): string {
    const providers = this.result?.signalsUsed?.integrations?.providers || [];
    return providers.length ? providers.join(', ') : 'No extra integrations';
  }

  get signalProofList(): string {
    const proof = this.result?.signalsUsed?.integrations?.strongestProof || [];
    return proof.join(', ');
  }

  get weeklyTrendLabel(): string {
    const delta = Number(this.result?.signalsUsed?.weeklyProgress?.trendDelta || 0);
    return delta > 0 ? `+${delta}` : `${delta}`;
  }

  getSprintFocus(): string {
    return this.result?.signalsUsed?.careerSprint?.activeLearningFocus || '';
  }

  get analysisLastUpdatedLabel(): string {
    const value = this.result?.analysisBasedOn?.lastAnalyzedAt || this.result?.cacheMetadata?.cachedAt;
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
  }

  formatSourceLabel(source: string): string {
    return String(source || '').replace(/signals?$/i, '').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
  }

  get resumeStatusLabel(): string {
    return this.result?.analysisBasedOn?.resumeStatus || this.result?.resumeStatusMessage || 'Resume not analyzed yet';
  }

  get scoreExplanation(): Record<string, string> {
    return this.result?.recommendationScores?.explanation || {};
  }

  getProjectStartUrl(project: RecommendedProject): string {
    const url = String(project?.startUrl || '').trim();
    if (/^https?:\/\//i.test(url)) return url;
    return '';
  }

  getCareerExploreUrl(path: CareerPath): string {
    const url = String(path?.exploreUrl || '').trim();
    if (/^https?:\/\//i.test(url)) return url;
    return '';
  }

  runAction(card: RecommendationCard): void {
    const target = String(card.actionUrl || '').trim();
    if (!target) return;
    if (/^https?:\/\//i.test(target)) {
      window.open(target, '_blank', 'noopener,noreferrer');
      return;
    }
    this.router.navigateByUrl(target);
  }

  actionToSprint(card: RecommendationCard): void {
    const task = {
      title: card.title,
      description: `${card.reason || card.description} Evidence: ${(card.evidence || []).join(', ')}`,
      points: Math.max(1, Math.round((Number(card.estimatedImpact || 50) / 100) * 5))
    };
    this.actionMessage = 'Creating sprint task...';
    this.api.getCurrentCareerSprint().subscribe({
      next: (sprint: any) => {
        const sprintId = sprint?._id || sprint?.id;
        const request$ = sprintId
          ? this.api.addCareerSprintTask(sprintId, task)
          : this.api.createCareerSprint({
              title: 'Recommendation Sprint',
              weeklyGoal: 5,
              tasks: [task]
            });
        request$.subscribe({
          next: () => {
            this.actionMessage = 'Career Sprint task created.';
            this.router.navigateByUrl('/app/career-sprint');
          },
          error: () => {
            this.actionMessage = '';
            this.errorMessage = 'Could not create a Career Sprint task. Open Career Sprint and try again.';
            this.cdr.detectChanges();
          }
        });
      },
      error: () => {
        this.actionMessage = '';
        this.router.navigateByUrl('/app/career-sprint');
      }
    });
  }

  barWidth(pct: number): string {
    return `${Math.min(100, Math.max(0, Number(pct || 0)))}%`;
  }

  getPriorityClass(priority: string = ''): string {
    const raw = String(priority || '').toLowerCase();
    if (raw.includes('high') || raw.includes('must')) return 'priority-must';
    if (raw.includes('medium')) return 'priority-high';
    return 'priority-rec';
  }

  getDifficultyClass(d: RecommendedProject['difficulty']): string {
    switch (d) {
      case 'Advanced': return 'badge-advanced';
      case 'Intermediate': return 'badge-intermediate';
      default: return 'badge-beginner';
    }
  }

  getMatchClass(match: number): string {
    if (match >= 75) return 'match-green';
    if (match >= 50) return 'match-purple';
    return 'match-blue';
  }

  getExpectedOutcome(card: RecommendationCard): string {
    const impact = Number(card.estimatedImpact || 0);
    if (impact >= 85) return 'Material readiness lift and stronger recruiter signal.';
    if (impact >= 70) return 'Clear improvement in market alignment and portfolio proof.';
    return 'Focused progress on a specific career gap.';
  }

  trackById(_: number, item: { id: string }): string {
    return item.id;
  }

  trackByName(_: number, item: RecommendedTechnology): string {
    return item.name;
  }

  private applyResult(
    data: RecommendationsResult,
    user: string,
    careerStack: string,
    experienceLevel: string,
    isTemporary: boolean,
    state: LoadingState
  ): void {
    this.result = this.normalizeResult(data, user, careerStack, experienceLevel);
    if (!this.availableSections.includes(this.activeSection)) this.activeSection = 'Career Overview';
    this.viewedUsername = user;
    this.isTemporaryView = isTemporary;
    this.isLoading = false;
    this.loadingState = state;
    this.cdr.detectChanges();
  }

  private normalizeResult(data: RecommendationsResult | null, user: string, careerStack: string, experienceLevel: string): RecommendationsResult {
    const signalsUsed = this.normalizeSignalsUsed(data?.signalsUsed, user);
    const scores = this.normalizeScores(data?.recommendationScores);
    const baseResult = {
      username: data?.username || user,
      careerStack: data?.careerStack || careerStack,
      experienceLevel: data?.experienceLevel || experienceLevel,
      projects: (Array.isArray(data?.projects) ? data.projects : []).slice().sort((a, b) => this.valueRank(b) - this.valueRank(a)),
      technologies: (Array.isArray(data?.technologies) ? data.technologies : []).slice().sort((a, b) => this.valueRank(b) - this.valueRank(a)),
      careerPaths: (Array.isArray(data?.careerPaths) ? data.careerPaths : []).slice().sort((a, b) => this.valueRank(b) - this.valueRank(a)),
      analysisSummary: typeof data?.analysisSummary === 'string' ? data.analysisSummary : '',
      portfolioRecommendations: Array.isArray(data?.portfolioRecommendations) ? data.portfolioRecommendations : [],
      resumeRecommendations: Array.isArray(data?.resumeRecommendations) ? data.resumeRecommendations : [],
      learningActions: Array.isArray(data?.learningActions) ? data.learningActions : [],
      interviewReadinessActions: Array.isArray(data?.interviewReadinessActions) ? data.interviewReadinessActions : [],
      signalsUsed,
      recommendationScores: scores,
      dataQuality: this.normalizeDataQuality(data?.dataQuality, signalsUsed),
      recommendationSignals: data?.recommendationSignals || {}
    };
    const structured = this.normalizeStructured(data?.structuredRecommendations, baseResult);
    const roadmap = this.normalizeRoadmap(data?.roadmap, structured);

    return {
      ...baseResult,
      analysisBasedOn: this.normalizeAnalysisBasedOn(data?.analysisBasedOn, user, careerStack, experienceLevel),
      resumeStatusMessage: typeof data?.resumeStatusMessage === 'string' ? data.resumeStatusMessage : '',
      claimedButNotProvenSkills: Array.isArray(data?.claimedButNotProvenSkills) ? data.claimedButNotProvenSkills : [],
      githubSkills: Array.isArray(data?.githubSkills) ? data.githubSkills : [],
      resumeSkills: Array.isArray(data?.resumeSkills) ? data.resumeSkills : [],
      structuredRecommendations: structured,
      roadmap,
      recommendationVersioning: data?.recommendationVersioning,
      cacheMetadata: data?.cacheMetadata,
      fromCache: Boolean(data?.fromCache),
      fromFrontendCache: Boolean(data?.fromFrontendCache),
      cacheState: data?.cacheState
    };
  }

  private normalizeDataQuality(raw: any, signals: RecommendationSignalsUsed) {
    const hasGitHubData = Boolean(raw?.hasGitHubData ?? signals.github.repoCount);
    const hasResumeData = Boolean(raw?.hasResumeData ?? signals.resume.analyzed);
    const hasSkillGapData = Boolean(raw?.hasSkillGapData ?? signals.skillGap?.present);
    const hasPortfolioData = Boolean(raw?.hasPortfolioData ?? (signals.portfolio.present || signals.portfolio.projectCount));
    const hasJobMarketData = Boolean(raw?.hasJobMarketData ?? (signals.jobsDemand?.sampledJobs || signals.jobsDemand?.topSkills?.length));
    const available = [hasGitHubData, hasResumeData, hasSkillGapData, hasPortfolioData, hasJobMarketData];
    return {
      hasGitHubData, hasResumeData, hasSkillGapData, hasPortfolioData, hasJobMarketData,
      dataCompleteness: Number.isFinite(Number(raw?.dataCompleteness)) ? Number(raw.dataCompleteness) : Math.round((available.filter(Boolean).length / available.length) * 100),
      scoreAvailability: raw?.scoreAvailability || {}
    };
  }

  private normalizeScores(raw?: RecommendationScores): RecommendationScores {
    return {
      readinessScore: Number(raw?.readinessScore || 0),
      portfolioScore: Number(raw?.portfolioScore || 0),
      learningScore: Number(raw?.learningScore || 0),
      interviewScore: Number(raw?.interviewScore || 0),
      marketReadinessScore: Number(raw?.marketReadinessScore || 0),
      careerGrowthScore: Number(raw?.careerGrowthScore || 0),
      overallRecommendationScore: Number(raw?.overallRecommendationScore || 0),
      explanation: raw?.explanation || {}
    };
  }

  private normalizeStructured(raw: Record<string, RecommendationCard[]> | undefined, result: Partial<RecommendationsResult>): Record<string, RecommendationCard[]> {
    const out: Record<string, RecommendationCard[]> = {};
    Object.entries(raw || {}).forEach(([category, cards]) => {
      out[category] = Array.isArray(cards) ? this.sortCards(cards.map((card, index) => ({
        id: card.id || `${category}_${index}`,
        category: card.category || category,
        title: card.title || '',
        description: card.description || '',
        priority: card.priority || '',
        confidenceScore: Number(card.confidenceScore || 0),
        reason: card.reason || '',
        evidence: Array.isArray(card.evidence) ? card.evidence : [],
        sourceSignalsUsed: Array.isArray(card.sourceSignalsUsed) ? card.sourceSignalsUsed : [],
        estimatedImpact: Number(card.estimatedImpact || 0),
        estimatedEffort: card.estimatedEffort || '',
        actionUrl: card.actionUrl || '',
        actionLabel: card.actionLabel || ''
      })).filter((card) => card.title)) : [];
    });
    return out;
  }

  private normalizeRoadmap(raw: RecommendationRoadmap | undefined, structured: Record<string, RecommendationCard[]>): RecommendationRoadmap {
    const phases = (raw?.timeline || []).map((phase) => ({
      label: String(phase.label || '').trim(),
      items: (phase.items || []).map((item) => String(item || '').trim()).filter(Boolean)
    })).filter((phase) => phase.label && phase.items.length);

    return {
      immediateActions: this.sortCards(Array.isArray(raw?.immediateActions) ? raw.immediateActions : []),
      next30Days: this.sortCards(Array.isArray(raw?.next30Days) ? raw.next30Days : []),
      next60Days: this.sortCards(Array.isArray(raw?.next60Days) ? raw.next60Days : []),
      next90Days: this.sortCards(Array.isArray(raw?.next90Days) ? raw.next90Days : []),
      longTermGrowth: this.sortCards(Array.isArray(raw?.longTermGrowth) ? raw.longTermGrowth : []),
      suggestedProjects: Array.isArray(raw?.suggestedProjects) ? raw.suggestedProjects : [],
      suggestedCertifications: Array.isArray(raw?.suggestedCertifications) ? raw.suggestedCertifications : structured['Certification Recommendations'] || [],
      suggestedTechnologies: Array.isArray(raw?.suggestedTechnologies) ? raw.suggestedTechnologies : [],
      suggestedLearningPath: Array.isArray(raw?.suggestedLearningPath) ? raw.suggestedLearningPath : [],
      timeline: phases
    };
  }

  private fallbackCardsFor(category: string, result: Partial<RecommendationsResult>): RecommendationCard[] {
    const signals = result.signalsUsed;
    const missing = [
      ...(signals?.skillGap?.missingSkills || []),
      ...((result.recommendationSignals as any)?.skills?.missingSkills || []),
      ...(result.technologies || []).map((tech) => tech.name)
    ].filter(Boolean);
    const firstMissing = missing[0] || 'your highest-value skill gap';
    const careerPath = result.careerPaths?.[0]?.title || `${result.careerStack || 'Full Stack'} Engineer`;
    const fallbackMap: Record<string, RecommendationCard[]> = {
      'Learning Recommendations': [
        this.makeFallbackCard({
          id: 'fallback_learning_1',
          category,
          title: `Practice ${firstMissing} in a small shipped artifact`,
          description: `Turn ${firstMissing} into visible proof instead of passive study.`,
          priority: 'High',
          evidence: missing.slice(0, 4),
          sources: ['skillGapSignals', 'recommendationSignals', 'jobMarketSignals'],
          impact: 82,
          effort: '1-2 weeks',
          actionUrl: '/app/courses',
          actionLabel: 'Open Learning Hub'
        })
      ],
      'Interview Recommendations': [
        this.makeFallbackCard({
          id: 'fallback_interview_1',
          category,
          title: 'Prepare one proof-backed project story',
          description: 'Convert your strongest project or repository into a concise interview narrative.',
          priority: 'High',
          evidence: [signals?.github?.repoCount ? `${signals.github.repoCount} repositories` : '', signals?.resume?.atsScore ? `ATS ${signals.resume.atsScore}` : ''].filter(Boolean),
          sources: ['githubSignals', 'resumeSignals'],
          impact: 78,
          effort: '3 focused sessions',
          actionUrl: '/app/interview-prep',
          actionLabel: 'Open Interview Prep'
        })
      ],
      'Job Readiness Recommendations': [
        this.makeFallbackCard({
          id: 'fallback_jobs_1',
          category,
          title: 'Compare your profile against current matched jobs',
          description: 'Use Jobs Hub demand to prioritize applications and close the most visible gaps.',
          priority: 'High',
          evidence: (signals?.jobsDemand?.topSkills || []).map((skill) => skill.name).slice(0, 5),
          sources: ['jobMarketSignals', 'skillGapSignals'],
          impact: 84,
          effort: '1 week',
          actionUrl: '/app/jobs',
          actionLabel: 'Open Jobs'
        })
      ],
      'Portfolio Recommendations': [
        this.makeFallbackCard({
          id: 'fallback_portfolio_1',
          category,
          title: 'Publish one polished project case study',
          description: 'Show the problem, stack, decisions, screenshots, and measurable outcome for your strongest project.',
          priority: (signals?.portfolio?.completenessScore || 0) < 70 ? 'High' : 'Medium',
          evidence: [`Portfolio ${signals?.portfolio?.completenessScore || 0}%`, `${signals?.portfolio?.liveLinkCount || 0} live links`],
          sources: ['portfolioSignals', 'githubSignals'],
          impact: 80,
          effort: '1-3 days',
          actionUrl: '/app/portfolio',
          actionLabel: 'Open Portfolio'
        })
      ],
      'Resume Recommendations': [
        this.makeFallbackCard({
          id: 'fallback_resume_1',
          category,
          title: 'Align resume bullets to proven skills and target jobs',
          description: 'Add measurable outcomes and naturally include target-role keywords backed by GitHub or portfolio proof.',
          priority: (signals?.resume?.atsScore || 0) < 70 ? 'High' : 'Medium',
          evidence: [`ATS ${signals?.resume?.atsScore || 0}`, ...missing.slice(0, 3)],
          sources: ['resumeSignals', 'skillGapSignals', 'githubSignals'],
          impact: 80,
          effort: '1-2 days',
          actionUrl: '/app/resume-analyzer',
          actionLabel: 'Open Resume'
        })
      ],
      'Career Growth Recommendations': [
        this.makeFallbackCard({
          id: 'fallback_career_1',
          category,
          title: careerPath,
          description: `Use ${careerPath} as the near-term path while strengthening proof around ${firstMissing}.`,
          priority: 'High',
          evidence: [result.careerStack || '', result.experienceLevel || '', firstMissing],
          sources: ['careerProfile', 'skillGapSignals', 'jobMarketSignals'],
          impact: 76,
          effort: '3-6 months',
          actionUrl: '/app/jobs',
          actionLabel: 'Open Jobs'
        })
      ]
    };
    return fallbackMap[category] || [];
  }

  private makeFallbackCard(input: {
    id: string;
    category: string;
    title?: string;
    description?: string;
    priority?: string;
    evidence?: string[];
    sources?: string[];
    impact?: number;
    effort?: string;
    actionUrl?: string;
    actionLabel?: string;
  }): RecommendationCard {
    return {
      id: input.id,
      category: input.category,
      title: input.title || 'Review this recommendation',
      description: input.description || 'Use available platform signals to choose the next practical action.',
      priority: input.priority || 'Medium',
      confidenceScore: 72,
      reason: input.description || 'Generated from deterministic platform signals because AI output was incomplete.',
      evidence: (input.evidence || []).filter(Boolean).slice(0, 6),
      sourceSignalsUsed: (input.sources || ['recommendationSignals']).filter(Boolean),
      estimatedImpact: Number(input.impact || 70),
      estimatedEffort: input.effort || 'Medium',
      actionUrl: input.actionUrl,
      actionLabel: input.actionLabel || 'Open'
    };
  }

  private dedupeCards(cards: RecommendationCard[]): RecommendationCard[] {
    return cards.filter((card, index, list) =>
      card.title && list.findIndex((item) => item.title.toLowerCase() === card.title.toLowerCase()) === index
    );
  }

  private sortCards(cards: RecommendationCard[]): RecommendationCard[] {
    return this.dedupeCards(cards).slice().sort((a, b) => this.valueRank(b) - this.valueRank(a));
  }

  private valueRank(item: any): number {
    const priority = String(item?.priority || item?.priorityRaw || '').toLowerCase();
    const priorityWeight = priority.includes('high') || priority.includes('must') ? 300 : priority.includes('medium') ? 200 : 100;
    return priorityWeight + Number(item?.estimatedImpact || item?.impact || item?.match || item?.jobDemand || item?.confidenceScore || 0);
  }

  private cardsFor(category: string): RecommendationCard[] {
    return this.sortCards(this.result?.structuredRecommendations?.[category] || []);
  }

  private pathToCard(path: CareerPath): RecommendationCard {
    return {
      id: path.id,
      category: 'Career Growth Recommendations',
      title: path.title,
      description: path.description,
      priority: path.priority || 'Medium',
      confidenceScore: Number(path.confidenceScore || path.match || 0),
      reason: path.reason || path.description,
      evidence: path.evidence || path.actionItems || [],
      sourceSignalsUsed: path.sourceSignalsUsed || [],
      estimatedImpact: Number(path.estimatedImpact || path.match || 0),
      estimatedEffort: path.estimatedEffort || path.timeline,
      actionUrl: path.exploreUrl,
      actionLabel: 'Explore'
    };
  }

  private normalizeSignalsUsed(raw: any, username: string): RecommendationSignalsUsed {
    return {
      github: {
        connected: Boolean(raw?.github?.connected ?? username),
        username: raw?.github?.username || username,
        repoCount: Number(raw?.github?.repoCount || 0),
        developerLevel: raw?.github?.developerLevel || ''
      },
      resume: {
        analyzed: Boolean(raw?.resume?.analyzed),
        analysisId: raw?.resume?.analysisId || '',
        atsScore: Number(raw?.resume?.atsScore || 0),
        experienceLevel: raw?.resume?.experienceLevel || '',
        fileName: raw?.resume?.fileName || '',
        lastAnalyzedAt: raw?.resume?.lastAnalyzedAt || null,
        extractedSkills: Array.isArray(raw?.resume?.extractedSkills) ? raw.resume.extractedSkills : [],
        experienceKeywords: Array.isArray(raw?.resume?.experienceKeywords) ? raw.resume.experienceKeywords : [],
        strengths: Array.isArray(raw?.resume?.strengths) ? raw.resume.strengths : [],
        weaknesses: Array.isArray(raw?.resume?.weaknesses) ? raw.resume.weaknesses : [],
        missingSections: Array.isArray(raw?.resume?.missingSections) ? raw.resume.missingSections : [],
        statusMessage: raw?.resume?.statusMessage || ''
      },
      portfolio: {
        present: Boolean(raw?.portfolio?.present),
        completenessScore: Number(raw?.portfolio?.completenessScore || 0),
        projectCount: Number(raw?.portfolio?.projectCount || 0),
        liveLinkCount: Number(raw?.portfolio?.liveLinkCount || 0)
      },
      integrations: {
        providers: Array.isArray(raw?.integrations?.providers) ? raw.integrations.providers : [],
        score: Number(raw?.integrations?.score || 0),
        strongestProof: Array.isArray(raw?.integrations?.strongestProof) ? raw.integrations.strongestProof : []
      },
      weeklyProgress: {
        status: raw?.weeklyProgress?.status || 'Unavailable',
        score: Number(raw?.weeklyProgress?.score || 0),
        trendDelta: Number(raw?.weeklyProgress?.trendDelta || 0)
      },
      careerSprint: {
        consistencyScore: Number(raw?.careerSprint?.consistencyScore || 0),
        streak: Number(raw?.careerSprint?.streak || 0),
        activeLearningFocus: raw?.careerSprint?.activeLearningFocus || ''
      },
      skillGap: {
        present: Boolean(raw?.skillGap?.present),
        coverage: Number(raw?.skillGap?.coverage || 0),
        knownSkills: Array.isArray(raw?.skillGap?.knownSkills) ? raw.skillGap.knownSkills : [],
        missingSkills: Array.isArray(raw?.skillGap?.missingSkills) ? raw.skillGap.missingSkills : [],
        weakSkills: Array.isArray(raw?.skillGap?.weakSkills) ? raw.skillGap.weakSkills : [],
        highDemandSkills: Array.isArray(raw?.skillGap?.highDemandSkills) ? raw.skillGap.highDemandSkills : [],
        updatedAt: raw?.skillGap?.updatedAt || null
      },
      careerProfile: {
        careerStack: raw?.careerProfile?.careerStack || '',
        experienceLevel: raw?.careerProfile?.experienceLevel || '',
        careerGoal: raw?.careerProfile?.careerGoal || ''
      },
      jobsDemand: {
        sampledJobs: Number(raw?.jobsDemand?.sampledJobs || 0),
        topSkills: Array.isArray(raw?.jobsDemand?.topSkills) ? raw.jobsDemand.topSkills : []
      }
    };
  }

  private normalizeAnalysisBasedOn(raw: any, username: string, careerStack: string, experienceLevel: string): AnalysisBasedOn {
    return {
      githubUsername: raw?.githubUsername || username,
      resumeAnalyzed: Boolean(raw?.resumeAnalyzed),
      resumeStatus: raw?.resumeStatus || 'Resume not analyzed yet',
      careerStack: raw?.careerStack || careerStack,
      experienceLevel: raw?.experienceLevel || experienceLevel,
      lastAnalyzedAt: raw?.lastAnalyzedAt || null
    };
  }
}
