import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  CareerSprintService,
  CareerSprint,
  SprintTask,
  TaskPriority,
  TaskCategory,
  TaskType,
  StreakStatus,
  PlannerFilter,
} from '../../shared/services/career-sprint.service';
import { ProfileService } from '../../shared/services/profile.service';

@Component({
  selector: 'app-career-sprint',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './career-sprint.component.html',
  styleUrl: './career-sprint.component.scss',
})
export class CareerSprintComponent implements OnInit {
  sprint: CareerSprint | null = null;
  userAvatar = '';
  userName = '';
  userInitial = 'D';
  avatarVersion = Date.now();
  isLoading = false;

  // ── Add task form ──────────────────────────────────────────────────────
  newTaskTitle       = '';
  newTaskDescription = '';
  newTaskPoints      = 3;
  newTaskPriority: TaskPriority = 'medium';
  newTaskCategory: TaskCategory = 'learning';

  // ── Sprint setup / AI generation ──────────────────────────────────────
  goalStack           = '';
  goalTechnology      = '';
  goalExperienceLevel = '';
  isGenerating        = false;
  generatedTasks: SprintTask[] = [];
  showSetupPanel      = false;

  // ── Sprint date picker ────────────────────────────────────────────────
  sprintStartDate = '';
  sprintEndDate   = '';
  isSavingDates   = false;

  // ── Task filter ───────────────────────────────────────────────────────
  plannerFilter: PlannerFilter = 'week';
  customRangeStart = '';
  customRangeEnd   = '';

  readonly priorityOptions: TaskPriority[] = ['high', 'medium', 'low'];
  readonly categoryOptions: TaskCategory[] = ['learning', 'project', 'practice'];

  constructor(
    private readonly sprintService: CareerSprintService,
    private readonly profileService: ProfileService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.loadSprint();
    this.loadProfile();
  }

  // ── Data loading ──────────────────────────────────────────────────────

  loadProfile(): void {
    this.profileService.getProfile().subscribe({
      next: (profile) => {
        this.userAvatar      = this.profileService.resolveAvatarUrl(profile.avatar || '');
        this.userName        = profile.name || '';
        this.userInitial     = this.profileService.getInitials(this.userName || 'Developer') || 'D';
        if (!this.goalStack && profile.careerStack)               this.goalStack = profile.careerStack;
        if (!this.goalExperienceLevel && profile.experienceLevel) this.goalExperienceLevel = profile.experienceLevel;
        this.bumpAvatarVersion();
        this.cdr.detectChanges();
      },
      error: () => this.cdr.detectChanges(),
    });
  }

  loadSprint(): void {
    this.isLoading = true;
    this.sprintService.getCurrent().subscribe({
      next: (sprint) => {
        this.sprint    = sprint;
        this.isLoading = false;
        this.syncDatePickers();
        this.cdr.detectChanges();
      },
      error: () => {
        this.isLoading = false;
        this.cdr.detectChanges();
      },
    });
  }

  private syncDatePickers(): void {
    if (!this.sprint) return;
    const start = this.sprint.sprintStartDate || this.sprint.weekStartDate;
    const end   = this.sprint.sprintEndDate   || this.sprint.weekEndDate;
    this.sprintStartDate = start ? new Date(start).toISOString().split('T')[0] : '';
    this.sprintEndDate   = end   ? new Date(end).toISOString().split('T')[0]   : '';
  }

  // ── Sprint dates ──────────────────────────────────────────────────────

  saveDates(): void {
    if (!this.sprint || !this.sprintStartDate || !this.sprintEndDate) return;
    this.isSavingDates = true;
    this.sprintService.updateSprintDates(this.sprint._id, this.sprintStartDate, this.sprintEndDate).subscribe({
      next: (sprint) => {
        this.sprint        = sprint;
        this.isSavingDates = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.isSavingDates = false;
        this.cdr.detectChanges();
      },
    });
  }

  get effectiveStartDate(): Date | null {
    const d = this.sprint?.sprintStartDate || this.sprint?.weekStartDate;
    return d ? new Date(d) : null;
  }

  get effectiveEndDate(): Date | null {
    const d = this.sprint?.sprintEndDate || this.sprint?.weekEndDate;
    return d ? new Date(d) : null;
  }

