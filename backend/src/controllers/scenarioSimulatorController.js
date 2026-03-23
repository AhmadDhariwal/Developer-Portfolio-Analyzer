const { simulateHiringOutcome } = require('../services/scenarioSimulatorService');

const runScenarioSimulation = async (req, res) => {
  try {
    const payload = req.body || {};
    const result = simulateHiringOutcome({
      baselineHiringScore: payload.baselineHiringScore,
      baselineJobMatch: payload.baselineJobMatch,
      skills: payload.skills,
      projects: payload.projects
    });

    return res.json({
      message: 'Scenario simulation complete.',
      result
    });
  } catch (error) {
    console.error('Scenario simulator error:', error.message);
    return res.status(500).json({ message: 'Failed to run scenario simulation.' });
  }
};

module.exports = { runScenarioSimulation };
