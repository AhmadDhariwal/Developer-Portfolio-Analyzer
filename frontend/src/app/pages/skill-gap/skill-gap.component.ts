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
  SkillGraphNode,
  SkillGraphEdge,
  WeeklyRoadmapWeek
} from '../../shared/services/skill-gap.service';
import { GithubService } from '../../shared/services/github.service';
import { CareerProfileService } from '../../shared/services/career-profile.service';
import { buildCareerProfileSignature } from '../../shared/models/career-profile.model';
import { AuthService } from '../../shared/services/auth.service';
import { FrontendAnalysisCacheService } from '../../shared/services/frontend-analysis-cache.service';
import { Subscription } from 'rxjs';
import { distinctUntilChanged } from 'rxjs/operators';

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
  result: SkillGapResult | null = null;
  graphLayout: Array<SkillGraphNode & { x: number; y: number }> = [];
  graphEdges: SkillGraphEdge[] = [];
  private readonly subscriptions: Subscription = new Subscription();

  constructor(
    private readonly skillGapService:    SkillGapService,
    private readonly githubService:      GithubService,
    private readonly careerProfileService: CareerProfileService,
    private readonly authService:        AuthService,
    private readonly frontendCache:      FrontendAnalysisCacheService,
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

  analyze(forceRefresh = false): void {
    const user = this.username.trim();
    if (!user) return;
    const isTemporary = Boolean(this.defaultUsername) && user.toLowerCase() !== this.defaultUsername.trim().toLowerCase();
    const { careerStack, experienceLevel } = this.careerProfileService.snapshot;
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
    this.result = null;
    this.graphLayout = [];
    this.graphEdges = [];
    this.cdr.detectChanges();

    this.skillGapService.analyze(user, careerStack, experienceLevel, isTemporary, forceRefresh).subscribe({
      next: (data: any) => {
        const raw = data?.data || data?.result || data;
        this.applyResult(raw, user, careerStack, experienceLevel, isTemporary);
        if (!isTemporary) {
          this.skillGapService.cacheResult(this.result as SkillGapResult, false);
        }
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.errorMessage = err?.error?.message || 'Failed to analyze skill gap. Please try again.';
        this.isLoading = false;
        this.result = null;
        this.graphLayout = [];
        this.graphEdges = [];
        this.cdr.detectChanges();
      }
    });
  }

  refreshAnalysis(): void {
    this.analyze(true);
  }

  /* ── Helpers ──────────────────────────────────────────────────── */

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
      totalWeeks: raw?.totalWeeks || 'N/A'
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
    this.refreshGraphLayout();
  }

  get currentCareerStack(): string  { return this.careerProfileService.careerStack; }
  get currentExperienceLevel(): string { return this.careerProfileService.experienceLevel; }

  returnToDefaultProfile(): void {
    if (!this.defaultUsername || this.isLoading) return;
    this.username = this.defaultUsername;
    this.analyze();
  }

  get integrationProvidersLabel(): string {
    const providers = this.result?.signalsUsed?.integrations?.providers || [];
    return providers.length ? providers.join(', ') : 'No extra integrations';
  }

  get weeklyTrendLabel(): string {
    const delta = Number(this.result?.signalsUsed?.weeklyProgress?.trendDelta || 0);
    return delta > 0 ? `+${delta}` : `${delta}`;
  }

  getPriorityClass(priority: MissingSkill['priority']): string {
    switch (priority) {
      case 'High':   return 'badge-high';
      case 'Medium': return 'badge-medium';
      case 'Low':    return 'badge-low';
      default:       return '';
    }
  }

  getProficiencyClass(proficiency: number): string {
    if (proficiency >= 80) return 'bar-green';
    if (proficiency >= 60) return 'bar-blue';
    return 'bar-amber';
  }

  getPhaseClass(color: RoadmapPhase['color']): string {
    return `phase-${color}`;
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

  get coverageFormulaLabel(): string {
    return this.result?.coverageBreakdown?.formula || 'Deterministic score from known skills, missing gaps, proficiency, resume, and integrations.';
  }

  getSkillEvidence(skill: CurrentSkill | MissingSkill): string[] {
    return Array.isArray(skill.evidence) ? skill.evidence.slice(0, 3) : [];
  }

  get analysisLastUpdatedLabel(): string {
    const value = this.result?.analysisBasedOn?.lastAnalyzedAt;
    if (!value) return 'Not available';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Not available';
    return date.toLocaleString();
  }

  get resumeStatusLabel(): string {
    return this.result?.analysisBasedOn?.resumeStatus || this.result?.resumeStatusMessage || 'Resume not analyzed yet';
  }

  getResourceTitle(resource: { title?: string; url?: string } | string): string {
    if (typeof resource === 'string') return resource;
    return String(resource?.title || 'Open resource');
  }

  getResourceUrl(resource: { title?: string; url?: string } | string): string {
    if (typeof resource === 'string') {
      return /^https?:\/\//i.test(resource)
        ? resource
        : `https://www.google.com/search?q=${encodeURIComponent(resource)}`;
    }
    const url = String(resource?.url || '').trim();
    if (/^https?:\/\//i.test(url)) return url;
    return `https://www.google.com/search?q=${encodeURIComponent(this.getResourceTitle(resource))}`;
  }

  trackByName(_: number, item: CurrentSkill | MissingSkill): string {
    return item.name;
  }

  trackByPhase(_: number, item: RoadmapPhase): string {
    return item.phase;
  }

  trackByWeek(_: number, item: WeeklyRoadmapWeek): number {
    return item.week;
  }

  private refreshGraphLayout(): void {
    const nodes = this.result?.skillGraph?.nodes || [];
    const edges = this.result?.skillGraph?.edges || [];
    const limitedNodes = nodes.slice(0, 16);

    const currentNodes = limitedNodes.filter((n) => n.kind === 'current');
    const missingNodes = limitedNodes.filter((n) => n.kind === 'missing');
    const allRows = Math.max(currentNodes.length, missingNodes.length, 1);

    const placeNodes = (
      list: SkillGraphNode[],
      x: number
    ): Array<SkillGraphNode & { x: number; y: number }> => {
      const step = 100 / (Math.max(list.length, 1) + 1);
      return list.map((node, index) => ({
        ...node,
        x,
        y: Math.round((index + 1) * step)
      }));
    };

    const left = placeNodes(currentNodes, 22);
    const right = placeNodes(missingNodes, 78);
    const fallbackCenter = limitedNodes.length && (!left.length || !right.length)
      ? limitedNodes.map((node, index) => ({
          ...node,
          x: 50 + (node.kind === 'current' ? -22 : 22),
          y: Math.round(((index % allRows) + 1) * (100 / (allRows + 1)))
        }))
      : [];

    this.graphLayout = left.length && right.length ? [...left, ...right] : fallbackCenter;
    const visibleIds = new Set(this.graphLayout.map((node) => node.id));
    this.graphEdges = edges.filter((edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to));
  }

  findNode(id: string): (SkillGraphNode & { x: number; y: number }) | undefined {
    return this.graphLayout.find((node) => node.id === id);
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
