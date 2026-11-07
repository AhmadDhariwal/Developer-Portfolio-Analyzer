import { ProjectInput, ScenarioContext } from './scenario-simulator.model';

export interface ScenarioTemplateDefinition {
  key: 'focused' | 'portfolio' | 'balanced';
  label: string;
  description: string;
  skillSlots: number;
  projectSlots: number;
  durationWeeks: number;
}

export interface ScenarioTemplateDraft {
  skills: string[];
  projects: ProjectInput[];
  durationWeeks: number;
}

export const SCENARIO_TEMPLATES: readonly ScenarioTemplateDefinition[] = [
  {
    key: 'focused',
    label: 'Focused Upskill',
    description: 'Close two or three gaps from compatible Skill Gap evidence.',
    skillSlots: 3,
    projectSlots: 0,
    durationWeeks: 4,
  },
  {
    key: 'portfolio',
    label: 'Portfolio Push',
    description: 'Build one planned portfolio project that has not already been completed.',
    skillSlots: 0,
    projectSlots: 1,
    durationWeeks: 6,
  },
  {
    key: 'balanced',
    label: 'Balanced Plan',
    description: 'Combine two relevant skills with one complementary portfolio project.',
    skillSlots: 2,
    projectSlots: 1,
    durationWeeks: 6,
  },
];

export function configureScenarioTemplate(
  template: ScenarioTemplateDefinition,
  context: ScenarioContext | null,
): ScenarioTemplateDraft {
  const available = (key: string) =>
    context?.sources.some(
      (source) => source.key === key && source.connected && source.status === 'available',
    );
  const missing = available('skillGap')
    ? [
        ...new Map(
          (context?.signals.missingSkills || []).map((skill) => [
            skill.trim().toLowerCase(),
            skill.trim(),
          ]),
        ).values(),
      ].filter(Boolean)
    : [];
  const skills = Array.from({ length: template.skillSlots }, (_, index) => missing[index] || '');
  const candidates = available('portfolio') ? context?.signals.portfolioCandidates || [] : [];
  const completed = new Set(
    (context?.signals.completedPortfolioProjects || []).map((name) => name.trim().toLowerCase()),
  );
  const project = candidates.find(
    (candidate) =>
      !completed.has(candidate.name.trim().toLowerCase()) &&
      (template.key !== 'balanced' ||
        candidate.skills.some((skill) =>
          skills.some((selected) => selected && selected.toLowerCase() === skill.toLowerCase()),
        )),
  );
  return {
    skills,
    projects: template.projectSlots
      ? [{ name: project?.name || '', impact: 70, complexity: 'medium', weeks: 3 }]
      : [],
    durationWeeks: template.durationWeeks,
  };
}
