'use strict';
const mongoose = require('mongoose');
const Sprint = require('../../career-sprint/models/careerSprint');
const { digest } = require('../utils/scenarioIdentity');
const { buildProposal, VERSION } = require('./scenarioSprintAdapter');
const legacyPolicy = require('../../career-sprint/services/sprintLegacyPolicy');
const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });
let sprintCreator = null;
let taskNormalizer = null;
let cacheInvalidator = null;
const registerSprintCreator = (fn) => {
  sprintCreator = typeof fn === 'function' ? fn : null;
};
const registerSprintExportHooks = ({ createSprint, normalizeTask, invalidateCareerSprintCache } = {}) => {
  if (typeof createSprint === 'function') sprintCreator = createSprint;
  if (typeof normalizeTask === 'function') taskNormalizer = normalizeTask;
  if (typeof invalidateCareerSprintCache === 'function') cacheInvalidator = invalidateCareerSprintCache;
};
const inFlightExports = new Map();
const MAX_IN_FLIGHT_EXPORTS = 256;
// Mutation target lookup must not execute overview analytics or inactivity writes.
const resolveCurrentSprintId = async (userId) => {
  const now = new Date();
  let sprint = await Sprint.findOne({
    userId,
    sprintStartDate: { $lte: now },
    sprintEndDate: { $gte: now },
  })
    .select('_id')
    .sort({ updatedAt: -1, _id: -1 })
    .maxTimeMS(2000)
    .lean();
  if (!sprint)
    sprint = await Sprint.findOne({
      userId,
      sprintStartDate: null,
      sprintEndDate: null,
      weekStartDate: { $lte: now },
      weekEndDate: { $gte: now },
    })
      .select('_id')
      .sort({ updatedAt: -1, _id: -1 })
      .maxTimeMS(2000)
      .lean();
  if (!sprint) {
    if (!sprintCreator) throw fail(500, 'Sprint creator is not registered.');
    sprint = await sprintCreator({ userId });
  }
  return sprint._id;
};
const performExport = async (userId, sprintId, scenario, mode, { scenarioHash, key }) => {
  if (!mongoose.Types.ObjectId.isValid(sprintId)) throw fail(400, 'Invalid Sprint ID.');
  if (!['draft', 'active-tasks'].includes(mode)) throw fail(400, 'Unsupported export mode.');
  for (let attempt = 0; attempt < 5; attempt++) {
    const sprint = await Sprint.findOne({ _id: sprintId, userId }).maxTimeMS(2000);
    if (!sprint) throw fail(404, 'Sprint not found.');
    legacyPolicy.assertWritable(sprint);
    const previous = sprint.scenarioReceipts?.find((receipt) => receipt.key === key);
    if (previous)
      return {
        sprintId: sprint._id,
        sourceScenarioHash: scenarioHash,
        sourceScenarioId: scenario._id || null,
        mode,
        replayed: true,
        tasksAdded: 0,
        tasksCreated: 0,
        tasksMerged: 0,
        tasksSkipped: previous.itemKeys.length,
        receipt: previous.toObject(),
        sprint,
      };
    if ((sprint.scenarioReceipts?.length || 0) >= 128)
      throw fail(409, 'Sprint export receipt limit reached. Choose another Sprint.');
    const historicalItems =
      mode === 'draft' ? sprint.aiPlans.flatMap((plan) => plan.tasks) : sprint.tasks;
    if (
      historicalItems.some(
        (task) => task.sourceScenarioHash === scenarioHash && !task.sourceScenarioItemKey,
      )
    )
      throw fail(
        409,
        'Historical Scenario work has no stable item identity. Review it before exporting to another Sprint.',
      );
    const normalize = taskNormalizer || ((t) => t);
    const tasks = buildProposal(scenario, sprint).map((task) =>
      normalize(task, 'manual', true, sprint),
    );
    if (!tasks.length) throw fail(400, 'No actionable scenario items.');
    let addedCount = 0;
    let workIds = [];
    if (mode === 'draft') {
      if (sprint.aiPlans.length >= 8) throw fail(409, 'Eight saved drafts already exist.');
      const context = await require('../../career-sprint/services/sprintDraftContextService').currentContext(userId);
      sprint.aiPlans.push({
        name: (scenario.name || 'Scenario planning draft').slice(0, 120),
        context,
        origin: 'scenario',
        source: 'scenario',
        generatorType: 'scenario',
        goalStack: scenario.role || sprint.goalStack,
        goalExperienceLevel: scenario.experienceLevel || sprint.goalExperienceLevel,
        goalTechnology: (scenario.skills || []).slice(0, 2).join(', ').slice(0, 120),
        summary: 'Hypothetical work for review; not demonstrated proficiency.',
        signalsUsed: ['Scenario intent'],
        tasks,
      });
      workIds = [sprint.aiPlans.at(-1)._id];
    } else {
      const seen = new Set(sprint.scenarioIngestedItems || []);
      const fresh = tasks.filter((task) => !seen.has(task.sourceScenarioItemKey));
      if (sprint.tasks.length + fresh.length > 500 || seen.size + fresh.length > 500)
        throw fail(413, 'Sprint task/provenance limit reached.');
      const previousCount = sprint.tasks.length;
      sprint.tasks.push(...fresh);
      workIds = sprint.tasks.slice(previousCount).map((task) => task._id);
      addedCount = fresh.length;
      sprint.weeklyGoal = Math.max(Number(sprint.weeklyGoal || 5), fresh.length);
      sprint.scenarioIngestedItems = [...seen, ...fresh.map((task) => task.sourceScenarioItemKey)];
    }
    const receipt = {
      key,
      scenarioHash,
      mode,
      workIds,
      itemKeys: tasks.map((task) => task.sourceScenarioItemKey),
      createdAt: new Date(),
    };
    sprint.scenarioReceipts.push(receipt);
    try {
      await sprint.save();
      cacheInvalidator?.(userId);
      require('./scenarioTelemetryService').event('export', 'committed', VERSION);
      return {
        sprintId: sprint._id,
        sourceScenarioHash: scenarioHash,
        sourceScenarioId: scenario._id || null,
        mode,
        replayed: false,
        tasksAdded: addedCount,
        tasksCreated: addedCount,
        tasksMerged: 0,
        tasksSkipped: 0,
        receipt,
        sprint,
      };
    } catch (error) {
      if (error.name !== 'VersionError') throw error;
      if (attempt === 4) throw fail(409, 'Sprint changed. Retry the export.');
    }
  }
};

