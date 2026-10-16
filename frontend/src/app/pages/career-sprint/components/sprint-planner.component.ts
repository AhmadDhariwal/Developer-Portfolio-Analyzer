import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  EventEmitter,
  Input,
  OnChanges,
  OnInit,
  Output,
  inject,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';
import {
  AiPlanDraft,
  CareerSprint,
  CareerSprintService,
  GenerateAiTasksResponse,
} from '../../../shared/services/career-sprint.service';
import {
  calendarKey,
  formatSprintDate,
  sprintError,
  sprintZone,
} from '../utils/sprint-presentation';

@Component({
  selector: 'app-sprint-planner',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './sprint-planner.component.html',
  styleUrl: './sprint-planner.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SprintPlannerComponent implements OnInit, OnChanges {
  @Input({ required: true }) sprint!: CareerSprint;
  @Input() disabled = false;
  @Output() updated = new EventEmitter<CareerSprint>();
  @Output() refreshRequested = new EventEmitter<void>();
  private readonly destroyRef = inject(DestroyRef);
  private readonly api = inject(CareerSprintService);
  private readonly cdr = inject(ChangeDetectorRef);
  busy = '';
  message = '';
  failed = false;
  technology = '';
  draftName = '';
  preview: GenerateAiTasksResponse | null = null;
  selectedDraftId = '';
  selected = new Set<number>();
  acknowledgedFingerprint = '';
  private lastFingerprint = '';
  private lastSprintId = '';
  confirmDelete = false;
  scenarios: Array<{ _id: string; name: string }> = [];
  scenarioId = '';
  scenarioError = '';
  scenariosLoading = false;

  get draft(): AiPlanDraft | undefined {
    return this.sprint.aiPlans?.find((item) => item._id === this.selectedDraftId);
  }
  get tasks() {
    return this.draft?.tasks || this.preview?.tasks || [];
  }
  get requiresAcknowledgement(): boolean {
    return this.draft?.compatibility?.requiresAcknowledgement ?? Boolean(this.draft);
  }
  get acknowledged(): boolean {
    return Boolean(
      this.draft?.compatibility?.currentFingerprint &&
      this.acknowledgedFingerprint === this.draft.compatibility.currentFingerprint,
    );
  }

  ngOnInit(): void {
    this.loadScenarios();
  }
  ngOnChanges(): void {
    if (this.lastSprintId !== this.sprint._id) {
      this.preview = null;
      this.selectedDraftId = '';
      this.selected.clear();
      this.lastSprintId = this.sprint._id;
    }
    const fingerprint = this.draft?.compatibility?.currentFingerprint || '';
    if (fingerprint !== this.lastFingerprint) this.acknowledgedFingerprint = '';
    this.lastFingerprint = fingerprint;
  }

  loadScenarios(): void {
    if (this.scenariosLoading) return;
    this.scenariosLoading = true;
    this.api
      .getScenarios()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.scenarios = result.history || [];
          this.scenariosLoading = false;
          this.scenarioError = '';
          this.cdr.markForCheck();
        },
        error: () => {
          this.scenariosLoading = false;
          this.scenarioError = 'Saved scenarios could not be loaded.';
          this.cdr.markForCheck();
        },
      });
  }

  generate(ai = false): void {
    if (this.busy || this.disabled) return;
    this.busy = ai ? 'ai' : 'generate';
    this.message = '';
    const payload = {
      stack: this.sprint.goalStack || undefined,
      technology: this.technology || this.sprint.goalTechnology || undefined,
      experienceLevel: this.sprint.goalExperienceLevel || undefined,
      sprintStartDate:
        calendarKey(
          this.sprint.sprintStartDate || this.sprint.weekStartDate,
          sprintZone(this.sprint),
        ) || undefined,
      sprintEndDate:
        calendarKey(
          this.sprint.sprintEndDate || this.sprint.weekEndDate,
          sprintZone(this.sprint),
        ) || undefined,
    };
    (ai ? this.api.generateTrueAiPlan(payload) : this.api.generateAiTasks(payload))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.busy = '';
          this.preview = result;
          this.selectedDraftId = '';
          this.selected.clear();
          this.failed = false;
          this.draftName = `${this.technology || 'Career'} ${result.planMeta.generationMode === 'llm' ? 'AI' : 'Sprint'} plan`;
          this.message =
            ai && result.planMeta.generationMode !== 'llm'
              ? 'AI was unavailable. A deterministic fallback is ready to review.'
              : 'Preview ready. Review the tasks before saving a draft.';
          this.cdr.markForCheck();
        },
        error: (error) =>
          this.error(error, 'Planning failed. Your previous preview is still available.'),
      });
  }

  selectDraft(id: string): void {
    this.selectedDraftId = id;
    this.preview = null;
    this.selected.clear();
    this.acknowledgedFingerprint = '';
    this.confirmDelete = false;
    this.message = '';
    this.lastFingerprint = this.draft?.compatibility?.currentFingerprint || '';
  }
  toggle(index: number): void {
    this.selected.has(index) ? this.selected.delete(index) : this.selected.add(index);
  }
  selectAll(): void {
    this.selected = new Set(this.tasks.map((_, index) => index));
  }
  acknowledge(checked: boolean): void {
    this.acknowledgedFingerprint = checked
      ? this.draft?.compatibility?.currentFingerprint || ''
      : '';
  }

  save(): void {
    if (!this.preview?.tasks.length || this.disabled || this.busy || !this.draftName.trim()) return;
    const meta = this.preview.planMeta;
    this.mutate(
      'save',
      this.api.saveAiPlan(this.sprint._id, {
        name: this.draftName.trim(),
        summary: meta.summary,
        confidenceScore: meta.confidenceScore,
        consistencyScore: meta.consistencyScore,
        signalsUsed: meta.signalsUsed,
        generatorType: meta.generationMode || 'deterministic',
        tasks: this.preview.tasks,
      }),
      'Draft saved. Select it below to import tasks.',
      (sprint) => {
        this.selectedDraftId =
          sprint.aiPlans?.find((draft) => draft.name === this.draftName.trim())?._id || '';
        this.preview = null;
        this.selected.clear();
      },
    );
  }

  importSelected(): void {
    if (
      !this.draft ||
      !this.selected.size ||
      this.disabled ||
      this.busy ||
      (this.requiresAcknowledgement && !this.acknowledged)
    )
      return;
    this.mutate(
      'import',
      this.api.importDraft(
        this.sprint._id,
        this.draft._id,
        [...this.selected].sort((a, b) => a - b),
        this.requiresAcknowledgement ? this.acknowledgedFingerprint : undefined,
      ),
      'Selected tasks imported. Existing tasks were kept without duplicates.',
      () => this.selected.clear(),
    );
  }

  deleteDraft(): void {
    if (!this.draft || !this.confirmDelete || this.disabled || this.busy) return;
    this.mutate(
      'delete',
      this.api.deleteDraft(this.sprint._id, this.draft._id),
      'Draft deleted. Tasks already imported remain in your Sprint.',
      () => {
        this.selectedDraftId = '';
        this.confirmDelete = false;
        this.selected.clear();
      },
    );
  }

  importScenario(): void {
    if (!this.scenarioId || this.disabled || this.busy) return;
    this.mutate(
      'scenario',
      this.api.importScenarioPlan(this.sprint._id, this.scenarioId),
      'Scenario saved as a draft. Review it before adding tasks.',
      (sprint) => {
        this.selectedDraftId =
          [...(sprint.aiPlans || [])].reverse().find((draft) => draft.source === 'scenario')?._id ||
          '';
        this.preview = null;
        this.selected.clear();
        this.acknowledgedFingerprint = '';
      },
    );
  }

  date(value: string | null | undefined): string {
    const zone = this.preview?.planMeta.context?.timeZone;
    if (zone && !this.draft)
      return formatSprintDate(value, {
        ...this.sprint,
        timeZone: zone,
        legacyAccess: { readOnly: false, calendarStatus: 'recorded', reason: null, timeZone: zone },
      });
    return formatSprintDate(value, this.sprint);
  }
  private mutate(
    kind: string,
    request: Observable<CareerSprint>,
    message: string,
    done?: (sprint: CareerSprint) => void,
  ): void {
    this.busy = kind;
    this.message = '';
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (sprint) => {
        this.busy = '';
        done?.(sprint);
        this.failed = false;
        this.message = message;
        this.updated.emit(sprint);
        this.cdr.markForCheck();
      },
      error: (error) => this.error(error, 'The action could not be saved. Retry when ready.'),
    });
  }
  private error(error: unknown, fallback: string): void {
    this.busy = '';
    this.failed = true;
    this.message = sprintError(error, fallback);
    this.acknowledgedFingerprint = '';
    this.cdr.markForCheck();
  }
}
