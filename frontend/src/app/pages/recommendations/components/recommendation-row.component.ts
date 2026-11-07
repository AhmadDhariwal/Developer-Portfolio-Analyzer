import { recommendationCategoryLabel } from '../utils/recommendation-presentation';
import { recommendationRoute, recommendationExternalUrl } from '../utils/recommendation-navigation';
import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RecommendationCard } from '../../../shared/models/recommendations.model';

@Component({
  selector: 'app-recommendation-row',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './recommendation-row.component.html',
  styleUrl: './recommendation-row.component.scss',
})
export class RecommendationRowComponent {
  @Input({ required: true }) card!: RecommendationCard;
  @Input() featured = false;
  @Input() rank: number | null = null;
  @Input() sprintEnabled = false;
  @Input() sprintState?: { loading: boolean; message: string; success: boolean };
  @Output() sprint = new EventEmitter<RecommendationCard>();

  readonly categoryLabel = recommendationCategoryLabel;
  get priorityTone(): string {
    const priority = this.card.priority?.toLowerCase();
    return ['high', 'medium', 'low'].includes(priority) ? priority : 'low';
  }
  get reviewRoute(): string | null {
    const routes: Record<string, string> = {
      skillGap: '/app/skill-gap',
      github: '/app/github-analyzer',
      resume: '/app/resume-analyzer',
      portfolio: '/app/portfolio',
      profile: '/app/profile',
      careerSprint: '/app/career-sprint',
    };
    const source = this.card.sources?.find((item) => routes[item.type]);
    return (source && routes[source.type]) || recommendationRoute(this.card.actionUrl);
  }
  readonly safeRoute = recommendationRoute;
  readonly externalUrl = recommendationExternalUrl;
}
