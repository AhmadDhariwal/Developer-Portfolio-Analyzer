const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authmiddleware');
const {
  startWorkflow,
  getWorkflowById,
  listWorkflows
} = require('../controllers/workflowcontroller');

router.post('/', protect, startWorkflow);
router.get('/', protect, listWorkflows);
router.get('/:id', protect, getWorkflowById);

module.exports = router;
