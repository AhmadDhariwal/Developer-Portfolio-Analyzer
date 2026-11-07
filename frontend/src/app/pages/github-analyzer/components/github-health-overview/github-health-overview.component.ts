import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { BadgeVariant, UiBadgeComponent } from '../../../../shared/components';
import {
  GitHubAnalysisResult,
  LanguageDistribution,
} from '../../../../shared/services/github.service';
import { GithubPresentation } from '../../github-presentation';
@Component({
  selector: 'app-github-health-overview',
  standalone: true,
  imports: [CommonModule, UiBadgeComponent],
  templateUrl: './github-health-overview.component.html',
  styleUrl: './github-health-overview.component.scss',
})
export class GithubHealthOverviewComponent extends GithubPresentation {
  @Input({ required: true }) healthScoreValue!: number | null;
  @Input({ required: true }) qualitativeStateVariant!: BadgeVariant;
  @Input({ required: true }) qualitativeState!: string;
  @Input({ required: true }) executiveHeadline!: string;
  @Input({ required: true }) result!: GitHubAnalysisResult;
  @Input({ required: true }) executiveExplanation!: string;
  @Input({ required: true }) strongestSignal!: {
    label: string;
    score: number | null;
    detail: string;
  };
  @Input({ required: true }) biggestWeakness!: {
    label: string;
    score: number | null;
    detail: string;
  };
  @Input({ required: true }) topRecommendedAction!: { title: string; detail: string };
  @Input({ required: true }) originalRepoCount!: number;
  @Input({ required: true }) forkedRepoCount!: number;
  @Input({ required: true }) totalSampledCommits!: number | null;
  @Input({ required: true }) displayLanguages!: LanguageDistribution[];
}
