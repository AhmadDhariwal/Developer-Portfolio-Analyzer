const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authmiddleware');
const {
  generateInterviewPrepSession,
  getInterviewPrepHistory
} = require('../controllers/interviewPrepController');

router.post('/', protect, generateInterviewPrepSession);
router.get('/history', protect, getInterviewPrepHistory);

module.exports = router;
