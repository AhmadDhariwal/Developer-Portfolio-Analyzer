import { ChangeDetectionStrategy, Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SimResult } from '../../../../shared/models/scenario-simulator.model';
import { ScenarioPresentation } from '../../utils/scenario-presentation';

@Component({
  selector: 'app-scenario-results',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './scenario-results.component.html',
  styleUrl: './scenario-results.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScenarioResultsComponent extends ScenarioPresentation {
  @Input({ required: true }) role!: string;
  @Input({ required: true }) durationWeeks!: number;
  @Input({ required: true }) isRunning!: boolean;
  @Input({ required: true }) isSavingScenario!: boolean;
  @Input({ required: true }) isCreatingSprint!: boolean;
  @Input({ required: true }) result!: SimResult | null;
  @Input({ required: true }) hasSimulated!: boolean;
  @Input({ required: true }) activeResultTab!: 'overview' | 'breakdown' | 'roadmap';
  @Input({ required: true }) isResultCurrent!: boolean;
  @Output() saveScenarioRequested = new EventEmitter<void>();
  @Output() createSprintDraftRequested = new EventEmitter<void>();
  @Output() activeResultTabChange = new EventEmitter<'overview' | 'breakdown' | 'roadmap'>();

  get hiringDelta(): number {
    return this.result?.improvements.hiringScore ?? 0;
  }
  get jobMatchDelta(): number {
    return this.result?.improvements.jobMatch ?? 0;
  }
  get breakdownRows(): Array<{ label: string; value: number; color: string }> {
    if (!this.result) return [];
    const breakdown = this.result.breakdown;
    return [
      { label: 'Skills', value: breakdown.skills, color: 'var(--color-primary-text)' },
      { label: 'Projects', value: breakdown.projects, color: 'var(--sim-success-text)' },
      { label: 'Synergy', value: breakdown.synergy, color: 'var(--color-warning-text)' },
      { label: 'Penalty', value: breakdown.penalty, color: 'var(--color-danger-text)' },
    ];
  }
  scrollTabs(direction: 'left' | 'right'): void {
    const el = document.getElementById('dossierNavTabs');
    if (el) {
      el.scrollBy({ left: direction === 'left' ? -180 : 180, behavior: 'smooth' });
    }
  }
  selectTab(tab: 'overview' | 'breakdown' | 'roadmap'): void {
    this.activeResultTabChange.emit(tab);
    setTimeout(() => {
      const el = document.getElementById(`dossierTab-${tab}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    }, 10);
  }
}