  get sprintDurationDays(): number {
    if (!this.effectiveStartDate || !this.effectiveEndDate) return 7;
    // Inclusive: Apr 19 – Apr 27 = 9 days
    const msPerDay = 1000 * 60 * 60 * 24;
    const startMs = new Date(this.effectiveStartDate).setHours(0, 0, 0, 0);
    const endMs   = new Date(this.effectiveEndDate).setHours(0, 0, 0, 0);
    return Math.max(1, Math.round((endMs - startMs) / msPerDay) + 1);
  }

  // ── Computed: progress ────────────────────────────────────────────────

  get totalPoints(): number {
    return this.sprint?.tasks.reduce((s, t) => s + (t.points || 1), 0) || 0;
  }

  get completedPoints(): number {
    return this.sprint?.tasks.filter(t => t.isCompleted).reduce((s, t) => s + (t.points || 1), 0) || 0;
  }

  get progressPercent(): number {
    if (!this.sprint || this.totalPoints === 0) return 0;
    return Math.min(100, Math.round((this.completedPoints / this.totalPoints) * 100));
  }

  get completedCount(): number {
    return this.sprint?.tasks.filter(t => t.isCompleted).length || 0;
  }

  get remainingTasksCount(): number {
    return (this.sprint?.tasks.length || 0) - this.completedCount;
  }

  get progressRingOffset(): number {
    const circumference = 2 * Math.PI * 45;
    return circumference - (this.progressPercent / 100) * circumference;
  }

  get motivationalText(): string {
    const p = this.progressPercent;
    if (p === 0)  return 'Ready to start';
    if (p < 25)   return 'Let\'s start strong';
    if (p < 60)   return 'Good momentum';
    if (p < 100)  return 'Almost there';
    return 'Goal achieved! 🎉';
  }

  // ── Computed: XP & Level ──────────────────────────────────────────────

  get xpPoints(): number  { return this.sprint?.xpPoints || 0; }
  get level(): number     { return this.sprint?.level || 1; }
  get xpToNextLevel(): number { return this.level * 100; }
  get xpInCurrentLevel(): number { return this.xpPoints - ((this.level - 1) * 100); }
  get xpProgressPercent(): number {
    return Math.min(100, Math.round((this.xpInCurrentLevel / 100) * 100));
  }

  // ── Computed: streak (day-based) ──────────────────────────────────────

  get currentStreak(): number {
    // Use currentStreak (days) if available, fall back to legacy streak (weeks)
    return this.sprint?.currentStreak ?? this.sprint?.streak ?? 0;
  }

  get longestStreak(): number {
    return this.sprint?.longestStreak ?? 0;
  }

  get canRestore(): boolean {
    return !!(this.sprint?._canRestore);
  }

  getStreakStatus(): StreakStatus {
    if (!this.sprint) return 'active';
    return this.sprint.streakStatus || (this.sprint.streakBroken ? 'broken' : this.sprint.streakWarning ? 'warning' : 'active');
  }

  getStreakLabel(): string {
    const days = this.currentStreak;
    return days === 1 ? '1 day' : `${days} days`;
  }

  getLongestStreakLabel(): string {
    const days = this.longestStreak;
    return days === 1 ? '1 day' : `${days} days`;
  }

  // ── Computed: tasks ───────────────────────────────────────────────────

  get allTasks(): SprintTask[] {
    return this.sprint?.tasks || [];
  }

  get pendingTasks(): SprintTask[] {
    return this.sprint?.tasks.filter(t => !t.isCompleted) || [];
  }

  get completedTasks(): SprintTask[] {
    return this.sprint?.tasks.filter(t => t.isCompleted) || [];
  }

  get highPriorityCompleted(): number {
    return this.sprint?.tasks.filter(t => t.isCompleted && t.priority === 'high').length || 0;
  }

  // ── Computed: task filters ────────────────────────────────────────────

  get todayTasks(): SprintTask[] {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    return this.sprint?.tasks.filter(t => {
      if (t.isCompleted) return false;
      const end = t.endDate ? new Date(t.endDate) : (t.deadline ? new Date(t.deadline) : null);
      return !end || (end >= today && end < tomorrow);
    }) || [];
  }

