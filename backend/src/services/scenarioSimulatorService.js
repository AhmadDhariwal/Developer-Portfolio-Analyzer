/**
 * Scenario Simulator Service - Career Growth Simulation Engine
 *
 * Scoring formula:
 *   finalScore = baseline + skillImpact + projectImpact + synergy - penalty
 *   capped at max +40 improvement
 */

const crypto = require('node:crypto');
const Analysis = require('../models/analysis');
const CareerSprint = require('../models/careerSprint');
const IntegrationConnection = require('../models/integrationConnection');
const IntegrationInsight = require('../models/integrationInsight');
const PublicProfile = require('../models/publicProfile');
const Recommendation = require('../models/recommendation');
const ResumeAnalysis = require('../models/resumeAnalysis');
const ScenarioSimulation = require('../models/scenarioSimulation');
const SkillGraph = require('../models/skillGraph');
const User = require('../models/user');
const roleWeights = require('../utils/roleWeights');
const skillDifficulty = require('../utils/skillDifficulty');
const marketDemand = require('../utils/marketDemand');
const {
  estimateSkillsEffort,
  estimateProjectsEffort,
  calcOverloadPenalty
} = require('../utils/timeEstimator');
const { createSprint } = require('./careerSprintService');
const { getDeveloperSignals, buildSignalHash } = require('./developerSignalService');

const clamp = (v, min = 0, max = 100) => Math.max(min, Math.min(max, Math.round(Number(v) || 0)));
const clampFloat = (v, min = 0, max = 100) => Math.max(min, Math.min(max, Number(v) || 0));
const round1 = (v) => Math.round(Number(v || 0) * 10) / 10;
const average = (values = [], fallback = 0) => {
  const valid = values.filter((value) => Number.isFinite(Number(value)) && Number(value) > 0).map(Number);
  if (!valid.length) return fallback;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
};

const MAX_IMPROVEMENT = 40;
const MAX_SKILLS = 10;
const MAX_PROJECTS = 5;
const SCENARIO_CONTEXT_VERSION = 'scenario-context-v2';
const SCENARIO_HISTORY_VERSION = 'scenario-history-v1';
const contextCache = new Map();
const historyCache = new Map();

const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = stableValue(value[key]);
        return acc;
      }, {});
  }
  return value;
};

const hashPayload = (payload = {}) => crypto
  .createHash('sha256')
  .update(JSON.stringify(stableValue(payload)))
  .digest('hex');

const buildScenarioHash = (input = {}) => hashPayload({
  baselineHiringScore: clamp(input.baselineHiringScore),
  baselineJobMatch: clamp(input.baselineJobMatch),
  role: normalizeRole(input.role),
  experienceLevel: normalizeLevel(input.experienceLevel),
  durationWeeks: clamp(input.durationWeeks || 6, 1, 24),
  skills: uniqueStrings(input.skills || [], MAX_SKILLS).map((skill) => skill.toLowerCase()).sort(),
  projects: (input.projects || [])
    .map((project) => ({
      name: String(project?.name || '').trim().toLowerCase(),
      impact: clamp(project?.impact, 0, 100),
      complexity: ['low', 'medium', 'high'].includes(project?.complexity) ? project.complexity : 'medium',
      weeks: clamp(project?.weeks, 1, 24)
    }))
    .filter((project) => project.name)
    .sort((left, right) => left.name.localeCompare(right.name))
});

const buildContextCacheKey = ({ userId, signalHash, careerProfile }) => hashPayload({
  version: SCENARIO_CONTEXT_VERSION,
  userId: String(userId || ''),
  signalHash,
  careerProfile: {
    careerStack: careerProfile?.careerStack || '',
    experienceLevel: careerProfile?.experienceLevel || '',
    careerGoal: careerProfile?.careerGoal || '',
    githubUsername: careerProfile?.activeGithubUsername || careerProfile?.githubUsername || ''
  }
});

const buildHistoryCacheKey = (userId, limit) => `${SCENARIO_HISTORY_VERSION}:${String(userId || '')}:${clamp(limit, 1, 20)}`;

const invalidateHistoryCache = (userId) => {
  const prefix = `${SCENARIO_HISTORY_VERSION}:${String(userId || '')}:`;
  Array.from(historyCache.keys())
    .filter((key) => key.startsWith(prefix))
    .forEach((key) => historyCache.delete(key));
};

const ROLE_ALIASES = {
  frontend: 'frontend',
  'front end': 'frontend',
  backend: 'backend',
  'back end': 'backend',
  'full stack': 'full stack',
  fullstack: 'full stack',
  'ai/ml': 'ai/ml',
  ai: 'ai/ml',
  ml: 'ai/ml',
  'machine learning': 'ai/ml',
  devops: 'devops',
  cloud: 'devops',
  infra: 'devops'
};

const LEVEL_ALIASES = {
  junior: 'junior',
  student: 'junior',
  intern: 'junior',
  '0-1 years': 'junior',
  '1-2 years': 'mid',
  mid: 'mid',
  'mid-level': 'mid',
  intermediate: 'mid',
  senior: 'senior',
  lead: 'senior',
  staff: 'senior',
  '5+ years': 'senior'
};

const ROLE_CORE_SKILLS = {
  frontend: ['react', 'angular', 'vue', 'javascript', 'typescript', 'css', 'html', 'next.js'],
  backend: ['node.js', 'node', 'python', 'java', 'golang', 'express', 'django', 'fastapi', 'spring boot'],
  'full stack': ['react', 'angular', 'vue', 'node.js', 'node', 'python', 'javascript', 'typescript'],
  'ai/ml': ['python', 'machine learning', 'deep learning', 'pytorch', 'tensorflow', 'scikit-learn', 'pandas'],
  devops: ['docker', 'kubernetes', 'aws', 'azure', 'gcp', 'terraform', 'ci/cd', 'linux']
};

const ROLE_LABELS = {
  frontend: 'Frontend Developer',
  backend: 'Backend Developer',
  'full stack': 'Full Stack Developer',
  'ai/ml': 'AI/ML Engineer',
  devops: 'DevOps Engineer'
};

const LEVEL_SKILL_MULT = { junior: 1.3, mid: 1.0, senior: 0.75 };
const LEVEL_PROJECT_MULT = { junior: 1.2, mid: 1.0, senior: 0.8 };
const COMPLEXITY_WEIGHT = { low: 0.8, medium: 1.0, high: 1.3 };

