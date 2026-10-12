import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import {
  SkillGapService,
  SkillGapResult,
  RoadmapPhase,
  WeeklyRoadmapWeek,
  SuggestedSkillProject,
} from '../../shared/services/skill-gap.service';
import { GithubService } from '../../shared/services/github.service';
import { CareerProfileService } from '../../shared/services/career-profile.service';
import { ResumeService } from '../../shared/services/resume.service';
import { AuthService } from '../../shared/services/auth.service';
import { RecommendationsService } from '../../shared/services/recommendations.service';
import {
  buildCareerProfileSignature,
  CAREER_STACKS,
  EXPERIENCE_LEVELS,
} from '../../shared/models/career-profile.model';
import { UiPageHeaderComponent } from '../../shared/components/ui-page-header/ui-page-header.component';
import { UiButtonComponent } from '../../shared/components/ui-button/ui-button.component';
import { UiSkeletonComponent } from '../../shared/components/ui-skeleton/ui-skeleton.component';
import {
  EvidenceSkill,
  EvidenceStatus,
  SKILL_EVIDENCE_VERSION,
  STATUS_LABELS,
  STATUS_REASONS,
} from '../../shared/models/skill-gap-evidence.model';

@Component({
  selector: 'app-skill-gap',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    UiPageHeaderComponent,
    UiButtonComponent,
    UiSkeletonComponent,
  ],
  templateUrl: './skill-gap.component.html',
  styleUrl: './skill-gap.component.scss',
})
export class SkillGapComponent implements OnInit, OnDestroy {
  readonly statuses = Object.keys(STATUS_LABELS) as EvidenceStatus[];
  readonly statusLabels = STATUS_LABELS;
  readonly statusReasons = STATUS_REASONS;
  readonly careerStacks = CAREER_STACKS;
  readonly experienceLevels = EXPERIENCE_LEVELS;
  result: SkillGapResult | null = null;
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
  savedPreviews: any[] = [];
  selectedSavedPreviewId = '';
  isSavedPreviewsLoading = false;
  search = '';
  requirementFilter = 'ALL';
  statusFilter = 'ALL';
  categoryFilter = 'ALL';
  sortBy = 'priority';
  private readonly subscriptions = new Subscription();
  private requestSubscription?: Subscription;
  private requestSequence = 0;
  private lastProfileKey = '';

