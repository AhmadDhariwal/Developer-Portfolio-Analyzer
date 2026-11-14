'use strict';

const legacy = require('./scenarioPlanningLegacy');
const { compare, digest } = require('../../utils/scenarioIdentity');
const RULE_VERSION = 'scenario-planning-v2';
const LEGACY_VERSION = 'scenario-planning-legacy-v1';
const TABLE_VERSION = 'scenario-static-rules-v1';
const plain = (value) => typeof value === 'string' && value.trim() && !/[<>\u0000-\u001f\u007f]/.test(value);
const error = (message, details = []) => Object.assign(new Error(message), { statusCode: 400, details });

const normalize = (payload) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    throw error('A scenario object is required.');
  const allowed = new Set([
    'ruleVersion',
    'name',
    'baselineHiringScore',
    'baselineJobMatch',
    'baselineAuthority',
    'baselineConfirmed',
    'role',
    'experienceLevel',
    'durationWeeks',
    'skills',
    'projects',
    'evaluation',
    'scenarioId',
    'sourceScenarioId',
    'mode',
    'sprintId',
  ]);
  if (Object.keys(payload).some((key) => !allowed.has(key))) throw error('Unknown scenario field.');
  if (payload.name !== undefined && typeof payload.name !== 'string')
    throw error('Scenario name must be text.');
  const roles = new Set([
    'frontend',
    'front end',
    'backend',
    'back end',
    'full stack',
    'fullstack',
    'ai/ml',
    'ai',
    'ml',
    'machine learning',
    'devops',
    'cloud',
    'infra',
    'frontend developer',
    'backend developer',
    'full stack developer',
    'ai/ml engineer',
    'devops engineer',
    'devops / cloud engineer',
  ]);
  const levels = new Set([
    'junior',
    'student',
    'intern',
    '0-1 years',
    '1-2 years',
    'mid',
    'mid-level',
    'intermediate',
    'senior',
    'lead',
    'staff',
    '5+ years',
    'junior developer',
    'mid-level developer',
    'senior developer',
  ]);
  if (
    payload.role !== undefined &&
    (typeof payload.role !== 'string' || !roles.has(payload.role.toLowerCase().trim()))
  )
    throw error('Unsupported career role.');
  if (
    payload.experienceLevel !== undefined &&
    (typeof payload.experienceLevel !== 'string' || !levels.has(payload.experienceLevel.toLowerCase().trim()))
  )
    throw error('Unsupported experience level.');
  for (const key of ['baselineHiringScore', 'baselineJobMatch'])
    if (
      typeof payload[key] !== 'number' ||
      !Number.isFinite(payload[key]) ||
      payload[key] < 0 ||
      payload[key] > 100
    )
      throw error(`${key} must be a finite number between 0 and 100.`);
  if (payload.baselineConfirmed !== true || payload.baselineAuthority !== 'user-assumption')
    throw error('Confirm the planning baseline assumptions.');
  if (!Number.isInteger(payload.durationWeeks) || payload.durationWeeks < 1 || payload.durationWeeks > 24)
    throw error('Duration must be an integer between 1 and 24 weeks.');
  if (
    !Array.isArray(payload.skills) ||
    payload.skills.length > 10 ||
    payload.skills.some((item) => !plain(item) || item.trim().length > 100)
  )
    throw error('Provide up to ten plain-text skills.');
  if (!Array.isArray(payload.projects) || payload.projects.length > 5)
    throw error('Provide up to five projects.');
  for (const project of payload.projects) {
    if (
      !project ||
      typeof project !== 'object' ||
      Array.isArray(project) ||
      Object.keys(project).some((key) => !['name', 'impact', 'complexity', 'weeks'].includes(key)) ||
      !plain(project.name) ||
      project.name.trim().length > 160 ||
      typeof project.impact !== 'number' ||
      !Number.isFinite(project.impact) ||
      project.impact < 0 ||
      project.impact > 100 ||
      !Number.isInteger(project.weeks) ||
      project.weeks < 1 ||
      project.weeks > 24 ||
      !['low', 'medium', 'high'].includes(project.complexity)
    )
      throw error('Invalid project fields.');
  }
  const canonical = (value) => value.trim().toLowerCase();
  const skills = [...new Set(payload.skills.map(canonical))];
  const projectMap = new Map();
  for (const item of payload.projects) {
    const project = { ...item, name: canonical(item.name) };
    if (projectMap.has(project.name) && digest(projectMap.get(project.name)) !== digest(project))
      throw error('Conflicting duplicate projects.');
    projectMap.set(project.name, project);
  }
  const validated = legacy.sanitizeScenarioInput({ ...payload, skills, projects: [...projectMap.values()] });
  if (!validated.isValid) throw error('Scenario input is invalid.', validated.errors);
  const input = validated.value;
  const skillValue = (skill) =>
    legacy.getRoleWeight(input.role, skill, true) *
    legacy.getDifficulty(skill, true) *
    legacy.getDemand(skill, true);
  input.skills.sort((a, b) => skillValue(b) - skillValue(a) || compare(a, b));
  const projectValue = (item) =>
    legacy.COMPLEXITY_WEIGHT[item.complexity] * (0.7 + Math.min(12, item.weeks) / 20) * item.impact;
  input.projects.sort((a, b) => projectValue(b) - projectValue(a) || compare(a.name, b.name));
  const { inputWarnings, ...canonicalInput } = input;
  return { ...canonicalInput, baselineAuthority: 'user-assumption', baselineConfirmed: true };
};

