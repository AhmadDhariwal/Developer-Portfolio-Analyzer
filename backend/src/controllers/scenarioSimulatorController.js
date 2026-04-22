const { simulateHiringOutcome } = require('../services/scenarioSimulatorService');

const runScenarioSimulation = async (req, res) => {
  try {
    const payload = req.body || {};

    // Validate required fields
    const baselineHiringScore = Number(payload.baselineHiringScore);
    const baselineJobMatch    = Number(payload.baselineJobMatch);

    if (isNaN(baselineHiringScore) || baselineHiringScore < 0 || baselineHiringScore > 100) {
      return res.status(400).json({ message: 'baselineHiringScore must be 0–100.' });
    }
    if (isNaN(baselineJobMatch) || baselineJobMatch < 0 || baselineJobMatch > 100) {
      return res.status(400).json({ message: 'baselineJobMatch must be 0–100.' });
    }

    const skills   = Array.isArray(payload.skills)   ? payload.skills   : [];
    const projects = Array.isArray(payload.projects) ? payload.projects : [];

    if (skills.length === 0 && projects.length === 0) {
      return res.status(400).json({ message: 'Add at least one skill or project to simulate.' });
    }

    const result = simulateHiringOutcome({
      baselineHiringScore,
      baselineJobMatch,
      role:            payload.role            || 'full stack',
      experienceLevel: payload.experienceLevel || 'mid',
      skills,
      projects,
      durationWeeks:   Number(payload.durationWeeks) || 6
    });

    return res.json({ message: 'Simulation complete.', result });
  } catch (error) {
    console.error('Scenario simulator error:', error.message);
    return res.status(500).json({ message: 'Failed to run scenario simulation.' });
  }
};

module.exports = { runScenarioSimulation };
