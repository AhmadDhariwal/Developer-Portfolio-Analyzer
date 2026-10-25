import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ScenarioContext } from '../../../shared/models/scenario-simulator.model';
import {
  configureScenarioTemplate,
  ScenarioTemplateDefinition,
  ScenarioTemplateDraft,
} from '../../../shared/models/scenario-template.model';

@Component({
  selector: 'app-scenario-template-configurator',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './scenario-template-configurator.component.html',
  styleUrl: './scenario-template-configurator.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScenarioTemplateConfiguratorComponent implements OnInit, AfterViewInit, OnDestroy {
  @Input({ required: true }) template!: ScenarioTemplateDefinition;
  @Input() context: ScenarioContext | null = null;
  @Input() dirty = false;
  @Input() baselineConfirmed = false;
  @Input() baselineHiringScore = 0;
  @Input() baselineJobMatch = 0;
  @Output() cancelled = new EventEmitter<void>();
  @Output() committed = new EventEmitter<{
    draft: ScenarioTemplateDraft;
    evaluate: boolean;
    baselineConfirmed: boolean;
  }>();
  @ViewChild('dialog', { static: true }) dialog!: ElementRef<HTMLDialogElement>;
  draft!: ScenarioTemplateDraft;
  replaceConfirmed = false;
  private previousFocus: HTMLElement | null = null;

  ngOnInit(): void {
    this.draft = configureScenarioTemplate(this.template, this.context);
  }
  ngAfterViewInit(): void {
    this.previousFocus = document.activeElement as HTMLElement;
    this.dialog.nativeElement.showModal();
  }
  ngOnDestroy(): void {
    this.dialog.nativeElement.close();
    this.previousFocus?.focus();
  }
  get missingEvidence(): boolean {
    return (
      this.draft.skills.some((skill) => !skill.trim()) ||
      this.draft.projects.some((project) => !project.name.trim())
    );
  }
  get workloadWarning(): string {
    if (this.draft.projects.some((project) => project.weeks > this.draft.durationWeeks))
      return 'A project exceeds the scenario duration. Extend the timeline or reduce its scope.';
    return 'Skills and projects share this timeline. Workload and overload penalties are calculated by the engine when you evaluate.';
  }
  get validationError(): string {
    const plain = (value: string, limit: number) =>
      !!value.trim() && value.trim().length <= limit && !/[<>\u0000-\u001f\u007f]/.test(value);
    if (
      !Number.isInteger(this.draft.durationWeeks) ||
      this.draft.durationWeeks < 1 ||
      this.draft.durationWeeks > 24
    )
      return 'Choose a duration from 1 to 24 whole weeks.';
    const skills = this.draft.skills.filter((skill) => skill.trim());
    if (this.template.skillSlots && skills.length < 2)
      return 'Enter at least two skills; the third focused skill is optional.';
    if (
      skills.some((skill) => !plain(skill, 100)) ||
      new Set(skills.map((skill) => skill.trim().toLowerCase())).size !== skills.length
    )
      return 'Use distinct plain-text skills of up to 100 characters.';
    const completed = new Set(
      (this.context?.signals.completedPortfolioProjects || []).map((name) =>
        name.trim().toLowerCase(),
      ),
    );
    if (this.draft.projects.some((project) => completed.has(project.name.trim().toLowerCase())))
      return 'Choose new work. This project is already recorded as completed.';
    if (
      this.draft.projects.some(
        (project) =>
          !plain(project.name, 160) ||
          !Number.isFinite(project.impact) ||
          project.impact < 0 ||
          project.impact > 100 ||
          !Number.isInteger(project.weeks) ||
          project.weeks < 1 ||
          project.weeks > 24 ||
          !['low', 'medium', 'high'].includes(project.complexity),
      )
    )
      return 'Enter a project name, impact from 0–100, complexity and 1–24 whole weeks.';
    if (this.dirty && !this.replaceConfirmed)
      return 'Confirm replacement of your current draft before continuing.';
    return '';
  }
  commit(evaluate: boolean): void {
    if (this.validationError || (evaluate && !this.baselineConfirmed)) return;
    this.committed.emit({
      draft: {
        ...this.draft,
        skills: this.draft.skills.map((skill) => skill.trim()).filter(Boolean),
        projects: this.draft.projects.map((project) => ({ ...project, name: project.name.trim() })),
      },
      evaluate,
      baselineConfirmed: this.baselineConfirmed,
    });
  }
  trackIndex(index: number): number {
    return index;
  }
}
