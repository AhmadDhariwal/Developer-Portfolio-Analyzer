const express = require('express');
const { protect } = require('../middleware/authmiddleware');
const {
  runScenarioSimulation,
  getScenarioSimulatorContext,
  saveScenarioSimulation,
  getScenarioSimulationHistory,
  deleteScenarioSimulation,
  createSprintFromScenarioController
} = require('../controllers/scenarioSimulatorController');

const router = express.Router();

router.get('/context', protect, getScenarioSimulatorContext);
router.get('/history', protect, getScenarioSimulationHistory);
router.post('/what-if', protect, runScenarioSimulation);
router.post('/save', protect, saveScenarioSimulation);
router.post('/create-sprint', protect, createSprintFromScenarioController);
router.delete('/:id', protect, deleteScenarioSimulation);

module.exports = router;