const normalizeRole = (role = '') => {
  const raw = String(role || '').toLowerCase().trim();
  if (!raw) return 'full stack';
  if (ROLE_ALIASES[raw]) return ROLE_ALIASES[raw];
  if (raw.includes('front')) return 'frontend';
  if (raw.includes('back')) return 'backend';
  if (raw.includes('full')) return 'full stack';
  if (raw.includes('ai') || raw.includes('ml') || raw.includes('machine')) return 'ai/ml';
  if (raw.includes('devops') || raw.includes('cloud') || raw.includes('infra')) return 'devops';
  return 'full stack';
};

const normalizeLevel = (level = '') => {
  const raw = String(level || '').toLowerCase().trim();
  if (!raw) return 'mid';
  if (LEVEL_ALIASES[raw]) return LEVEL_ALIASES[raw];
  if (raw.includes('junior') || raw.includes('student') || raw.includes('intern') || raw.includes('0-1')) return 'junior';
  if (raw.includes('senior') || raw.includes('lead') || raw.includes('staff') || raw.includes('5+')) return 'senior';
  return 'mid';
};

const uniqueStrings = (values = [], limit = 12) => {
  const seen = new Set();
  const result = [];

  for (const value of Array.isArray(values) ? values : []) {
    const safeValue = String(value || '').trim();
    const key = safeValue.toLowerCase();
    if (!safeValue || seen.has(key)) continue;
    seen.add(key);
    result.push(safeValue);
    if (result.length >= limit) break;
  }

  return result;
};

const uniqueStringsWithWarnings = (values = [], limit = 12, label = 'item') => {
  const seen = new Set();
  const result = [];
  const duplicates = [];

  for (const value of Array.isArray(values) ? values : []) {
    const safeValue = String(value || '').trim();
    const key = safeValue.toLowerCase();
    if (!safeValue) continue;
    if (seen.has(key)) {
      duplicates.push(safeValue);
      continue;
    }
    seen.add(key);
    result.push(safeValue);
    if (result.length >= limit) break;
  }

  return {
    values: result,
    warnings: duplicates.length
      ? [`Removed duplicate ${label}${duplicates.length === 1 ? '' : 's'}: ${uniqueStrings(duplicates, 6).join(', ')}.`]
      : []
  };
};

const sanitizeProjects = (projects = []) => {
  const clean = [];
  const errors = [];
  const warnings = [];
  const seen = new Set();

  (Array.isArray(projects) ? projects : []).slice(0, MAX_PROJECTS).forEach((project, index) => {
    const name = String(project?.name || '').trim();
    const rawImpact = Number(project?.impact);
    const rawWeeks = Number(project?.weeks);
    const complexity = String(project?.complexity || 'medium').toLowerCase().trim();
    const hasProjectInput = name || project?.impact !== undefined || project?.weeks !== undefined || project?.complexity !== undefined;

    if (!name) {
      if (hasProjectInput) {
        errors.push({ field: `projects[${index}].name`, message: 'Project name is required.' });
      }
      return;
    }

    const key = name.toLowerCase();
    if (seen.has(key)) {
      warnings.push(`Removed duplicate project: ${name}.`);
      return;
    }
    seen.add(key);

    if (!Number.isFinite(rawImpact) || rawImpact < 0 || rawImpact > 100) {
      errors.push({ field: `projects[${index}].impact`, message: 'Project impact must be between 0 and 100.' });
    }
    if (!Number.isFinite(rawWeeks) || rawWeeks < 1 || rawWeeks > 24) {
      errors.push({ field: `projects[${index}].weeks`, message: 'Project estimated weeks must be between 1 and 24.' });
    }
    if (!['low', 'medium', 'high'].includes(complexity)) {
      errors.push({ field: `projects[${index}].complexity`, message: 'Project complexity must be low, medium, or high.' });
    }

    clean.push({
      name,
      impact: clamp(rawImpact, 0, 100),
      weeks: clamp(rawWeeks, 1, 24),
      complexity: ['low', 'medium', 'high'].includes(complexity) ? complexity : 'medium'
    });
  });

  return { clean, errors, warnings };
};

const sanitizeScenarioInput = (payload = {}, options = {}) => {
  const requirePlan = options.requirePlan !== false;
  const errors = [];
  const warnings = [];
  const baselineHiringScore = Number(payload.baselineHiringScore);
  const baselineJobMatch = Number(payload.baselineJobMatch);

  if (!Number.isFinite(baselineHiringScore) || baselineHiringScore < 0 || baselineHiringScore > 100) {
    errors.push({ field: 'baselineHiringScore', message: 'Baseline hiring score must be between 0 and 100.' });
  }
  if (!Number.isFinite(baselineJobMatch) || baselineJobMatch < 0 || baselineJobMatch > 100) {
    errors.push({ field: 'baselineJobMatch', message: 'Baseline job match must be between 0 and 100.' });
  }

  const role = normalizeRole(payload.role);
  const experienceLevel = normalizeLevel(payload.experienceLevel);
  const rawDurationWeeks = Number(payload.durationWeeks || 6);
  if (!Number.isFinite(rawDurationWeeks) || rawDurationWeeks < 1 || rawDurationWeeks > 24) {
    errors.push({ field: 'durationWeeks', message: 'Duration must be between 1 and 24 weeks.' });
  }
  const durationWeeks = clamp(rawDurationWeeks, 1, 24);
  const dedupedSkills = uniqueStringsWithWarnings(payload.skills, MAX_SKILLS, 'skill');
  const skills = dedupedSkills.values;
  warnings.push(...dedupedSkills.warnings);
  const { clean: projects, errors: projectErrors, warnings: projectWarnings } = sanitizeProjects(payload.projects);
  errors.push(...projectErrors);
  warnings.push(...projectWarnings);

  if (requirePlan && !skills.length && !projects.length) {
    errors.push({ field: 'plan', message: 'Add at least one skill or project to simulate.' });
  }

  return {
    isValid: errors.length === 0,
    errors,
    value: {
      baselineHiringScore: clamp(baselineHiringScore),
      baselineJobMatch: clamp(baselineJobMatch),
      role,
      experienceLevel,
      durationWeeks,
      skills,
      projects,
      inputWarnings: warnings
    },
    warnings
  };
};