  constructor(
    private readonly skillGapService: SkillGapService,
    private readonly githubService: GithubService,
    private readonly careerProfileService: CareerProfileService,
    private readonly authService: AuthService,
    private readonly resumeService: ResumeService,
    private readonly recommendationsService: RecommendationsService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  get currentCareerStack(): string {
    return this.careerProfileService.careerStack;
  }
  get currentExperienceLevel(): string {
    return this.careerProfileService.experienceLevel;
  }
  get hasCareerTarget(): boolean {
    return this.careerProfileService.isConfigured;
  }
  get isCurrentContract(): boolean {
    return this.result?.ruleVersion === SKILL_EVIDENCE_VERSION;
  }
  get skills(): EvidenceSkill[] {
    return this.isCurrentContract ? this.result?.skills || [] : [];
  }
  get visibleSkills(): EvidenceSkill[] {
    const list = this.skills.filter(
      (skill) =>
        (this.requirementFilter === 'ALL' || skill.requirement === this.requirementFilter) &&
        (this.statusFilter === 'ALL' || skill.status === this.statusFilter) &&
        (this.categoryFilter === 'ALL' || skill.category === this.categoryFilter) &&
        skill.name.toLowerCase().includes(this.search.trim().toLowerCase()),
    );
    if (this.sortBy === 'name') {
      return [...list].sort((a, b) => a.name.localeCompare(b.name));
    }
    if (this.sortBy === 'status') {
      const order: Record<EvidenceStatus, number> = {
        DEMONSTRATED: 0,
        PARTIAL: 1,
        CLAIMED_ONLY: 2,
        NOT_EVIDENCED: 3,
        UNKNOWN: 4,
      };
      return [...list].sort((a, b) => order[a.status] - order[b.status]);
    }
    if (this.sortBy === 'confidence') {
      const order: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2, INSUFFICIENT: 3 };
      return [...list].sort(
        (a, b) => (order[a.evidenceConfidence] ?? 9) - (order[b.evidenceConfidence] ?? 9),
      );
    }
    // Default 'priority': REQUIRED first, then by weight
    return [...list].sort((a, b) => {
      if (a.requirement !== b.requirement) {
        return a.requirement === 'REQUIRED' ? -1 : 1;
      }
      return (b.weight || 1) - (a.weight || 1);
    });
  }
  get categories(): string[] {
    return Object.keys(this.result?.categoryBreakdown || {});
  }
  get demonstratedCount(): number {
    return this.skills.filter((s) => s.status === 'DEMONSTRATED').length;
  }
  get partialCount(): number {
    return this.skills.filter((s) => s.status === 'PARTIAL').length;
  }
  get claimedCount(): number {
    return this.skills.filter((s) => s.status === 'CLAIMED_ONLY').length;
  }
  get notEvidencedCount(): number {
    return this.skills.filter((s) => s.status === 'NOT_EVIDENCED').length;
  }
  get requiredCount(): number {
    return this.skills.filter((s) => s.requirement === 'REQUIRED').length;
  }
  get optionalCount(): number {
    return this.skills.filter((s) => s.requirement === 'OPTIONAL').length;
  }
  get evidenceBackedCount(): number {
    return this.skills.filter((s) => s.status === 'DEMONSTRATED' || s.status === 'PARTIAL').length;
  }
  get validatedGapsCount(): number {
    return this.skills.filter(
      (s) =>
        s.requirement === 'REQUIRED' &&
        (s.status === 'NOT_EVIDENCED' || s.status === 'CLAIMED_ONLY'),
    ).length;
  }
  get totalWeeks(): string {
    return (
      this.result?.totalWeeks ||
      (this.result?.estimatedWeeks ? `${this.result.estimatedWeeks} weeks` : '8 weeks')
    );
  }
  get roadmapPhases(): RoadmapPhase[] {
    return this.result?.roadmap || [];
  }
  get weeklyMilestones(): WeeklyRoadmapWeek[] {
    return this.result?.weeklyRoadmap || [];
  }
  get suggestedProjects(): SuggestedSkillProject[] {
    return this.result?.suggestedProjects || [];
  }
  get immediateSkills(): string[] {
    return (this.result?.immediateSkills || []).map((s: any) =>
      typeof s === 'string' ? s : s.name,
    );
  }
  get shortTermSkills(): string[] {
    return (this.result?.shortTermSkills || []).map((s: any) =>
      typeof s === 'string' ? s : s.name,
    );
  }
  get midTermSkills(): string[] {
    return (this.result?.midTermSkills || []).map((s: any) => (typeof s === 'string' ? s : s.name));
  }
  get longTermSkills(): string[] {
    return (this.result?.longTermSkills || []).map((s: any) =>
      typeof s === 'string' ? s : s.name,
    );
  }
  get highDemandSkills(): any[] {
    return this.result?.highDemandSkills || [];
  }
  get jobsDemand() {
    return this.result?.signalsUsed?.jobsDemand;
  }
  get opportunities() {
    // Keep the backend's priority and order; do not introduce a frontend ranking policy.
    return (this.result?.missingSkills || []).filter((skill) =>
      this.skills.some(
        (fact) =>
          fact.name === skill.name &&
          fact.requirement === 'REQUIRED' &&
          fact.status !== 'DEMONSTRATED',
      ),
    );
  }
  get legacyReadiness(): number | null {
    if (!this.result) return null;
    return (
      this.result.legacyReadinessScore ??
      (/^v[0-7](?:-|$)/.test(this.result.ruleVersion || '') ? this.result.coverage : null)
    );
  }
  get staleEvidence(): boolean {
    return (
      !!this.result?.sourceReferences?.some((source) => source.freshness === 'STALE') ||
      this.skills.some((skill) => skill.evidence.some((source) => source.freshness === 'STALE'))
    );
  }
  getResourceUrl(resource: any): string {
    if (!resource) return '#';
    if (typeof resource === 'string') return resource;
    return resource.url || '#';
  }
  getResourceTitle(resource: any): string {
    if (!resource) return '';
    if (typeof resource === 'string') return resource;
    return resource.title || resource.url || '';
  }
  getPriorityVariant(priority?: string): 'danger' | 'warning' | 'info' | 'neutral' {
    if (priority === 'High') return 'danger';
    if (priority === 'Medium') return 'warning';
    if (priority === 'Low') return 'info';
    return 'neutral';
  }
  get noCoreEvidence(): boolean {
    return this.isCurrentContract && this.result?.evidenceCompleteness?.availableCoreSources === 0;
  }
  sourceLabel(type: string): string {
    return (
      (
        {
          github: 'GitHub',
          resume: 'Active resume',
          profile: 'Developer profile',
          integration: 'Optional integration',
        } as Record<string, string>
      )[type] || type
    );
  }
  evidenceLabel(kind: string): string {
    return (
      (
        {
          IMPLEMENTATION: 'Inspected implementation',
          METADATA: 'Repository metadata / dependencies',
          CLAIM: 'Resume mention / self-reported claim',
        } as Record<string, string>
      )[kind] || kind
    );
  }
  warningLabel(warning: string): string {
    const [code, detail] = warning.split(':');
    const messages: Record<string, string> = {
      partial_source_limitations:
        'Some evidence sources are unavailable. Coverage uses the available analyzed evidence.',
      career_requirements_unavailable:
        'Career requirements are unavailable. Configure your career target.',
      github_and_resume_evidence_unavailable: 'No analyzed GitHub or resume evidence is available.',
      stale_source: 'This source is marked stale. Reanalyze it to update the evidence.',
      source_timestamp_unavailable: 'The source has no recorded timestamp.',
      freshness_age_not_calibrated:
        'Evidence age is recorded; no calibrated age threshold is defined.',
      conflicting_positive_evidence:
        'Conflicting positive evidence needs review; classification is conservative.',
      missing_requirement_entry: 'A career requirement matrix entry is missing.',
      score_unavailable: 'Coverage is unavailable for this evidence snapshot.',
    };
    return (messages[code] || warning.replace(/_/g, ' ')) + (detail ? ` (${detail})` : '');
  }
  nextAction(skill: EvidenceSkill): string {
    const supplied = this.result?.missingSkills?.find(
      (item) => item.name === skill.name,
    )?.suggestedProject;
    if (supplied) return supplied.deliverable || supplied.outcome || supplied.title;
    if (skill.status === 'UNKNOWN')
      return 'Analyze or update your GitHub and active resume to provide evidence.';
    if (skill.status === 'CLAIMED_ONLY')
      return 'Add concrete project examples supporting this claim.';
    if (skill.status === 'PARTIAL') return 'Document how you applied this skill in a project.';
    if (skill.status === 'NOT_EVIDENCED')
      return 'If you use this skill, include relevant project examples in your evidence.';
    return 'Keep implementation examples and source analyses up to date.';
  }
  private profileKey(): string {
    return buildCareerProfileSignature(this.careerProfileService.snapshot) + this.hasCareerTarget;
  }
  ngOnInit(): void {
    this.lastProfileKey = this.profileKey();
    this.subscriptions.add(
      this.careerProfileService.careerProfile$.subscribe(() => {
        if (this.profileKey() === this.lastProfileKey) return;
        this.lastProfileKey = this.profileKey();
        this.requestSequence++;
        this.requestSubscription?.unsubscribe();
        this.result = null;
        this.profileResultBackup = null;
        this.isLoading = false;
        this.username = this.storedUsername();
        this.skillGapService.clearCache();
        if (!this.isPreviewMode) this.loadProfile();
        this.cdr.detectChanges();
      }),
    );
    this.username = this.storedUsername();
    this.defaultUsername = this.username;
    if (this.username || !this.hasCareerTarget) {
      this.isInitLoading = false;
      this.loadProfile();
    } else {
      this.subscriptions.add(
        this.githubService.getActiveUsername().subscribe({
          next: (data) => {
            this.username = data.username || '';
            this.defaultUsername = this.username;
            this.isInitLoading = false;
            this.loadProfile();
          },
          error: () => {
            this.isInitLoading = false;
            this.loadProfile();
          },
        }),
      );
    }
  }
  private storedUsername(): string {
    return String(
      this.careerProfileService.snapshot.activeGithubUsername ||
        this.authService.getCurrentUser()?.activeGithubUsername ||
        this.authService.getCurrentUser()?.githubUsername ||
        '',
    )
      .trim()
      .replace(/^@/, '');
  }
  ngOnDestroy(): void {
    this.requestSequence++;
    this.requestSubscription?.unsubscribe();
    this.subscriptions.unsubscribe();
  }
  setMode(preview: boolean): void {
    if (this.isLoading) return;
    this.isPreviewMode = preview;
    this.result = null;
    this.errorMessage = '';
    this.search = '';
    this.statusFilter = this.requirementFilter = this.categoryFilter = 'ALL';
    if (preview) this.loadSavedPreviews();
    else this.loadProfile();
  }
  loadProfile(forceRefresh = false): void {
    if (this.hasCareerTarget) this.analyze(forceRefresh);
  }
  analyze(forceRefresh = false): void {
    if (this.isLoading) return;
    if (!this.isPreviewMode && !this.hasCareerTarget) return;
    const user = this.isPreviewMode ? this.previewGithubUsername.trim() : this.username;
    if (this.isPreviewMode && !user) {
      this.errorMessage = 'Enter a GitHub username for preview.';
      return;
    }
    const stack = this.isPreviewMode ? this.previewCareerStack : this.currentCareerStack;
    const level = this.isPreviewMode ? this.previewExperienceLevel : this.currentExperienceLevel;
    const previousResult = this.result;
    const preservePrevious = Boolean(previousResult) && forceRefresh;
    const sequence = ++this.requestSequence;
    this.isLoading = true;
    this.errorMessage = '';
    if (!preservePrevious) this.result = null;
    this.requestSubscription = this.skillGapService
      .analyze(
        user,
        stack,
        level,
        this.isPreviewMode,
        forceRefresh,
        this.isPreviewMode ? this.previewResumeText : undefined,
        this.isPreviewMode ? this.previewResumeId : undefined,
        this.isPreviewMode ? this.previewResumeHash : undefined,
      )
      .subscribe({
        next: (data) => {
          if (sequence !== this.requestSequence) return;
          this.applyResult(
            data?.data || data?.result || data,
            user,
            stack,
            level,
            this.isPreviewMode,
          );
          this.isLoading = false;
          this.cdr.detectChanges();
        },
        error: (err) => {
          if (sequence !== this.requestSequence) return;
          this.errorMessage =
            err?.error?.message || 'Unable to load skill evidence. Please try again.';
          this.isLoading = false;
          if (preservePrevious && previousResult) this.result = previousResult;
          this.cdr.detectChanges();
        },
      });
  }
  private applyResult(
    raw: SkillGapResult,
    user: string,
    stack: string,
    level: string,
    temporary: boolean,
  ): void {
    this.result = {
      ...raw,
      username: raw.username || user,
      careerStack: raw.careerStack || stack,
      experienceLevel: raw.experienceLevel || level,
    };
    this.viewedUsername = user;
    this.isTemporaryView = temporary;
    this.search = '';
    this.statusFilter = this.requirementFilter = this.categoryFilter = 'ALL';
  }
  onFileSelected(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (file.type !== 'application/pdf' || file.size > 5 * 1024 * 1024) {
      this.errorMessage = 'Choose a PDF no larger than 5 MB.';
      return;
    }
    this.isUploading = true;
    this.errorMessage = '';
    this.clearPreviewFile();
    this.subscriptions.add(
      this.resumeService.parsePreviewResumeText(file).subscribe({
        next: (data) => {
          this.previewResumeId = data.previewResumeId;
          this.previewResumeHash = data.resumeHash;
          this.previewFileName = file.name;
          this.isUploading = false;
          this.cdr.detectChanges();
        },
        error: () => {
          this.isUploading = false;
          this.errorMessage = 'Unable to parse the preview PDF. Please retry.';
          this.cdr.detectChanges();
        },
      }),
    );
  }
  clearPreviewFile(): void {
    this.previewFileName =
      this.previewResumeText =
      this.previewResumeId =
      this.previewResumeHash =
        '';
  }
  get isAuthenticated(): boolean {
    return Boolean(this.authService.getCurrentUser()?._id);
  }