  get overdueTasks(): SprintTask[] {
    const now = new Date();
    return this.sprint?.tasks.filter(t => {
      if (t.isCompleted) return false;
      const end = t.endDate ? new Date(t.endDate) : (t.deadline ? new Date(t.deadline) : null);
      return end && end < now;
    }) || [];
  }

  get sprintTasks(): SprintTask[] {
    // Tasks within the sprint date range
    const start = this.effectiveStartDate;
    const end   = this.effectiveEndDate;
    if (!start || !end) return this.pendingTasks;
    return this.sprint?.tasks.filter(t => {
      if (t.isCompleted) return false;
      const taskStart = t.startDate ? new Date(t.startDate) : null;
      const taskEnd   = t.endDate   ? new Date(t.endDate)   : null;
      if (!taskStart && !taskEnd) return true; // no dates = always in sprint
      return (!taskStart || taskStart <= end) && (!taskEnd || taskEnd >= start);
    }) || [];
  }

  get customRangeTasks(): SprintTask[] {
    if (!this.customRangeStart || !this.customRangeEnd) return this.pendingTasks;
    const start = new Date(this.customRangeStart); start.setHours(0, 0, 0, 0);
    const end   = new Date(this.customRangeEnd);   end.setHours(23, 59, 59, 999);
    return this.sprint?.tasks.filter(t => {
      if (t.isCompleted) return false;
      const taskEnd = t.endDate ? new Date(t.endDate) : (t.deadline ? new Date(t.deadline) : null);
      return !taskEnd || (taskEnd >= start && taskEnd <= end);
    }) || [];
  }

  get plannerTasks(): SprintTask[] {
    switch (this.plannerFilter) {
      case 'all':     return this.allTasks;
      case 'sprint':  return this.sprintTasks;
      case 'today':   return this.todayTasks;
      case 'week':    return this.pendingTasks;
      case 'overdue': return this.overdueTasks;
      case 'custom':  return this.customRangeTasks;
      default:        return this.pendingTasks;
    }
  }

  // ── Computed: insights ────────────────────────────────────────────────

  get insights(): string[] {
    if (!this.sprint) return [];
    const msgs: string[] = [];
    const p      = this.progressPercent;
    const status = this.getStreakStatus();
    const streak = this.currentStreak;

    if (p === 100) {
      msgs.push('🎉 You completed all tasks this sprint!');
    } else if (p >= 70) {
      msgs.push(`✅ You are ${p}% complete — almost there!`);
    } else if (p >= 40) {
      msgs.push(`📈 You are ${p}% complete — keep the momentum.`);
    } else if (p > 0) {
      msgs.push(`⚡ You are ${p}% complete — push harder.`);
    } else {
      msgs.push('🚀 No tasks completed yet — start today!');
    }

    if (this.highPriorityCompleted > 0) {
      msgs.push(`🔥 You completed ${this.highPriorityCompleted} high-priority task${this.highPriorityCompleted > 1 ? 's' : ''}.`);
    }

    if (status === 'warning') {
      msgs.push('⚠️ You haven\'t completed a task today — your streak is at risk!');
    } else if (status === 'broken') {
      const canR = this.canRestore;
      msgs.push(canR ? '💔 Streak broken. You can still restore it (within 3 days).' : '💔 Streak broken. Start fresh today!');
    } else if (streak >= 7) {
      msgs.push(`🏆 ${streak}-day streak — incredible consistency!`);
    } else if (streak >= 3) {
      msgs.push(`🔥 ${streak}-day streak — consistency is building!`);
    }

    if (this.overdueTasks.length > 0) {
      msgs.push(`⏰ ${this.overdueTasks.length} task${this.overdueTasks.length > 1 ? 's are' : ' is'} overdue.`);
    }

    return msgs;
  }

  // ── Actions: task management ──────────────────────────────────────────