const getRoleWeight = (role, skillName) => {
  const weights = roleWeights[role] || roleWeights.default;
  const key = String(skillName).toLowerCase().trim();
  return weights[key] ?? weights.default ?? 1;
};

const getDifficulty = (skillName) => {
  const key = String(skillName).toLowerCase().trim();
  return skillDifficulty[key] ?? skillDifficulty.default;
};

const getDemand = (skillName) => {
  const key = String(skillName).toLowerCase().trim();
  return marketDemand[key] ?? marketDemand.default;
};

const skillRelevanceTier = (weight) => {
  if (weight >= 1.4) return 'core';
  if (weight >= 1.1) return 'valuable';
  if (weight >= 0.9) return 'transferable';
  return 'low';
};

const computeSkillImpact = (skills, role, level) => {
  if (!skills.length) return { total: 0, perSkill: [] };

  const levelMult = LEVEL_SKILL_MULT[level] || 1;
  let total = 0;
  const perSkill = [];

  skills.forEach((skill, index) => {
    const relevance = getRoleWeight(role, skill);
    const difficulty = getDifficulty(skill);
    const demand = getDemand(skill);
    const diminish = index < 3 ? 1 : index < 6 ? 0.7 : 0.4;
    const pts = relevance * difficulty * demand * diminish * levelMult * 4.5;
    total += pts;
    perSkill.push({
      skill,
      pts: round1(pts),
      relevance: round1(relevance),
      tier: skillRelevanceTier(relevance),
      demand: round1(demand),
      difficulty: round1(difficulty)
    });
  });

  return { total: Math.min(22, total), perSkill };
};

const computeProjectImpact = (projects, level) => {
  if (!projects.length) return { total: 0, perProject: [] };

  const levelMult = LEVEL_PROJECT_MULT[level] || 1;
  let total = 0;
  const perProject = [];

  projects.forEach((project, index) => {
    const complexityWeight = COMPLEXITY_WEIGHT[project.complexity] || 1;
    const weeks = Math.min(12, Number(project.weeks) || 3);
    const durationWeight = 0.7 + weeks / 20;
    const impactNorm = (Number(project.impact) || 65) / 100;
    const diminish = index === 0 ? 1 : index === 1 ? 0.8 : 0.6;
    const pts = complexityWeight * durationWeight * impactNorm * diminish * levelMult * 12;
    total += pts;
    perProject.push({
      name: project.name,
      complexity: project.complexity,
      weeks,
      impact: project.impact,
      pts: round1(pts)
    });
  });

  return { total: Math.min(22, total), perProject };
};

const computeSynergy = (skills, projects) => {
  if (!skills.length || !projects.length) return 0;

  let matches = 0;
  skills.forEach((skill) => {
    const normalizedSkill = skill.toLowerCase();
    projects.forEach((project) => {
      const name = String(project.name || '').toLowerCase();
      const firstWord = name.split(/\s+/).filter(Boolean)[0] || '';
      if (name.includes(normalizedSkill) || (firstWord && normalizedSkill.includes(firstWord))) {
        matches += 1;
      }
    });
  });

  const base = Math.min(6, skills.length * 0.8 + projects.length * 0.6);
  const matchBonus = Math.min(5, matches * 1.5);
  return Math.min(10, base + matchBonus);
};

const suggestDurationWeeks = (skillsEffort, projectsEffort, durationWeeks, overloaded) => {
  const totalEffort = Number(skillsEffort || 0) + Number(projectsEffort || 0);
  const capacityPerWeek = 6.5;
  const realistic = Math.max(2, Math.min(20, Math.ceil(totalEffort / capacityPerWeek)));
  return overloaded ? Math.max(durationWeeks + 2, realistic) : Math.max(durationWeeks, realistic);
};

const buildConfidenceScore = ({ cleanSkills, cleanProjects, duration, overloaded, penalty, perSkillData, resumeConnected, githubConnected }) => {
  const avgRelevance = average(perSkillData.map((skill) => skill.relevance), cleanProjects.length ? 1.1 : 1);
  const evidenceScore = average([
    cleanSkills.length >= 3 ? 90 : cleanSkills.length ? 72 : 52,
    cleanProjects.length >= 2 ? 88 : cleanProjects.length ? 70 : 48,
    resumeConnected ? 82 : 62,
    githubConnected ? 84 : 64
  ], 62);
  const realismScore = overloaded ? Math.max(35, 74 - penalty * 5) : Math.min(94, 72 + duration * 1.6);
  const relevanceScore = clampFloat(avgRelevance * 58, 35, 95);
  return clamp((evidenceScore * 0.4) + (realismScore * 0.35) + (relevanceScore * 0.25), 28, 96);
};

const buildUncertaintyRange = ({
  predictedHiringScore,
  predictedJobMatch,
  totalImprovement,
  confidenceScore,
  penalty,
  overloaded
}) => {
  const variance = clampFloat((100 - confidenceScore) / 6 + Math.max(0, penalty) * 0.35 + (overloaded ? 2.5 : 0), 2, 18);
  const hiringVariance = Math.max(2, Math.round(Math.min(variance, totalImprovement || variance)));
  const jobVariance = Math.max(2, Math.round(Math.min(variance * 1.1, Math.max(totalImprovement * 0.9, 2))));

  return {
    low: {
      hiringScore: clamp(predictedHiringScore - hiringVariance),
      jobMatch: clamp(predictedJobMatch - jobVariance)
    },
    expected: {
      hiringScore: clamp(predictedHiringScore),
      jobMatch: clamp(predictedJobMatch)
    },
    high: {
      hiringScore: clamp(predictedHiringScore + hiringVariance),
      jobMatch: clamp(predictedJobMatch + jobVariance)
    }
  };
};

