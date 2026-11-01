import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import {
  ScoreCardColor,
  ScoreCardComponent,
  UiBadgeComponent,
  UiCardComponent,
  UiMetricCardComponent,
} from '../../../../shared/components';
import { ResumeAnalysis } from '../../../../shared/models/resume.model';
import { formatResumeDate, formatResumeFileSize } from '../../resume-presentation';
import { QualityIndicatorConfig } from '../../resume-view.models';

@Component({
  selector: 'app-resume-overview',
  standalone: true,
  imports: [
    CommonModule,
    UiCardComponent,
    UiMetricCardComponent,
    ScoreCardComponent,
    UiBadgeComponent,
  ],
  templateUrl: './resume-overview.component.html',
  styleUrl: './resume-overview.component.scss',
})
export class ResumeOverviewComponent {
  @Input({ required: true }) isStale!: boolean;
  @Input({ required: true }) analysis!: ResumeAnalysis;
  @Input({ required: true }) overallScore!: number | null;
  @Input({ required: true }) overallScoreAvailable!: boolean;
  @Input({ required: true }) scoreCardColor!: ScoreCardColor;
  @Input({ required: true }) scoreRuleVersion!: string;
  @Input({ required: true }) scoreCalculatedAt!: string | null;
  @Input({ required: true }) qualityIndicator!: QualityIndicatorConfig | null;
  @Input({ required: true }) detectedSkillCount!: number;
  @Input({ required: true }) quantifiedAchievementsCount!: number;
  @Input({ required: true }) experienceYears!: number | null;
  @Input({ required: true }) experienceLevel!: string | null;
  @Input({ required: true }) detectedWordCount!: number | null;
  @Input({ required: true }) uniqueWordCount!: number | null;

  formatDate = formatResumeDate;
  formatFileSize = formatResumeFileSize;
}
