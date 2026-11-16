const express = require('express');
const router = express.Router();
const { protect } = require('../../core/middleware/authmiddleware');
const {
  startWorkflow,
  getWorkflowById,
  listWorkflows
} = require('./workflowcontroller');

router.post('/', protect, startWorkflow);
router.get('/', protect, listWorkflows);
router.get('/:id', protect, getWorkflowById);

module.exports = router;
