import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import {
  UiBadgeComponent,
  UiCardComponent,
  UiSectionHeaderComponent,
} from '../../../../shared/components';
import { ResumeWarning } from '../../../../shared/models/resume.model';
import { SectionPresenceItem, SkillGroupViewModel } from '../../resume-view.models';
import { ResumeSkillsComponent } from '../resume-skills/resume-skills.component';
import { ResumeWarningsComponent } from '../resume-warnings/resume-warnings.component';
@Component({
  selector: 'app-resume-evidence',
  standalone: true,
  imports: [
    CommonModule,
    UiCardComponent,
    UiBadgeComponent,
    UiSectionHeaderComponent,
    ResumeSkillsComponent,
    ResumeWarningsComponent,
  ],
  templateUrl: './resume-evidence.component.html',
  styleUrl: './resume-evidence.component.scss',
})
export class ResumeEvidenceComponent {
  @Input({ required: true }) sectionPresenceList!: SectionPresenceItem[];
  @Input({ required: true }) skillGroups!: SkillGroupViewModel[];
  @Input({ required: true }) detectedSkillCount!: number;
  @Input({ required: true }) quantifiedAchievementsCount!: number;
  @Input({ required: true }) quantifiedAchievementExamples!: string[];
  @Input({ required: true }) warningsList!: ResumeWarning[];
  @Input({ required: true }) showAllSkills!: boolean;
  @Output() readonly toggleSkills = new EventEmitter<void>();
}
