import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import {
  UiBadgeComponent,
  UiButtonComponent,
  UiProgressComponent,
} from '../../../../shared/components';
import { GithubPresentation } from '../../github-presentation';
import { DisplayBreakdownItem } from '../../github-view.models';
@Component({
  selector: 'app-github-scoring-breakdown',
  standalone: true,
  imports: [CommonModule, UiButtonComponent, UiBadgeComponent, UiProgressComponent],
  templateUrl: './github-scoring-breakdown.component.html',
  styleUrl: './github-scoring-breakdown.component.scss',
})
export class GithubScoringBreakdownComponent extends GithubPresentation {
  @Input({ required: true }) ruleVersion!: string;
  @Input({ required: true }) scoreBreakdownList!: DisplayBreakdownItem[];
  @Output() readonly auditRequested = new EventEmitter<void>();
}