const buildAssumptions = ({ cleanSkills, cleanProjects, duration, normalizedRole, normalizedLevel, confidenceScore, suggestedDurationWeeks, sources }) => ({
  skillsConsidered: cleanSkills,
  projectsConsidered: cleanProjects.map((project) => ({
    name: project.name,
    complexity: project.complexity,
    weeks: project.weeks,
    impact: project.impact
  })),
  notes: [
    `Predictions are tuned for ${ROLE_LABELS[normalizedRole] || normalizedRole} pathways.`,
    `Current plan assumes ${duration} weeks of focused effort at ${normalizedLevel} pace.`,
    confidenceScore < 65
      ? 'Confidence is reduced because the plan is either overloaded or missing supporting evidence from your profile signals.'
      : 'Confidence is stronger because the plan aligns with your role and the available profile signals.'
  ],
  sources: sources
    .filter((source) => source.connected)
    .map((source) => ({ label: source.label, connected: source.connected, lastUpdatedAt: source.lastUpdatedAt })),
  suggestedDurationWeeks
});

const buildExplainability = ({ breakdown, perSkillData, projectDetails, penalty, confidenceScore, duration, suggestedDurationWeeks }) => {
  const scoreDrivers = [
    ...perSkillData
      .filter((skill) => Number(skill.pts || 0) > 0)
      .slice(0, 4)
      .map((skill) => `${skill.skill} contributed +${skill.pts} from ${skill.tier} role fit and ${skill.demand}x demand.`),
    ...projectDetails
      .filter((project) => Number(project.pts || 0) > 0)
      .slice(0, 3)
      .map((project) => `${project.name} contributed +${project.pts} from ${project.complexity} complexity, ${project.weeks} weeks, and ${project.impact}/100 impact.`)
  ];

  if (breakdown.synergy > 0) {
    scoreDrivers.push(`Skill/project alignment added +${breakdown.synergy} synergy points.`);
  }

  const penalties = [];
  if (penalty > 0) {
    penalties.push(`Overload reduced the estimate by ${Math.round(penalty)} points because the effort exceeds the selected ${duration}-week window.`);
  }
  if (breakdown.total >= MAX_IMPROVEMENT - 2) {
    penalties.push(`The max improvement cap limited the result to a realistic +${MAX_IMPROVEMENT} point ceiling.`);
  }

  return {
    scoreDrivers,
    penalties,
    confidenceReason: confidenceScore >= 80
      ? 'High confidence: role fit, evidence, and timeline are aligned.'
      : confidenceScore >= 60
        ? 'Moderate confidence: useful plan, but evidence or timeline realism leaves some uncertainty.'
        : 'Lower confidence: the plan needs stronger evidence, narrower scope, or more time.',
    effortVsDuration: duration >= suggestedDurationWeeks
      ? `The selected ${duration}-week duration is realistic for the estimated effort.`
      : `The selected ${duration}-week duration is aggressive; ${suggestedDurationWeeks} weeks is more realistic.`
  };
};

const generateInsights = ({
  skills,
  projects,
  role,
  level,
  breakdown,
  overloadWarning,
  durationWeeks,
  perSkillData,
  suggestedDurationWeeks,
  confidenceScore
}) => {
  const insights = [];
  const warnings = [];
  const suggestions = [];

  const roleLabel = ROLE_LABELS[role] || role;
  const coreSkills = ROLE_CORE_SKILLS[role] || [];

  perSkillData.forEach(({ skill, tier, relevance }) => {
    if (tier === 'core') {
      insights.push(`${skill} is a core skill for ${roleLabel} roles and gives this plan strong relevance.`);
      return;
    }
    if (tier === 'valuable') {
      insights.push(`${skill} is a valuable addition for ${roleLabel} roles and meaningfully improves your match.`);
      return;
    }
    if (tier === 'transferable') {
      insights.push(`${skill} adds transferable value, but it is not a primary requirement for ${roleLabel} openings.`);
      return;
    }

    warnings.push(
      `${skill} has low relevance for ${roleLabel} roles (weight ${relevance}). It will add only limited score improvement.`
    );
  });

  const addedLower = skills.map((skill) => skill.toLowerCase());
  const missingCore = coreSkills.filter((skill) => !addedLower.some((entry) => entry.includes(skill) || skill.includes(entry)));
  if (missingCore.length && skills.length) {
    suggestions.push(`To strengthen this ${roleLabel} plan, consider adding ${missingCore.slice(0, 3).join(', ')}.`);
  }
  if (!skills.length) {
    suggestions.push(`Add role-aligned skills such as ${coreSkills.slice(0, 4).join(', ')} to make the scenario more realistic.`);
  }

  if (projects.length) {
    if (projects.some((project) => project.complexity === 'high')) {
      insights.push('A higher-complexity project increases the practical depth signal in this scenario.');
    }
    if (projects.some((project) => Number(project.weeks) >= 6)) {
      insights.push('Longer projects add credibility by showing sustained execution over time.');
    }
    if (projects.every((project) => project.complexity === 'low')) {
      suggestions.push('Add at least one medium or high complexity project to avoid a shallow project signal.');
    }
  }

  if (breakdown.synergy >= 5) {
    insights.push('Strong skill-to-project synergy detected. Your project choices reinforce the skills you want to learn.');
  } else if (skills.length && projects.length && breakdown.synergy < 2) {
    suggestions.push('Align project titles and scope more closely with the selected skills to improve synergy.');
  }

  if (overloadWarning) warnings.push(overloadWarning);

  if (durationWeeks < suggestedDurationWeeks) {
    warnings.push(`This plan likely needs closer to ${suggestedDurationWeeks} weeks to land consistently without quality drop-offs.`);
  }

  if (level === 'junior') {
    suggestions.push('As a junior profile, focus on depth in 2 to 3 core skills rather than spreading too wide.');
  } else if (level === 'senior') {
    suggestions.push('For senior pathways, pair implementation skills with system design, architecture, and leadership examples.');
  }

  if (breakdown.total >= 35) {
    warnings.push('The improvement cap is nearly saturated. Additional items beyond this point will have diminishing returns.');
  }

  if (confidenceScore < 60) {
    warnings.push('Confidence is moderate because the simulator has limited evidence or the plan is aggressive for the selected timeline.');
  } else if (confidenceScore >= 80) {
    insights.push('Confidence is strong because the plan fits your role, timeline, and available analysis signals.');
  }

  return { insights, warnings, suggestions };
};