const calculate = (payload, context = {}) => {
  const version = payload?.ruleVersion || LEGACY_VERSION;
  if (![RULE_VERSION, LEGACY_VERSION].includes(version)) throw error('Unknown Scenario rule version.');
  if (version === LEGACY_VERSION) {
    const normalizedInput = legacy.sanitizeScenarioInput(payload, { requirePlan: false }).value;
    const calculationContext = {
      resumeConnected: !!context.resumeConnected,
      githubConnected: !!context.githubConnected,
      sources: Array.isArray(context.sources) ? context.sources : [],
    };
    return {
      ...legacy.simulateHiringOutcome(payload, calculationContext),
      ruleVersion: LEGACY_VERSION,
      tableVersion: TABLE_VERSION,
      evaluation: {
        ruleVersion: LEGACY_VERSION,
        tableVersion: TABLE_VERSION,
        normalizedInput,
        calculationContext,
      },
    };
  }
  const input = normalize(payload);
  // Evidence support is kept separate from the hypothetical central calculation.
  const calculationContext = { sources: [], resumeConnected: false, githubConnected: false };
  const result = legacy.simulateHiringOutcome(input, calculationContext, {
    preserveZero: true,
    consistentDuration: true,
    safeLookup: true,
  });
  const planHash = digest(input);
  const contextFingerprint = digest(calculationContext);
  const evaluationHash = digest({
    ruleVersion: version,
    tableVersion: TABLE_VERSION,
    planHash,
    contextFingerprint,
  });
  result.scenarioHash = `${version}:${evaluationHash}`;
  result.ruleVersion = version;
  result.tableVersion = TABLE_VERSION;
  result.dataTrust = {
    baseline: { label: 'Confirmed planning assumption', authority: 'user-assumption' },
    prediction: {
      label: 'Hypothetical planning estimate',
      guaranteed: false,
      usesAI: false,
      calibrated: false,
    },
  };
  result.support = {
    kind: 'heuristic',
    calibrated: false,
    label: 'Planning feasibility heuristic; not a probability of hiring or proficiency.',
  };
  result.explainability.confidenceReason = result.support.label;
  result.explainability.scoreDrivers = [
    ...result.skillDetails.map(
      (item) => `${item.skill}: ${item.pts} nominal skill points before caps, overload and saturation.`,
    ),
    ...result.projectDetails.map(
      (item) => `${item.name}: ${item.pts} nominal project points before caps, overload and saturation.`,
    ),
  ];
  result.insights = result.insights.filter(
    (note) => !/confidence|credibility|sustained execution/i.test(note),
  );
  result.warnings = result.warnings.filter((note) => !/confidence/i.test(note));
  result.assumptions.notes = [
    'Baseline values are confirmed user assumptions.',
    'Static skill demand and title-based synergy are heuristics.',
    'Learning is hypothetical and does not establish demonstrated proficiency.',
  ];
  if (result.meta.exceedsSupportedWindow)
    result.warnings.push('Required effort exceeds the supported 24-week planning window.');
  result.reconciliation = {
    uncappedItemPoints:
      result.skillDetails.reduce((sum, item) => sum + item.pts, 0) +
      result.projectDetails.reduce((sum, item) => sum + item.pts, 0),
    appliedHiringDelta: result.improvements.hiringScore,
    label: 'Item points precede component caps, rounding, overload and score saturation.',
  };
  return {
    ...result,
    evaluation: {
      ruleVersion: version,
      tableVersion: TABLE_VERSION,
      planHash,
      contextFingerprint,
      evaluationHash,
      normalizedInput: input,
      calculationContext,
    },
  };
};

module.exports = { RULE_VERSION, LEGACY_VERSION, TABLE_VERSION, normalize, calculate };
