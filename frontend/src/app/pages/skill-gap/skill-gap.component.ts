import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  SkillGapService,
  SkillGapResult,
  CurrentSkill,
  MissingSkill,
  RoadmapPhase,
  SkillPriority,
  SkillTimelineItem,
  SuggestedSkillProject,
  WeeklyRoadmapWeek
} from '../../shared/services/skill-gap.service';
import { GithubService } from '../../shared/services/github.service';
import { CareerProfileService } from '../../shared/services/career-profile.service';
import { ResumeService } from '../../shared/services/resume.service';
import { buildCareerProfileSignature } from '../../shared/models/career-profile.model';
import { AuthService } from '../../shared/services/auth.service';
import { FrontendAnalysisCacheService } from '../../shared/services/frontend-analysis-cache.service';
import { RecommendationsService } from '../../shared/services/recommendations.service';
import { Subscription } from 'rxjs';
import { distinctUntilChanged } from 'rxjs/operators';

type SkillCardKind = 'gap' | 'strength' | 'weak';

interface SkillCardViewModel {
  id: string;
  name: string;
  category?: string;
  kind: SkillCardKind;
  priority?: SkillPriority;
  priorityLabel?: string;
  confidence?: number;
  proficiency?: number;
  demand?: number;
  demandLabel?: string;
  whyItMatters?: string;
  evidence: string[];
  evidenceSummary: string;
  detectionMethod: string;
  learningPath?: string;
  learningEffort?: string;
  project?: SuggestedSkillProject;
  nextAction?: string;
  resources: Array<{ title: string; url: string } | string>;
  isProven: boolean;
}

interface NextActionViewModel {
  skill: string;
  title: string;
  detail?: string;
  priority?: SkillPriority;
}

interface MarketInsightViewModel {
  label: string;
  value: string;
  detail?: string;
  tone: 'primary' | 'success' | 'warning';
}

interface CategoryBreakdownViewModel {
  name: string;
  coverage: number;
  current: number;
  gaps: number;
}

interface DistributionViewModel {
  label: string;
  count: number;
  tone: 'strong' | 'good' | 'average' | 'weak';
}

@Component({
  selector: 'app-skill-gap',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './skill-gap.component.html',
  styleUrl: './skill-gap.component.scss',
})
export class SkillGapComponent implements OnInit, OnDestroy {
  username = '';
  defaultUsername = '';
  viewedUsername = '';
  isLoading = false;
  isInitLoading = true;
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
  profileResultBackup: SkillGapResult | null = null;
  isSavingPreview = false;
  previewSaveMessage = '';

  result: SkillGapResult | null = null;
  topGapCards: SkillCardViewModel[] = [];
  remainingGapCards: SkillCardViewModel[] = [];
  strengthCards: SkillCardViewModel[] = [];
  weakSkillCards: SkillCardViewModel[] = [];
  recommendedActions: NextActionViewModel[] = [];
  marketInsights: MarketInsightViewModel[] = [];
  categoryBreakdown: CategoryBreakdownViewModel[] = [];
  matchDistribution: DistributionViewModel[] = [];
  showAllGaps = false;
  private readonly subscriptions: Subscription = new Subscription();
  private activeAnalyzeKey = '';

