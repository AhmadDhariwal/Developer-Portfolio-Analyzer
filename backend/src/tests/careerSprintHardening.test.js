'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

const controllerSource = read('backend', 'src', 'controllers', 'careerSprintController.js');
const serviceSource = read('backend', 'src', 'services', 'careerSprintService.js');
const aiServiceSource = read('backend', 'src', 'services', 'aiTaskService.js');
const routesSource = read('backend', 'src', 'routes', 'careerSprint.routes.js');
const promptSource = read('backend', 'src', 'prompts', 'careerSprintPrompt.js');
const componentSource = read('frontend', 'src', 'app', 'pages', 'career-sprint', 'career-sprint.component.ts');
const clientSource = read('frontend', 'src', 'app', 'shared', 'services', 'career-sprint.service.ts');

const {
  calcWeightedProgress,
  xpForTask,
  levelFromXp,
  assertObjectId,
  sanitizeBoundedText,
  LIMITS
} = require('../services/careerSprintService');

const {
  validateAiTaskPlan,
  hasAiTaskFactPollution,
  isUsableTaskText,
  assignDeterministicScoring
} = require('../services/aiTaskService');

const { getCareerSprintPrompt } = require('../prompts/careerSprintPrompt');

const groundedTasks = [
  { title: 'Learn React hooks deeply', description: 'Build a small React dashboard using hooks for Frontend Intern growth.', category: 'learning' },
  { title: 'Ship React portfolio section', description: 'Publish a React project page that proves Frontend delivery quality.', category: 'project' },
  { title: 'Practice React testing basics', description: 'Write unit tests for React components covering happy-path Intern workflows.', category: 'practice' },
  { title: 'Close TypeScript gap', description: 'Convert one React module to TypeScript with strict typing and readable types.', category: 'learning' },
  { title: 'Improve GitHub README', description: 'Rewrite the React repo README so recruiters can understand the Frontend proof quickly.', category: 'practice' },
  { title: 'Build React form validation', description: 'Implement accessible form validation in a React feature for Intern interview readiness.', category: 'project' }
];

