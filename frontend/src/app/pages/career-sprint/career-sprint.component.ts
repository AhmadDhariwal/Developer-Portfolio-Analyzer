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
  goalStack       = '';
  goalTechnology  = '';
  goalExperienceLevel = '';
  isGenerating    = false;
  generatedTasks: SprintTask[] = [];
  showSetupPanel  = false;

  // ── Weekly planner filter ─────────────────────────────────────────────
  plannerFilter: 'today' | 'week' | 'overdue' = 'week';

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
        this.userAvatar = this.profileService.resolveAvatarUrl(profile.avatar || '');
        this.userName   = profile.name || '';
        this.userInitial = this.profileService.getInitials(this.userName || 'Developer') || 'D';
        // Pre-fill goal fields from profile
        if (!this.goalStack && profile.careerStack)         this.goalStack = profile.careerStack;
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
        this.cdr.detectChanges();
      },
      error: () => {
        this.isLoading = false;
        this.cdr.detectChanges();
      },
    });
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
    if (p === 0)   return 'Ready to start';
    if (p < 25)    return 'Let\'s start strong';
    if (p < 60)    return 'Good momentum';
    if (p < 100)   return 'Almost there';
    return 'Goal achieved this week! 🎉';
  }

  // ── Computed: XP & Level ──────────────────────────────────────────────

  get xpPoints(): number  { return this.sprint?.xpPoints || 0; }
  get level(): number     { return this.sprint?.level || 1; }
  get xpToNextLevel(): number { return this.level * 100; }
  get xpInCurrentLevel(): number { return this.xpPoints - ((this.level - 1) * 100); }
  get xpProgressPercent(): number {
    return Math.min(100, Math.round((this.xpInCurrentLevel / 100) * 100));
  }

  // ── Computed: tasks ───────────────────────────────────────────────────

  get pendingTasks(): SprintTask[] {
    return this.sprint?.tasks.filter(t => !t.isCompleted) || [];
  }

  get completedTasks(): SprintTask[] {
    return this.sprint?.tasks.filter(t => t.isCompleted) || [];
  }

  get highPriorityCompleted(): number {
    return this.sprint?.tasks.filter(t => t.isCompleted && t.priority === 'high').length || 0;
  }

  // ── Computed: weekly planner ──────────────────────────────────────────

  get todayTasks(): SprintTask[] {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return this.sprint?.tasks.filter(t => {
      if (t.isCompleted) return false;
      const due = t.deadline ? new Date(t.deadline) : null;
      return !due || (due >= today && due < tomorrow);
    }) || [];
  }

  get overdueTasks(): SprintTask[] {
    const now = new Date();
    return this.sprint?.tasks.filter(t => {
      if (t.isCompleted) return false;
      const due = t.deadline ? new Date(t.deadline) : null;
      return due && due < now;
    }) || [];
  }

  get plannerTasks(): SprintTask[] {
    if (this.plannerFilter === 'today')   return this.todayTasks;
    if (this.plannerFilter === 'overdue') return this.overdueTasks;
    return this.pendingTasks;
  }

  // ── Computed: streak ──────────────────────────────────────────────────

  getStreakStatus(): StreakStatus {
    if (!this.sprint) return 'active';
    return this.sprint.streakStatus || (this.sprint.streakBroken ? 'broken' : this.sprint.streakWarning ? 'warning' : 'active');
  }

  getStreakLabel(): string {
    const weeks = this.sprint?.streak || 0;
    return weeks === 1 ? '1 week' : `${weeks} weeks`;
  }

  // ── Computed: insights ────────────────────────────────────────────────

  get insights(): string[] {
    if (!this.sprint) return [];
    const msgs: string[] = [];
    const p = this.progressPercent;
    const status = this.getStreakStatus();

    if (p === 100) {
      msgs.push('🎉 You completed all tasks this week!');
    } else if (p >= 70) {
      msgs.push(`✅ You are ${p}% complete — almost there!`);
    } else if (p >= 40) {
      msgs.push(`📈 You are ${p}% complete — keep the momentum.`);
    } else if (p > 0) {
      msgs.push(`⚡ You are ${p}% complete — push harder this week.`);
    } else {
      msgs.push('🚀 No tasks completed yet — start today!');
    }

    if (this.highPriorityCompleted > 0) {
      msgs.push(`🔥 You completed ${this.highPriorityCompleted} high-priority task${this.highPriorityCompleted > 1 ? 's' : ''}.`);
    }

    if (status === 'warning') {
      msgs.push('⚠️ Sprint ends soon — complete remaining tasks to keep your streak.');
    } else if (status === 'broken') {
      msgs.push('💔 Your streak was broken. Restore it within 24 hours.');
    } else if ((this.sprint?.streak || 0) >= 3) {
      msgs.push(`🏆 ${this.sprint!.streak}-week streak — consistency is your superpower!`);
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
        this.sprint            = sprint;
        this.newTaskTitle      = '';
        this.newTaskDescription = '';
        this.newTaskPoints     = 3;
        this.newTaskPriority   = 'medium';
        this.newTaskCategory   = 'learning';
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
      stack:           this.goalStack || undefined,
      technology:      this.goalTechnology || undefined,
      experienceLevel: this.goalExperienceLevel || undefined,
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

    // Add tasks sequentially to avoid race conditions
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
