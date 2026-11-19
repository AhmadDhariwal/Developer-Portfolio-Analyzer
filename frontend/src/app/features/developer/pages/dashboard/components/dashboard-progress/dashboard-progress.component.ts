import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  DashboardProgress,
  DashboardPortfolioAssessment,
  DashboardIntegrationConnectivity,
} from '../../../../../../shared/models/dashboard.model';

@Component({
  selector: 'app-dashboard-progress',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dashboard-progress.component.html',
  styleUrl: './dashboard-progress.component.scss',
})
export class DashboardProgressComponent {
  @Input() data: DashboardProgress | null = null;
  @Input() portfolioAssessment: DashboardPortfolioAssessment | null = null;
  @Input() currentPortfolioScore: number | null = null;
  @Input() canAssessPortfolio = false;
  @Input() assessingPortfolio = false;
  @Input() portfolioAssessmentError = '';
  @Output() assessPortfolio = new EventEmitter<void>();
  @Input() loading = false;
  @Input() error = '';
  @Input() stale = false;
  @Input() integrationHealth: DashboardIntegrationConnectivity | null = null;
  @Input() integrationHealthState: 'loading' | 'ready' | 'error' = 'loading';

  get historyPolyline(): string {
    const points = this.data?.history.points || [];
    const first = new Date(points[0]?.at || 0).getTime();
    const span = Math.max(1, new Date(points.at(-1)?.at || 0).getTime() - first);
    return points
      .map(
        (point) =>
          `${10 + ((new Date(point.at).getTime() - first) / span) * 280},${110 - point.value}`,
      )
      .join(' ');
  }

  get historyAreaPoints(): string {
    const pts = this.historyCoords;
    if (!pts.length) return '';
    const firstX = pts[0].x;
    const lastX = pts[pts.length - 1].x;
    return `${firstX},110 ${pts.map((p) => `${p.x},${p.y}`).join(' ')} ${lastX},110`;
  }

  get historyCoords(): { x: number; y: number }[] {
    const points = this.data?.history.points || [];
    if (!points.length) return [];
    const first = new Date(points[0]?.at || 0).getTime();
    const span = Math.max(1, new Date(points.at(-1)?.at || 0).getTime() - first);
    return points.map((point) => ({
      x: 10 + ((new Date(point.at).getTime() - first) / span) * 280,
      y: 110 - point.value,
    }));
  }

  get hasDatedSprintCompletions(): boolean {
    return this.data?.sprint.velocity.some((day) => day.completed > 0) ?? false;
  }

  get maxVelocity(): number {
    return Math.max(1, ...(this.data?.sprint.velocity || []).map((day) => day.points));
  }
}
