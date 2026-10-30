import { ChangeDetectionStrategy, Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ProjectInput,
  SimResult,
  SavedScenario,
} from '../../../../shared/models/scenario-simulator.model';
import { ScenarioPresentation, buildScenarioComparison } from '../../utils/scenario-presentation';

@Component({
  selector: 'app-scenario-history',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './scenario-history.component.html',
  styleUrl: './scenario-history.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScenarioHistoryComponent extends ScenarioPresentation {
  @Input({ required: true }) nextHistoryCursor!: string | null;
  @Input({ required: true }) role!: string;
  @Input({ required: true }) durationWeeks!: number;
  @Input({ required: true }) skills!: string[];
  @Input({ required: true }) projects!: ProjectInput[];
  @Input({ required: true }) isLoadingHistory!: boolean;
  @Input({ required: true }) showMobileHistory!: boolean;
  @Input({ required: true }) scenarioHistory!: SavedScenario[];
  @Input({ required: true }) compareScenario!: SavedScenario | null;
  @Input({ required: true }) isCompareOpen!: boolean;
  @Input({ required: true }) deletingScenarioId!: string;
  @Input({ required: true }) historyCacheHit!: boolean;
  @Input({ required: true }) historyCacheLabel!: string;
  @Input({ required: true }) result!: SimResult | null;
  @Input({ required: true }) baselineHiringScore!: number;
  @Input({ required: true }) baselineJobMatch!: number;
  @Input({ required: true }) baselineConfirmed!: boolean;
  @Input({ required: true }) scenarioName!: string;
  @Input({ required: true }) experienceLevel!: string;
  @Output() loadScenarioRequested = new EventEmitter<SavedScenario>();
  @Output() compareWithScenarioRequested = new EventEmitter<SavedScenario>();
  @Output() closeCompareRequested = new EventEmitter<void>();
  @Output() deleteScenarioRequested = new EventEmitter<string>();
  @Output() loadMoreHistoryRequested = new EventEmitter<void>();
  @Output() showMobileHistoryChange = new EventEmitter<boolean>();
  @Output() benchmarkSelected = new EventEmitter<string>();
  get comparisonData() {
    return buildScenarioComparison(this);
  }
  onBenchmarkChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value) this.benchmarkSelected.emit(value);
  }
}
