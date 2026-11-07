import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { UiBadgeComponent, UiButtonComponent } from '../../../../shared/components';
import { GitHubAnalysisResult } from '../../../../shared/services/github.service';
import { GithubPresentation } from '../../github-presentation';
@Component({
  selector: 'app-github-profile-search',
  standalone: true,
  imports: [CommonModule, FormsModule, UiButtonComponent, UiBadgeComponent],
  templateUrl: './github-profile-search.component.html',
  styleUrl: './github-profile-search.component.scss',
})
export class GithubProfileSearchComponent extends GithubPresentation {
  @Input({ required: true }) username!: string;
  @Input({ required: true }) isAnalyzing!: boolean;
  @Input({ required: true }) analysisReady!: boolean;
  @Input({ required: true }) result!: GitHubAnalysisResult | null;
  @Input({ required: true }) errorMessage!: string;
  @Input({ required: true }) viewedUsername!: string;
  @Input({ required: true }) isDefaultProfile!: boolean;
  @Input({ required: true }) calculationTimestamp!: string;
  @Input({ required: true }) cacheStatusLabel!: string;
  @Input({ required: true }) isTemporaryView!: boolean;
  @Input({ required: true }) defaultUsername!: string;
  @Input({ required: true }) isStale!: boolean;
  @Output() readonly analyzeRequested = new EventEmitter<void>();
  @Output() readonly returnRequested = new EventEmitter<void>();
  @Output() readonly usernameChange = new EventEmitter<string>();
}
