'use strict';
const service = require('../services/scenarioSimulatorService');
const telemetry = require('../services/scenarioTelemetryService');
const handle = (operation, work) => async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  try {
    return await work(req, res);
  } catch (error) {
    const status = [400, 404, 409, 413, 429, 503].includes(error.statusCode) ? error.statusCode : 500;
    telemetry.event(operation, String(status));
    if (status === 503) res.set('Retry-After', '2');
    return res.status(status).json({
      message: status === 500 ? 'Scenario operation failed.' : error.message,
      ...(error.details?.length ? { errors: error.details } : {}),
    });
  }
};
const runScenarioSimulation = handle('evaluate', async (req, res) => {
  const result = await service.evaluateForUser(req.user._id, req.body || {});
  telemetry.event('evaluate', 'success', req.body.ruleVersion || 'scenario-planning-legacy-v1');
  return res.json({ message: 'Simulation complete.', result });
});
const getScenarioSimulatorContext = handle('context', async (req, res) =>
  res.json({ context: await service.getScenarioContext(req.user._id, { user: req.user }) }),
);
const saveScenarioSimulation = handle('save', async (req, res) =>
  res.status(201).json({
    message: 'Scenario saved successfully.',
    scenario: await service.saveScenarioForUser(req.user._id, req.body || {}),
  }),
);
const getScenarioSimulationHistory = handle('history', async (req, res) =>
  res.json(
    await service.getScenarioHistoryForUser(req.user._id, Number(req.query.limit || 8), {
      cursor: req.query.cursor,
    }),
  ),
);
const deleteScenarioSimulation = handle('delete', async (req, res) => {
  if (!(await service.deleteScenarioForUser(req.user._id, req.params.id)))
    return res.status(404).json({ message: 'Scenario not found.' });
  return res.json({ message: 'Scenario deleted.' });
});
const createSprintFromScenarioController = handle('export', async (req, res) => {
  const sprint = await service.createSprintFromScenario(req.user._id, req.body || {});
  const { sprint: document, ...summary } = sprint;
  return res.json({
    message:
      sprint.mode === 'draft'
        ? 'Scenario saved as a reviewable draft.'
        : 'Scenario exported as incomplete active tasks.',
    sprint: summary,
  });
});
module.exports = {
  runScenarioSimulation,
  getScenarioSimulatorContext,
  saveScenarioSimulation,
  getScenarioSimulationHistory,
  deleteScenarioSimulation,
  createSprintFromScenarioController,
};
