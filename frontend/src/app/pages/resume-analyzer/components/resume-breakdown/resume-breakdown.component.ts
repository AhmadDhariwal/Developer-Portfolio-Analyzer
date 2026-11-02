import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import {
  UiBadgeComponent,
  UiProgressComponent,
  UiSectionHeaderComponent,
} from '../../../../shared/components';
import { DisplayBreakdownDimension } from '../../resume-view.models';

@Component({
  selector: 'app-resume-breakdown',
  standalone: true,
  imports: [CommonModule, UiBadgeComponent, UiProgressComponent, UiSectionHeaderComponent],
  templateUrl: './resume-breakdown.component.html',
  styleUrl: './resume-breakdown.component.scss',
})
export class ResumeBreakdownComponent {
  @Input({ required: true }) breakdownDimensions!: DisplayBreakdownDimension[];
}
