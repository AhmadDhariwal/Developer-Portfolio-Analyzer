import {
  ProjectInput,
  ScenarioSource,
  SavedScenario,
  SimResult,
} from '../../../shared/models/scenario-simulator.model';
export interface ScenarioComparisonState {
  result: SimResult | null;
  baselineHiringScore: number;
  baselineJobMatch: number;
  baselineConfirmed: boolean;
  durationWeeks: number;
  scenarioName: string;
  skills: string[];
  projects: ProjectInput[];
  role: string;
  experienceLevel: string;
  compareScenario: SavedScenario | null;
}
export function buildScenarioComparison(state: ScenarioComparisonState) {
  if (!state.compareScenario) return null;
  const currentScore = state.result?.predicted?.hiringScore ?? state.baselineHiringScore;
  const currentMatch = state.result?.predicted?.jobMatch ?? state.baselineJobMatch;
  const currentFeasibility = state.result?.confidenceScore ?? (state.baselineConfirmed ? 80 : 60);
  const currentDuration = state.result?.meta?.durationWeeks ?? state.durationWeeks;
  const currentName =
    state.scenarioName?.trim() ||
    (state.result ? 'Current Simulated Plan' : 'Current Baseline Profile');

  const savedScore =
    state.compareScenario.result?.predicted?.hiringScore ??
    state.compareScenario.predicted?.hiringScore ??
    0;
  const savedMatch =
    state.compareScenario.result?.predicted?.jobMatch ??
    state.compareScenario.predicted?.jobMatch ??
    0;
  const savedFeasibility = state.compareScenario.confidenceScore ?? 0;
  const savedDuration = state.compareScenario.durationWeeks ?? 0;
  const savedName = state.compareScenario.name;

  const currentSkills = new Set((state.skills || []).map((s) => s.toLowerCase().trim()));
  const savedSkills = new Set(
    (state.compareScenario.skills || []).map((s) => s.toLowerCase().trim()),
  );

  const sharedSkills: string[] = [];
  const currentOnlySkills: string[] = [];
  const savedOnlySkills: string[] = [];

  (state.skills || []).forEach((s) => {
    if (savedSkills.has(s.toLowerCase().trim())) {
      sharedSkills.push(s);
    } else {
      currentOnlySkills.push(s);
    }
  });

  (state.compareScenario.skills || []).forEach((s) => {
    if (!currentSkills.has(s.toLowerCase().trim())) {
      savedOnlySkills.push(s);
    }
  });

  return {
    current: {
      name: currentName,
      hiringScore: currentScore,
      jobMatch: currentMatch,
      feasibility: currentFeasibility,
      duration: currentDuration,
      skillsCount: state.skills?.length || 0,
      projectsCount: state.projects?.length || 0,
      isSimulated: !!state.result,
      role: state.role,
      level: state.experienceLevel,
    },
    saved: {
      name: savedName,
      hiringScore: savedScore,
      jobMatch: savedMatch,
      feasibility: savedFeasibility,
      duration: savedDuration,
      skillsCount: state.compareScenario.skills?.length || 0,
      projectsCount: state.compareScenario.projects?.length || 0,
      role: state.compareScenario.role,
      level: state.compareScenario.experienceLevel,
      createdAt: state.compareScenario.createdAt,
    },
    deltas: {
      hiring: currentScore - savedScore,
      jobMatch: currentMatch - savedMatch,
      feasibility: currentFeasibility - savedFeasibility,
      duration: currentDuration - savedDuration,
    },
    skills: {
      shared: sharedSkills,
      currentOnly: currentOnlySkills,
      savedOnly: savedOnlySkills,
    },
    projects: {
      current: state.projects || [],
      saved: state.compareScenario.projects || [],
    },
  };
}
export class ScenarioPresentation {
  barWidth(value: number): number {
    return Math.min(100, Math.abs(value) * 2.5);
  }
  rangeWidth(start: number, end: number): number {
    return Math.max(2, end - start);
  }
  tierColor(tier: string): string {
    return (
      {
        core: 'var(--sim-success-text)',
        valuable: 'var(--color-info-text)',
        transferable: 'var(--color-warning-text)',
        low: 'var(--color-danger-text)',
      }[tier] || 'var(--text-muted)'
    );
  }
  tierLabel(tier: string): string {
    return (
      { core: 'Core', valuable: 'Valuable', transferable: 'Transferable', low: 'Low Relevance' }[
        tier
      ] || tier
    );
  }
  scoreColor(score: number): string {
    if (score >= 80) return 'var(--sim-success-text)';
    if (score >= 60) return 'var(--color-warning-text)';
    return 'var(--color-danger-text)';
  }
  deltaLabel(value: number): string {
    return value >= 0 ? `+${value}` : `${value}`;
  }
  formatRole(value: string): string {
    return value === 'ai/ml' ? 'AI / ML' : value.replace(/\b\w/g, (letter) => letter.toUpperCase());
  }
  formatDate(value: string | null | undefined): string {
    if (!value) return 'Not available';
    return new Date(value).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }
  trackBySkill(_: number, skill: string): string {
    return skill;
  }
  trackByProject(_: number, project: ProjectInput): string {
    return `${project.name}-${project.weeks}-${project.impact}`;
  }
  trackByProjectInput(index: number): number {
    return index;
  }
  trackByHistory(_: number, scenario: SavedScenario): string {
    return scenario._id;
  }
  trackBySource(_: number, source: ScenarioSource): string {
    return source.key;
  }
}
