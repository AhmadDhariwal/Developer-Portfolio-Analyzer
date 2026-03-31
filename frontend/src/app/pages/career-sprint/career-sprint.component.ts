import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CareerSprintService, CareerSprint, SprintTask } from '../../shared/services/career-sprint.service';

@Component({
  selector: 'app-career-sprint',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './career-sprint.component.html',
  styleUrl: './career-sprint.component.scss'
})
export class CareerSprintComponent implements OnInit {
  sprint: CareerSprint | null = null;
  isLoading = false;
  newTaskTitle = '';
  newTaskDescription = '';
  newTaskPoints = 1;

  constructor(
    private readonly sprintService: CareerSprintService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loadSprint();
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
}
