import { ChangeDetectionStrategy, Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ProjectInput, SimResult } from '../../../../shared/models/scenario-simulator.model';
import { ScenarioPresentation } from '../../utils/scenario-presentation';

@Component({
  selector: 'app-scenario-inputs',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './scenario-inputs.component.html',
  styleUrl: './scenario-inputs.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScenarioInputsComponent extends ScenarioPresentation {
  @Input({ required: true }) baselineConfirmed!: boolean;
  @Input({ required: true }) baselineHiringScore!: number;
  @Input({ required: true }) baselineJobMatch!: number;
  @Input({ required: true }) role!: string;
  @Input({ required: true }) experienceLevel!: string;
  @Input({ required: true }) durationWeeks!: number;
  @Input({ required: true }) skillInput!: string;
  @Input({ required: true }) scenarioName!: string;
  @Input({ required: true }) skills!: string[];
  @Input({ required: true }) projects!: ProjectInput[];
  @Input({ required: true }) isRunning!: boolean;
  @Input({ required: true }) isSavingScenario!: boolean;
  @Input({ required: true }) errorMessage!: string;
  @Input({ required: true }) result!: SimResult | null;
  @Input({ required: true }) roleOptions!: ReadonlyArray<{ value: string; label: string }>;
  @Input({ required: true }) levelOptions!: ReadonlyArray<{ value: string; label: string }>;
  @Input({ required: true }) durationOptions!: readonly number[];
  @Input({ required: true }) isResultCurrent!: boolean;
  @Input({ required: true }) validationError!: string | null;
  @Output() addSuggestedSkillRequested = new EventEmitter<string>();
  @Output() addSkillRequested = new EventEmitter<void>();
  @Output() removeSkillRequested = new EventEmitter<string>();
  @Output() addProjectRequested = new EventEmitter<void>();
  @Output() removeProjectRequested = new EventEmitter<number>();
  @Output() saveScenarioRequested = new EventEmitter<void>();
  @Output() simulateRequested = new EventEmitter<void>();
  @Output() scenarioNameChange = new EventEmitter<string>();
  @Output() roleChange = new EventEmitter<string>();
  @Output() experienceLevelChange = new EventEmitter<string>();
  @Output() baselineHiringScoreChange = new EventEmitter<number>();
  @Output() baselineJobMatchChange = new EventEmitter<number>();
  @Output() baselineConfirmedChange = new EventEmitter<boolean>();
  @Output() skillInputChange = new EventEmitter<string>();
  @Output() projectsChange = new EventEmitter<ProjectInput[]>();
  @Output() durationWeeksChange = new EventEmitter<number>();

  updateProject(index: number, patch: Partial<ProjectInput>): void {
    this.projectsChange.emit(
      this.projects.map((project, i) => (i === index ? { ...project, ...patch } : project)),
    );
  }
}
