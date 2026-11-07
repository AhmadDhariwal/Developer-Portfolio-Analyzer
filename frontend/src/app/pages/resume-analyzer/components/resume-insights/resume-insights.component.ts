import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import {
  UiBadgeComponent,
  UiCardComponent,
  UiSectionHeaderComponent,
} from '../../../../shared/components';
import { ResumeAnalysis } from '../../../../shared/models/resume.model';

@Component({
  selector: 'app-resume-insights',
  standalone: true,
  imports: [CommonModule, UiCardComponent, UiBadgeComponent, UiSectionHeaderComponent],
  templateUrl: './resume-insights.component.html',
  styleUrl: './resume-insights.component.scss',
})
export class ResumeInsightsComponent {
  @Input({ required: true }) analysis!: ResumeAnalysis;
  @Input({ required: true }) aiGuidanceAvailable!: boolean;
  @Input({ required: true }) aiStrengths!: string[];
  @Input({ required: true }) aiWeaknesses!: string[];
  @Input({ required: true }) aiWritingSuggestions!: string[];
  @Input({ required: true }) aiPriorities!: {
    title: string;
    description: string;
    impact: string;
  }[];
  @Input({ required: true }) hiringReadiness!: string;
}