  constructor(
    private readonly skillGapService:    SkillGapService,
    private readonly githubService:      GithubService,
    private readonly careerProfileService: CareerProfileService,
    private readonly authService:        AuthService,
    private readonly frontendCache:      FrontendAnalysisCacheService,
    private readonly resumeService:       ResumeService,
    private readonly recommendationsService: RecommendationsService,
    private readonly cdr:                ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    // Subscribe to profile signal changes and re-analyze once per distinct profile hash/signature.
    this.subscriptions.add(
      this.careerProfileService.careerProfile$.pipe(
        distinctUntilChanged((a, b) => buildCareerProfileSignature(a) === buildCareerProfileSignature(b))
      ).subscribe(() => {
        const activeUsername = this.getStoredActiveUsername();
        if (activeUsername) this.applyDefaultUsername(activeUsername);
        if (this.username) this.analyze();
      })
    );

    this.isInitLoading = true;
    const storedUsername = this.getStoredActiveUsername();
    if (storedUsername) {
      this.applyDefaultUsername(storedUsername);
      this.isInitLoading = false;
      this.analyze();
      this.cdr.detectChanges();
      return;
    }

    this.subscriptions.add(
      this.githubService.getActiveUsername().subscribe({
        next: (data) => {
          this.applyDefaultUsername(data.username || '');
          this.isInitLoading = false;
          if (this.username) this.analyze();
          this.cdr.detectChanges();
        },
        error: () => {
          this.isInitLoading = false;
          this.cdr.detectChanges();
        }
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
    this.subscriptions.unsubscribe();
  }

  setMode(preview: boolean): void {
    if (this.isLoading) return;
    this.isPreviewMode = preview;
    if (preview) {
      // Back up profile result if not already temporary
      if (this.result && !this.isTemporaryView) {
        this.profileResultBackup = this.result;
      }
      this.result = null;
      this.clearPresentation();
      this.errorMessage = '';
    } else {
      // Restore backup if present
      if (this.profileResultBackup) {
        this.applyResult(this.profileResultBackup, this.defaultUsername, this.profileResultBackup.careerStack, this.profileResultBackup.experienceLevel, false);
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
      this.cdr.detectChanges();
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      this.errorMessage = 'File is too large. Max size is 5MB.';
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

  analyze(forceRefresh = false): void {
    const user = this.isPreviewMode ? this.previewGithubUsername.trim() : this.username.trim();
    if (!user) {
      if (this.isPreviewMode) {
        this.errorMessage = 'GitHub username is required for preview.';
      }
      return;
    }

    const careerStack = this.isPreviewMode ? this.previewCareerStack : this.careerProfileService.careerStack;
    const experienceLevel = this.isPreviewMode ? this.previewExperienceLevel : this.careerProfileService.experienceLevel;
    const isTemporary = this.isPreviewMode;
    const resumeText = this.isPreviewMode ? this.previewResumeText : '';
    const previewResumeId = isTemporary && !resumeText.trim() ? this.previewResumeId : '';
    const previewResumeHash = previewResumeId ? this.previewResumeHash : '';

    const analyzeKey = [
      user.toLowerCase(),
      careerStack,
      experienceLevel,
      isTemporary ? 'temporary' : 'saved',
      forceRefresh ? 'refresh' : 'normal',
      isTemporary ? (previewResumeHash || (resumeText ? `inline-${resumeText.length}` : 'no-resume')) : 'profile'
    ].join('|');

    if (this.isLoading && this.activeAnalyzeKey === analyzeKey) return;

    const currentSignalHash = !isTemporary
      ? this.frontendCache.getCurrentSignalHash({ module: 'developer-signals', careerStack, experienceLevel })
      : null;
    const cached = !forceRefresh && !isTemporary
      ? this.skillGapService.getCachedResult(user, careerStack, experienceLevel)
      : null;
    const cachedSignalHash = this.skillGapService.extractSignalHash(cached);

    this.errorMessage = '';
    if (cached && currentSignalHash && cachedSignalHash === currentSignalHash) {
      this.applyResult(cached, user, careerStack, experienceLevel, isTemporary);
      this.isLoading = false;
      this.cdr.detectChanges();
      return;
    }

    if (cached && currentSignalHash && cachedSignalHash && cachedSignalHash !== currentSignalHash) {
      this.skillGapService.invalidateCachedResult(careerStack, experienceLevel);
    }

    this.isLoading = true;
    this.activeAnalyzeKey = analyzeKey;
    this.result = null;
    this.clearPresentation();
    this.cdr.detectChanges();

    this.skillGapService.analyze(user, careerStack, experienceLevel, isTemporary, forceRefresh, resumeText, previewResumeId, previewResumeHash).subscribe({
      next: (data: any) => {
        const raw = data?.data || data?.result || data;
        this.applyResult(raw, user, careerStack, experienceLevel, isTemporary);
        if (!isTemporary) {
          this.skillGapService.cacheResult(this.result as SkillGapResult, false);
        }
        this.isLoading = false;
        if (this.activeAnalyzeKey === analyzeKey) this.activeAnalyzeKey = '';
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.errorMessage = err?.error?.message || 'Failed to analyze skill gap. Please try again.';
        this.isLoading = false;
        this.result = null;
        this.clearPresentation();
        if (this.activeAnalyzeKey === analyzeKey) this.activeAnalyzeKey = '';
        this.cdr.detectChanges();
      }
    });
  }

  get isAuthenticated(): boolean {
    return Boolean(this.authService.getCurrentUser()?._id);
  }

  savePreview(): void {
    if (!this.result || !this.isTemporaryView || !this.isAuthenticated || this.isSavingPreview) return;
    const resumeHash = String((this.result.cacheMetadata?.cacheKey as any)?.resumeHash || 'no-resume');
    this.isSavingPreview = true;
    this.previewSaveMessage = '';
    this.recommendationsService.savePreview({
      module: 'skill-gap',
      title: `${this.result.username} Skill Gap Preview`,
      githubUsername: this.result.username,
      careerStack: this.result.careerStack,
      experienceLevel: this.result.experienceLevel,
      resumeHash,
      result: this.result
    }).subscribe({
      next: () => {
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
  refreshAnalysis(): void {
    this.analyze(true);
  }

  /* Helpers */

  private applyResult(raw: any, user: string, careerStack: string, experienceLevel: string, isTemporary: boolean): void {
    const normalized: SkillGapResult = {
      username: raw?.username || user,
      careerStack: raw?.careerStack || careerStack,
      experienceLevel: raw?.experienceLevel || experienceLevel,
      coverage: (typeof raw?.coverage === 'number') ? raw.coverage : 0,
      missing: (typeof raw?.missing === 'number') ? raw.missing : 0,
      yourSkills: Array.isArray(raw?.yourSkills) ? raw.yourSkills : [],
      missingSkills: Array.isArray(raw?.missingSkills) ? raw.missingSkills : [],
      resumeSkills: Array.isArray(raw?.resumeSkills) ? raw.resumeSkills : [],
      githubSkills: Array.isArray(raw?.githubSkills) ? raw.githubSkills : [],
      provenSkills: Array.isArray(raw?.provenSkills) ? raw.provenSkills : [],
      claimedButNotProvenSkills: Array.isArray(raw?.claimedButNotProvenSkills) ? raw.claimedButNotProvenSkills : [],
      weakSkills: Array.isArray(raw?.weakSkills) ? raw.weakSkills : [],
      highDemandSkills: Array.isArray(raw?.highDemandSkills) ? raw.highDemandSkills : [],
      immediateSkills: Array.isArray(raw?.immediateSkills) ? raw.immediateSkills : [],
      shortTermSkills: Array.isArray(raw?.shortTermSkills) ? raw.shortTermSkills : [],
      midTermSkills: Array.isArray(raw?.midTermSkills) ? raw.midTermSkills : [],
      longTermSkills: Array.isArray(raw?.longTermSkills) ? raw.longTermSkills : [],
      prerequisites: raw?.prerequisites && typeof raw.prerequisites === 'object' ? raw.prerequisites : {},
      estimatedWeeks: Number(raw?.estimatedWeeks || 0),
      suggestedProjects: Array.isArray(raw?.suggestedProjects) ? raw.suggestedProjects : [],
      coverageBreakdown: raw?.coverageBreakdown || undefined,
      cacheMetadata: raw?.cacheMetadata || undefined,
      skillGapSignals: raw?.skillGapSignals || undefined,
      fromCache: Boolean(raw?.fromCache),
      fromFrontendCache: Boolean(raw?.fromFrontendCache),
      levelAssessment: raw?.levelAssessment || '',
      analysisSummary: raw?.analysisSummary || '',
      roadmap: Array.isArray(raw?.roadmap) ? raw.roadmap : [],
      skillGraph: raw?.skillGraph?.nodes && raw?.skillGraph?.edges ? raw.skillGraph : { nodes: [], edges: [] },
      weeklyRoadmap: Array.isArray(raw?.weeklyRoadmap) ? raw.weeklyRoadmap : [],
      signalsUsed: this.normalizeSignalsUsed(raw?.signalsUsed, user),
      analysisBasedOn: this.normalizeAnalysisBasedOn(raw?.analysisBasedOn, user, careerStack, experienceLevel),
      resumeStatusMessage: typeof raw?.resumeStatusMessage === 'string' ? raw.resumeStatusMessage : '',
      totalWeeks: raw?.totalWeeks || ''
    };

    const yourCount = normalized.yourSkills.length;
    const missingCount = normalized.missingSkills.length;
    const denom = yourCount + missingCount;
    const derivedCoverage = denom > 0 ? Math.round((yourCount / denom) * 100) : 0;
    const validCoverage = Number.isFinite(Number(normalized.coverage))
      ? Math.max(0, Math.min(100, Math.round(Number(normalized.coverage))))
      : derivedCoverage;

    normalized.coverage = validCoverage;
    normalized.missing = Math.max(0, Math.min(100, 100 - validCoverage));
    this.result = normalized;
    this.viewedUsername = user;
    this.isTemporaryView = isTemporary;
    this.buildPresentationViewModels();
  }

  get currentCareerStack(): string  { return this.careerProfileService.careerStack; }
  get currentExperienceLevel(): string { return this.careerProfileService.experienceLevel; }

  returnToDefaultProfile(): void {
    if (this.isLoading) return;
    this.setMode(false);
  }

  get visibleGapCards(): SkillCardViewModel[] {
    return this.showAllGaps ? [...this.topGapCards, ...this.remainingGapCards] : this.topGapCards;
  }

  get topStrength(): SkillCardViewModel | null {
    return this.strengthCards[0] || null;
  }

  get overallSummary(): string {
    const supplied = String(this.result?.analysisSummary || this.result?.levelAssessment || '').trim();
    if (supplied) return supplied;
    if (!this.result) return '';
    return `${this.result.coverage}% coverage across ${this.result.yourSkills.length} evidence-backed skills, with ${this.result.missingSkills.length} validated gaps for the active career profile.`;
  }

  toggleAllGaps(): void {
    this.showAllGaps = !this.showAllGaps;
  }

  getGapPriorityCount(priority: SkillPriority): number {
    return [...this.topGapCards, ...this.remainingGapCards].filter((card) => card.priority === priority).length;
  }

  getPriorityClass(priority?: SkillPriority): string {
    switch (priority) {
      case 'High':   return 'badge-high';
      case 'Medium': return 'badge-medium';
      case 'Low':    return 'badge-low';
      default:       return '';
    }
  }

  coverageWidth(pct: number): string {
    return `${Math.min(100, Math.max(0, pct))}%`;
  }

  getConfidenceClass(score = 0): string {
    if (score >= 75) return 'confidence-high';
    if (score >= 55) return 'confidence-medium';
    return 'confidence-low';
  }

  get cacheStatusLabel(): string {
    if (this.result?.fromFrontendCache) return 'Loaded instantly from local cache';
    if (this.result?.fromCache || this.result?.cacheMetadata?.loadedFromCache) return 'Backend cache hit';
    return 'Fresh signal analysis';
  }

  getSkillPriorityLabel(priority?: SkillPriority): string | undefined {
    return priority ? `${priority} priority` : undefined;
  }

  getSkillDemandLabel(demand?: number): string | undefined {
    return Number.isFinite(Number(demand)) && Number(demand) > 0
      ? `${Math.round(Number(demand))}% demand`
      : undefined;
  }

  getSkillEvidence(skill: CurrentSkill | MissingSkill): string[] {
    const values = Array.isArray(skill.evidence) ? skill.evidence : [];
    return [...new Set(values.map((item) => String(item || '').trim()).filter(Boolean))].slice(0, 4);
  }

  getSkillLearningPath(skill: CurrentSkill | MissingSkill): string | undefined {
    const timeline: Array<[string, SkillTimelineItem[] | undefined]> = [
      ['Immediate focus', this.result?.immediateSkills],
      ['Short-term plan', this.result?.shortTermSkills],
      ['Mid-term plan', this.result?.midTermSkills],
      ['Long-term plan', this.result?.longTermSkills]
    ];
    const match = timeline.find(([, skills]) => this.hasNamedSkill(skills, skill.name));
    if (match) return match[0];

    const phase = (this.result?.roadmap || []).find((item) =>
      (item.skills || []).some((name) => this.sameSkill(name, skill.name))
    );
    if (phase) return `${phase.phase}: ${phase.title}`;

    const week = (this.result?.weeklyRoadmap || []).find((item) =>
      (item.focusSkills || []).some((name) => this.sameSkill(name, skill.name))
    );
    return week ? `Week ${week.week} focus` : undefined;
  }

  getSkillSuggestedProject(skill: CurrentSkill | MissingSkill): SuggestedSkillProject | undefined {
    if ('suggestedProject' in skill && skill.suggestedProject) return skill.suggestedProject;
    return (this.result?.suggestedProjects || []).find((project) =>
      this.sameSkill(project.skill, skill.name)
    );
  }

  getSkillNextAction(skill: CurrentSkill | MissingSkill): string | undefined {
    const project = this.getSkillSuggestedProject(skill);
    if (project?.deliverable) return project.deliverable;
    if (project?.outcome) return project.outcome;
    if (project?.title) return project.title;

    const week = (this.result?.weeklyRoadmap || []).find((item) =>
      (item.focusSkills || []).some((name) => this.sameSkill(name, skill.name))
    );
    return week?.outcomes?.find((outcome) => String(outcome || '').trim());
  }

  buildSkillCardViewModel(skill: CurrentSkill | MissingSkill, kind: SkillCardKind): SkillCardViewModel | null {
    const name = String(skill?.name || '').trim();
    if (!this.isDisplayableSkillName(name)) return null;

    const evidence = this.getSkillEvidence(skill);
    const demand = 'jobDemand' in skill && Number(skill.jobDemand) > 0
      ? Math.min(100, Math.round(Number(skill.jobDemand)))
      : undefined;
    const project = this.getSkillSuggestedProject(skill);
    const learningPath = this.getSkillLearningPath(skill);
    const nextAction = this.getSkillNextAction(skill);
    const suppliedSource = String(skill.detectionMethod || skill.source || '').trim();
    const isPlanBacked = Boolean(learningPath || project || nextAction);
    const isDemandBacked = Boolean(demand || this.hasNamedSkill(this.result?.highDemandSkills, name));
    const hasEvidence = Boolean(evidence.length || skill.whyExists || (suppliedSource && !/ai/i.test(suppliedSource)));
    if (!hasEvidence && !(kind === 'gap' && (isPlanBacked || isDemandBacked))) return null;

    const evidenceSummary = String(skill.whyExists || evidence[0] || '').trim()
      || (demand ? `${demand}% demand for the active career profile.` : '')
      || (learningPath ? `Included in the ${learningPath.toLowerCase()}.` : '');
    if (!evidenceSummary) return null;

    const detectionMethod = suppliedSource
      || (isDemandBacked ? 'Job market demand' : '')
      || (project ? 'Recommended project' : '')
      || (learningPath ? 'Learning roadmap' : '');
    if (!detectionMethod) return null;

    const confidence = Number(skill.confidenceScore);
    const proficiency = 'proficiency' in skill ? Number(skill.proficiency) : Number.NaN;
    const priority = skill.priority;
    const whyItMatters = String(skill.businessImpact || skill.whyItMatters || '').trim()
      || (demand ? `${name} has a ${demand}% demand score for the selected career path.` : '')
      || (this.hasNamedSkill(this.result?.immediateSkills, name) ? `${name} is prioritized in the immediate learning plan.` : '')
      || evidence[0];

    return {
      id: this.normalizeSkillKey(name),
      name,
      category: String(skill.category || '').trim() || undefined,
      kind,
      priority,
      priorityLabel: this.getSkillPriorityLabel(priority),
      confidence: Number.isFinite(confidence) && confidence > 0 ? Math.min(100, Math.round(confidence)) : undefined,
      proficiency: Number.isFinite(proficiency) && proficiency >= 0 ? Math.min(100, Math.round(proficiency)) : undefined,
      demand,
      demandLabel: this.getSkillDemandLabel(demand),
      whyItMatters,
      evidence,
      evidenceSummary,
      detectionMethod,
      learningPath,
      learningEffort: 'learningEffort' in skill ? String(skill.learningEffort?.label || '').trim() || undefined : undefined,
      project,
      nextAction,
      resources: 'recommendedResources' in skill && Array.isArray(skill.recommendedResources)
        ? skill.recommendedResources.slice(0, 2)
        : [],
      isProven: (this.result?.provenSkills || []).some((item) => this.sameSkill(item, name))
    };
  }

  shouldShowSection(section: 'gaps' | 'strengths' | 'weak' | 'roadmap' | 'actions' | 'market' | 'summary'): boolean {
    switch (section) {
      case 'gaps': return this.topGapCards.length > 0;
      case 'strengths': return this.strengthCards.length > 0;
      case 'weak': return this.weakSkillCards.length > 0;
      case 'roadmap': return Boolean(this.result?.roadmap?.length || this.result?.weeklyRoadmap?.length);
      case 'actions': return this.recommendedActions.length > 0;
      case 'market': return this.marketInsights.length > 0;
      case 'summary': return Boolean(this.overallSummary);
    }
  }

  get analysisLastUpdatedLabel(): string {
    const value = this.result?.analysisBasedOn?.lastAnalyzedAt;
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString();
  }

  getResourceTitle(resource: { title?: string; url?: string } | string): string {
    if (typeof resource === 'string') return resource;
    return String(resource?.title || 'Open resource');
  }

  getResourceUrl(resource: { title?: string; url?: string } | string): string {
    if (typeof resource === 'string') {
      return /^https?:\/\//i.test(resource)
        ? resource
        : 'https://roadmap.sh/';
    }
    const url = String(resource?.url || '').trim();
    if (/^https?:\/\//i.test(url)) return url;
    return 'https://roadmap.sh/';
  }

  trackByCard(_: number, item: SkillCardViewModel): string {
    return item.id;
  }

  trackByAction(_: number, item: NextActionViewModel): string {
    return `${item.skill}:${item.title}`;
  }

  trackByPhase(_: number, item: RoadmapPhase): string {
    return item.phase;
  }

  trackByWeek(_: number, item: WeeklyRoadmapWeek): number {
    return item.week;
  }

  private hasNamedSkill(skills: SkillTimelineItem[] | undefined, name: string): boolean {
    return (skills || []).some((skill) => this.sameSkill(skill.name, name));
  }

  private sameSkill(left: string, right: string): boolean {
    return String(left || '').trim().toLowerCase() === String(right || '').trim().toLowerCase();
  }

  private buildPresentationViewModels(): void {
    if (!this.result) {
      this.clearPresentation();
      return;
    }

    const gapCards = this.toUniqueSkillCards(this.result.missingSkills, 'gap')
      .sort((left, right) =>
        this.priorityScore(right.priority) - this.priorityScore(left.priority)
        || Number(right.demand || 0) - Number(left.demand || 0)
        || Number(left.confidence || 101) - Number(right.confidence || 101)
        || left.name.localeCompare(right.name)
      );
    const gapKeys = new Set(gapCards.map((card) => card.id));
    const weakKeys = new Set((this.result.weakSkills || []).map((skill) => this.normalizeSkillKey(skill.name)));
    const currentSkills = this.toUniqueSkillCards(this.result.yourSkills, 'strength');
    const weakFromCurrent = currentSkills
      .filter((card) => weakKeys.has(card.id) && !gapKeys.has(card.id))
      .map((card) => ({ ...card, kind: 'weak' as const }));
    const extraWeak = this.toUniqueSkillCards(this.result.weakSkills || [], 'weak')
      .filter((card) => !gapKeys.has(card.id) && !weakFromCurrent.some((item) => item.id === card.id));

    this.topGapCards = gapCards.slice(0, 8);
    this.remainingGapCards = gapCards.slice(8);
    this.strengthCards = currentSkills
      .filter((card) => !weakKeys.has(card.id))
      .sort((left, right) => Number(right.proficiency || 0) - Number(left.proficiency || 0));
    this.weakSkillCards = [...weakFromCurrent, ...extraWeak]
      .sort((left, right) => Number(left.proficiency || 0) - Number(right.proficiency || 0));
    this.recommendedActions = gapCards
      .filter((card) => Boolean(card.project?.title || card.nextAction))
      .slice(0, 3)
      .map((card) => ({
        skill: card.name,
        title: card.project?.title || card.nextAction as string,
        detail: card.project?.deliverable || card.project?.outcome || card.learningPath || card.learningEffort,
        priority: card.priority
      }));
    this.marketInsights = this.buildMarketInsights(gapCards);
    this.categoryBreakdown = this.buildCategoryBreakdown([...currentSkills, ...gapCards]);
    this.matchDistribution = this.buildMatchDistribution(currentSkills);
    this.showAllGaps = false;
  }

  private toUniqueSkillCards(skills: SkillTimelineItem[], kind: SkillCardKind): SkillCardViewModel[] {
    const cards = new Map<string, SkillCardViewModel>();
    skills.forEach((skill) => {
      const card = this.buildSkillCardViewModel(skill, kind);
      if (card && !cards.has(card.id)) cards.set(card.id, card);
    });
    return [...cards.values()];
  }

  private buildMarketInsights(gaps: SkillCardViewModel[]): MarketInsightViewModel[] {
    const insights: MarketInsightViewModel[] = [];
    const jobsDemand = this.result?.signalsUsed?.jobsDemand;
    const sampledJobs = Number(jobsDemand?.sampledJobs || 0);
    const requestedSkills = (jobsDemand?.topSkills || [])
      .map((skill) => String(skill.name || '').trim())
      .filter(Boolean)
      .slice(0, 3);
    const highDemandGaps = gaps.filter((card) => Number(card.demand || 0) >= 75);

    if (sampledJobs > 0) {
      insights.push({ label: 'Jobs analyzed', value: String(sampledJobs), detail: 'Current demand sample', tone: 'primary' });
    }
    if (highDemandGaps.length) {
      insights.push({ label: 'High-demand gaps', value: String(highDemandGaps.length), detail: highDemandGaps.slice(0, 3).map((card) => card.name).join(', '), tone: 'warning' });
    }
    if (requestedSkills.length) {
      insights.push({ label: 'Most requested skills', value: requestedSkills.join(', '), detail: 'From current job signals', tone: 'success' });
    }
    return insights;
  }

  private buildCategoryBreakdown(cards: SkillCardViewModel[]): CategoryBreakdownViewModel[] {
    const categories = new Map<string, { current: number; gaps: number }>();
    cards.forEach((card) => {
      const category = card.category;
      if (!category) return;
      const current = categories.get(category) || { current: 0, gaps: 0 };
      if (card.kind === 'gap') current.gaps += 1;
      else current.current += 1;
      categories.set(category, current);
    });
    return [...categories.entries()]
      .map(([name, counts]) => ({
        name,
        ...counts,
        coverage: Math.round((counts.current / Math.max(1, counts.current + counts.gaps)) * 100)
      }))
      .sort((left, right) => right.current + right.gaps - (left.current + left.gaps))
      .slice(0, 6);
  }

  private buildMatchDistribution(cards: SkillCardViewModel[]): DistributionViewModel[] {
    const ranges: Array<DistributionViewModel & { min: number; max: number }> = [
      { label: 'Strong (80-100%)', count: 0, tone: 'strong', min: 80, max: 100 },
      { label: 'Good (60-79%)', count: 0, tone: 'good', min: 60, max: 79 },
      { label: 'Average (40-59%)', count: 0, tone: 'average', min: 40, max: 59 },
      { label: 'Weak (0-39%)', count: 0, tone: 'weak', min: 0, max: 39 }
    ];
    cards.forEach((card) => {
      if (card.proficiency === undefined) return;
      const range = ranges.find((item) => card.proficiency! >= item.min && card.proficiency! <= item.max);
      if (range) range.count += 1;
    });
    return ranges;
  }

  private clearPresentation(): void {
    this.topGapCards = [];
    this.remainingGapCards = [];
    this.strengthCards = [];
    this.weakSkillCards = [];
    this.recommendedActions = [];
    this.marketInsights = [];
    this.categoryBreakdown = [];
    this.matchDistribution = [];
    this.showAllGaps = false;
  }

  private priorityScore(priority?: SkillPriority): number {
    return priority === 'High' ? 3 : priority === 'Medium' ? 2 : priority === 'Low' ? 1 : 0;
  }

  private isDisplayableSkillName(name: string): boolean {
    if (name.length < 2 || name.length > 64) return false;
    if (!/[A-Za-z]/.test(name) || !/^[A-Za-z0-9][A-Za-z0-9 .+#/&()_-]*$/.test(name)) return false;
    if (/^[A-Za-z]\d+$/.test(name)) return false;
    return !new Set(['unknown', 'none', 'n/a', 'other', 'skill', 'technical skill']).has(name.toLowerCase());
  }

  private normalizeSkillKey(name: string): string {
    return String(name || '').trim().toLowerCase().replace(/[^a-z0-9+#]+/g, '-');
  }

  private normalizeSignalsUsed(raw: any, username: string): SkillGapResult['signalsUsed'] {
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

  private normalizeAnalysisBasedOn(raw: any, username: string, careerStack: string, experienceLevel: string): SkillGapResult['analysisBasedOn'] {
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
