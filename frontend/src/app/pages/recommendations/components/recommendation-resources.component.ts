import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RecommendationsResult } from '../../../shared/models/recommendations.model';
import { recommendationExternalUrl, recommendationRoute } from '../utils/recommendation-navigation';

@Component({
  selector: 'app-recommendation-resources',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './recommendation-resources.component.html',
  styleUrl: './recommendation-resources.component.scss',
})
export class RecommendationResourcesComponent {
  @Input({ required: true }) result!: RecommendationsResult;
  readonly safeRoute = recommendationRoute;
  readonly externalUrl = recommendationExternalUrl;
  get supplementalGroups() {
    return [
      { title: 'Learning actions', items: this.result.learningActions || [] },
      { title: 'Interview preparation', items: this.result.interviewReadinessActions || [] },
      { title: 'Resume actions', items: this.result.resumeRecommendations || [] },
      { title: 'Portfolio actions', items: this.result.portfolioRecommendations || [] },
    ].filter((group) => group.items.length);
  }
}
