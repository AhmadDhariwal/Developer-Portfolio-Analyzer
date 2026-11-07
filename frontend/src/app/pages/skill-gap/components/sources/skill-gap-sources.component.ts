import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { SkillGapResult } from '../../../../shared/services/skill-gap.service';
import { sourceLabel, warningLabel } from '../../skill-gap-presentation';

@Component({
  selector: 'section[skillGapSources]',
  standalone: true,
  imports: [CommonModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './skill-gap-sources.component.html',
})
export class SkillGapSourcesComponent {
  @Input({ required: true }) analysis!: SkillGapResult;
  @Input() noCoreEvidence = false;
  @Input() staleEvidence = false;
  @Input() legacyReadiness: number | null = null;
  readonly sourceLabel = sourceLabel;
  readonly warningLabel = warningLabel;
}
