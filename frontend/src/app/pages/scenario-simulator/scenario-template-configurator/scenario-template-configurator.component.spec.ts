import { TestBed } from '@angular/core/testing';
import { ScenarioContext } from '../../../shared/models/scenario-simulator.model';
import {
  configureScenarioTemplate,
  SCENARIO_TEMPLATES,
} from '../../../shared/models/scenario-template.model';
import { ScenarioTemplateConfiguratorComponent } from './scenario-template-configurator.component';

const context = {
  sources: ['skillGap', 'portfolio'].map((key) => ({ key, connected: true, status: 'available' })),
  signals: {
    missingSkills: ['Docker', 'TypeScript', 'Testing', 'docker'],
    completedPortfolioProjects: ['Old project'],
    portfolioCandidates: [
      { name: 'Old project', skills: ['Docker'] },
      { name: 'Container showcase', skills: ['Docker'] },
    ],
  },
} as unknown as ScenarioContext;

describe('Scenario template recommendations', () => {
  it('uses distinct compatible missing skills and one new complementary project', () => {
    const focused = configureScenarioTemplate(SCENARIO_TEMPLATES[0], context);
    expect(focused.skills.map((skill) => skill.toLowerCase())).toEqual([
      'docker',
      'typescript',
      'testing',
    ]);
    expect(focused.projects).toEqual([]);
    const portfolio = configureScenarioTemplate(SCENARIO_TEMPLATES[1], context);
    expect(portfolio.skills).toEqual([]);
    expect(portfolio.projects.map((project) => project.name)).toEqual(['Container showcase']);
    const balanced = configureScenarioTemplate(SCENARIO_TEMPLATES[2], context);
    expect(balanced.skills).toHaveLength(2);
    expect(balanced.projects[0].name).toBe('Container showcase');
    balanced.projects[0].name = 'Edited';
    expect(context.signals.portfolioCandidates![1].name).toBe('Container showcase');
  });
  it('leaves editable empty slots when sources are missing, stale or incompatible', () => {
    for (const template of SCENARIO_TEMPLATES) {
      for (const status of ['missing', 'stale', 'incompatible', 'error']) {
        const draft = configureScenarioTemplate(template, {
          ...context,
          sources: context.sources.map((source) => ({ ...source, status })),
        });
        expect(draft.skills.every((skill) => skill === '')).toBe(true);
        expect(draft.projects.every((project) => project.name === '')).toBe(true);
      }
      expect(configureScenarioTemplate(template, null).skills.every((skill) => !skill)).toBe(true);
    }
  });
  it('requires a skill overlap for Balanced Plan project suggestions', () => {
    expect(
      configureScenarioTemplate(SCENARIO_TEMPLATES[2], {
        ...context,
        signals: {
          ...context.signals,
          portfolioCandidates: [{ name: 'Other project', skills: ['Python'] }],
        },
      }).projects[0].name,
    ).toBe('');
  });
});

describe('Scenario template configurator', () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.open = true;
    });
    HTMLDialogElement.prototype.close = vi.fn();
    TestBed.configureTestingModule({ imports: [ScenarioTemplateConfiguratorComponent] });
  });
  it('keeps edits isolated, requires replacement consent and baseline confirmation for evaluation', () => {
    const fixture = TestBed.createComponent(ScenarioTemplateConfiguratorComponent);
    fixture.componentRef.setInput('template', SCENARIO_TEMPLATES[2]);
    fixture.componentRef.setInput('context', context);
    fixture.componentRef.setInput('dirty', true);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const emit = vi.spyOn(component.committed, 'emit');
    component.commit(false);
    expect(emit).not.toHaveBeenCalled();
    component.replaceConfirmed = true;
    component.commit(true);
    expect(emit).not.toHaveBeenCalled();
    component.draft.projects[0].impact = 0;
    component.commit(false);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        evaluate: false,
        draft: expect.objectContaining({ projects: [expect.objectContaining({ impact: 0 })] }),
      }),
    );
    component.baselineConfirmed = true;
    component.commit(true);
    expect(emit).toHaveBeenLastCalledWith(
      expect.objectContaining({ evaluate: true, baselineConfirmed: true }),
    );
    component.draft.projects[0].name = 'OLD PROJECT';
    expect(component.validationError).toContain('already recorded as completed');
    component.draft.projects[0].name = 'New';
    component.draft.projects[0].weeks = 0;
    expect(component.validationError).toContain('whole weeks');
    fixture.destroy();
  });
  it('cancels using the button and Escape without applying', () => {
    const fixture = TestBed.createComponent(ScenarioTemplateConfiguratorComponent);
    fixture.componentRef.setInput('template', SCENARIO_TEMPLATES[0]);
    fixture.detectChanges();
    const cancelled = vi.spyOn(fixture.componentInstance.cancelled, 'emit');
    const committed = vi.spyOn(fixture.componentInstance.committed, 'emit');
    (fixture.nativeElement.querySelector('footer button') as HTMLButtonElement).click();
    fixture.nativeElement
      .querySelector('dialog')
      .dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(cancelled).toHaveBeenCalledTimes(2);
    expect(committed).not.toHaveBeenCalled();
    fixture.destroy();
  });
});
