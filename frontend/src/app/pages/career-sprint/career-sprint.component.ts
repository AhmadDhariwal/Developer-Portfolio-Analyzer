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
import { SearchableSelectComponent } from '../../shared/components/searchable-select/searchable-select.component';
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
  nextSprintWindow,
  restoreEligible,
  sprintError,
  sprintReadOnly,
  sprintZone,
  sprintWindowConflict,
  taskDescription,
} from './utils/sprint-presentation';

@Component({
  selector: 'app-career-sprint',
  standalone: true,
  imports: [
    CommonModule,
    SearchableSelectComponent,
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
  planningTarget: CareerSprint | null = null;
  planningTargetVerified = true;
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
  calendarSprint: CareerSprint | null = null;
  dateMessage = '';
  dateError = '';
  preferenceMessage = '';
  get zoneOptions() {
    return this.zones.map((value) => ({ value, label: value }));
  }
  get calendarSprints(): CareerSprint[] {
    return this.knownSprints.filter(
      (item, index, all) => all.findIndex((other) => other._id === item._id) === index,
    );
  }
  get calendarSprintOptions() {
    return this.calendarSprints.map((record) => ({
      value: record._id,
      label: record.title || 'Career Sprint',
      meta: `${this.calendarStatus(record)} · ${this.date(record.sprintStartDate || record.weekStartDate, record)} – ${this.date(record.sprintEndDate || record.weekEndDate, record)}`,
    }));
  }
  get calendarDirty(): boolean {
    return (
      !!this.calendarSprint &&
      (this.sprintStartDate !==
        calendarKey(
          this.calendarSprint.sprintStartDate || this.calendarSprint.weekStartDate,
          sprintZone(this.calendarSprint),
        ) ||
        this.sprintEndDate !==
          calendarKey(
            this.calendarSprint.sprintEndDate || this.calendarSprint.weekEndDate,
            sprintZone(this.calendarSprint),
          ))
    );
  }
  get dateDuration(): number {
    return (
      Math.round((Date.parse(this.sprintEndDate) - Date.parse(this.sprintStartDate)) / 86400000) + 1
    );
  }
  get dateConflict(): CareerSprint | undefined {
    return sprintWindowConflict(
      this.calendarSprints.filter((s) => s._id !== this.calendarSprint?._id),
      this.sprintStartDate,
      this.sprintEndDate,
      this.calendarSprint ? sprintZone(this.calendarSprint) || 'UTC' : 'UTC',
    );
  }
  get calendarDisabled(): boolean {
    return (
      !this.calendarSprint ||
      sprintReadOnly(this.calendarSprint) ||
      this.stale ||
      this.isRefreshing ||
      !!this.busy
    );
  }
  calendarStatus(record: CareerSprint): string {
    if (sprintReadOnly(record)) return 'Read-only legacy';
    const start = Date.parse(record.sprintStartDate || record.weekStartDate);
    const end = Date.parse(record.sprintEndDate || record.weekEndDate);
    return this.now < start ? 'Upcoming' : this.now > end ? 'Completed' : 'Active';
  }
  get taskDateWarning(): string {
    const record = this.calendarSprint;
    if (
      !record ||
      !Array.isArray(record.tasks) ||
      !record.analytics ||
      record.tasks.length !== record.analytics.totalTasks
    )
      return 'Complete task records are unavailable; review task dates before saving. Task dates will remain unchanged.';
    const outside = record.tasks.filter((task) =>
      [task.startDate, task.endDate, task.dueDate, task.deadline].some((value) => {
        const day = value ? calendarKey(value, sprintZone(record)) : '';
        return day && (day < this.sprintStartDate || day > this.sprintEndDate);
      }),
    );
    return outside.length
      ? `${outside.length} tasks have dates outside this window. Their dates will remain unchanged.`
      : 'Loaded task dates remain unchanged when the Sprint window changes.';
  }
  resetCalendarDates(): void {
    const record = this.calendarSprint;
    this.sprintStartDate = record
      ? calendarKey(record.sprintStartDate || record.weekStartDate, sprintZone(record))
      : '';
    this.sprintEndDate = record
      ? calendarKey(record.sprintEndDate || record.weekEndDate, sprintZone(record))
      : '';
    this.dateMessage = this.dateError = '';
  }
  selectCalendarSprint(id: string): void {
    if (
      this.busy ||
      (this.calendarDirty && !window.confirm('Discard unsaved Sprint date changes?'))
    )
      return;
    this.calendarSprint = this.calendarSprints.find((record) => record._id === id) || null;
    this.resetCalendarDates();
  }
  toggleCalendarSettings(): void {
    if (this.busy) return;
    if (
      this.settingsOpen &&
      (this.calendarDirty || this.preferenceZone !== this.savedPreferenceZone) &&
      !window.confirm('Discard unsaved Calendar settings changes?')
    )
      return;
    this.settingsOpen = !this.settingsOpen;
    this.preferenceZone = this.savedPreferenceZone;
    this.preferenceMessage = '';
    if (!this.calendarSprint) this.calendarSprint = this.sprint;
    this.resetCalendarDates();
  }
  cancelPreference(): void {
    this.preferenceZone = this.savedPreferenceZone;
    this.preferenceError = this.preferenceMessage = '';
  }

  get readOnly(): boolean {
    return Boolean(this.sprint && sprintReadOnly(this.sprint));
  }
  get mutationsDisabled(): boolean {
    return this.readOnly || this.stale || this.isRefreshing || !!this.busy;
  }
  get planningDisabledReason(): string {
    if (this.planningReadOnly)
      return 'This historical Sprint is read-only. Its original calendar cannot be verified or its window is a preserved legacy exception. Create a separate, non-overlapping Sprint to save plans and tasks; history stays unchanged.';
    if (this.planningTarget && !this.planningTargetVerified)
      return 'The selected Sprint could not be refreshed. Refresh Sprint before changing its plans.';
    if (this.stale)
      return 'The current Sprint could not be verified after a refresh or conflicting change. Refresh Sprint to re-enable planning.';
    if (this.isRefreshing)
      return 'Sprint data is refreshing. Planning will be available when it finishes.';
    if (this.busy)
      return 'A Sprint change is being saved. Planning will be available when it finishes.';
    return '';
  }
  get plannerSprint(): CareerSprint | null {
    return this.planningTarget || this.sprint;
  }
  get planningReadOnly(): boolean {
    return !this.plannerSprint || sprintReadOnly(this.plannerSprint);
  }
  get planningDisabled(): boolean {
    return (
      this.planningReadOnly ||
      this.stale ||
      this.isRefreshing ||
      !!this.busy ||
      Boolean(this.planningTarget && !this.planningTargetVerified)
    );
  }
  get writablePlanningSprints(): CareerSprint[] {
    const records = this.planningTarget
      ? [this.planningTarget, ...this.knownSprints]
      : this.knownSprints;
    return records.filter(
      (record, index) =>
        !sprintReadOnly(record) && records.findIndex((item) => item._id === record._id) === index,
    );
  }
  selectPlanningSprint(id: string): void {
    if (this.busy || this.isRefreshing) return;
    const record = this.writablePlanningSprints.find((item) => item._id === id);
    if (id === this.sprint?._id) this.planningTarget = null;
    else if (record) this.planningTarget = record;
    else return;
    this.planningTargetVerified = false;
    this.view = 'plans';
    this.loadData(true);
  }
  beginPlanningSprint(): void {
    if (this.busy) return;
    this.newSprintOpen = true;
    this.useAvailableDates();
    this.cdr.markForCheck();
    setTimeout(
      () =>
        document
          .getElementById('new-sprint')
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      50,
    );
  }
  private refreshPlanningTarget(): void {
    if (!this.planningTarget) return;
    const fresh =
      !this.historyError && this.history.find((record) => record._id === this.planningTarget?._id);
    this.planningTargetVerified = Boolean(fresh);
    if (fresh) this.planningTarget = fresh;
  }
  private get knownSprints(): CareerSprint[] {
    return this.sprint ? [this.sprint, ...this.history] : this.history;
  }
  get newSprintConflict(): CareerSprint | undefined {
    return this.preferencesLoaded
      ? sprintWindowConflict(
          this.knownSprints,
          this.newStart,
          this.newEnd,
          this.savedPreferenceZone,
        )
      : undefined;
  }
  openNewSprint(): void {
    if (this.busy) return;
    this.newSprintOpen = !this.newSprintOpen;
    if (this.newSprintOpen && (!this.newStart || !this.newEnd)) this.useAvailableDates();
  }
  useAvailableDates(): void {
    if (!this.preferencesLoaded || this.busy) return;
    const window = nextSprintWindow(this.knownSprints, this.savedPreferenceZone, this.now);
    if (window) {
      this.newStart = window.start;
      this.newEnd = window.end;
    }
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
          this.refreshPlanningTarget();
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
    if (!this.calendarSprint) {
      this.calendarSprint = sprint;
      this.resetCalendarDates();
    } else if (this.calendarSprint._id === sprint._id && !this.calendarDirty) {
      this.calendarSprint = sprint;
      this.resetCalendarDates();
    }
    if (!this.zone && ['today', 'week', 'custom'].includes(this.dateFilter))
      this.dateFilter = 'all';
  }
  plannerUpdated(sprint: CareerSprint): void {
    if (this.planningTarget?._id === sprint._id) {
      this.planningTarget = sprint;
      this.planningTargetVerified = true;
    } else this.acceptSprint(sprint);
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
          this.refreshPlanningTarget();
          this.cdr.markForCheck();
        },
        error: () => {
          if (this.planningTarget) this.planningTargetVerified = false;
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
    const previous = this.sprint;
    const isCompleted = !task.isCompleted;
    const optimistic = {
      ...previous,
      tasks: previous.tasks.map((item) =>
        item._id === task._id ? { ...item, isCompleted } : item,
      ),
    };
    // Only the pending checkbox changes locally; scores and timestamps stay server-owned.
    this.sprint = optimistic;
    this.mutate(
      `toggle:${task._id}`,
      this.api.toggleTask(previous._id, task._id, isCompleted),
      task.isCompleted
        ? 'Task reopened. XP and progress reflect the server response.'
        : 'Task completed. XP and progress updated.',
      undefined,
      () => {
        if (this.sprint === optimistic) this.sprint = previous;
      },
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
    const selected = this.calendarSprint;
    if (!selected || this.calendarDisabled) return;
    if (!Number.isFinite(this.dateDuration) || this.dateDuration < 1 || this.dateDuration > 366) {
      this.dateError = 'Choose a valid window of 1–366 days.';
      return;
    }
    if (this.dateConflict) {
      this.dateError = 'These dates overlap another loaded Sprint.';
      return;
    }
    this.busy = 'dates';
    this.dateError = this.dateMessage = '';
    this.api
      .updateSprintDates(selected._id, this.sprintStartDate, this.sprintEndDate)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          this.busy = '';
          this.calendarSprint = updated;
          this.resetCalendarDates();
          if (this.sprint?._id === updated._id) {
            this.acceptSprint(updated);
            this.resetFilters();
          }
          if (this.planningTarget?._id === updated._id) this.planningTarget = updated;
          this.history = this.history.map((item) => (item._id === updated._id ? updated : item));
          this.dateMessage = 'Sprint dates updated. Task dates were preserved.';
          this.refreshHistory();
          this.cdr.markForCheck();
        },
        error: (error) => {
          this.busy = '';
          this.dateError = sprintError(error, 'Sprint dates could not be saved.');
          this.cdr.markForCheck();
        },
      });
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
    failed?: () => void,
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
        failed?.();
        this.busy = '';
        this.actionMessage = sprintError(error, 'This change could not be saved. Please retry.');
        this.actionFailed = true;
        // A rejected date overlap does not invalidate the current Sprint snapshot.
        // Other conflicts still fail closed until a successful refresh.
        if (
          error?.status === 409 &&
          !(kind === 'dates' && /overlap/i.test(error?.error?.message || ''))
        )
          this.stale = true;
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
    if (this.busy) return;
    if (!this.zones.includes(this.preferenceZone)) {
      this.preferenceError = 'Select a valid IANA timezone.';
      return;
    }
    this.preferenceMessage = '';
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
          this.preferenceMessage =
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
    if (this.newSprintConflict) {
      this.actionFailed = true;
      this.actionMessage =
        'These dates overlap a saved Sprint. Choose another window or use the current Sprint and its Sprint studio. Your saved work is unchanged.';
      return;
    }
    this.busy = 'create';
    this.api
      .create({
        title: this.newTitle.trim(),
        sprintStartDate: this.newStart,
        sprintEndDate: this.newEnd,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (created) => {
          this.busy = '';
          this.newSprintOpen = false;
          this.planningTarget = created;
          this.planningTargetVerified = true;
          this.view = 'plans';
          this.actionMessage =
            'Sprint saved. Sprint studio is open for the new Sprint. The dashboard current Sprint remains selected by its dates.';
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
  exploreSprintStudio(): void {
    this.view = 'plans';
    this.cdr.markForCheck();
    setTimeout(() => {
      const planner =
        document.getElementById('sprint-planner-section') ||
        document.querySelector('.workspace-nav');
      if (planner) {
        planner.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 50);
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
