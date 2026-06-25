import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { catchError, forkJoin, of, Subscription } from 'rxjs';
import { distinctUntilChanged } from 'rxjs/operators';
import { ApiService } from '../../shared/services/api.service';
import { CareerProfileService } from '../../shared/services/career-profile.service';
import { buildCareerProfileSignature } from '../../shared/models/career-profile.model';

interface ProjectInput {
  name: string;
  impact: number;
  complexity: 'low' | 'medium' | 'high';
  weeks: number;
}

interface SkillDetail {
  skill: string;
  pts: number;
  relevance: number;
  tier: 'core' | 'valuable' | 'transferable' | 'low';
  demand: number;
  difficulty: number;
}

interface ProjectDetail {
  name: string;
  complexity: 'low' | 'medium' | 'high';
  weeks: number;
  impact: number;
  pts: number;
}

interface ScenarioRange {
  hiringScore: number;
  jobMatch: number;
}

interface SimResult {
  scenarioHash: string;
  baseline: { hiringScore: number; jobMatch: number };
  predicted: { hiringScore: number; jobMatch: number };
  improvements: { hiringScore: number; jobMatch: number };
  confidenceScore: number;
  uncertaintyRange: {
    low: ScenarioRange;
    expected: ScenarioRange;
    high: ScenarioRange;
  };
  breakdown: { skills: number; projects: number; synergy: number; penalty: number; total: number };
  skillDetails: SkillDetail[];
  projectDetails: ProjectDetail[];
  insights: string[];
  warnings: string[];
  suggestions: string[];
  explainability?: {
    scoreDrivers: string[];
    penalties: string[];
    confidenceReason: string;
    effortVsDuration: string;
  };
  assumptions: {
    skillsConsidered: string[];
    projectsConsidered: ProjectInput[];
    notes: string[];
    sources: Array<{ label: string; connected: boolean; lastUpdatedAt: string | null }>;
    suggestedDurationWeeks: number;
  };
  meta: {
    role: string;
    level: string;
    durationWeeks: number;
    suggestedDurationWeeks: number;
    overloaded: boolean;
    skillsEffort: number;
    projectsEffort: number;
  };
}

interface ScenarioSource {
  key: string;
  label: string;
  connected: boolean;
  lastUpdatedAt: string | null;
}

interface ScenarioContext {
  profile: {
    careerStack: string;
    experienceLevel: string;
    githubUsername: string;
    role: string;
    level: string;
    baselineHiringScore: number;
    baselineJobMatch: number;
  };
  sources: ScenarioSource[];
  signals: {
    knownSkills: string[];
    missingSkills: string[];
    recommendationSkills: string[];
    sprintFocus: string[];
    connectedProviders: string[];
    portfolioProjects: string[];
    topDemandedSkills?: string[];
  };
  suggestedInputs: {
    role: string;
    experienceLevel: string;
    baselineHiringScore: number;
    baselineJobMatch: number;
    durationWeeks: number;
    skills: string[];
    projects: ProjectInput[];
  };
  summary: string;
  signalHash?: string;
  sourceContextSummary?: Record<string, unknown>;
  cache?: { hit: boolean; key: string; version: string };
}

interface SavedScenario {
  _id: string;
  name: string;
  baselineHiringScore: number;
  baselineJobMatch: number;
  role: string;
  experienceLevel: string;
  durationWeeks: number;
  skills: string[];
  projects: ProjectInput[];
  confidenceScore: number;
  predicted: { hiringScore: number; jobMatch: number };
  improvements: { hiringScore: number; jobMatch: number };
  result: SimResult;
  scenarioHash?: string;
  sourceContextSummary?: Record<string, unknown>;
  warnings?: string[];
  uncertaintyRange?: SimResult['uncertaintyRange'];
  breakdown?: SimResult['breakdown'];
  createdAt: string;
}

interface TemplateOption {
  key: 'focused' | 'portfolio' | 'balanced';
  label: string;
  description: string;
}

