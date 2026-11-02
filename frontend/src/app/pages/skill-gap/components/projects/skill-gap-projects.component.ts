import { Component, Input, ChangeDetectionStrategy, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SuggestedSkillProject } from '../../../../shared/services/skill-gap.service';

@Component({
  selector: 'section[skillGapProjects]',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './skill-gap-projects.component.html',
})
export class SkillGapProjectsComponent {
  @Input() suggestedProjects: SuggestedSkillProject[] = [];
  @Input() displayedProjects: SuggestedSkillProject[] = [];
  @Input() initialProjectLimit = 3;
  @Input() showAllProjects = false;
  @Output() expandedChange = new EventEmitter<boolean>();
}