const simulateHiringOutcome = (payload = {}, signalContext = {}) => {
  const normalizedInput = sanitizeScenarioInput(payload, { requirePlan: false }).value;
  const normalizedRole = normalizeRole(normalizedInput.role);
  const normalizedLevel = normalizeLevel(normalizedInput.experienceLevel);
  const duration = clamp(normalizedInput.durationWeeks || 6, 1, 24);
  const cleanSkills = uniqueStrings(normalizedInput.skills, MAX_SKILLS);
  const cleanProjects = sanitizeProjects(normalizedInput.projects).clean;

  const { total: skillImpact, perSkill: perSkillData } = computeSkillImpact(cleanSkills, normalizedRole, normalizedLevel);
  const { total: projectImpact, perProject: projectDetails } = computeProjectImpact(cleanProjects, normalizedLevel);
  const synergy = computeSynergy(cleanSkills, cleanProjects);

  const skillsEffort = estimateSkillsEffort(cleanSkills);
  const projectsEffort = estimateProjectsEffort(cleanProjects);
  const { penalty, warning: overloadWarning } = calcOverloadPenalty(skillsEffort, projectsEffort, duration);

  const rawImprovement = skillImpact + projectImpact + synergy - penalty;
  const totalImprovement = Math.min(MAX_IMPROVEMENT, Math.max(0, rawImprovement));

  const predictedHiringScore = clamp(Number(normalizedInput.baselineHiringScore) + totalImprovement);
  const jobMatchImprovement = Math.round(totalImprovement * 0.72);
  const predictedJobMatch = clamp(Number(normalizedInput.baselineJobMatch) + jobMatchImprovement);

  const suggestedDurationWeeks = suggestDurationWeeks(skillsEffort, projectsEffort, duration, !!overloadWarning);
  const sources = Array.isArray(signalContext.sources) ? signalContext.sources : [];
  const confidenceScore = buildConfidenceScore({
    cleanSkills,
    cleanProjects,
    duration,
    overloaded: !!overloadWarning,
    penalty,
    perSkillData,
    resumeConnected: !!signalContext.resumeConnected,
    githubConnected: !!signalContext.githubConnected
  });
  const uncertaintyRange = buildUncertaintyRange({
    predictedHiringScore,
    predictedJobMatch,
    totalImprovement,
    confidenceScore,
    penalty,
    overloaded: !!overloadWarning
  });

  const breakdown = {
    skills: Math.round(skillImpact),
    projects: Math.round(projectImpact),
    synergy: Math.round(synergy),
    penalty: -Math.round(penalty),
    total: Math.round(totalImprovement)
  };

  const { insights, warnings, suggestions } = generateInsights({
    skills: cleanSkills,
    projects: cleanProjects,
    role: normalizedRole,
    level: normalizedLevel,
    breakdown,
    overloadWarning,
    durationWeeks: duration,
    perSkillData,
    suggestedDurationWeeks,
    confidenceScore
  });
  const inputWarnings = Array.isArray(normalizedInput.inputWarnings) ? normalizedInput.inputWarnings : [];
  const scenarioHash = buildScenarioHash(normalizedInput);
  const explainability = buildExplainability({
    breakdown,
    perSkillData,
    projectDetails,
    penalty,
    confidenceScore,
    duration,
    suggestedDurationWeeks
  });

  return {
    scenarioHash,
    baseline: {
      hiringScore: clamp(normalizedInput.baselineHiringScore),
      jobMatch: clamp(normalizedInput.baselineJobMatch)
    },
    predicted: {
      hiringScore: predictedHiringScore,
      jobMatch: predictedJobMatch
    },
    improvements: {
      hiringScore: predictedHiringScore - clamp(normalizedInput.baselineHiringScore),
      jobMatch: predictedJobMatch - clamp(normalizedInput.baselineJobMatch)
    },
    confidenceScore,
    uncertaintyRange,
    breakdown,
    skillDetails: perSkillData,
    projectDetails,
    insights,
    warnings: uniqueStrings([...inputWarnings, ...warnings], 12),
    suggestions,
    explainability,
    assumptions: buildAssumptions({
      cleanSkills,
      cleanProjects,
      duration,
      normalizedRole,
      normalizedLevel,
      confidenceScore,
      suggestedDurationWeeks,
      sources
    }),
    meta: {
      role: normalizedRole,
      level: normalizedLevel,
      durationWeeks: duration,
      suggestedDurationWeeks,
      skillsEffort: round1(skillsEffort),
      projectsEffort: round1(projectsEffort),
      overloaded: !!overloadWarning
    }
  };
};

const mapResumeSkills = (resumeAnalysis) => {
  if (!resumeAnalysis?.skills) return [];
  const values = resumeAnalysis.skills instanceof Map
    ? Array.from(resumeAnalysis.skills.values())
    : Object.values(resumeAnalysis.skills || {});
  return uniqueStrings(values.flat(), 12);
};

const mapCareerStackToRole = (careerStack = '') => normalizeRole(careerStack);

const deriveProjectFromPublicItem = (item) => {
  const name = String(item?.title || '').trim();
  if (!name) return null;
  const techCount = Array.isArray(item?.tech) ? item.tech.length : Array.isArray(item?.techStack) ? item.techStack.length : 0;
  const complexity = techCount >= 5 ? 'high' : techCount >= 3 ? 'medium' : 'low';
  const impact = clamp(
    (item?.url ? 20 : 0) +
    (item?.repoUrl ? 18 : 0) +
    (String(item?.description || '').length > 120 ? 20 : 8) +
    (techCount * 8),
    45,
    92
  );
  const weeks = complexity === 'high' ? 6 : complexity === 'medium' ? 4 : 3;

  return { name, complexity, impact, weeks };
};

const buildSourceContextSummary = (context = {}, signalHash = '') => ({
  signalHash,
  careerStack: context.profile?.careerStack || '',
  experienceLevel: context.profile?.experienceLevel || '',
  baselineHiringScore: context.profile?.baselineHiringScore || 0,
  baselineJobMatch: context.profile?.baselineJobMatch || 0,
  connectedSources: (context.sources || []).filter((source) => source.connected).map((source) => source.key),
  suggestedSkillCount: context.suggestedInputs?.skills?.length || 0,
  suggestedProjectCount: context.suggestedInputs?.projects?.length || 0
});

