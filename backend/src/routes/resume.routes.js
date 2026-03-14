const express = require('express');
const router = express.Router();
const {
  uploadResume,
  analyzeResumeFile,
  getResumeAnalysis,
  getResumeAnalysisByUserId,
  downloadResumeGuide
} = require('../controllers/resumecontoller');
const { protect } = require('../middleware/authmiddleware');
const upload = require('../middleware/uploadmiddleware');

// Upload resume file
router.post('/upload', protect, upload.single('file'), uploadResume);

// Analyze resume
router.post('/analyze', protect, analyzeResumeFile);

// Get current user's resume analysis
router.get('/result', protect, getResumeAnalysis);

// Get specific user's resume analysis
router.get('/result/:userId', protect, getResumeAnalysisByUserId);

// Generate and download AI-powered resume improvement guide
router.get('/guide', protect, downloadResumeGuide);

module.exports = router;