test('career sprint routes require JWT protect middleware', () => {
  assert.match(routesSource, /router\.get\('\/current',\s*protect/);
  assert.match(routesSource, /router\.post\('\/',\s*protect/);
  assert.match(routesSource, /router\.post\('\/generate-ai-plan',\s*protect/);
  assert.match(routesSource, /router\.put\('\/:id\/tasks\/:taskId',\s*protect/);
});

test('controller sanitizes client errors and never leaks internals', () => {
  assert.match(controllerSource, /INTERNAL_ERROR_PATTERN/);
  assert.match(controllerSource, /Authentication required\./);
  assert.match(controllerSource, /isCompleted must be a boolean/);
  assert.doesNotMatch(controllerSource, /res\.status\([^\)]*\)\.json\(\{\s*message:\s*error\.message/);
  assert.doesNotMatch(controllerSource, /stack:\s*error\.stack|error\.stack/);
  assert.doesNotMatch(controllerSource, /YOUTUBE_API_KEY|OPENAI|GEMINI_API|apiKey/);
});

test('invalid ObjectIds are rejected as 404 before mongoose cast', () => {
  assert.throws(() => assertObjectId('not-an-id', 'Sprint'), (error) => error.statusCode === 404);
  assert.throws(() => assertObjectId('', 'Task'), (error) => error.statusCode === 404);
  assert.doesNotThrow(() => assertObjectId('507f1f77bcf86cd799439011', 'Sprint'));
  assert.match(serviceSource, /assertObjectId\(sprintId/);
  assert.match(controllerSource, /assertObjectId\(req\.params\.id/);
});

test('oversized text inputs return 413 and empty titles are not invented', () => {
  assert.throws(
    () => sanitizeBoundedText('x'.repeat(LIMITS.title + 1), LIMITS.title, 'Task title', { required: true }),
    (error) => error.statusCode === 413
  );
  assert.throws(
    () => sanitizeBoundedText('', LIMITS.title, 'Task title', { required: true }),
    (error) => error.statusCode === 400
  );
  assert.doesNotMatch(serviceSource, /title \|\| 'New Task'/);
  assert.doesNotMatch(aiServiceSource, /title \|\| 'Task'/);
});

test('ownership is enforced on every sprint and scenario mutation query', () => {
  assert.match(serviceSource, /findOne\(\{\s*_id:\s*sprintId,\s*userId\s*\}\)/);
  assert.match(serviceSource, /ScenarioSimulation\.findOne\(\{\s*_id:\s*scenarioId,\s*userId\s*\}\)/);
  assert.match(serviceSource, /CareerSprint\.find\(\{\s*userId\s*\}/);
  assert.match(serviceSource, /sort\(\{\s*updatedAt:\s*-1\s*\}\)/);
});

test('failed force refresh preserves previous valid cache entry', () => {
  assert.match(serviceSource, /if \(forceRefresh && previousValid\) return timer\.attach\(cloneCached\(previousValid\)\)/);
  assert.match(serviceSource, /sprintOverviewInflight/);
  assert.match(serviceSource, /sprintCacheEpoch/);
  assert.match(serviceSource, /withBudget\(/);
  assert.match(aiServiceSource, /dedupeGeneration/);
  assert.match(aiServiceSource, /generationInflight/);
});

test('scores remain finite and deterministic without inventing NaN', () => {
  assert.equal(calcWeightedProgress([]), 0);
  assert.equal(calcWeightedProgress([{ points: NaN, isCompleted: true }]), 100);
  assert.equal(xpForTask({ priority: 'high', points: 5 }), 20);
  assert.equal(levelFromXp(NaN), 1);
  assert.ok(Number.isFinite(levelFromXp(250)));
});

test('AI fact pollution and low-quality tasks are rejected', () => {
  assert.equal(hasAiTaskFactPollution({ tasks: groundedTasks, confidenceScore: 99 }), true);
  assert.equal(hasAiTaskFactPollution({ tasks: groundedTasks, xpPoints: 10 }), true);
  assert.equal(hasAiTaskFactPollution({ tasks: groundedTasks }), false);

  assert.equal(isUsableTaskText('As an AI I cannot help with this'), false);
  assert.equal(isUsableTaskText('todo placeholder task'), false);
  assert.equal(isUsableTaskText('Ship a React portfolio proof page with measurable outcomes'), true);

  const polluted = validateAiTaskPlan({
    tasks: groundedTasks,
    readinessScore: 88
  }, { focusTechnology: 'React', effectiveStack: 'Frontend', missingSkills: ['TypeScript'] });
  assert.equal(polluted.ok, false);
  assert.equal(polluted.reason, 'pollution');

  const lowQuality = validateAiTaskPlan({
    tasks: Array.from({ length: 6 }, () => ({
      title: 'Do something important',
      description: 'It is important to understand the situation and generally speaking improve.',
      category: 'learning'
    }))
  }, { focusTechnology: 'React', effectiveStack: 'Frontend', missingSkills: ['TypeScript'] });
  assert.equal(lowQuality.ok, false);

  const ungrounded = validateAiTaskPlan({
    tasks: [
      { title: 'Study quantum hardware topology', description: 'Prepare an executive quantum leadership briefing for tomorrow.', category: 'learning' },
      { title: 'Build quantum orchestration mesh', description: 'Create a worldwide quantum hardware control plane prototype.', category: 'project' },
      { title: 'Practice quantum executive talks', description: 'Rehearse quantum leadership answers for executive interviews.', category: 'practice' },
      { title: 'Review quantum roadmap notes', description: 'Summarize quantum hardware strategy notes into one page.', category: 'learning' },
      { title: 'Polish quantum case study', description: 'Improve the quantum hardware case study presentation draft.', category: 'practice' },
      { title: 'Ship quantum demo reel', description: 'Record a short quantum hardware demo for stakeholders.', category: 'project' }
    ]
  }, { focusTechnology: 'React', effectiveStack: 'Frontend', missingSkills: ['TypeScript'], recommendationTechnologies: ['React'] });
  assert.equal(ungrounded.ok, false);
  assert.equal(ungrounded.reason, 'ungrounded');

  const valid = validateAiTaskPlan({ tasks: groundedTasks }, {
    focusTechnology: 'React',
    effectiveStack: 'Frontend',
    effectiveExperience: 'Intern',
    missingSkills: ['TypeScript'],
    recommendationTechnologies: ['React']
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.tasks.length >= 6, true);
  assert.ok(valid.tasks.every((task) => Number.isFinite(task.points)));
  assert.deepEqual(
    assignDeterministicScoring([{ category: 'project' }, { category: 'learning' }]).map((task) => task.priority),
    ['high', 'high']
  );
});

test('LLM path uses returnMeta, schema validation, and safe deterministic fallback labels', () => {
  assert.match(aiServiceSource, /returnMeta:\s*true/);
  assert.match(aiServiceSource, /validateAiTaskPlan/);
  assert.match(aiServiceSource, /generationMode: usedFallback \? 'deterministic' : 'llm'/);
  assert.match(aiServiceSource, /providerLabel: usedFallback \? 'Deterministic Plan' : 'AI-Assisted Plan'/);
  assert.doesNotMatch(aiServiceSource, /LLM Planner|Rules Engine Fallback|Gemini|OpenAI/);
});

test('prompt is compact, schema-bound, and forbids score invention', () => {
  const prompt = getCareerSprintPrompt({
    careerStack: 'Frontend',
    experienceLevel: 'Intern',
    focusTechnology: 'React',
    sprintWindow: '2026-08-01 to 2026-08-07',
    missingSkills: ['TypeScript'],
    githubWeakAreas: ['poor_readme'],
    recommendationTechnologies: ['React'],
    developerSignals: {
      careerSprintSignal: { consistencyScore: 40, activeLearningFocus: 'React', streak: 2 },
      weeklyReportSignal: { weeklyProgressScore: 35, repeatedWeakAreas: ['Testing'] },
      portfolioSignal: { completenessScore: 40 },
      integrationSignal: { usedProviders: ['GitHub'], strongestProof: ['GitHub'] }
    },
    baselineTasks: groundedTasks
  });

  assert.match(prompt, /Return ONLY valid JSON/);
  assert.match(prompt, /"category": "learning\|project\|practice"/);
  assert.match(prompt, /Do NOT assign XP, points, streaks, scores/);
  assert.match(prompt, /Do NOT return markdown/);
  assert.equal(prompt.includes('"xpPoints"'), false);
  assert.equal(prompt.includes('"confidenceScore"'), false);
  assert.match(promptSource, /Ground tasks in the provided stack/);
});

test('frontend failed refresh and failed AI generation preserve previous valid results', () => {
  assert.match(componentSource, /const previousSprint = this\.sprint/);
  assert.match(componentSource, /const preservePrevious = Boolean\(previousSprint\)/);
  assert.match(componentSource, /if \(preservePrevious && previousSprint\)/);
  assert.match(componentSource, /const previousTasks = \[\.\.\.this\.generatedTasks\]/);
  assert.match(componentSource, /this\.generatedTasks = previousTasks/);
  assert.match(componentSource, /pendingTaskIds/);
  assert.match(componentSource, /Failed to add generated tasks\. Previous plan was preserved\./);
});

test('frontend request dedupe and profile-scoped cache keys prevent cross-user bleed', () => {
  assert.match(clientSource, /current:\$\{profile\}:\$\{active\}/);
  assert.match(clientSource, /history:\$\{this\.profileKey\(profileSignature\)\}:\$\{limit\}/);
  assert.match(clientSource, /shareReplay/);
  assert.match(clientSource, /private dedupe</);
  assert.match(clientSource, /clearCache\(\)/);
});

test('unsafe or empty AI plans are never treated as persistable drafts', () => {
  assert.match(serviceSource, /AI plan must include at least one valid task/);
  assert.match(serviceSource, /AI plan has too many tasks/);
  assert.match(serviceSource, /dedupeTasks\(payload\.tasks/);
});
