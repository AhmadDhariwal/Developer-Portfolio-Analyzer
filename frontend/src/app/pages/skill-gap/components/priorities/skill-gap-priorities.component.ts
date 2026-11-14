import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MissingSkill } from '../../../../shared/services/skill-gap.service';

@Component({
  selector: 'section[skillGapPriorities]',
  standalone: true,
  imports: [CommonModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './skill-gap-priorities.component.html',
})
export class SkillGapPrioritiesComponent {
  @Input() opportunities: MissingSkill[] = [];
}
