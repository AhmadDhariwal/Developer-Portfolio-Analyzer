import { ChangeDetectionStrategy, Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ProjectInput, ScenarioContext } from '../../../../shared/models/scenario-simulator.model';
import { ScenarioTemplateDefinition } from '../../../../shared/models/scenario-template.model';
import { ScenarioPresentation } from '../../utils/scenario-presentation';

@Component({
  selector: 'app-scenario-context',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './scenario-context.component.html',
  styleUrl: './scenario-context.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScenarioContextPanelComponent extends ScenarioPresentation {
  @Input({ required: true }) experienceLevel!: string;
  @Input({ required: true }) durationWeeks!: number;
  @Input({ required: true }) projects!: ProjectInput[];
  @Input({ required: true }) isLoadingContext!: boolean;
  @Input({ required: true }) showMobileContext!: boolean;
  @Input({ required: true }) context!: ScenarioContext | null;
  @Input({ required: true }) contextCacheHit!: boolean;
  @Input({ required: true }) templates!: readonly ScenarioTemplateDefinition[];
  @Input({ required: true }) contextCacheLabel!: string;
  @Output() addSuggestedSkillRequested = new EventEmitter<string>();
  @Output() addSuggestedProjectRequested = new EventEmitter<ProjectInput>();
  @Output() applyTemplateRequested = new EventEmitter<ScenarioTemplateDefinition>();
  @Output() showMobileContextChange = new EventEmitter<boolean>();
}
