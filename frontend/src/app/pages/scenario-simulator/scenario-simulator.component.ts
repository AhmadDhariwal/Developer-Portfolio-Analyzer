import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  DoCheck,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { catchError, forkJoin, of, Subject, Subscription, switchMap, takeUntil } from 'rxjs';
import { distinctUntilChanged } from 'rxjs/operators';
import { ScenarioSimulatorService } from '../../shared/services/scenario-simulator.service';
import { CareerProfileService } from '../../shared/services/career-profile.service';
import { buildCareerProfileSignature } from '../../shared/models/career-profile.model';

import {
  ProjectInput,
  SimResult,
  ScenarioContext,
  SavedScenario,
  ScenarioSource,
  ScenarioInput,
} from '../../shared/models/scenario-simulator.model';
import {
  SCENARIO_TEMPLATES,
  ScenarioTemplateDefinition,
  ScenarioTemplateDraft,
} from '../../shared/models/scenario-template.model';
import { ScenarioTemplateConfiguratorComponent } from './scenario-template-configurator/scenario-template-configurator.component';

@Component({
  selector: 'app-scenario-simulator',
  standalone: true,
  imports: [CommonModule, FormsModule, ScenarioTemplateConfiguratorComponent],
  templateUrl: './scenario-simulator.component.html',
  styleUrl: './scenario-simulator.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScenarioSimulatorComponent implements OnInit, OnDestroy, DoCheck {
  baselineConfirmed = false;
  private evaluatedPayload: ScenarioInput | null = null;
  private evaluatedDraftKey = '';
  private requestGeneration = 0;
  private contextGeneration = 0;
  private readonly destroyed$ = new Subject<void>();
  nextHistoryCursor: string | null = null;
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
  historyError = '';
  actionMessage = '';
  actionTone: 'success' | 'error' | 'info' = 'info';
  result: SimResult | null = null;
  hasSimulated = false;
  showInfoPanel = false;
  showMobileContext = false;
  showMobileHistory = false;
  context: ScenarioContext | null = null;
  scenarioHistory: SavedScenario[] = [];
  compareScenario: SavedScenario | null = null;
  isCompareOpen = false;
  activeResultTab: 'overview' | 'breakdown' | 'roadmap' = 'overview';
  deletingScenarioId = '';
  contextCacheHit = false;
  historyCacheHit = false;
  private readonly subscriptions = new Subscription();
  private lastProfileSignature = '';

  readonly roleOptions = [
    { value: 'frontend', label: 'Frontend Developer' },
    { value: 'backend', label: 'Backend Developer' },
    { value: 'full stack', label: 'Full Stack Developer' },
    { value: 'ai/ml', label: 'AI / ML Engineer' },
    { value: 'devops', label: 'DevOps / Cloud Engineer' },
  ];

  readonly levelOptions = [
    { value: 'junior', label: 'Junior (0-2 years)' },
    { value: 'mid', label: 'Mid-level (2-5 years)' },
    { value: 'senior', label: 'Senior (5+ years)' },
  ];

  readonly durationOptions = [2, 4, 6, 8, 12, 16];

  readonly templates = SCENARIO_TEMPLATES;
  activeTemplate: ScenarioTemplateDefinition | null = null;
  private pristineDraftKey = '';

  private fullDraftKey(): string {
    return JSON.stringify({
      ...this.buildScenarioPayload(),
      projects: this.projects,
      skillInput: this.skillInput,
    });
  }
  get hasUnsavedDraft(): boolean {
    return this.fullDraftKey() !== this.pristineDraftKey;
  }
  get templateContext(): ScenarioContext | null {
    if (!this.context) return null;
    if (
      this.context.profile.role === this.role &&
      this.context.profile.level === this.experienceLevel
    )
      return this.context;
    return {
      ...this.context,
      signals: { ...this.context.signals, missingSkills: [], portfolioCandidates: [] },
    };
  }

  ngDoCheck(): void {
    if (this.result?.ruleVersion === 'scenario-planning-v2' && !this.isResultCurrent)
      this.invalidateEvaluation();
  }

  private invalidateEvaluation(): void {
    this.requestGeneration++;
    this.isRunning = false;
    this.result = null;
    this.hasSimulated = false;
    this.evaluatedPayload = null;
    this.evaluatedDraftKey = '';
  }

  constructor(
    private readonly apiService: ScenarioSimulatorService,
    private readonly careerProfileService: CareerProfileService,
    private readonly cdr: ChangeDetectorRef,
  ) {
    this.pristineDraftKey = this.fullDraftKey();
  }

  ngOnInit(): void {
    this.subscriptions.add(
      this.apiService.sessionChanged$.subscribe(() => {
        this.requestGeneration++;
        this.contextGeneration++;
        this.isRunning = false;
        this.isSavingScenario = false;
        this.isCreatingSprint = false;
        this.isLoadingContext = false;
        this.isLoadingHistory = false;
        this.context = null;
        this.activeTemplate = null;
        this.skillInput = '';
        this.errorMessage = '';
        this.actionMessage = '';
        this.hasSimulated = false;
        this.nextHistoryCursor = null;
        this.skills = [];
        this.projects = [this.createEmptyProject()];
        this.scenarioName = '';
        this.baselineHiringScore = 55;
        this.baselineJobMatch = 48;
        this.role = 'full stack';
        this.experienceLevel = 'mid';
        this.durationWeeks = 6;
        this.result = null;
        this.evaluatedPayload = null;
        this.scenarioHistory = [];
        this.compareScenario = null;
        this.baselineConfirmed = false;
        this.pristineDraftKey = this.fullDraftKey();
        this.cdr.markForCheck();
      }),
    );
    this.lastProfileSignature = buildCareerProfileSignature(this.careerProfileService.snapshot);
    this.subscriptions.add(
      this.careerProfileService.careerProfile$
        .pipe(
          distinctUntilChanged(
            (a, b) => buildCareerProfileSignature(a) === buildCareerProfileSignature(b),
          ),
        )
        .subscribe((profile) => {
          const nextSignature = buildCareerProfileSignature(profile);
          if (nextSignature === this.lastProfileSignature) return;
          this.lastProfileSignature = nextSignature;
          this.reloadContextForProfileChange();
        }),
    );
    this.loadBootstrapData();
  }

  ngOnDestroy(): void {
    this.requestGeneration++;
    this.destroyed$.next();
    this.destroyed$.complete();
    this.subscriptions.unsubscribe();
  }

  private createEmptyProject(): ProjectInput {
    return { name: '', impact: 70, complexity: 'medium', weeks: 3 };
  }

  private cloneProject(project: Partial<ProjectInput>): ProjectInput {
    return {
      name: String(project.name || '').trim(),
      impact: Math.max(
        0,
        Math.min(100, Number.isFinite(Number(project.impact)) ? Number(project.impact) : 70),
      ),
      complexity:
        project.complexity === 'low' || project.complexity === 'high'
          ? project.complexity
          : 'medium',
      weeks: Math.max(1, Math.min(24, Number(project.weeks) || 3)),
    };
  }

  private buildScenarioPayload(): ScenarioInput {
    return {
      ruleVersion: 'scenario-planning-v2',
      baselineAuthority: 'user-assumption',
      baselineConfirmed: this.baselineConfirmed,
      name: this.scenarioName.trim(),
      baselineHiringScore: this.baselineHiringScore,
      baselineJobMatch: this.baselineJobMatch,
      role: this.role,
      experienceLevel: this.experienceLevel,
      durationWeeks: this.durationWeeks,
      skills: this.skills,
      projects: this.validProjects,
    };
  }

  private draftKey(payload: ScenarioInput = this.buildScenarioPayload()): string {
    const { name, evaluation, scenarioId, mode, ...input } = payload;
    return JSON.stringify(input);
  }
  get isResultCurrent(): boolean {
    return (
      this.result?.ruleVersion === 'scenario-planning-v2' &&
      !!this.result.evaluation &&
      this.evaluatedDraftKey === this.draftKey()
    );
  }
  private applyContext(context: ScenarioContext, resetPlan = false): void {
    this.context = context;

    if (
      !resetPlan &&
      (this.hasUnsavedDraft ||
        this.baselineConfirmed ||
        this.skills.length ||
        this.validProjects.length ||
        this.hasSimulated)
    ) {
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
    this.pristineDraftKey = this.fullDraftKey();
  }

  private generateScenarioName(): string {
    const roleLabel =
      this.roleOptions.find((option) => option.value === this.role)?.label || 'Career Scenario';
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
    this.historyError = '';
    if (forceRefresh) {
      this.actionTone = 'info';
      this.actionMessage = 'Refreshing simulator signals and saved scenarios...';
    }

    const generation = ++this.contextGeneration;
    forkJoin({
      context: this.apiService
        .getScenarioSimulatorContext(forceRefresh, this.lastProfileSignature)
        .pipe(catchError(() => of(null))),
      history: this.apiService
        .getScenarioSimulationHistory(8, forceRefresh, this.lastProfileSignature)
        .pipe(
          catchError(() => {
            this.historyError =
              'History could not be refreshed. Showing the last loaded evaluations.';
            return of({
              history: this.scenarioHistory,
              nextCursor: this.nextHistoryCursor,
              frontendCacheHit: false,
              cache: { hit: false },
            });
          }),
        ),
    })
      .pipe(takeUntil(this.destroyed$))
      .subscribe({
        next: ({ context, history }) => {
          if (generation !== this.contextGeneration) return;
          if (context?.context) {
            this.applyContext(context.context, false);
            this.contextCacheHit = !!context.frontendCacheHit || !!context.context.cache?.hit;
          } else {
            this.contextError =
              'Live scenario signals are unavailable right now. You can still simulate manually.';
            this.contextCacheHit = false;
          }

          this.scenarioHistory = Array.isArray(history?.history) ? history.history : [];
          this.nextHistoryCursor = history?.nextCursor || null;
          this.historyCacheHit = !!history?.frontendCacheHit || !!history?.cache?.hit;
          if (forceRefresh && !this.contextError && !this.historyError) {
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
        },
      });
  }

  private reloadContextForProfileChange(): void {
    this.activeTemplate = null;
    this.context = null;
    this.invalidateEvaluation();
    this.apiService.invalidateScenarioContextCache();
    this.loadBootstrapData(true);
  }
  loadMoreHistory(): void {
    if (!this.nextHistoryCursor || this.isLoadingHistory) return;
    this.isLoadingHistory = true;
    this.apiService
      .getScenarioSimulationHistory(8, true, this.lastProfileSignature, this.nextHistoryCursor)
      .pipe(takeUntil(this.destroyed$))
      .subscribe({
        next: (response) => {
          this.scenarioHistory = [...this.scenarioHistory, ...response.history];
          this.nextHistoryCursor = response.nextCursor || null;
          this.isLoadingHistory = false;
          this.cdr.markForCheck();
        },
        error: () => {
          this.isLoadingHistory = false;
          this.cdr.markForCheck();
        },
      });
  }

  get validProjects(): ProjectInput[] {
    return this.projects
      .map((project) => ({ ...project, name: String(project.name || '').trim() }))
      .filter((project) => project.name.trim());
  }

  get validationError(): string | null {
    if (!this.baselineConfirmed) return 'Confirm your planning baseline assumptions.';
    if (!Number.isFinite(this.baselineHiringScore) || !Number.isFinite(this.baselineJobMatch))
      return 'Baseline assumptions must be numbers.';
    if (this.baselineHiringScore < 0 || this.baselineHiringScore > 100)
      return 'Hiring score must be between 0 and 100.';
    if (this.baselineJobMatch < 0 || this.baselineJobMatch > 100)
      return 'Job match must be between 0 and 100.';
    if (!Number.isInteger(this.durationWeeks) || this.durationWeeks < 1 || this.durationWeeks > 24)
      return 'Duration must be between 1 and 24 weeks.';
    if (
      this.validProjects.some((project) =>
        (this.context?.signals.completedPortfolioProjects || []).some(
          (name) => name.trim().toLowerCase() === project.name.toLowerCase(),
        ),
      )
    )
      return 'Choose new work; completed portfolio projects cannot be planned again.';
    if (!this.skills.length && !this.validProjects.length)
      return 'Add at least one skill or project.';
    if (this.skills.length > 10 || this.validProjects.length > 5)
      return 'Use up to ten skills and five projects.';
    if (
      this.validProjects.some(
        (project) =>
          !Number.isFinite(project.impact) ||
          project.impact < 0 ||
          project.impact > 100 ||
          !Number.isInteger(project.weeks) ||
          project.weeks < 1 ||
          project.weeks > 24,
      )
    )
      return 'Project impact must be 0–100 and weeks must be an integer from 1–24.';
    const projectNames = this.validProjects.map((project) => project.name.trim().toLowerCase());
    if (new Set(projectNames).size !== projectNames.length)
      return 'Remove duplicate project names before running the simulation.';
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
      { label: 'Skills', value: breakdown.skills, color: 'var(--color-primary-text)' },
      { label: 'Projects', value: breakdown.projects, color: 'var(--sim-success-text)' },
      { label: 'Synergy', value: breakdown.synergy, color: 'var(--color-warning-text)' },
      { label: 'Penalty', value: breakdown.penalty, color: 'var(--color-danger-text)' },
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
    if (
      this.projects.some(
        (item) => item.name.trim().toLowerCase() === project.name.trim().toLowerCase(),
      )
    )
      return;
    this.projects = [...this.projects, this.cloneProject(project)];
  }

  removeProject(index: number): void {
    this.projects = this.projects.filter((_, currentIndex) => currentIndex !== index);
    if (!this.projects.length) this.projects = [this.createEmptyProject()];
  }

  applyTemplate(template: ScenarioTemplateDefinition): void {
    this.activeTemplate = template;
  }

  commitTemplate(event: {
    draft: ScenarioTemplateDraft;
    evaluate: boolean;
    baselineConfirmed: boolean;
  }): void {
    if (!this.activeTemplate) return;
    const label = this.activeTemplate.label;
    this.invalidateEvaluation();
    this.skills = [...event.draft.skills];
    this.projects = event.draft.projects.map((project) => ({ ...project }));
    this.durationWeeks = event.draft.durationWeeks;
    this.baselineConfirmed = event.baselineConfirmed;
    this.skillInput = '';
    this.scenarioName = `${label} - ${this.generateScenarioName()}`;
    this.activeTemplate = null;
    this.compareScenario = null;
    this.errorMessage = '';
    this.actionTone = 'info';
    this.actionMessage =
      'Template applied to your editable draft. Save or export only after evaluation.';
    if (event.evaluate) this.simulate();
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

    const payload = structuredClone(this.buildScenarioPayload());
    const generation = ++this.requestGeneration;
    this.apiService
      .runWhatIfSimulation(payload)
      .pipe(takeUntil(this.destroyed$))
      .subscribe({
        next: (response) => {
          if (generation !== this.requestGeneration) return;
          if (this.draftKey(payload) !== this.draftKey()) {
            this.invalidateEvaluation();
            this.cdr.markForCheck();
            return;
          }
          this.evaluatedPayload = payload;
          this.evaluatedDraftKey = this.draftKey(payload);
          this.result = response?.result || null;
          this.hasSimulated = !!this.result;
          this.isRunning = false;
          if (!this.scenarioName.trim()) this.scenarioName = this.generateScenarioName();
          if (this.result?.warnings?.length) {
            this.actionTone = 'info';
            this.actionMessage =
              'Simulation completed with realism warnings. Review the warning panel before committing this plan.';
          }
          this.cdr.markForCheck();
        },
        error: (error) => {
          if (generation !== this.requestGeneration) return;
          this.errorMessage = this.normalizeError(error, 'Simulation failed. Please try again.');
          this.isRunning = false;
          this.cdr.markForCheck();
        },
      });
  }

  saveScenario(): void {
    if (!this.result || !this.isResultCurrent || this.isSavingScenario || this.validationError)
      return;

    this.isSavingScenario = true;
    this.actionMessage = '';
    const savingDraftKey = this.fullDraftKey();

    this.apiService
      .saveScenarioSimulation({
        ...this.evaluatedPayload!,
        name: this.scenarioName,
        evaluation: this.result.evaluation,
      })
      .pipe(takeUntil(this.destroyed$))
      .subscribe({
        next: (response) => {
          const scenario = response?.scenario as SavedScenario | undefined;
          if (scenario) {
            if (this.fullDraftKey() === savingDraftKey) this.pristineDraftKey = savingDraftKey;
            this.scenarioHistory = [
              scenario,
              ...this.scenarioHistory.filter((item) => item._id !== scenario._id),
            ].slice(0, 8);
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
        },
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
    this.baselineConfirmed = scenario.result?.ruleVersion === 'scenario-planning-v2';
    this.evaluatedPayload =
      this.baselineConfirmed && scenario.result?.evaluation
        ? { ...scenario.result.evaluation.normalizedInput, ruleVersion: 'scenario-planning-v2' }
        : null;
    this.evaluatedDraftKey = this.evaluatedPayload ? this.draftKey() : '';
    this.pristineDraftKey = this.fullDraftKey();
    this.hasSimulated = true;
    this.errorMessage = '';
    this.actionTone = 'info';
    this.actionMessage = `Loaded scenario "${scenario.name}".`;
    this.cdr.markForCheck();
  }

  compareWithScenario(scenario: SavedScenario): void {
    if (this.compareScenario?._id === scenario._id && this.isCompareOpen) {
      this.isCompareOpen = false;
      this.compareScenario = null;
    } else {
      this.compareScenario = scenario;
      this.isCompareOpen = true;
      setTimeout(() => {
        const el = document.getElementById('scenario-comparison-section');
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 100);
    }
    this.cdr.markForCheck();
  }

  closeCompare(): void {
    this.isCompareOpen = false;
    this.compareScenario = null;
    this.cdr.markForCheck();
  }

  scrollTabs(direction: 'left' | 'right'): void {
    const el = document.getElementById('dossierNavTabs');
    if (el) {
      el.scrollBy({ left: direction === 'left' ? -180 : 180, behavior: 'smooth' });
    }
  }

  selectTab(tab: 'overview' | 'breakdown' | 'roadmap'): void {
    this.activeResultTab = tab;
    setTimeout(() => {
      const el = document.getElementById(`dossierTab-${tab}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    }, 10);
    this.cdr.markForCheck();
  }

  selectBenchmarkById(id: string): void {
    const found = this.scenarioHistory.find((s) => s._id === id);
    if (found) {
      this.compareScenario = found;
      this.isCompareOpen = true;
      this.cdr.markForCheck();
    }
  }

  onBenchmarkChange(event: Event): void {
    const select = event.target as HTMLSelectElement;
    if (select && select.value) {
      this.selectBenchmarkById(select.value);
    }
  }

  get comparisonData() {
    if (!this.compareScenario) return null;
    const currentScore = this.result?.predicted?.hiringScore ?? this.baselineHiringScore;
    const currentMatch = this.result?.predicted?.jobMatch ?? this.baselineJobMatch;
    const currentFeasibility = this.result?.confidenceScore ?? (this.baselineConfirmed ? 80 : 60);
    const currentDuration = this.result?.meta?.durationWeeks ?? this.durationWeeks;
    const currentName =
      this.scenarioName?.trim() ||
      (this.result ? 'Current Simulated Plan' : 'Current Baseline Profile');

    const savedScore =
      this.compareScenario.result?.predicted?.hiringScore ??
      this.compareScenario.predicted?.hiringScore ??
      0;
    const savedMatch =
      this.compareScenario.result?.predicted?.jobMatch ??
      this.compareScenario.predicted?.jobMatch ??
      0;
    const savedFeasibility = this.compareScenario.confidenceScore ?? 0;
    const savedDuration = this.compareScenario.durationWeeks ?? 0;
    const savedName = this.compareScenario.name;

    const currentSkills = new Set((this.skills || []).map((s) => s.toLowerCase().trim()));
    const savedSkills = new Set(
      (this.compareScenario.skills || []).map((s) => s.toLowerCase().trim()),
    );

    const sharedSkills: string[] = [];
    const currentOnlySkills: string[] = [];
    const savedOnlySkills: string[] = [];

    (this.skills || []).forEach((s) => {
      if (savedSkills.has(s.toLowerCase().trim())) {
        sharedSkills.push(s);
      } else {
        currentOnlySkills.push(s);
      }
    });

    (this.compareScenario.skills || []).forEach((s) => {
      if (!currentSkills.has(s.toLowerCase().trim())) {
        savedOnlySkills.push(s);
      }
    });

    return {
      current: {
        name: currentName,
        hiringScore: currentScore,
        jobMatch: currentMatch,
        feasibility: currentFeasibility,
        duration: currentDuration,
        skillsCount: this.skills?.length || 0,
        projectsCount: this.projects?.length || 0,
        isSimulated: !!this.result,
        role: this.role,
        level: this.experienceLevel,
      },
      saved: {
        name: savedName,
        hiringScore: savedScore,
        jobMatch: savedMatch,
        feasibility: savedFeasibility,
        duration: savedDuration,
        skillsCount: this.compareScenario.skills?.length || 0,
        projectsCount: this.compareScenario.projects?.length || 0,
        role: this.compareScenario.role,
        level: this.compareScenario.experienceLevel,
        createdAt: this.compareScenario.createdAt,
      },
      deltas: {
        hiring: currentScore - savedScore,
        jobMatch: currentMatch - savedMatch,
        feasibility: currentFeasibility - savedFeasibility,
        duration: currentDuration - savedDuration,
      },
      skills: {
        shared: sharedSkills,
        currentOnly: currentOnlySkills,
        savedOnly: savedOnlySkills,
      },
      projects: {
        current: this.projects || [],
        saved: this.compareScenario.projects || [],
      },
    };
  }

  deleteScenario(id: string): void {
    if (!id || this.deletingScenarioId) return;

    this.deletingScenarioId = id;
    this.apiService
      .deleteScenarioSimulation(id)
      .pipe(takeUntil(this.destroyed$))
      .subscribe({
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
        },
      });
  }

  createSprintDraft(): void {
    if (!this.result || !this.isResultCurrent || this.isCreatingSprint || this.validationError)
      return;

    this.isCreatingSprint = true;
    this.actionMessage = '';

    const payload = {
      ...this.evaluatedPayload!,
      name: this.scenarioName,
      evaluation: this.result.evaluation,
    };
    this.apiService
      .saveScenarioSimulation(payload)
      .pipe(
        switchMap((response) =>
          this.apiService.createSprintFromScenario({
            ...payload,
            scenarioId: response.scenario._id,
            mode: 'draft',
          }),
        ),
        takeUntil(this.destroyed$),
      )
      .subscribe({
        next: (response) => {
          this.isCreatingSprint = false;
          this.actionTone = 'success';
          const sprint = response?.sprint || {};
          this.actionMessage =
            response?.message ||
            `Scenario sprint updated: ${sprint.tasksCreated || 0} created, ${sprint.tasksMerged || 0} merged, ${sprint.tasksSkipped || 0} skipped.`;
          this.cdr.markForCheck();
        },
        error: (error) => {
          this.isCreatingSprint = false;
          this.actionTone = 'error';
          this.actionMessage = this.normalizeError(
            error,
            'Failed to create a sprint from this scenario.',
          );
          this.cdr.markForCheck();
        },
      });
  }

  barWidth(value: number): number {
    return Math.min(100, Math.abs(value) * 2.5);
  }

  rangeWidth(start: number, end: number): number {
    return Math.max(2, end - start);
  }

  tierColor(tier: string): string {
    return (
      {
        core: 'var(--sim-success-text)',
        valuable: 'var(--color-info-text)',
        transferable: 'var(--color-warning-text)',
        low: 'var(--color-danger-text)',
      }[tier] || 'var(--text-muted)'
    );
  }

  tierLabel(tier: string): string {
    return (
      { core: 'Core', valuable: 'Valuable', transferable: 'Transferable', low: 'Low Relevance' }[
        tier
      ] || tier
    );
  }

  scoreColor(score: number): string {
    if (score >= 80) return 'var(--sim-success-text)';
    if (score >= 60) return 'var(--color-warning-text)';
    return 'var(--color-danger-text)';
  }

  deltaLabel(value: number): string {
    return value >= 0 ? `+${value}` : `${value}`;
  }

  formatRole(value: string): string {
    return value === 'ai/ml' ? 'AI / ML' : value.replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  formatDate(value: string | null | undefined): string {
    if (!value) return 'Not available';
    return new Date(value).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
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
