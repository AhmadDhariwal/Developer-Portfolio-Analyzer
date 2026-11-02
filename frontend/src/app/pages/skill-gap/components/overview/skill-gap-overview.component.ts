import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SkillGapResult } from '../../../../shared/services/skill-gap.service';
import { warningLabel } from '../../skill-gap-presentation';

@Component({
  selector: 'section[skillGapOverview]',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './skill-gap-overview.component.html',
})
export class SkillGapOverviewComponent {
  @Input({ required: true }) analysis!: SkillGapResult;
  @Input() evidenceBackedCount = 0;
  @Input() demonstratedCount = 0;
  @Input() partialCount = 0;
  @Input() validatedGapsCount = 0;
  @Input() claimedCount = 0;
  @Input() totalWeeks = '';
  @Input() roadmapPhaseCount = 0;
  readonly warningLabel = warningLabel;
}