@Component({
  selector: 'app-scenario-simulator',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './scenario-simulator.component.html',
  styleUrl: './scenario-simulator.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ScenarioSimulatorComponent implements OnInit, OnDestroy {
  baselineHiringScore = 55;
  baselineJobMatch = 48;
  role = 'full stack';
  experienceLevel = 'mid';
  durationWeeks = 6;
  skillInput = '';
  scenarioName = '';
  skills: string[] = [];
  projects: ProjectInput[] = [this.createEmptyProject()];

  isRunning = false;
  isSavingScenario = false;
  isCreatingSprint = false;
  isLoadingContext = true;
  isLoadingHistory = true;
  errorMessage = '';
  contextError = '';
  actionMessage = '';
  actionTone: 'success' | 'error' | 'info' = 'info';
  result: SimResult | null = null;
  hasSimulated = false;
  showInfoPanel = false;
  context: ScenarioContext | null = null;
  scenarioHistory: SavedScenario[] = [];
  compareScenario: SavedScenario | null = null;
  deletingScenarioId = '';
  contextCacheHit = false;
  historyCacheHit = false;
  private readonly subscriptions = new Subscription();
  private lastProfileSignature = '';
  private isRefreshingProfileContext = false;

  readonly roleOptions = [
    { value: 'frontend', label: 'Frontend Developer' },
    { value: 'backend', label: 'Backend Developer' },
    { value: 'full stack', label: 'Full Stack Developer' },
    { value: 'ai/ml', label: 'AI / ML Engineer' },
    { value: 'devops', label: 'DevOps / Cloud Engineer' }
  ];

  readonly levelOptions = [
    { value: 'junior', label: 'Junior (0-2 years)' },
    { value: 'mid', label: 'Mid-level (2-5 years)' },
    { value: 'senior', label: 'Senior (5+ years)' }
  ];

  readonly durationOptions = [2, 4, 6, 8, 12, 16];

  readonly templates: TemplateOption[] = [
    {
      key: 'focused',
      label: 'Focused Upskill',
      description: 'Lean into top missing skills with a compact, realistic plan.'
    },
    {
      key: 'portfolio',
      label: 'Portfolio Push',
      description: 'Turn your strongest project signals into a showcase-oriented scenario.'
    },
    {
      key: 'balanced',
      label: 'Balanced Plan',
      description: 'Mix skills and one strong project for a practical hiring lift.'
    }
  ];

  constructor(
    private readonly apiService: ApiService,
    private readonly careerProfileService: CareerProfileService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.lastProfileSignature = buildCareerProfileSignature(this.careerProfileService.snapshot);
    this.subscriptions.add(
      this.careerProfileService.careerProfile$.pipe(
        distinctUntilChanged((a, b) => buildCareerProfileSignature(a) === buildCareerProfileSignature(b))
      ).subscribe((profile) => {
        const nextSignature = buildCareerProfileSignature(profile);
        if (nextSignature === this.lastProfileSignature) return;
        this.lastProfileSignature = nextSignature;
        this.reloadContextForProfileChange();
      })
    );
    this.loadBootstrapData();
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  private createEmptyProject(): ProjectInput {
    return { name: '', impact: 70, complexity: 'medium', weeks: 3 };
  }

  private cloneProject(project: Partial<ProjectInput>): ProjectInput {
    return {
      name: String(project.name || '').trim(),
      impact: Math.max(0, Math.min(100, Number(project.impact) || 70)),
      complexity: project.complexity === 'low' || project.complexity === 'high' ? project.complexity : 'medium',
      weeks: Math.max(1, Math.min(24, Number(project.weeks) || 3))
    };
  }

  private buildScenarioPayload() {
    return {
      name: this.scenarioName.trim(),
      baselineHiringScore: this.baselineHiringScore,
      baselineJobMatch: this.baselineJobMatch,
      role: this.role,
      experienceLevel: this.experienceLevel,
      durationWeeks: this.durationWeeks,
      skills: this.skills,
      projects: this.validProjects
    };
  }

  private applyContext(context: ScenarioContext, resetPlan = false): void {
    this.context = context;

    if (!resetPlan && (this.skills.length || this.validProjects.length || this.hasSimulated)) {
      return;
    }

    this.baselineHiringScore = context.suggestedInputs.baselineHiringScore;
    this.baselineJobMatch = context.suggestedInputs.baselineJobMatch;
    this.role = context.suggestedInputs.role;
    this.experienceLevel = context.suggestedInputs.experienceLevel;
    this.durationWeeks = context.suggestedInputs.durationWeeks;
    this.skills = [...(context.suggestedInputs.skills || [])];
    this.projects = context.suggestedInputs.projects?.length
      ? context.suggestedInputs.projects.map((project) => this.cloneProject(project))
      : [this.createEmptyProject()];
    this.scenarioName = this.generateScenarioName();
  }

  private generateScenarioName(): string {
    const roleLabel = this.roleOptions.find((option) => option.value === this.role)?.label || 'Career Scenario';
    const primarySkills = this.skills.slice(0, 2).join(' + ');
    if (primarySkills) return `${roleLabel}: ${primarySkills}`;
    return `${roleLabel} - ${this.durationWeeks} week plan`;
  }

  private normalizeError(error: any, fallback: string): string {
    if (Array.isArray(error?.error?.errors) && error.error.errors.length) {
      return error.error.errors.map((item: { message: string }) => item.message).join(' ');
    }
    return error?.error?.message || fallback;
  }

  loadBootstrapData(forceRefresh = false): void {
    this.isLoadingContext = true;
    this.isLoadingHistory = true;
    this.contextError = '';
    if (forceRefresh) {
      this.actionTone = 'info';
      this.actionMessage = 'Refreshing simulator signals and saved scenarios...';
    }

    forkJoin({
      context: this.apiService.getScenarioSimulatorContext(forceRefresh).pipe(catchError(() => of(null))),
      history: this.apiService.getScenarioSimulationHistory(8, forceRefresh).pipe(catchError(() => of({ history: [] })))
    }).subscribe({
      next: ({ context, history }) => {
        if (context?.context) {
          this.applyContext(context.context, true);
          this.contextCacheHit = !!context.context.cache?.hit;
        } else {
          this.contextError = 'Live scenario signals are unavailable right now. You can still simulate manually.';
          this.contextCacheHit = false;
        }

        this.scenarioHistory = Array.isArray(history?.history) ? history.history : [];
        this.historyCacheHit = !!history?.cache?.hit;
        if (forceRefresh && !this.contextError) {
          this.actionMessage = 'Simulator signals refreshed.';
          this.actionTone = 'success';
        }
        this.isLoadingContext = false;
        this.isLoadingHistory = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.contextError = 'Failed to load scenario workspace data.';
        this.isLoadingContext = false;
        this.isLoadingHistory = false;
        this.cdr.markForCheck();
      }
    });
  }

  private reloadContextForProfileChange(): void {
    if (this.isRefreshingProfileContext) return;
    this.isRefreshingProfileContext = true;
    this.isLoadingContext = true;
    this.contextError = '';
    this.apiService.invalidateScenarioContextCache();
    this.apiService.getScenarioSimulatorContext(true).pipe(
      catchError(() => of(null))
    ).subscribe((context) => {
      if (context?.context) {
        this.applyContext(context.context, true);
        this.contextCacheHit = !!context.context.cache?.hit;
      } else {
        this.contextError = 'Live scenario signals are unavailable right now. You can still simulate manually.';
        this.contextCacheHit = false;
      }
      this.isLoadingContext = false;
      this.isRefreshingProfileContext = false;
      this.cdr.markForCheck();
    });
  }

  get validProjects(): ProjectInput[] {
    return this.projects
      .map((project) => this.cloneProject(project))
      .filter((project) => project.name.trim());
  }

  get validationError(): string | null {
    if (this.baselineHiringScore < 0 || this.baselineHiringScore > 100) return 'Hiring score must be between 0 and 100.';
    if (this.baselineJobMatch < 0 || this.baselineJobMatch > 100) return 'Job match must be between 0 and 100.';
    if (this.durationWeeks < 1 || this.durationWeeks > 24) return 'Duration must be between 1 and 24 weeks.';
    if (!this.skills.length && !this.validProjects.length) return 'Add at least one skill or project.';
    const projectNames = this.validProjects.map((project) => project.name.trim().toLowerCase());
    if (new Set(projectNames).size !== projectNames.length) return 'Remove duplicate project names before running the simulation.';
    return null;
  }

  get contextCacheLabel(): string {
    if (this.isLoadingContext) return 'Loading context';
    return this.contextCacheHit ? 'Cached context' : 'Fresh context';
  }

  get historyCacheLabel(): string {
    if (this.isLoadingHistory) return 'Loading history';
    return this.historyCacheHit ? 'Cached history' : 'Fresh history';
  }

  get hiringDelta(): number {
    return this.result?.improvements.hiringScore ?? 0;
  }

  get jobMatchDelta(): number {
    return this.result?.improvements.jobMatch ?? 0;
  }

  get breakdownRows(): Array<{ label: string; value: number; color: string }> {
    if (!this.result) return [];
    const breakdown = this.result.breakdown;
    return [
      { label: 'Skills', value: breakdown.skills, color: '#7c3aed' },
      { label: 'Projects', value: breakdown.projects, color: '#10b981' },
      { label: 'Synergy', value: breakdown.synergy, color: '#f59e0b' },
      { label: 'Penalty', value: breakdown.penalty, color: '#ef4444' }
    ];
  }

  addSkill(): void {
    const value = this.skillInput.trim();
    if (!value) return;
    if (this.skills.some((skill) => skill.toLowerCase() === value.toLowerCase())) {
      this.skillInput = '';
      return;
    }

    this.skills = [...this.skills, value];
    this.skillInput = '';
    if (!this.scenarioName.trim()) this.scenarioName = this.generateScenarioName();
  }

  addSuggestedSkill(skill: string): void {
    if (this.skills.some((item) => item.toLowerCase() === skill.toLowerCase())) return;
    this.skills = [...this.skills, skill];
  }

  removeSkill(skill: string): void {
    this.skills = this.skills.filter((item) => item !== skill);
  }

  addProject(): void {
    this.projects = [...this.projects, this.createEmptyProject()];
  }

  addSuggestedProject(project: ProjectInput): void {
    if (this.projects.some((item) => item.name.trim().toLowerCase() === project.name.trim().toLowerCase())) return;
    this.projects = [...this.projects, this.cloneProject(project)];
  }

  removeProject(index: number): void {
    this.projects = this.projects.filter((_, currentIndex) => currentIndex !== index);
    if (!this.projects.length) this.projects = [this.createEmptyProject()];
  }

  applyTemplate(template: TemplateOption): void {
    const suggested = this.context?.suggestedInputs;
    if (!suggested) return;

    if (template.key === 'focused') {
      this.skills = [...(suggested.skills || []).slice(0, 3)];
      this.projects = [this.createEmptyProject()];
      this.durationWeeks = Math.max(4, suggested.durationWeeks - 2);
    } else if (template.key === 'portfolio') {
      this.skills = [...(suggested.skills || []).slice(0, 2)];
      this.projects = suggested.projects?.length
        ? suggested.projects.slice(0, 2).map((project) => this.cloneProject(project))
        : [this.createEmptyProject()];
      this.durationWeeks = Math.max(6, suggested.durationWeeks);
    } else {
      this.skills = [...(suggested.skills || []).slice(0, 4)];
      this.projects = suggested.projects?.length
        ? [this.cloneProject(suggested.projects[0])]
        : [this.createEmptyProject()];
      this.durationWeeks = Math.max(6, suggested.durationWeeks);
    }

    this.scenarioName = `${template.label} - ${this.generateScenarioName()}`;
    this.compareScenario = null;
    this.errorMessage = '';
  }

  simulate(): void {
    const validationError = this.validationError;
    if (validationError) {
      this.errorMessage = validationError;
      return;
    }

    this.isRunning = true;
    this.errorMessage = '';
    this.actionMessage = '';
    this.result = null;

    this.apiService.runWhatIfSimulation(this.buildScenarioPayload()).subscribe({
      next: (response) => {
        this.result = response?.result || null;
        this.hasSimulated = !!this.result;
        this.isRunning = false;
        if (!this.scenarioName.trim()) this.scenarioName = this.generateScenarioName();
        if (this.result?.warnings?.length) {
          this.actionTone = 'info';
          this.actionMessage = 'Simulation completed with realism warnings. Review the warning panel before committing this plan.';
        }
        this.cdr.markForCheck();
      },
      error: (error) => {
        this.errorMessage = this.normalizeError(error, 'Simulation failed. Please try again.');
        this.isRunning = false;
        this.cdr.markForCheck();
      }
    });
  }

  saveScenario(): void {
    if (!this.result || this.isSavingScenario || this.validationError) return;

    this.isSavingScenario = true;
    this.actionMessage = '';

    this.apiService.saveScenarioSimulation(this.buildScenarioPayload()).subscribe({
      next: (response) => {
        const scenario = response?.scenario as SavedScenario | undefined;
        if (scenario) {
          this.scenarioHistory = [scenario, ...this.scenarioHistory.filter((item) => item._id !== scenario._id)].slice(0, 8);
          this.historyCacheHit = false;
        }
        this.actionTone = 'success';
        this.actionMessage = 'Scenario saved to your personal history.';
        this.isSavingScenario = false;
        this.cdr.markForCheck();
      },
      error: (error) => {
        this.actionTone = 'error';
        this.actionMessage = this.normalizeError(error, 'Failed to save scenario.');
        this.isSavingScenario = false;
        this.cdr.markForCheck();
      }
    });
  }

  loadScenario(scenario: SavedScenario): void {
    this.scenarioName = scenario.name || '';
    this.baselineHiringScore = scenario.baselineHiringScore;
    this.baselineJobMatch = scenario.baselineJobMatch;
    this.role = scenario.role;
    this.experienceLevel = scenario.experienceLevel;
    this.durationWeeks = scenario.durationWeeks;
    this.skills = [...(scenario.skills || [])];
    this.projects = scenario.projects?.length
      ? scenario.projects.map((project) => this.cloneProject(project))
      : [this.createEmptyProject()];
    this.result = scenario.result;
    this.hasSimulated = true;
    this.errorMessage = '';
    this.actionTone = 'info';
    this.actionMessage = `Loaded scenario "${scenario.name}".`;
    this.cdr.markForCheck();
  }

  compareWithScenario(scenario: SavedScenario): void {
    this.compareScenario = this.compareScenario?._id === scenario._id ? null : scenario;
  }

  deleteScenario(id: string): void {
    if (!id || this.deletingScenarioId) return;

    this.deletingScenarioId = id;
    this.apiService.deleteScenarioSimulation(id).subscribe({
      next: () => {
        this.scenarioHistory = this.scenarioHistory.filter((scenario) => scenario._id !== id);
        this.historyCacheHit = false;
        if (this.compareScenario?._id === id) this.compareScenario = null;
        this.deletingScenarioId = '';
        this.actionTone = 'success';
        this.actionMessage = 'Scenario removed from history.';
        this.cdr.markForCheck();
      },
      error: (error) => {
        this.deletingScenarioId = '';
        this.actionTone = 'error';
        this.actionMessage = this.normalizeError(error, 'Failed to delete scenario.');
        this.cdr.markForCheck();
      }
    });
  }

  createSprintDraft(): void {
    if (!this.result || this.isCreatingSprint || this.validationError) return;

    this.isCreatingSprint = true;
    this.actionMessage = '';

    this.apiService.createSprintFromScenario(this.buildScenarioPayload()).subscribe({
      next: (response) => {
        this.isCreatingSprint = false;
        this.actionTone = 'success';
        const sprint = response?.sprint || {};
        this.actionMessage = response?.message || `Scenario sprint updated: ${sprint.tasksCreated || 0} created, ${sprint.tasksMerged || 0} merged, ${sprint.tasksSkipped || 0} skipped.`;
        this.cdr.markForCheck();
      },
      error: (error) => {
        this.isCreatingSprint = false;
        this.actionTone = 'error';
        this.actionMessage = this.normalizeError(error, 'Failed to create a sprint from this scenario.');
        this.cdr.markForCheck();
      }
    });
  }

  barWidth(value: number): number {
    return Math.min(100, Math.abs(value) * 2.5);
  }

  rangeWidth(start: number, end: number): number {
    return Math.max(2, end - start);
  }

  tierColor(tier: string): string {
    return { core: '#22c55e', valuable: '#60a5fa', transferable: '#f59e0b', low: '#ef4444' }[tier] || '#64748b';
  }

  tierLabel(tier: string): string {
    return { core: 'Core', valuable: 'Valuable', transferable: 'Transferable', low: 'Low Relevance' }[tier] || tier;
  }

  scoreColor(score: number): string {
    if (score >= 80) return '#22c55e';
    if (score >= 60) return '#f59e0b';
    return '#ef4444';
  }

  deltaLabel(value: number): string {
    return value >= 0 ? `+${value}` : `${value}`;
  }

  formatRole(value: string): string {
    return value === 'ai/ml'
      ? 'AI / ML'
      : value.replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  formatDate(value: string | null | undefined): string {
    if (!value) return 'Not available';
    return new Date(value).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }

  trackBySkill(_: number, skill: string): string {
    return skill;
  }

  trackByProject(_: number, project: ProjectInput): string {
    return `${project.name}-${project.weeks}-${project.impact}`;
  }

  trackByProjectInput(index: number): number {
    return index;
  }

  trackByHistory(_: number, scenario: SavedScenario): string {
    return scenario._id;
  }

  trackBySource(_: number, source: ScenarioSource): string {
    return source.key;
  }
}