const exportScenario = async (userId, sprintId, scenario, mode = 'draft') => {
  const scenarioHash =
    scenario.scenarioHash ||
    scenario.result?.scenarioHash ||
    digest({
      skills: scenario.skills,
      projects: scenario.projects,
      durationWeeks: scenario.durationWeeks,
    });
  const key = digest({ scenarioHash, mode, version: VERSION });
  const requestKey = JSON.stringify([String(userId), String(sprintId), key]);
  const existing = inFlightExports.get(requestKey);
  if (existing) {
    const result = await existing;
    return {
      ...result,
      replayed: true,
      tasksAdded: 0,
      tasksCreated: 0,
      tasksMerged: 0,
      tasksSkipped: result.receipt?.itemKeys?.length || 0,
    };
  }

  const identity = { scenarioHash, key };
  if (inFlightExports.size >= MAX_IN_FLIGHT_EXPORTS)
    return performExport(userId, sprintId, scenario, mode, identity);

  const operation = performExport(userId, sprintId, scenario, mode, identity);
  inFlightExports.set(requestKey, operation);
  try {
    return await operation;
  } finally {
    if (inFlightExports.get(requestKey) === operation) inFlightExports.delete(requestKey);
  }
};
module.exports = { exportScenario, resolveCurrentSprintId, registerSprintCreator, registerSprintExportHooks };
