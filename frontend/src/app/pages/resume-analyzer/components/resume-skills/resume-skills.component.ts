import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { UiButtonComponent, UiCardComponent } from '../../../../shared/components';
import { SkillBadgeComponent } from '../../../../shared/components/skill-badge/skill-badge.component';
import { SkillGroupViewModel } from '../../resume-view.models';

@Component({
  selector: 'app-resume-skills',
  standalone: true,
  imports: [CommonModule, UiButtonComponent, UiCardComponent, SkillBadgeComponent],
  templateUrl: './resume-skills.component.html',
  styleUrl: './resume-skills.component.scss',
})
export class ResumeSkillsComponent {
  @Input({ required: true }) skillGroups!: SkillGroupViewModel[];
  @Input({ required: true }) detectedSkillCount!: number;
  @Input({ required: true }) showAllSkills!: boolean;
  @Output() readonly toggleSkills = new EventEmitter<void>();
}
