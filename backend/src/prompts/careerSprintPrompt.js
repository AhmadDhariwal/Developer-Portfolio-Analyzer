'use strict';

// No model-authored factual text crosses this boundary. Only references to the
// deterministic, owned preview targets can affect optional sequencing.
const { prompt } = require('../services/sprintAiSelectionService');
const getCareerSprintPrompt = ({ baselineTasks = [] } = {}) => prompt(baselineTasks.slice(0, 8));
module.exports = { getCareerSprintPrompt };