  addTask(): void {
    if (!this.sprint || !this.newTaskTitle.trim()) return;
    this.sprintService.addTask(this.sprint._id, {
      title:       this.newTaskTitle.trim(),
      description: this.newTaskDescription.trim() || undefined,
      points:      this.newTaskPoints,
      priority:    this.newTaskPriority,
      category:    this.newTaskCategory,
      taskType:    'manual',
    }).subscribe({
      next: (sprint) => {
        this.sprint             = sprint;
        this.newTaskTitle       = '';
        this.newTaskDescription = '';
        this.newTaskPoints      = 3;
        this.newTaskPriority    = 'medium';
        this.newTaskCategory    = 'learning';
        this.cdr.detectChanges();
      },
      error: () => this.cdr.detectChanges(),
    });
  }

  toggleTask(task: SprintTask): void {
    if (!this.sprint) return;
    this.sprintService.toggleTask(this.sprint._id, task._id, !task.isCompleted).subscribe({
      next: (sprint) => { this.sprint = sprint; this.cdr.detectChanges(); },
      error: () => this.cdr.detectChanges(),
    });
  }

  restoreStreak(): void {
    if (!this.sprint) return;
    this.sprintService.restoreStreak(this.sprint._id).subscribe({
      next: (sprint) => { this.sprint = sprint; this.cdr.detectChanges(); },
      error: () => this.cdr.detectChanges(),
    });
  }

  // ── Actions: AI generation ────────────────────────────────────────────

  generateAiPlan(): void {
    this.isGenerating   = true;
    this.generatedTasks = [];
    this.sprintService.generateAiTasks({
      stack:           this.goalStack      || undefined,
      technology:      this.goalTechnology || undefined,
      experienceLevel: this.goalExperienceLevel || undefined,
      sprintStartDate: this.sprintStartDate || undefined,
      sprintEndDate:   this.sprintEndDate   || undefined,
    }).subscribe({
      next: (res) => {
        this.generatedTasks = res.tasks || [];
        this.isGenerating   = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.isGenerating = false;
        this.cdr.detectChanges();
      },
    });
  }

  addGeneratedTasksToSprint(): void {
    if (!this.sprint || this.generatedTasks.length === 0) return;
    const addNext = (index: number) => {
      if (index >= this.generatedTasks.length) {
        this.generatedTasks = [];
        this.showSetupPanel = false;
        this.cdr.detectChanges();
        return;
      }
      const t = this.generatedTasks[index];
      this.sprintService.addTask(this.sprint!._id, {
        title:       t.title,
        description: t.description,
        points:      t.points,
        priority:    t.priority,
        category:    t.category,
        taskType:    'ai',
        startDate:   t.startDate || undefined,
        endDate:     t.endDate   || undefined,
      }).subscribe({
        next: (sprint) => { this.sprint = sprint; addNext(index + 1); },
        error: () => addNext(index + 1),
      });
    };
    addNext(0);
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  getPriorityColor(priority: TaskPriority): string {
    return { high: '#ef4444', medium: '#f59e0b', low: '#22c55e' }[priority] || '#6366f1';
  }

  getCategoryIcon(category: TaskCategory): string {
    return { learning: '📚', project: '🛠️', practice: '⚡' }[category] || '📌';
  }

  formatTaskDate(dateStr: string | null | undefined): string {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  getTaskDateRange(task: SprintTask): string {
    const start = task.startDate;
    const end   = task.endDate || task.deadline || task.dueDate;
    if (start && end) return `${this.formatTaskDate(start)} → ${this.formatTaskDate(end)}`;
    if (end)          return `Due ${this.formatTaskDate(end)}`;
    return '';
  }

  isTaskActive(task: SprintTask): boolean {
    const now   = new Date();
    const start = task.startDate ? new Date(task.startDate) : null;
    const end   = task.endDate   ? new Date(task.endDate)   : null;
    if (!start && !end) return true;
    return (!start || start <= now) && (!end || end >= now);
  }

  getAvatarSrc(): string {
    const raw = String(this.userAvatar || '').trim();
    if (!raw) return '';
    if (/^data:/i.test(raw) || raw.startsWith('blob:')) return raw;
    const sep = raw.includes('?') ? '&' : '?';
    return `${raw}${sep}v=${this.avatarVersion}`;
  }

  private bumpAvatarVersion(): void {
    this.avatarVersion = Date.now();
  }
}