const getScenarioContext = async (userId, options = {}) => {
  const developerSignals = await getDeveloperSignals(userId);
  const signalHash = buildSignalHash(developerSignals);
  const careerProfile = developerSignals.careerProfileSignal || developerSignals.careerProfile || {};
  const contextCacheKey = buildContextCacheKey({ userId, signalHash, careerProfile });
  if (!options.forceRefresh && contextCache.has(contextCacheKey)) {
    return {
      ...contextCache.get(contextCacheKey),
      cache: { hit: true, key: contextCacheKey, version: SCENARIO_CONTEXT_VERSION }
    };
  }

  const now = new Date();
  const [
    user,
    analysis,
    resumeAnalysis,
    skillGraph,
    recommendations,
    currentSprint,
    latestSprint,
    publicProfile,
    integrationInsight,
    integrationConnections
  ] = await Promise.all([
    User.findById(userId)
      .select('careerStack activeCareerStack experienceLevel activeExperienceLevel githubUsername activeGithubUsername defaultResumeFileId score jobTitle')
      .lean(),
    Analysis.findOne({ userId }).sort({ createdAt: -1 }).lean(),
    ResumeAnalysis.findOne({ userId }).sort({ analyzedAt: -1, createdAt: -1 }).lean(),
    SkillGraph.findOne({ userId }).sort({ updatedAt: -1 }).lean(),
    Recommendation.find({ userId }).sort({ createdAt: -1 }).limit(12).lean(),
    CareerSprint.findOne({
      userId,
      $or: [
        { sprintStartDate: { $lte: now }, sprintEndDate: { $gte: now } },
        { weekStartDate: { $lte: now }, weekEndDate: { $gte: now } }
      ]
    }).sort({ updatedAt: -1 }).lean(),
    CareerSprint.findOne({ userId }).sort({ updatedAt: -1, createdAt: -1 }).lean(),
    PublicProfile.findOne({ userId }).lean(),
    IntegrationInsight.findOne({ userId }).lean(),
    IntegrationConnection.find({ userId, status: 'connected' }).lean()
  ]);

  const githubSignal = developerSignals.githubSignals || {};
  const resumeSignal = developerSignals.resumeSignals || {};
  const skillGapSignal = developerSignals.skillGapSignals || {};
  const recommendationSignal = developerSignals.recommendationSignal || developerSignals.recommendationSignals || {};
  const sprintSignal = developerSignals.careerSprintSignal || developerSignals.careerSprintSignals || {};
  const jobsDemandSignal = developerSignals.jobsDemandSignal || developerSignals.jobsDemandSignals || {};
  const portfolioSignal = developerSignals.portfolioSignal || developerSignals.portfolioSignals || {};
  const integrationSignal = developerSignals.integrationSignal || developerSignals.integrationSignals || {};

  const sprint = currentSprint || latestSprint;
  const resolvedResumeAnalysis = user?.defaultResumeFileId
    ? await ResumeAnalysis.findOne({ userId, fileId: user.defaultResumeFileId })
      .sort({ analyzedAt: -1, createdAt: -1 })
      .lean() || resumeAnalysis
    : resumeAnalysis;
  const resumeSkills = uniqueStrings(resumeSignal.skills?.length ? resumeSignal.skills : mapResumeSkills(resolvedResumeAnalysis), 12);
  const githubSkills = uniqueStrings([
    ...(githubSignal.languageDistribution || []).map((item) => item.language || item.name || item),
    ...(githubSignal.technologies || []).map((item) => item.name || item.technology || item),
    ...Object.keys(analysis?.languageDistribution || {}),
    ...(analysis?.missingSkills || [])
  ], 12);
  const missingSkills = uniqueStrings([
    ...(skillGapSignal.missingSkills || []),
    ...(skillGapSignal.weakSkills || []),
    ...(analysis?.missingSkills || []),
    ...((skillGraph?.nodes || [])
      .filter((node) => node.kind === 'missing')
      .sort((a, b) => Number(b.demandScore || 0) - Number(a.demandScore || 0))
      .map((node) => node.name))
  ], 8);
  const recommendationSkills = uniqueStrings(
    [
      ...(recommendationSignal.skills?.recommendedTechnologies || []),
      ...(recommendationSignal.skills?.missingSkills || []),
      ...recommendations.flatMap((recommendation) => [
        ...(recommendation.techStack || []),
        ...(recommendation.isNewTech || [])
      ])
    ],
    10
  );
  const sprintFocus = uniqueStrings([
    sprintSignal.activeLearningFocus,
    ...(sprintSignal.repeatedIncompleteSkills || []),
    ...((skillGraph?.weeklyRoadmap || []).flatMap((week) => week.focusSkills || [])),
    ...((sprint?.tasks || [])
      .filter((task) => !task.isCompleted)
      .map((task) => task.title))
  ], 6);
  const portfolioProjects = uniqueStrings([
    ...(publicProfile?.projects || []).map((project) => project.title),
    ...(publicProfile?.upcomingProjects || []).map((project) => project.title)
  ], 6);
  const integrationSkills = uniqueStrings([
    ...(integrationSignal.detectedSkills || []),
    ...(integrationInsight?.mergedSkills || []),
    ...((integrationInsight?.providers || []).flatMap((provider) => provider.inferredSkills || []))
  ], 10);
  const connectedProviders = uniqueStrings((integrationConnections || []).map((connection) => connection.provider), 10);

  const role = mapCareerStackToRole(user?.activeCareerStack || user?.careerStack);
  const level = normalizeLevel(user?.activeExperienceLevel || user?.experienceLevel || careerProfile.experienceLevel);
  const baselineHiringScore = clamp(average([
    user?.score,
    analysis?.readinessScore,
    resolvedResumeAnalysis?.atsScore,
    resumeSignal.atsScore,
    skillGapSignal.coverage,
    portfolioSignal.completenessScore
  ], 55));
  const baselineJobMatch = clamp(average([
    analysis?.skillScore,
    analysis?.githubScore,
    resolvedResumeAnalysis?.keywordDensity,
    resumeSignal.keywordDensity,
    githubSignal.scores?.healthScore,
    jobsDemandSignal.sampledJobs ? 55 : 0
  ], 48));
  const suggestedSkills = uniqueStrings([
    ...missingSkills,
    ...recommendationSkills,
    ...sprintFocus,
    ...integrationSkills
  ], 6);
  const suggestedProjects = [...(publicProfile?.projects || []), ...(publicProfile?.upcomingProjects || [])]
    .map((item) => deriveProjectFromPublicItem(item))
    .filter((project) => !!project)
    .filter((project, index, list) => list.findIndex((candidate) => candidate.name.toLowerCase() === project.name.toLowerCase()) === index)
    .slice(0, 3);

  const latestTimestamp = (...values) => {
    const valid = values.filter(Boolean).map((value) => new Date(value));
    if (!valid.length) return null;
    valid.sort((a, b) => b.getTime() - a.getTime());
    return valid[0];
  };

  const sources = [
    {
      key: 'github',
      label: 'GitHub Analyzer',
      connected: !!analysis,
      lastUpdatedAt: githubSignal.updatedAt || analysis?.createdAt || null
    },
    {
      key: 'resume',
      label: 'Resume Analyzer',
      connected: !!resolvedResumeAnalysis || !!resumeSignal.analyzed,
      lastUpdatedAt: resumeSignal.lastAnalyzedAt || resolvedResumeAnalysis?.analyzedAt || resolvedResumeAnalysis?.createdAt || null
    },
    {
      key: 'skillGap',
      label: 'Skill Gap',
      connected: !!skillGraph || !!skillGapSignal.present,
      lastUpdatedAt: skillGapSignal.updatedAt || skillGraph?.updatedAt || null
    },
    {
      key: 'recommendations',
      label: 'Recommendations',
      connected: recommendations.length > 0 || !!recommendationSignal.present,
      lastUpdatedAt: recommendationSignal.updatedAt || recommendations[0]?.createdAt || null
    },
    {
      key: 'careerSprint',
      label: 'Career Sprint',
      connected: !!sprint || !!sprintSignal.present,
      lastUpdatedAt: sprintSignal.updatedAt || sprint?.updatedAt || sprint?.createdAt || null
    },
    {
      key: 'portfolio',
      label: 'Public Portfolio',
      connected: !!publicProfile || !!portfolioSignal.present,
      lastUpdatedAt: portfolioSignal.updatedAt || publicProfile?.updatedAt || publicProfile?.createdAt || null
    },
    {
      key: 'integrations',
      label: 'Integrations',
      connected: connectedProviders.length > 0 || !!integrationInsight,
      lastUpdatedAt: latestTimestamp(
        integrationInsight?.updatedAt,
        ...(integrationConnections || []).map((connection) => connection.lastSyncedAt || connection.updatedAt)
      )
    },
    {
      key: 'jobsDemand',
      label: 'Jobs Demand',
      connected: !!jobsDemandSignal.present,
      lastUpdatedAt: jobsDemandSignal.updatedAt || null
    }
  ];

  const context = {
    profile: {
      careerStack: user?.activeCareerStack || user?.careerStack || careerProfile.careerStack || 'Full Stack',
      experienceLevel: user?.activeExperienceLevel || user?.experienceLevel || careerProfile.experienceLevel || 'Student',
      githubUsername: user?.activeGithubUsername || user?.githubUsername || careerProfile.activeGithubUsername || careerProfile.githubUsername || '',
      role,
      level,
      baselineHiringScore,
      baselineJobMatch
    },
    sources,
    signals: {
      knownSkills: uniqueStrings([
        ...resumeSkills,
        ...githubSkills,
        ...integrationSkills,
        ...(publicProfile?.skills || []).map((skill) => skill.name)
      ], 12),
      missingSkills,
      recommendationSkills,
      sprintFocus,
      connectedProviders,
      portfolioProjects,
      topDemandedSkills: (jobsDemandSignal.topSkills || []).slice(0, 8).map((skill) => skill.name || skill.skill || skill)
    },
    suggestedInputs: {
      role,
      experienceLevel: level,
      baselineHiringScore,
      baselineJobMatch,
      durationWeeks: Math.max(4, sprintFocus.length >= 4 ? 8 : 6),
      skills: suggestedSkills,
      projects: suggestedProjects
    },
    summary: `Recommendations are prefetched from your ${user?.activeCareerStack || user?.careerStack || careerProfile.careerStack || 'Full Stack'} profile, ${user?.activeExperienceLevel || user?.experienceLevel || careerProfile.experienceLevel || 'current'} experience level, and signals such as ${missingSkills.slice(0, 3).join(', ') || 'recent analysis activity'}.`,
    signalHash,
    cache: { hit: false, key: contextCacheKey, version: SCENARIO_CONTEXT_VERSION }
  };

  context.sourceContextSummary = buildSourceContextSummary(context, signalHash);
  contextCache.set(contextCacheKey, context);
  return context;
};

