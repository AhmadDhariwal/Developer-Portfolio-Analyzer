import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SkillGapResult } from '../../../../shared/services/skill-gap.service';

@Component({
  selector: 'section[skillGapCategories]',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './skill-gap-categories.component.html',
})
export class SkillGapCategoriesComponent {
  @Input({ required: true }) analysis!: SkillGapResult;
  @Input() categories: string[] = [];
}
