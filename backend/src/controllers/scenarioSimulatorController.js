const {
  sanitizeScenarioInput,
  simulateHiringOutcome,
  getScenarioContext,
  saveScenarioForUser,
  getScenarioHistoryForUser,
  deleteScenarioForUser,
  createSprintFromScenario
} = require('../services/scenarioSimulatorService');

const validationResponse = (res, errors) => res.status(400).json({
  message: 'Scenario input is invalid.',
  errors
});

const runScenarioSimulation = async (req, res) => {
  try {
    const normalized = sanitizeScenarioInput(req.body || {});
    if (!normalized.isValid) return validationResponse(res, normalized.errors);

    const context = await getScenarioContext(req.user._id);
    const result = simulateHiringOutcome(normalized.value, {
      resumeConnected: context.sources.some((source) => source.key === 'resume' && source.connected),
      githubConnected: context.sources.some((source) => source.key === 'github' && source.connected),
      sources: context.sources
    });

    return res.json({
      message: 'Simulation complete.',
      result
    });
  } catch (error) {
    console.error('Scenario simulator error:', error.message);
    return res.status(500).json({ message: 'Failed to run scenario simulation.' });
  }
};

const getScenarioSimulatorContext = async (req, res) => {
  try {
    const context = await getScenarioContext(req.user._id);
    return res.json({ context });
  } catch (error) {
    console.error('Scenario simulator context error:', error.message);
    return res.status(500).json({ message: 'Failed to load scenario simulator context.' });
  }
};

const saveScenarioSimulation = async (req, res) => {
  try {
    const scenario = await saveScenarioForUser(req.user._id, req.body || {});
    return res.status(201).json({
      message: 'Scenario saved successfully.',
      scenario
    });
  } catch (error) {
    if (error.statusCode === 400) return validationResponse(res, error.details || []);
    console.error('Scenario save error:', error.message);
    return res.status(500).json({ message: 'Failed to save scenario.' });
  }
};

const getScenarioSimulationHistory = async (req, res) => {
  try {
    const limit = Number(req.query.limit || 8);
    const history = await getScenarioHistoryForUser(req.user._id, limit);
    return res.json({ history });
  } catch (error) {
    console.error('Scenario history error:', error.message);
    return res.status(500).json({ message: 'Failed to load scenario history.' });
  }
};

const deleteScenarioSimulation = async (req, res) => {
  try {
    const deleted = await deleteScenarioForUser(req.user._id, req.params.id);
    if (!deleted) {
      return res.status(404).json({ message: 'Scenario not found.' });
    }
    return res.json({ message: 'Scenario deleted.' });
  } catch (error) {
    console.error('Scenario delete error:', error.message);
    return res.status(500).json({ message: 'Failed to delete scenario.' });
  }
};

const createSprintFromScenarioController = async (req, res) => {
  try {
    const sprint = await createSprintFromScenario(req.user._id, req.body || {});
    return res.json({
      message: sprint.tasksAdded
        ? 'Scenario tasks were added to your Career Sprint.'
        : 'This scenario is already reflected in your current Career Sprint.',
      sprint
    });
  } catch (error) {
    if (error.statusCode === 400) return validationResponse(res, error.details || []);
    console.error('Scenario sprint handoff error:', error.message);
    return res.status(500).json({ message: 'Failed to create sprint from scenario.' });
  }
};

module.exports = {
  runScenarioSimulation,
  getScenarioSimulatorContext,
  saveScenarioSimulation,
  getScenarioSimulationHistory,
  deleteScenarioSimulation,
  createSprintFromScenarioController
};
