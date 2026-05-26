import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { catchError, forkJoin, of } from 'rxjs';
import {
  AiPlanDraft,
  CareerSprint,
  CareerSprintService,
  GenerateAiTasksResponse,
  PlannerFilter,
  SprintTask,
  TaskCategory,
  TaskPriority,
  StreakStatus
} from '../../shared/services/career-sprint.service';
import { ProfileService } from '../../shared/services/profile.service';

@Component({
  selector: 'app-career-sprint',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './career-sprint.component.html',
  styleUrl: './career-sprint.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CareerSprintComponent implements OnInit {
  sprint: CareerSprint | null = null;
  history: CareerSprint[] = [];
  userAvatar = '';
  userName = '';
  userInitial = 'D';
  avatarVersion = Date.now();
  isLoading = false;
  errorMessage = '';
  actionMessage = '';
  actionTone: 'success' | 'error' | 'info' = 'info';

  newTaskTitle = '';
  newTaskDescription = '';
  newTaskPoints = 3;
  newTaskPriority: TaskPriority = 'medium';
  newTaskCategory: TaskCategory = 'learning';
  isAddingTask = false;

  goalStack = '';
  goalTechnology = '';
  goalExperienceLevel = '';
  isGeneratingPlan = false;
  isGeneratingAi = false;
  isSavingAiPlan = false;
  isImportingScenario = false;
  generatedTasks: SprintTask[] = [];
  generatedPlanMeta: GenerateAiTasksResponse['planMeta'] | null = null;
  showSetupPanel = false;

  sprintStartDate = '';
  sprintEndDate = '';
  isSavingDates = false;

  plannerFilter: PlannerFilter = 'week';
  customRangeStart = '';
  customRangeEnd = '';
  selectedDraftId = '';

  readonly priorityOptions: TaskPriority[] = ['high', 'medium', 'low'];
  readonly categoryOptions: TaskCategory[] = ['learning', 'project', 'practice'];

  constructor(
    private readonly sprintService: CareerSprintService,
    private readonly profileService: ProfileService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loadData();
    this.loadProfile();
  }

  loadProfile(): void {
    this.profileService.getProfile().subscribe({
      next: (profile) => {
        this.userAvatar = this.profileService.resolveAvatarUrl(profile.avatar || '');
        this.userName = profile.name || '';
        this.userInitial = this.profileService.getInitials(this.userName || 'Developer') || 'D';
        if (!this.goalStack && profile.careerStack) this.goalStack = profile.careerStack;
        if (!this.goalExperienceLevel && profile.experienceLevel) this.goalExperienceLevel = profile.experienceLevel;
        this.avatarVersion = Date.now();
        this.cdr.markForCheck();
      },
      error: () => this.cdr.markForCheck()
    });
  }

  loadData(): void {
    this.isLoading = true;
    this.errorMessage = '';

    forkJoin({
      sprint: this.sprintService.getCurrent(),
      history: this.sprintService.getHistory(8).pipe(
        catchError(() => of({ history: [] }))
      )
    }).subscribe({
      next: ({ sprint, history }) => {
        this.applySprintState(sprint);
        this.history = history.history || [];
        this.isLoading = false;
        this.cdr.markForCheck();
      },
      error: (error) => {
        this.errorMessage = error?.error?.message || 'Failed to load Career Sprint.';
        this.isLoading = false;
        this.cdr.markForCheck();
      }
    });
  }

  private applySprintState(sprint: CareerSprint): void {
    this.sprint = sprint;
    this.syncDatePickers();
    if (!this.goalStack && sprint.goalStack) this.goalStack = sprint.goalStack;
    if (!this.goalTechnology && sprint.goalTechnology) this.goalTechnology = sprint.goalTechnology;
    if (!this.goalExperienceLevel && sprint.goalExperienceLevel) this.goalExperienceLevel = sprint.goalExperienceLevel;
  }

  private syncDatePickers(): void {
    if (!this.sprint) return;
    const start = this.sprint.sprintStartDate || this.sprint.weekStartDate;
    const end = this.sprint.sprintEndDate || this.sprint.weekEndDate;
    this.sprintStartDate = this.toDateInputValue(start);
    this.sprintEndDate = this.toDateInputValue(end);
  }

  private setAction(message: string, tone: 'success' | 'error' | 'info' = 'info'): void {
    this.actionMessage = message;
    this.actionTone = tone;
  }

  private parseDate(value: string | Date | null | undefined): Date | null {
    if (!value) return null;
    const parsed = value instanceof Date ? new Date(value) : new Date(String(value));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private toDateInputValue(value: string | Date | null | undefined): string {
    const parsed = this.parseDate(value);
    return parsed ? parsed.toISOString().split('T')[0] : '';
  }

  get analytics() {
    return this.sprint?.analytics || null;
  }

  get comparison() {
    return this.sprint?.comparison || null;
  }

  get restoreMeta() {
    return this.sprint?.restoreMeta || null;
  }

  get progressPercent(): number {
    return this.analytics?.progressPercent || 0;
  }

  get totalPoints(): number {
    return this.analytics?.totalPoints || 0;
  }

  get completedPoints(): number {
    return this.analytics?.completedPoints || 0;
  }

  get completedCount(): number {
    return this.analytics?.completedTasks || 0;
  }

  get remainingTasksCount(): number {
    return this.analytics?.pendingTasks || 0;
  }

  get overdueCount(): number {
    return this.analytics?.overdueTasks || 0;
  }

  get progressRingOffset(): number {
    const circumference = 2 * Math.PI * 45;
    return circumference - (this.progressPercent / 100) * circumference;
  }

  get xpPoints(): number {
    return this.sprint?.xpPoints || 0;
  }

  get level(): number {
    return this.sprint?.level || 1;
  }

  get xpToNextLevel(): number {
    return this.level * 100;
  }

  get xpInCurrentLevel(): number {
    return this.xpPoints - ((this.level - 1) * 100);
  }

  get xpProgressPercent(): number {
    return Math.min(100, Math.max(0, Math.round((this.xpInCurrentLevel / 100) * 100)));
  }

  get currentStreak(): number {
    return this.sprint?.currentStreak ?? this.sprint?.streak ?? 0;
  }

  get longestStreak(): number {
    return this.sprint?.longestStreak ?? 0;
  }

  get canRestore(): boolean {
    return !!this.sprint?._canRestore;
  }

  getStreakStatus(): StreakStatus {
    if (!this.sprint) return 'active';
    return this.sprint.streakStatus || (this.sprint.streakBroken ? 'broken' : this.sprint.streakWarning ? 'warning' : 'active');
  }

  get motivationalText(): string {
    const progress = this.progressPercent;
    if (progress === 0) return 'Ready to start';
    if (progress < 25) return 'Build momentum today';
    if (progress < 60) return 'Steady execution';
    if (progress < 100) return 'Closing the sprint strong';
    return 'Sprint goal achieved';
  }

  get effectiveStartDate(): Date | null {
    const value = this.sprint?.sprintStartDate || this.sprint?.weekStartDate;
    return this.parseDate(value);
  }

  get effectiveEndDate(): Date | null {
    const value = this.sprint?.sprintEndDate || this.sprint?.weekEndDate;
    return this.parseDate(value);
  }

  get sprintDurationDays(): number {
    if (!this.effectiveStartDate || !this.effectiveEndDate) return 7;
    const milliseconds = new Date(this.effectiveEndDate).setHours(0, 0, 0, 0) - new Date(this.effectiveStartDate).setHours(0, 0, 0, 0);
    return Math.max(1, Math.round(milliseconds / (1000 * 60 * 60 * 24)) + 1);
  }

  get allTasks(): SprintTask[] {
    return this.sprint?.tasks || [];
  }

  get pendingTasks(): SprintTask[] {
    return this.allTasks.filter((task) => !task.isCompleted);
  }

  get completedTasks(): SprintTask[] {
    return this.allTasks.filter((task) => task.isCompleted);
  }

  get todayTasks(): SprintTask[] {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    return this.pendingTasks.filter((task) => {
      const dueDate = task.endDate || task.deadline || task.dueDate;
      if (!dueDate) return false;
      const parsed = this.parseDate(dueDate);
      if (!parsed) return false;
      return parsed >= today && parsed < tomorrow;
    });
  }

  get overdueTasks(): SprintTask[] {
    const now = new Date();
    return this.pendingTasks.filter((task) => {
      const dueDate = task.endDate || task.deadline || task.dueDate;
      const parsed = this.parseDate(dueDate);
      return parsed ? parsed < now : false;
    });
  }

  get sprintTasks(): SprintTask[] {
    const start = this.effectiveStartDate;
    const end = this.effectiveEndDate;
    if (!start || !end) return this.pendingTasks;

    return this.pendingTasks.filter((task) => {
      const taskStart = this.parseDate(task.startDate);
      const taskEnd = this.parseDate(task.endDate);
      if (!taskStart && !taskEnd) return true;
      return (!taskStart || taskStart <= end) && (!taskEnd || taskEnd >= start);
    });
  }

  get customRangeTasks(): SprintTask[] {
    if (!this.customRangeStart || !this.customRangeEnd) return this.pendingTasks;
    const start = new Date(this.customRangeStart);
    start.setHours(0, 0, 0, 0);
    const end = new Date(this.customRangeEnd);
    end.setHours(23, 59, 59, 999);
    return this.pendingTasks.filter((task) => {
      const dueDate = task.endDate || task.deadline || task.dueDate;
      if (!dueDate) return true;
      const parsed = this.parseDate(dueDate);
      if (!parsed) return false;
      return parsed >= start && parsed <= end;
    });
  }

  get plannerTasks(): SprintTask[] {
    switch (this.plannerFilter) {
      case 'all':
        return this.allTasks;
      case 'sprint':
        return this.sprintTasks;
      case 'today':
        return this.todayTasks;
      case 'overdue':
        return this.overdueTasks;
      case 'custom':
        return this.customRangeTasks;
      case 'week':
      default:
        return this.pendingTasks;
    }
  }

  get latestHistory(): CareerSprint | null {
    return this.history[0] || null;
  }

  get sprintDaysLabel(): string {
    const days = this.sprintDurationDays;
    return `${days} day${days === 1 ? '' : 's'} left`;
  }

  get trendActivity(): Array<{ date: string; count: number; active: boolean; label: string }> {
    const labels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    const activity = (this.analytics?.dailyActivity || []).slice(-7);
    return activity.map((item) => {
      const parsed = this.parseDate(item.date);
      const dayIndex = parsed ? parsed.getDay() : 0;
      return {
        ...item,
        label: labels[dayIndex] || 'S'
      };
    });
  }

  saveDates(): void {
    if (!this.sprint || !this.sprintStartDate || !this.sprintEndDate) return;
    this.isSavingDates = true;
    this.sprintService.updateSprintDates(this.sprint._id, this.sprintStartDate, this.sprintEndDate).subscribe({
      next: (sprint) => {
        this.applySprintState(sprint);
        this.isSavingDates = false;
        this.setAction('Sprint dates updated.', 'success');
        this.cdr.markForCheck();
      },
      error: (error) => {
        this.isSavingDates = false;
        this.setAction(error?.error?.message || 'Failed to update sprint dates.', 'error');
        this.cdr.markForCheck();
      }
    });
  }

  addTask(): void {
    if (!this.sprint || !this.newTaskTitle.trim() || this.isAddingTask) return;
    this.isAddingTask = true;
    this.sprintService.addTask(this.sprint._id, {
      title: this.newTaskTitle.trim(),
      description: this.newTaskDescription.trim() || undefined,
      points: this.newTaskPoints,
      priority: this.newTaskPriority,
      category: this.newTaskCategory,
      taskType: 'manual'
    }).subscribe({
      next: (sprint) => {
        this.applySprintState(sprint);
        this.newTaskTitle = '';
        this.newTaskDescription = '';
        this.newTaskPoints = 3;
        this.newTaskPriority = 'medium';
        this.newTaskCategory = 'learning';
        this.isAddingTask = false;
        this.setAction('Manual task added to sprint.', 'success');
        this.cdr.markForCheck();
      },
      error: (error) => {
        this.isAddingTask = false;
        this.setAction(error?.error?.message || 'Failed to add task.', 'error');
        this.cdr.markForCheck();
      }
    });
  }

  toggleTask(task: SprintTask): void {
    if (!this.sprint || !task._id) return;
    const snapshot = structuredClone(this.sprint);
    task.isCompleted = !task.isCompleted;
    this.cdr.markForCheck();

    this.sprintService.toggleTask(this.sprint._id, task._id, task.isCompleted).subscribe({
      next: (sprint) => {
        this.applySprintState(sprint);
        this.cdr.markForCheck();
      },
      error: (error) => {
        this.sprint = snapshot;
        this.setAction(error?.error?.message || 'Failed to update task.', 'error');
        this.cdr.markForCheck();
      }
    });
  }

  restoreStreak(): void {
    if (!this.sprint) return;
    this.sprintService.restoreStreak(this.sprint._id).subscribe({
      next: (sprint) => {
        this.applySprintState(sprint);
        this.setAction('Streak restored successfully.', 'success');
        this.cdr.markForCheck();
      },
      error: (error) => {
        this.setAction(error?.error?.message || 'Failed to restore streak.', 'error');
        this.cdr.markForCheck();
      }
    });
  }

  generateAiPlan(): void {
    this.isGeneratingPlan = true;
    this.generatedTasks = [];
    this.generatedPlanMeta = null;
    this.sprintService.generateAiTasks({
      stack: this.goalStack || undefined,
      technology: this.goalTechnology || undefined,
      experienceLevel: this.goalExperienceLevel || undefined,
      sprintStartDate: this.sprintStartDate || undefined,
      sprintEndDate: this.sprintEndDate || undefined
    }).subscribe({
      next: (response) => {
        this.generatedTasks = response.tasks || [];
        this.generatedPlanMeta = response.planMeta || null;
        this.isGeneratingPlan = false;
        this.setAction('Sprint plan generated from real developer signals.', 'success');
        this.cdr.markForCheck();
      },
      error: (error) => {
        this.isGeneratingPlan = false;
        this.setAction(error?.error?.message || 'Failed to generate sprint plan.', 'error');
        this.cdr.markForCheck();
      }
    });
  }

  generateLlmAiPlan(): void {
    this.isGeneratingAi = true;
    this.generatedTasks = [];
    this.generatedPlanMeta = null;
    this.sprintService.generateTrueAiPlan({
      stack: this.goalStack || undefined,
      technology: this.goalTechnology || undefined,
      experienceLevel: this.goalExperienceLevel || undefined,
      sprintStartDate: this.sprintStartDate || undefined,
      sprintEndDate: this.sprintEndDate || undefined
    }).subscribe({
      next: (response) => {
        this.generatedTasks = response.tasks || [];
        this.generatedPlanMeta = response.planMeta || null;
        this.isGeneratingAi = false;
        this.setAction(
          this.generatedPlanMeta?.generationMode === 'llm'
            ? 'AI sprint plan generated with LLM guidance.'
            : 'AI provider unavailable, so the rules-based fallback plan was used.',
          'success'
        );
        this.cdr.markForCheck();
      },
      error: (error) => {
        this.isGeneratingAi = false;
        this.setAction(error?.error?.message || 'Failed to generate AI sprint plan.', 'error');
        this.cdr.markForCheck();
      }
    });
  }

  saveGeneratedPlan(): void {
    if (!this.sprint || !this.generatedTasks.length || this.isSavingAiPlan) return;
    this.isSavingAiPlan = true;
    this.sprintService.saveAiPlan(this.sprint._id, {
      name: `${this.goalTechnology || this.goalStack || 'Career Sprint'} ${this.generatedPlanMeta?.generationMode === 'llm' ? 'AI' : 'Plan'} Draft`,
      goalStack: this.goalStack,
      goalTechnology: this.goalTechnology,
      goalExperienceLevel: this.goalExperienceLevel,
      summary: this.generatedPlanMeta?.summary || '',
      confidenceScore: this.generatedPlanMeta?.confidenceScore || 0,
      consistencyScore: this.generatedPlanMeta?.consistencyScore || 0,
      signalsUsed: this.generatedPlanMeta?.signalsUsed || [],
      generatorType: this.generatedPlanMeta?.generationMode || 'deterministic',
      tasks: this.generatedTasks
    }).subscribe({
      next: (sprint) => {
        this.applySprintState(sprint);
        this.isSavingAiPlan = false;
        this.setAction('AI plan saved to sprint drafts.', 'success');
        this.cdr.markForCheck();
      },
      error: (error) => {
        this.isSavingAiPlan = false;
        this.setAction(error?.error?.message || 'Failed to save AI plan.', 'error');
        this.cdr.markForCheck();
      }
    });
  }

  loadDraft(plan: AiPlanDraft): void {
    this.selectedDraftId = plan._id;
    this.generatedTasks = plan.tasks.map((task) => ({ ...task }));
    this.generatedPlanMeta = {
      summary: plan.summary,
      confidenceScore: plan.confidenceScore,
      consistencyScore: plan.consistencyScore,
      signalsUsed: plan.signalsUsed || [],
      generationMode: plan.generatorType === 'llm' ? 'llm' : 'deterministic',
      providerLabel: plan.generatorType === 'llm' ? 'LLM Planner' : plan.source === 'scenario' ? 'Scenario Simulator' : 'Rules Engine'
    };
    this.goalStack = plan.goalStack || this.goalStack;
    this.goalTechnology = plan.goalTechnology || this.goalTechnology;
    this.goalExperienceLevel = plan.goalExperienceLevel || this.goalExperienceLevel;
    this.showSetupPanel = true;
    this.setAction(`Loaded draft "${plan.name}".`, 'info');
  }

  importScenarioPlan(): void {
    if (!this.sprint || this.isImportingScenario) return;
    this.isImportingScenario = true;
    this.sprintService.importScenarioPlan(this.sprint._id).subscribe({
      next: (sprint) => {
        this.applySprintState(sprint);
        const latestScenarioPlan = [...(sprint.aiPlans || [])].reverse().find((plan) => plan.source === 'scenario');
        if (latestScenarioPlan) this.loadDraft(latestScenarioPlan);
        this.isImportingScenario = false;
        this.setAction('Scenario Simulator plan imported into sprint drafts.', 'success');
        this.cdr.markForCheck();
      },
      error: (error) => {
        this.isImportingScenario = false;
        this.setAction(error?.error?.message || 'Failed to import Scenario Simulator plan.', 'error');
        this.cdr.markForCheck();
      }
    });
  }

  addGeneratedTasksToSprint(): void {
    if (!this.sprint || !this.generatedTasks.length) return;

    const tasks = this.generatedTasks.slice();
    const addNext = (index: number) => {
      if (index >= tasks.length) {
        this.generatedTasks = [];
        this.generatedPlanMeta = null;
        this.selectedDraftId = '';
        this.showSetupPanel = false;
        this.setAction('Generated tasks added to the current sprint.', 'success');
        this.cdr.markForCheck();
        return;
      }

      const task = tasks[index];
      this.sprintService.addTask(this.sprint!._id, {
        title: task.title,
        description: task.description,
        points: task.points,
        priority: task.priority,
        category: task.category,
        taskType: 'ai',
        startDate: task.startDate || undefined,
        endDate: task.endDate || undefined
      }).subscribe({
        next: (sprint) => {
          this.applySprintState(sprint);
          addNext(index + 1);
        },
        error: () => addNext(index + 1)
      });
    };

    addNext(0);
  }

  getPriorityColor(priority: TaskPriority): string {
    return { high: '#ef4444', medium: '#f59e0b', low: '#22c55e' }[priority] || '#6366f1';
  }

  getGeneratedModeLabel(): string {
    if (this.generatedPlanMeta?.generationMode === 'llm') return 'LLM AI Plan';
    return 'Signal-Based Plan';
  }

  getDraftModeLabel(plan: AiPlanDraft): string {
    if (plan.source === 'scenario') return 'Scenario Draft';
    if (plan.generatorType === 'llm') return 'AI Draft';
    return 'Planned Draft';
  }

  openSetupPanel(): void {
    this.showSetupPanel = true;
    this.setAction('Configure your sprint context to generate a new plan.', 'info');
  }

  getCategoryIcon(category: TaskCategory): string {
    return { learning: 'Study', project: 'Build', practice: 'Polish' }[category] || 'Task';
  }

  formatTaskDate(dateStr: string | null | undefined): string {
    const date = this.parseDate(dateStr);
    if (!date) return '';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  getTaskDateRange(task: SprintTask): string {
    const start = task.startDate;
    const end = task.endDate || task.deadline || task.dueDate;
    if (start && end) return `${this.formatTaskDate(start)} to ${this.formatTaskDate(end)}`;
    if (end) return `Due ${this.formatTaskDate(end)}`;
    return '';
  }

  isTaskActive(task: SprintTask): boolean {
    const now = new Date();
    const start = this.parseDate(task.startDate);
    const end = this.parseDate(task.endDate);
    if (!start && !end) return true;
    return (!start || start <= now) && (!end || end >= now);
  }

  getAvatarSrc(): string {
    const raw = String(this.userAvatar || '').trim();
    if (!raw) return '';
    if (/^data:/i.test(raw) || raw.startsWith('blob:')) return raw;
    const separator = raw.includes('?') ? '&' : '?';
    return `${raw}${separator}v=${this.avatarVersion}`;
  }

  trackByTask(_: number, task: SprintTask): string {
    return task._id || `${task.title}-${task.startDate || ''}-${task.endDate || ''}`;
  }

  trackByDraft(_: number, plan: AiPlanDraft): string {
    return plan._id;
  }

  trackByHistory(_: number, sprint: CareerSprint): string {
    return sprint._id;
  }

  trackByActivity(_: number, item: { date: string; count: number; active: boolean }): string {
    return String(item.date);
  }
}
