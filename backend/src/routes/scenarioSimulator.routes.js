const { limits, contextLimit } = require('../middleware/scenarioSimulatorMiddleware');
const express = require('express');
const { protect } = require('../middleware/authmiddleware');
const {
  runScenarioSimulation,
  getScenarioSimulatorContext,
  saveScenarioSimulation,
  getScenarioSimulationHistory,
  deleteScenarioSimulation,
  createSprintFromScenarioController,
} = require('../controllers/scenarioSimulatorController');

const router = express.Router();

router.get('/context', protect, contextLimit, getScenarioSimulatorContext);
router.get('/history', protect, limits.history, getScenarioSimulationHistory);
router.post('/what-if', protect, limits.evaluate, runScenarioSimulation);
router.post('/save', protect, limits.save, saveScenarioSimulation);
router.post('/create-sprint', protect, limits.export, createSprintFromScenarioController);
router.delete('/:id', protect, limits.delete, deleteScenarioSimulation);

module.exports = router;
