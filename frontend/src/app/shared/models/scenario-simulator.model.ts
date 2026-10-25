export interface ProjectInput {
  name: string;
  impact: number;
  complexity: 'low' | 'medium' | 'high';
  weeks: number;
}

export interface SkillDetail {
  skill: string;
  pts: number;
  relevance: number;
  tier: 'core' | 'valuable' | 'transferable' | 'low';
  demand: number;
  difficulty: number;
}

export interface ProjectDetail {
  name: string;
  complexity: 'low' | 'medium' | 'high';
  weeks: number;
  impact: number;
  pts: number;
}

export interface ScenarioRange {
  hiringScore: number;
  jobMatch: number;
}

export interface SimResult {
  ruleVersion?: string;
  evaluation?: ScenarioEvaluation;
  support?: { kind: string; calibrated: boolean; label: string };
  scenarioHash: string;
  baseline: { hiringScore: number; jobMatch: number };
  predicted: { hiringScore: number; jobMatch: number };
  improvements: { hiringScore: number; jobMatch: number };
  confidenceScore: number;
  uncertaintyRange: {
    low: ScenarioRange;
    expected: ScenarioRange;
    high: ScenarioRange;
  };
  breakdown: { skills: number; projects: number; synergy: number; penalty: number; total: number };
  skillDetails: SkillDetail[];
  projectDetails: ProjectDetail[];
  insights: string[];
  warnings: string[];
  suggestions: string[];
  explainability?: {
    scoreDrivers: string[];
    penalties: string[];
    confidenceReason: string;
    effortVsDuration: string;
  };
  assumptions: {
    skillsConsidered: string[];
    projectsConsidered: ProjectInput[];
    notes: string[];
    sources: Array<{ label: string; connected: boolean; lastUpdatedAt: string | null }>;
    suggestedDurationWeeks: number;
  };
  meta: {
    role: string;
    level: string;
    durationWeeks: number;
    suggestedDurationWeeks: number;
    overloaded: boolean;
    skillsEffort: number;
    projectsEffort: number;
  };
}

export interface ScenarioSource {
  status?: string;
  evidenceClass?: string;
  key: string;
  label: string;
  connected: boolean;
  lastUpdatedAt: string | null;
}

export interface ScenarioContext {
  warnings?: string[];
  degraded?: boolean;
  profile: {
    careerStack: string;
    experienceLevel: string;
    githubUsername: string;
    role: string;
    level: string;
    baselineHiringScore: number;
    baselineJobMatch: number;
  };
  sources: ScenarioSource[];
  signals: {
    knownSkills: string[];
    missingSkills: string[];
    recommendationSkills: string[];
    sprintFocus: string[];
    connectedProviders: string[];
    portfolioProjects: string[];
    topDemandedSkills?: string[];
  };
  suggestedInputs: {
    role: string;
    experienceLevel: string;
    baselineHiringScore: number;
    baselineJobMatch: number;
    durationWeeks: number;
    skills: string[];
    projects: ProjectInput[];
  };
  summary: string;
  signalHash?: string;
  sourceContextSummary?: Record<string, unknown>;
  cache?: { hit: boolean; key: string; version: string };
}

export interface SavedScenario {
  _id: string;
  name: string;
  baselineHiringScore: number;
  baselineJobMatch: number;
  role: string;
  experienceLevel: string;
  durationWeeks: number;
  skills: string[];
  projects: ProjectInput[];
  confidenceScore: number;
  predicted: { hiringScore: number; jobMatch: number };
  improvements: { hiringScore: number; jobMatch: number };
  result: SimResult;
  scenarioHash?: string;
  sourceContextSummary?: Record<string, unknown>;
  warnings?: string[];
  uncertaintyRange?: SimResult['uncertaintyRange'];
  breakdown?: SimResult['breakdown'];
  createdAt: string;
}

export interface ScenarioInput {
  name?: string;
  ruleVersion?: string;
  baselineAuthority?: 'user-assumption';
  baselineConfirmed?: boolean;
  baselineHiringScore: number;
  baselineJobMatch: number;
  role?: string;
  experienceLevel?: string;
  durationWeeks?: number;
  skills: string[];
  projects: ProjectInput[];
  evaluation?: ScenarioEvaluation;
  scenarioId?: string;
  mode?: 'draft' | 'active-tasks';
  sprintId?: string;
}
export interface ScenarioEvaluation {
  ruleVersion: string;
  tableVersion: string;
  planHash: string;
  contextFingerprint: string;
  evaluationHash: string;
  normalizedInput: ScenarioInput;
  calculationContext: { sources: unknown[]; resumeConnected: boolean; githubConnected: boolean };
}