const generateScenarioName = ({ role, durationWeeks, skills, projects }) => {
  const roleLabel = ROLE_LABELS[normalizeRole(role)] || 'Scenario';
  if (skills.length) return `${roleLabel} plan: ${skills.slice(0, 2).join(' + ')} (${durationWeeks}w)`;
  if (projects.length) return `${roleLabel} project plan (${durationWeeks}w)`;
  return `${roleLabel} scenario (${durationWeeks}w)`;
};

const saveScenarioForUser = async (userId, payload = {}) => {
  const normalized = sanitizeScenarioInput(payload);
  if (!normalized.isValid) {
    const error = new Error('Scenario validation failed.');
    error.statusCode = 400;
    error.details = normalized.errors;
    throw error;
  }

  const context = await getScenarioContext(userId);
  const result = simulateHiringOutcome(normalized.value, {
    resumeConnected: context.sources.some((source) => source.key === 'resume' && source.connected),
    githubConnected: context.sources.some((source) => source.key === 'github' && source.connected),
    sources: context.sources
  });
  const scenarioHash = result.scenarioHash || buildScenarioHash(normalized.value);

  const scenario = await ScenarioSimulation.create({
    userId,
    name: String(payload.name || '').trim() || generateScenarioName(normalized.value),
    ...normalized.value,
    predicted: result.predicted,
    improvements: result.improvements,
    confidenceScore: result.confidenceScore,
    scenarioHash,
    breakdown: result.breakdown,
    uncertaintyRange: result.uncertaintyRange,
    warnings: result.warnings,
    sourceContextSummary: context.sourceContextSummary || buildSourceContextSummary(context, context.signalHash),
    result
  });

  invalidateHistoryCache(userId);
  return scenario.toObject();
};

