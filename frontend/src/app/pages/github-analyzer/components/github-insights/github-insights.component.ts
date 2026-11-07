import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { UiBadgeComponent } from '../../../../shared/components';
import { GitHubAnalysisResult } from '../../../../shared/services/github.service';
import { GithubPresentation } from '../../github-presentation';
@Component({
  selector: 'app-github-insights',
  standalone: true,
  imports: [CommonModule, UiBadgeComponent],
  templateUrl: './github-insights.component.html',
  styleUrl: './github-insights.component.scss',
})
export class GithubInsightsComponent extends GithubPresentation {
  @Input({ required: true }) result!: GitHubAnalysisResult;
  @Input({ required: true }) hasAiContent!: boolean;
  @Input({ required: true }) hasStrengths!: boolean;
  @Input({ required: true }) hasWeakAreas!: boolean;
  @Input({ required: true }) hasRecruiterInsights!: boolean;
}