  savePreview(): void {
    if (!this.result || !this.isTemporaryView || !this.isAuthenticated || this.isSavingPreview)
      return;
    const resumeHash = String(
      (this.result.cacheMetadata?.cacheKey as any)?.resumeHash || 'no-resume',
    );
    this.isSavingPreview = true;
    this.previewSaveMessage = '';
    this.recommendationsService
      .savePreview({
        module: 'skill-gap',
        title: `${this.result.username} Skill Gap Preview`,
        githubUsername: this.result.username,
        careerStack: this.result.careerStack,
        experienceLevel: this.result.experienceLevel,
        resumeHash,
        result: this.result,
      })
      .subscribe({
        next: ({ preview }) => {
          this.savedPreviews = this.recommendationsService
            .cacheSavedPreview(preview)
            .filter((p: any) => p.module === 'skill-gap');
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

  loadSavedPreviews(forceRefresh = false): void {
    if (!this.isAuthenticated || this.isSavedPreviewsLoading) return;
    this.isSavedPreviewsLoading = true;
    this.recommendationsService.listSavedPreviews(forceRefresh).subscribe({
      next: ({ previews }) => {
        this.savedPreviews = (Array.isArray(previews) ? previews : []).filter(
          (p: any) => p.module === 'skill-gap',
        );
        this.isSavedPreviewsLoading = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.isSavedPreviewsLoading = false;
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

    if (preview.module === 'skill-gap') {
      this.applyResult(
        {
          ...preview.resultSummary,
          username: preview.githubUsername,
          careerStack: preview.careerStack,
          experienceLevel: preview.experienceLevel,
        },
        preview.githubUsername,
        preview.careerStack,
        preview.experienceLevel,
        true,
      );
    }
  }

  deleteSavedPreview(): void {
    const id = this.selectedSavedPreviewId;
    if (!id || this.isLoading) return;
    this.recommendationsService.deleteSavedPreview(id).subscribe({
      next: () => {
        this.savedPreviews = this.recommendationsService
          .removeSavedPreviewFromCache(id)
          .filter((item: any) => item.module === 'skill-gap');
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

  refreshAnalysis(): void {
    this.analyze(true);
  }
}