const getScenarioHistoryForUser = async (userId, limit = 8, options = {}) => {
  const safeLimit = clamp(limit, 1, 20);
  const cacheKey = buildHistoryCacheKey(userId, safeLimit);
  if (!options.forceRefresh && historyCache.has(cacheKey)) {
    return {
      history: historyCache.get(cacheKey),
      cache: { hit: true, key: cacheKey, version: SCENARIO_HISTORY_VERSION }
    };
  }

  const history = await ScenarioSimulation.find({ userId })
    .sort({ createdAt: -1 })
    .limit(safeLimit)
    .lean();

  historyCache.set(cacheKey, history);
  return {
    history,
    cache: { hit: false, key: cacheKey, version: SCENARIO_HISTORY_VERSION }
  };
};

const deleteScenarioForUser = async (userId, scenarioId) => {
  const deleted = await ScenarioSimulation.findOneAndDelete({ _id: scenarioId, userId }).lean();
  if (deleted) invalidateHistoryCache(userId);
  return !!deleted;
};

const scheduleTaskWindow = (index, totalTasks, durationWeeks) => {
  const start = new Date();
  const totalDays = Math.max(7, durationWeeks * 7);
  const block = Math.max(4, Math.floor(totalDays / Math.max(totalTasks, 1)));
  const startDate = new Date(start);
  startDate.setDate(start.getDate() + index * block);
  const endDate = new Date(startDate);
  endDate.setDate(startDate.getDate() + Math.max(3, block - 1));
  return { startDate, endDate };
};

const buildSprintTasksFromScenario = (normalizedInput, result, source = {}) => {
  const sourceFields = {
    sourceScenarioId: source.scenarioId || null,
    sourceScenarioHash: source.scenarioHash || result.scenarioHash || buildScenarioHash(normalizedInput)
  };
  const skillTasks = result.skillDetails.slice(0, 4).map((detail, index) => ({
    title: `Learn ${detail.skill}`,
    description: `Scenario task: learn ${detail.skill} for ${ROLE_LABELS[result.meta.role] || result.meta.role}. Demand ${detail.demand}x, relevance ${detail.relevance}x, expected impact +${detail.pts}.`,
    points: detail.tier === 'core' ? 5 : detail.tier === 'valuable' ? 4 : 3,
    priority: detail.tier === 'core' ? 'high' : detail.tier === 'valuable' ? 'medium' : 'low',
    category: 'learning',
    taskType: 'manual',
    ...sourceFields,
    ...scheduleTaskWindow(index, Math.max(result.skillDetails.length + result.projectDetails.length, 1), normalizedInput.durationWeeks)
  }));

  const projectTasks = result.projectDetails.slice(0, 2).map((detail, index) => ({
    title: `Build ${detail.name}`,
    description: `Scenario task: build ${detail.name}. Complexity ${detail.complexity}, planned ${detail.weeks} weeks, expected impact +${detail.pts}.`,
    points: detail.complexity === 'high' ? 6 : detail.complexity === 'medium' ? 5 : 4,
    priority: detail.impact >= 80 ? 'high' : 'medium',
    category: 'project',
    taskType: 'manual',
    ...sourceFields,
    ...scheduleTaskWindow(skillTasks.length + index, Math.max(result.skillDetails.length + result.projectDetails.length, 1), normalizedInput.durationWeeks)
  }));

  const seen = new Set();
  return [...skillTasks, ...projectTasks]
    .filter((task) => {
      const key = task.title.toLowerCase().trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 6);
};

const createSprintFromScenario = async (userId, payload = {}) => {
  const normalized = sanitizeScenarioInput(payload);
  if (!normalized.isValid) {
    const error = new Error('Scenario validation failed.');
    error.statusCode = 400;
    error.details = normalized.errors;
    throw error;
  }

  const context = await getScenarioContext(userId);
  const result = simulateHiringOutcome(normalized.value, {
    resumeConnected: context.sources.some((source) => source.key === 'resume' && source.connected),
    githubConnected: context.sources.some((source) => source.key === 'github' && source.connected),
    sources: context.sources
  });

  const scenarioHash = result.scenarioHash || buildScenarioHash(normalized.value);
  const tasks = buildSprintTasksFromScenario(normalized.value, result, {
    scenarioId: payload.scenarioId || payload.sourceScenarioId || null,
    scenarioHash
  });
  const now = new Date();
  let sprint = await CareerSprint.findOne({
    userId,
    weekStartDate: { $lte: now },
    weekEndDate: { $gte: now }
  });

  if (!sprint) {
    sprint = await createSprint({
      userId,
      title: `Scenario Sprint - ${ROLE_LABELS[result.meta.role] || 'Career Plan'}`,
      weeklyGoal: Math.max(4, tasks.length),
      tasks: [],
      goalStack: context.profile.careerStack,
      goalExperienceLevel: context.profile.experienceLevel
    });
  }

  const existingTitles = new Set((sprint.tasks || []).map((task) => String(task.title || '').toLowerCase().trim()));
  const tasksToAdd = tasks.filter((task) => !existingTitles.has(task.title.toLowerCase().trim()));
  const skippedTasks = tasks.length - tasksToAdd.length;

  tasksToAdd.forEach((task) => {
    sprint.tasks.push(task);
  });

  if (tasksToAdd.length) {
    sprint.weeklyGoal = Math.max(Number(sprint.weeklyGoal || 5), tasksToAdd.length);
    await sprint.save();
  }

  return {
    sprintId: sprint._id,
    sprintTitle: sprint.title,
    sourceScenarioId: payload.scenarioId || payload.sourceScenarioId || null,
    sourceScenarioHash: scenarioHash,
    tasksCreated: tasksToAdd.length,
    tasksMerged: tasksToAdd.length,
    tasksSkipped: skippedTasks,
    tasksAdded: tasksToAdd.length,
    tasks: tasksToAdd.map((task) => ({
      title: task.title,
      category: task.category,
      priority: task.priority,
      sourceScenarioHash: task.sourceScenarioHash
    }))
  };
};

module.exports = {
  sanitizeScenarioInput,
  simulateHiringOutcome,
  getScenarioContext,
  saveScenarioForUser,
  getScenarioHistoryForUser,
  deleteScenarioForUser,
  createSprintFromScenario
};
