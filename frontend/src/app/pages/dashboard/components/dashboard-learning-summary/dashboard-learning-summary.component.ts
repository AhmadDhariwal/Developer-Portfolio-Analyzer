import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

export interface DashboardLearningSnapshot {
  totalTracked: number;
  savedCount: number;
  inProgressCount: number;
  completedCount: number;
}

@Component({
  selector: 'app-dashboard-learning-summary',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './dashboard-learning-summary.component.html',
  styleUrl: './dashboard-learning-summary.component.scss',
})
export class DashboardLearningSummaryComponent {
  @Input() completedCourses: { title: string; completedAt: string | null }[] = [];
  @Input() snapshot: DashboardLearningSnapshot | null = null;
}
