import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { UiDrawerComponent } from '../../../../shared/components';
import { GitHubAnalysisResult, TechnologySignal } from '../../../../shared/services/github.service';
import { GithubPresentation } from '../../github-presentation';
import { DisplayBreakdownItem } from '../../github-view.models';
@Component({
  selector: 'app-github-technical-audit',
  standalone: true,
  imports: [CommonModule, UiDrawerComponent],
  templateUrl: './github-technical-audit.component.html',
  styleUrl: './github-technical-audit.component.scss',
})
export class GithubTechnicalAuditComponent extends GithubPresentation {
  @Input({ required: true }) showEvidenceDrawer!: boolean;
  @Input({ required: true }) result!: GitHubAnalysisResult | null;
  @Input({ required: true }) ruleVersion!: string;
  @Input({ required: true }) calculationTimestamp!: string;
  @Input({ required: true }) cacheStatusLabel!: string;
  @Input({ required: true }) originalRepoCount!: number;
  @Input({ required: true }) forkedRepoCount!: number;
  @Input({ required: true }) archivedRepoCount!: number;
  @Input({ required: true }) totalSampledCommits!: number | null;
  @Input({ required: true }) evidenceFacts!:
    | {
        repoCount?: number;
        originalRepoCount?: number;
        forkRepoCount?: number;
        archivedRepoCount?: number;
        languageCount?: number;
        totalStars?: number | null;
        totalForks?: number | null;
        totalCommits?: number | null;
        activeRepos?: number;
      }
    | null
    | undefined;
  @Input({ required: true }) scoreBreakdownList!: DisplayBreakdownItem[];
  @Input({ required: true }) hasTechnologyData!: boolean;
  @Input({ required: true }) technologyCategories!: {
    category: string;
    items: TechnologySignal[];
  }[];
  @Input({ required: true }) scoringWarnings!: string[];
  @Output() readonly closed = new EventEmitter<void>();
}
