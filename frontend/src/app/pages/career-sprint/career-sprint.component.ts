import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  HostListener,
  OnDestroy,
  OnInit,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, forkJoin, Observable, of } from 'rxjs';
import {
  CareerSprint,
  CareerSprintService,
  SprintTask,
  SprintTaskInput,
} from '../../shared/services/career-sprint.service';
import { ProfileService } from '../../shared/services/profile.service';
import { SprintTaskEditorComponent } from './components/sprint-task-editor.component';
import { SprintPlannerComponent } from './components/sprint-planner.component';
import {
  calendarKey,
  formatSprintDate,
  restoreEligible,
  sprintError,
  sprintReadOnly,
  sprintZone,
  taskDescription,
} from './utils/sprint-presentation';

@Component({
  selector: 'app-career-sprint',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    SprintTaskEditorComponent,
    SprintPlannerComponent,
  ],
  templateUrl: './career-sprint.component.html',
  styleUrl: './career-sprint.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CareerSprintComponent implements OnInit, OnDestroy {
  readonly taskDescription = taskDescription;
  readonly Math = Math;
  private readonly api = inject(CareerSprintService);
  private readonly profile = inject(ProfileService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);
  private profileSignature = '';
  private timer?: ReturnType<typeof setInterval>;
  sprint: CareerSprint | null = null;
  history: CareerSprint[] = [];
  historyError = '';
  userName = 'Developer';
  careerStack = '';
  experienceLevel = '';
  isLoading = true;
  isRefreshing = false;
  stale = false;
  errorMessage = '';
  actionMessage = '';
  actionFailed = false;
  busy = '';
  view: 'tasks' | 'plans' | 'history' = 'tasks';
  now = Date.now();
  showEditor = false;
  taskToEdit: SprintTask | null = null;
  deleteTaskId = '';
  search = '';
  statusFilter = 'all';
  priorityFilter = 'all';
  categoryFilter = 'all';
  dateFilter = 'all';
  customStart = '';
  customEnd = '';
  expandedHistoryId = '';
  settingsOpen = false;
  newSprintOpen = false;
  newTitle = 'Career Sprint';
  newStart = '';
  newEnd = '';
  sprintStartDate = '';
  sprintEndDate = '';
  preferenceZone = '';
  savedPreferenceZone = '';
  preferencesLoaded = false;
  preferenceError = '';
  zones = this.timeZones();

  get readOnly(): boolean {
    return Boolean(this.sprint && sprintReadOnly(this.sprint));
  }
  get mutationsDisabled(): boolean {
    return this.readOnly || this.stale || this.isRefreshing || !!this.busy;
  }
  get zone(): string | null {
    return this.sprint ? sprintZone(this.sprint) : null;
  }
  get analytics() {
    return this.sprint?.analytics;
  }
  get progress(): number | null {
    return this.analytics?.progressPercent ?? null;
  }
  get xpProgress(): number {
    return this.sprint
      ? Math.min(100, Math.max(0, this.sprint.xpPoints - (this.sprint.level - 1) * 100))
      : 0;
  }
  get canRestore(): boolean {
    return Boolean(
      this.sprint && !this.mutationsDisabled && restoreEligible(this.sprint, this.now),
    );
  }
  get restoreCountdown(): string {
    const expires = this.sprint?.restoreMeta?.expiresAt;
    if (!expires) return '';
    const seconds = Math.max(0, Math.ceil((+new Date(expires) - this.now) / 1000));
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m ${seconds % 60}s`;
  }
  get activity() {
    return (this.analytics?.dailyActivity || []).slice(-7).map((item) => ({
      ...item,
      date: calendarKey(item.date, this.zone) || item.date,
      label: new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(
        new Date((calendarKey(item.date, this.zone) || item.date.slice(0, 10)) + 'T12:00:00Z'),
      ),
    }));
  }
  get visibleTasks(): SprintTask[] {
    const query = this.search.trim().toLowerCase();
    const today = calendarKey(new Date(this.now), this.zone);
    return (this.sprint?.tasks || []).filter((task) => {
      if (query && !`${task.title} ${task.description}`.toLowerCase().includes(query)) return false;
      if (
        (this.statusFilter === 'pending' && task.isCompleted) ||
        (this.statusFilter === 'completed' && !task.isCompleted)
      )
        return false;
      if (this.priorityFilter !== 'all' && task.priority !== this.priorityFilter) return false;
      if (this.categoryFilter !== 'all' && task.category !== this.categoryFilter) return false;
      const due = task.endDate || task.deadline || task.dueDate;
      if (this.dateFilter === 'overdue')
        return Boolean(!task.isCompleted && due && +new Date(due) < this.now);
      if (this.dateFilter === 'unscheduled') return !task.startDate && !due;
      if (this.dateFilter === 'sprint') {
        const start = this.sprint?.sprintStartDate || this.sprint?.weekStartDate;
        const end = this.sprint?.sprintEndDate || this.sprint?.weekEndDate;
        return (
          (!task.startDate || !end || +new Date(task.startDate) <= +new Date(end)) &&
          (!due || !start || +new Date(due) >= +new Date(start))
        );
      }
      const key = calendarKey(due, this.zone);
      if (this.dateFilter === 'today') return !!today && key === today;
      if (this.dateFilter === 'week') {
        if (!today || !key) return false;
        const start = new Date(today + 'T12:00:00Z');
        start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
        const end = new Date(start);
        end.setUTCDate(end.getUTCDate() + 6);
        return key >= start.toISOString().slice(0, 10) && key <= end.toISOString().slice(0, 10);
      }
      if (this.dateFilter === 'custom')
        return Boolean(
          key &&
          (!this.customStart || key >= this.customStart) &&
          (!this.customEnd || key <= this.customEnd),
        );
      return true;
    });
  }

  ngOnInit(): void {
    this.profile
      .getProfile()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (profile) => {
          this.userName = profile.name?.split(' ')[0] || 'Developer';
          this.careerStack = profile.activeCareerStack || profile.careerStack || '';
          this.experienceLevel = profile.activeExperienceLevel || profile.experienceLevel || '';
          this.profileSignature = JSON.stringify([
            profile._id,
            profile.profileHash,
            this.careerStack,
            this.experienceLevel,
          ]);
          this.loadData();
        },
        error: () => this.loadData(),
      });
    this.loadPreferences();
    this.timer = setInterval(() => {
      this.now = Date.now();
      this.cdr.markForCheck();
    }, 1000);
  }
  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
  @HostListener('window:focus') onFocus(): void {
    if (this.sprint && !this.busy) this.loadData(true);
  }
  @HostListener('window:devinsight:profile-personalization-changed') onProfileChange(): void {
    this.api.clearCache();
    this.loadData(true);
  }

  loadData(forceRefresh = false): void {
    if (this.isRefreshing) return;
    this.isLoading = !this.sprint;
    this.isRefreshing = !!this.sprint;
    this.errorMessage = '';
    this.historyError = '';
    forkJoin({
      sprint: this.api.getCurrent(this.profileSignature, '', forceRefresh),
      history: this.api.getHistory(12, this.profileSignature, true).pipe(
        catchError(() => {
          this.historyError = 'History is unavailable. Previously loaded records are preserved.';
          return of({ history: this.history });
        }),
      ),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.acceptSprint(result.sprint);
          this.history = result.history.history || [];
          this.isLoading = false;
          this.isRefreshing = false;
          this.stale = false;
          if (this.actionFailed) {
            this.actionFailed = false;
            this.actionMessage = 'Sprint refreshed. Review the current data and retry your change.';
          }
          this.cdr.markForCheck();
        },
        error: (error) => {
          this.errorMessage = sprintError(
            error,
            'Career Sprint could not be loaded. Retry to reconnect.',
          );
          this.stale = !!this.sprint;
          this.isLoading = false;
          this.isRefreshing = false;
          this.cdr.markForCheck();
        },
      });
  }

  private acceptSprint(sprint: CareerSprint): void {
    this.sprint = sprint;
    this.sprintStartDate = calendarKey(
      sprint.sprintStartDate || sprint.weekStartDate,
      sprintZone(sprint),
    );
    this.sprintEndDate = calendarKey(
      sprint.sprintEndDate || sprint.weekEndDate,
      sprintZone(sprint),
    );
    if (!this.zone && ['today', 'week', 'custom'].includes(this.dateFilter))
      this.dateFilter = 'all';
  }
  plannerUpdated(sprint: CareerSprint): void {
    this.acceptSprint(sprint);
    this.refreshHistory();
  }
  private refreshHistory(): void {
    this.api
      .getHistory(12, this.profileSignature, true)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.history = result.history;
          this.historyError = '';
          this.cdr.markForCheck();
        },
        error: () => {
          this.historyError =
            'History could not be refreshed. Retry without losing your current Sprint.';
          this.cdr.markForCheck();
        },
      });
  }
  openEditor(task: SprintTask | null = null): void {
    if (this.mutationsDisabled || task?.isCompleted) return;
    this.taskToEdit = task;
    this.showEditor = true;
  }
  saveTask(payload: SprintTaskInput): void {
    if (!this.sprint || this.mutationsDisabled) return;
    const request = this.taskToEdit?._id
      ? this.api.editTask(this.sprint._id, this.taskToEdit._id, payload)
      : this.api.addTask(this.sprint._id, {
          ...payload,
          startDate: payload.startDate || undefined,
          endDate: payload.endDate || undefined,
        });
    this.mutate('task', request, this.taskToEdit ? 'Task updated.' : 'Task created.', () => {
      this.showEditor = false;
      this.taskToEdit = null;
    });
  }
  toggleTask(task: SprintTask): void {
    if (!this.sprint || !task._id || this.mutationsDisabled) return;
    this.mutate(
      `toggle:${task._id}`,
      this.api.toggleTask(this.sprint._id, task._id, !task.isCompleted),
      task.isCompleted
        ? 'Task reopened. XP and progress reflect the server response.'
        : 'Task completed. XP and progress updated.',
    );
  }
  deleteTask(task: SprintTask): void {
    if (
      !this.sprint ||
      !task._id ||
      task.isCompleted ||
      this.mutationsDisabled ||
      this.deleteTaskId !== task._id
    )
      return;
    this.mutate(
      'delete',
      this.api.deleteTask(this.sprint._id, task._id),
      'Task deleted.',
      () => (this.deleteTaskId = ''),
    );
  }
  saveDates(): void {
    if (
      !this.sprint ||
      this.mutationsDisabled ||
      !this.sprintStartDate ||
      !this.sprintEndDate ||
      this.sprintStartDate > this.sprintEndDate
    )
      return;
    this.mutate(
      'dates',
      this.api.updateSprintDates(this.sprint._id, this.sprintStartDate, this.sprintEndDate),
      'Sprint dates updated.',
    );
  }
  restoreStreak(): void {
    if (!this.sprint || !this.canRestore) return;
    this.mutate(
      'restore',
      this.api.restoreStreak(this.sprint._id),
      'Streak restored. No activity or XP was created.',
    );
  }
  private mutate(
    kind: string,
    request: Observable<CareerSprint>,
    message: string,
    done?: () => void,
  ): void {
    this.busy = kind;
    this.actionMessage = '';
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (sprint) => {
        this.acceptSprint(sprint);
        this.busy = '';
        this.actionMessage = message;
        this.actionFailed = false;
        done?.();
        this.refreshHistory();
        this.cdr.markForCheck();
      },
      error: (error) => {
        this.busy = '';
        this.actionMessage = sprintError(error, 'This change could not be saved. Please retry.');
        this.actionFailed = true;
        if (error?.status === 409) this.stale = true;
        this.cdr.markForCheck();
      },
    });
  }
  loadPreferences(): void {
    this.api
      .getPreferences()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.preferenceZone = this.savedPreferenceZone = result.timeZone;
          this.preferencesLoaded = true;
          this.preferenceError = '';
          this.cdr.markForCheck();
        },
        error: () => {
          this.preferencesLoaded = false;
          this.preferenceError =
            'Timezone preference is unavailable. Retry before creating a Sprint.';
          this.cdr.markForCheck();
        },
      });
  }
  savePreference(): void {
    if (this.busy || !this.preferenceZone.trim()) return;
    this.busy = 'zone';
    this.api
      .savePreferences(this.preferenceZone.trim())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.preferenceZone = this.savedPreferenceZone = result.timeZone;
          this.preferencesLoaded = true;
          this.busy = '';
          this.preferenceError = '';
          this.actionFailed = false;
          this.actionMessage =
            'Timezone preference saved for future Sprints. Existing Sprint dates and calendars are unchanged.';
          this.cdr.markForCheck();
        },
        error: (error) => {
          this.busy = '';
          this.preferenceError = sprintError(error, 'Timezone preference could not be saved.');
          this.cdr.markForCheck();
        },
      });
  }
  createSprint(): void {
    if (
      this.busy ||
      !this.preferencesLoaded ||
      !this.newStart ||
      !this.newEnd ||
      this.newStart > this.newEnd ||
      !this.newTitle.trim()
    )
      return;
    this.busy = 'create';
    this.api
      .create({
        title: this.newTitle.trim(),
        sprintStartDate: this.newStart,
        sprintEndDate: this.newEnd,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.busy = '';
          this.newSprintOpen = false;
          this.actionMessage =
            'Sprint saved. The active Sprint is selected by its dates; future Sprints are available in history.';
          this.actionFailed = false;
          this.loadData(true);
        },
        error: (error) => {
          this.busy = '';
          this.actionFailed = true;
          this.actionMessage = sprintError(error, 'Sprint could not be created.');
          this.cdr.markForCheck();
        },
      });
  }
  date(value: string | null | undefined, sprint = this.sprint): string {
    return sprint ? formatSprintDate(value, sprint) : 'Unavailable';
  }
  metric(value: number | null | undefined, suffix = ''): string {
    return value == null || !Number.isFinite(value) ? 'Unavailable' : `${value}${suffix}`;
  }
  overdue(task: SprintTask): boolean {
    const due = task.endDate || task.deadline || task.dueDate;
    return Boolean(!task.isCompleted && due && +new Date(due) < this.now);
  }
  source(task: SprintTask): string {
    return task.sourceRecommendationId
      ? 'Recommendation'
      : task.sourceScenarioId
        ? 'Scenario'
        : taskDescription(task).sourceDetails.trimStart().startsWith('Course:')
          ? 'Learning Hub'
          : task.taskType === 'ai'
            ? 'Planned task'
            : 'Manual';
  }
  resetFilters(): void {
    this.search = '';
    this.statusFilter = this.priorityFilter = this.categoryFilter = this.dateFilter = 'all';
    this.customStart = this.customEnd = '';
  }
  private timeZones(): string[] {
    const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
    return [
      ...new Set([
        'UTC',
        'Asia/Karachi',
        'America/New_York',
        ...(intl.supportedValuesOf?.('timeZone') || []),
      ]),
    ].sort();
  }
}
