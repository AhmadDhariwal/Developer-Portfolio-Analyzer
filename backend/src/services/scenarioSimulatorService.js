'use strict';
const mongoose = require('mongoose');
const ScenarioSimulation = require('../models/scenarioSimulation');
const developerContext = require('./developerContextService');
const legacy = require('./scoring/scenarioPlanningLegacy');
const engine = require('./scoring/scenarioPlanningScore');
const { getScenarioContext } = require('./scenarioContextService');
const { digest } = require('../utils/scenarioIdentity');
const telemetry = require('./scenarioTelemetryService');
const fail = (statusCode, message, details = []) =>
  Object.assign(new Error(message), { statusCode, details });
let indexReadiness;
const requireIndexes = async () => {
  if (process.env.NODE_ENV !== 'production') return;
  if (!indexReadiness)
    indexReadiness = ScenarioSimulation.collection
      .indexes({ maxTimeMS: 1000 })
      .then((indexes) => {
        const unique = indexes.some(
          (index) =>
            index.unique &&
            !index.sparse &&
            !index.partialFilterExpression &&
            index.key.userId === 1 &&
            index.key.scenarioHash === 1 &&
            Object.keys(index.key).length === 2,
        );
        const history = indexes.some(
          (index) => JSON.stringify(index.key) === JSON.stringify({ userId: 1, createdAt: -1, _id: -1 }),
        );
        if (!unique || !history) throw new Error('Required Scenario indexes are unavailable.');
      })
      .catch(() => {
        indexReadiness = null;
        throw fail(503, 'Scenario persistence indexes require deployment verification.');
      });
  return indexReadiness;
};
const validate = (payload) => {
  if (payload?.ruleVersion === engine.RULE_VERSION) return engine.normalize(payload);
  if (payload?.ruleVersion && payload.ruleVersion !== engine.LEGACY_VERSION)
    throw fail(400, 'Unknown Scenario rule version.');
  const normalized = legacy.sanitizeScenarioInput(payload);
  if (!normalized.isValid) throw fail(400, 'Scenario validation failed.', normalized.errors);
  return normalized.value;
};
const evaluateForUser = async (userId, payload) => {
  validate(payload);
  if (payload.ruleVersion === engine.RULE_VERSION) return engine.calculate(payload);
  const context = await getScenarioContext(userId);
  const result = engine.calculate(payload, {
    sources: context.sources,
    resumeConnected: context.sources.some((item) => item.key === 'resume' && item.connected),
    githubConnected: context.sources.some((item) => item.key === 'github' && item.connected),
  });
  const finite = (value) =>
    typeof value === 'number'
      ? Number.isFinite(value)
      : value && typeof value === 'object'
        ? Object.values(value).every(finite)
        : true;
  if (!finite(result))
    throw fail(400, 'Legacy inputs do not define a finite planning result. Use scenario-planning-v2.');
  return result;
};
const saveScenarioForUser = async (userId, payload = {}) => {
  const normalized = validate(payload);
  await requireIndexes();
  const result = await evaluateForUser(userId, payload);
  if (
    payload.ruleVersion === engine.RULE_VERSION &&
    (!payload.evaluation || digest(payload.evaluation) !== digest(result.evaluation))
  )
    throw fail(409, 'Evaluation changed. Run the current draft again before saving.');
  const now = new Date();
  const document = {
    userId,
    name:
      String(payload.name || '')
        .trim()
        .slice(0, 120) || 'Scenario planning evaluation',
    ...normalized,
    scenarioHash: result.scenarioHash,
    predicted: result.predicted,
    improvements: result.improvements,
    confidenceScore: result.confidenceScore,
    breakdown: result.breakdown,
    uncertaintyRange: result.uncertaintyRange,
    warnings: result.warnings,
    result,
    recordSchemaVersion: 'scenario-snapshot-v2',
    ruleVersion: payload.ruleVersion || engine.LEGACY_VERSION,
    tableVersion: engine.TABLE_VERSION,
    evaluation: result.evaluation || {
      normalizedInput: normalized,
      calculationContext: result.assumptions.sources,
    },
    sourceContextSummary: { authority: 'user-assumption', hypothetical: true },
    createdAt: now,
    updatedAt: now,
  };
  if (Buffer.byteLength(JSON.stringify(document)) > 65536) throw fail(413, 'Scenario snapshot is too large.');
  let scenario;
  try {
    scenario = await ScenarioSimulation.findOneAndUpdate(
      { userId, scenarioHash: result.scenarioHash },
      { $setOnInsert: document },
      {
        upsert: true,
        returnDocument: 'after',
        runValidators: true,
        setDefaultsOnInsert: true,
        timestamps: false,
        maxTimeMS: 2000,
      },
    );
  } catch (error) {
    if (error.code !== 11000) throw error;
    scenario = await ScenarioSimulation.findOne({ userId, scenarioHash: result.scenarioHash }).maxTimeMS(
      2000,
    );
    if (!scenario) throw error;
  }
  telemetry.event('save', 'success', payload.ruleVersion || engine.LEGACY_VERSION);
  return scenario.toObject();
};
const getScenarioHistoryForUser = async (userId, limit = 8, options = {}) => {
  await requireIndexes();
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(20, Math.round(limit))) : 8;
  const filter = { userId };
  if (options.cursor) {
    try {
      if (typeof options.cursor !== 'string' || options.cursor.length > 200) throw Error();
      const cursor = JSON.parse(Buffer.from(options.cursor, 'base64url').toString());
      if (
        !mongoose.isObjectIdOrHexString(cursor.id) ||
        typeof cursor.createdAt !== 'string' ||
        !Number.isFinite(Date.parse(cursor.createdAt))
      )
        throw Error();
      const date = new Date(cursor.createdAt);
      filter.$or = [
        { createdAt: { $lt: date } },
        { createdAt: date, _id: { $lt: new mongoose.Types.ObjectId(cursor.id) } },
      ];
    } catch {
      throw fail(400, 'Invalid history cursor.');
    }
  }
  const records = await ScenarioSimulation.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(safeLimit + 1)
    .read('primary')
    .maxTimeMS(2000)
    .lean();
  const history = records.slice(0, safeLimit);
  const last = history.at(-1);
  return {
    history,
    nextCursor:
      records.length > safeLimit
        ? Buffer.from(JSON.stringify({ createdAt: last.createdAt, id: String(last._id) })).toString(
            'base64url',
          )
        : null,
    cache: { hit: false, version: 'scenario-history-v2' },
  };
};
const deleteScenarioForUser = async (userId, scenarioId) => {
  if (!mongoose.isObjectIdOrHexString(scenarioId)) throw fail(404, 'Scenario not found.');
  return Boolean(
    await ScenarioSimulation.findOneAndDelete({ _id: scenarioId, userId }).maxTimeMS(2000).lean(),
  );
};
const createSprintFromScenario = async (userId, payload = {}) => {
  const { exportScenario, resolveCurrentSprintId } = require('./scenarioSprintExportService');
  let scenario;
  const id = payload.scenarioId || payload.sourceScenarioId;
  if (id) {
    if (!mongoose.isObjectIdOrHexString(id)) throw fail(404, 'Scenario not found.');
    scenario = await ScenarioSimulation.findOne({ _id: id, userId }).lean();
    if (!scenario) throw fail(404, 'Scenario not found.');
    if (payload.ruleVersion && digest(validate(payload)) !== digest(scenario.evaluation?.normalizedInput))
      throw fail(409, 'Scenario source does not match the submitted plan.');
  } else {
    const input = validate(payload);
    const result = await evaluateForUser(userId, payload);
    scenario = {
      ...input,
      name: payload.name || 'Scenario planning evaluation',
      result,
      scenarioHash: result.scenarioHash,
    };
  }
  const mode = payload.mode || 'active-tasks';
  if (!['draft', 'active-tasks'].includes(mode)) throw fail(400, 'Unsupported export mode.');
  const target = payload.sprintId || String(await resolveCurrentSprintId(userId));
  return exportScenario(userId, target, scenario, mode);
};
module.exports = {
  __test: {
    loadCurrentResumeAnalysis: (userId) => developerContext.resolveResumeAnalysis(userId),
    requireIndexes,
  },
  sanitizeScenarioInput: legacy.sanitizeScenarioInput,
  simulateHiringOutcome: engine.calculate,
  evaluateForUser,
  getScenarioContext,
  invalidateContextCache: () => {},
  saveScenarioForUser,
  getScenarioHistoryForUser,
  deleteScenarioForUser,
  createSprintFromScenario,
};
