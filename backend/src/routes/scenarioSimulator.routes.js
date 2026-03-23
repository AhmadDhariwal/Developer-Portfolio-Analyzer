const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authmiddleware');
const { runScenarioSimulation } = require('../controllers/scenarioSimulatorController');

router.post('/what-if', protect, runScenarioSimulation);

module.exports = router;
