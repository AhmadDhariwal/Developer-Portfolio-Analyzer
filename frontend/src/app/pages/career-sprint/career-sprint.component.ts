import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CareerSprintService, CareerSprint, SprintTask } from '../../shared/services/career-sprint.service';
import { ProfileService } from '../../shared/services/profile.service';

@Component({
  selector: 'app-career-sprint',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './career-sprint.component.html',
  styleUrl: './career-sprint.component.scss'
})
export class CareerSprintComponent implements OnInit {
  sprint: CareerSprint | null = null;
  userAvatar = '';
  userName = '';
  userInitial = 'D';
  avatarVersion = Date.now();
  isLoading = false;
  newTaskTitle = '';
  newTaskDescription = '';
  newTaskPoints = 1;

  constructor(
    private readonly sprintService: CareerSprintService,
    private readonly profileService: ProfileService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loadSprint();
    this.loadProfile();
  }

  loadProfile(): void {
    this.profileService.getProfile().subscribe({
      next: (profile) => {
        this.userAvatar = this.profileService.resolveAvatarUrl(profile.avatar || '');
        this.userName = profile.name || '';
        this.userInitial = this.profileService.getInitials(this.userName || 'Developer') || 'D';
        this.bumpAvatarVersion();
        this.cdr.detectChanges();
      },
      error: () => {
        this.cdr.detectChanges();
      }
    });
  }

  loadSprint(): void {
    this.isLoading = true;
    this.sprintService.getCurrent().subscribe({
      next: (sprint) => {
        this.sprint = sprint;
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.isLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  get completedCount(): number {
    return this.sprint?.tasks.filter((t) => t.isCompleted).length || 0;
  }

  get progressPercent(): number {
    if (!this.sprint) return 0;
    return Math.min(100, Math.round((this.completedCount / Math.max(this.sprint.weeklyGoal, 1)) * 100));
  }

  get remainingTasksCount(): number {
    if (!this.sprint) return 0;
    return Math.max(0, this.sprint.tasks.length - this.completedCount);
  }

  get motivationalText(): string {
    const p = this.progressPercent;
    if (p < 25) return 'Let’s start strong';
    if (p < 60) return 'Good momentum';
    if (p < 100) return 'Almost there';
    return 'Goal achieved this week';
  }

  get pendingTasks(): SprintTask[] {
    return this.sprint?.tasks.filter((t) => !t.isCompleted) || [];
  }

  get completedTasks(): SprintTask[] {
    return this.sprint?.tasks.filter((t) => t.isCompleted) || [];
  }
  
  get progressRingOffset(): number {
    const circumference = 2 * Math.PI * 45; // radius=45
    return circumference - (this.progressPercent / 100) * circumference;
  }

  addTask(): void {
    if (!this.sprint || !this.newTaskTitle.trim()) return;

    this.sprintService.addTask(this.sprint._id, {
      title: this.newTaskTitle,
      description: this.newTaskDescription.trim() || undefined,
      points: this.newTaskPoints
    }).subscribe({
      next: (sprint) => {
        this.sprint = sprint;
        this.newTaskTitle = '';
        this.newTaskDescription = '';
        this.newTaskPoints = 1;
        this.cdr.detectChanges();
      },
      error: () => {
        this.cdr.detectChanges();
      }
    });
  }

  toggleTask(task: SprintTask): void {
    if (!this.sprint) return;

    this.sprintService.toggleTask(this.sprint._id, task._id, !task.isCompleted).subscribe({
      next: (sprint) => {
        this.sprint = sprint;
        this.cdr.detectChanges();
      },
      error: () => {
        this.cdr.detectChanges();
      }
    });
  }

  restoreStreak(): void {
    if (!this.sprint) return;

    this.sprintService.restoreStreak(this.sprint._id).subscribe({
      next: (sprint) => {
        this.sprint = sprint;
        this.cdr.detectChanges();
      },
      error: () => {
        this.cdr.detectChanges();
      }
    });
  }

  getStreakLabel(): string {
    if (!this.sprint) return '';
    const weeks = this.sprint.streak || 0;
    return weeks === 1 ? '1 week' : `${weeks} weeks`;
  }

  getStreakStatus(): string {
    if (!this.sprint) return '';
    if (this.sprint.streakBroken) return 'broken';
    if (this.sprint.streakWarning) return 'warning';
    return 'active';
  }

  getAvatarSrc(): string {
    const raw = String(this.userAvatar || '').trim();
    if (!raw) return '';
    if (/^data:/i.test(raw) || raw.startsWith('blob:')) return raw;
    
    const separator = raw.includes('?') ? '&' : '?';
    return `${raw}${separator}v=${this.avatarVersion}`;
  }

  private bumpAvatarVersion(): void {
    this.avatarVersion = Date.now();
  }
}
