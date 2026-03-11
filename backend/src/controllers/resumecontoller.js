const { extractTextFromPDF, analyzeResume } = require('../services/resumeservice');
const Analysis = require('../models/analysis');
const ResumeFile = require('../models/resumeFile');
const ResumeAnalysis = require('../models/resumeAnalysis');
const fs = require('fs');

// @desc    Upload resume file
// @route   POST /api/resume/upload
// @access  Private
const uploadResume = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No resume file uploaded' });
    }

    // Create ResumeFile record
    const resumeFile = new ResumeFile({
      userId: req.user._id,
      fileName: req.file.originalname,
      fileUrl: req.file.path,
      fileSize: req.file.size,
      mimeType: req.file.mimetype
    });

    await resumeFile.save();

    res.json({
      message: 'Resume uploaded successfully',
      fileId: resumeFile._id,
      fileName: resumeFile.fileName,
      fileSize: resumeFile.fileSize
    });
  } catch (error) {
    console.error('Resume Upload Error:', error);
    res.status(500).json({ message: error.message || 'Server Error' });
  }
};

// @desc    Analyze resume
// @route   POST /api/resume/analyze
// @access  Private
const analyzeResumeFile = async (req, res) => {
  try {
    const { fileId } = req.body;

    if (!fileId) {
      return res.status(400).json({ message: 'fileId is required' });
    }

    // Get the resume file
    const resumeFile = await ResumeFile.findById(fileId);
    if (!resumeFile) {
      return res.status(404).json({ message: 'Resume file not found' });
    }

    // Verify user owns this file
    if (resumeFile.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    // Extract text from PDF
    const text = await extractTextFromPDF(resumeFile.fileUrl);

    // Analyze resume
    const analysis = analyzeResume(text, resumeFile.fileName, resumeFile.fileSize);

    // Save analysis to database
    const resumeAnalysis = new ResumeAnalysis({
      userId: req.user._id,
      fileId: resumeFile._id,
      fileName: analysis.fileName,
      fileSize: analysis.fileSize,
      atsScore: analysis.atsScore,
      keywordDensity: analysis.keywordDensity,
      formatScore: analysis.formatScore,
      contentQuality: analysis.contentQuality,
      skills: new Map(Object.entries(analysis.skills)),
      suggestions: analysis.suggestions,
      uploadDate: resumeFile.uploadDate,
      analyzedAt: new Date()
    });

    await resumeAnalysis.save();

    // Mark file as analyzed
    resumeFile.isAnalyzed = true;
    await resumeFile.save();

    // Return analysis
    res.json({
      message: 'Resume analyzed successfully',
      atsScore: analysis.atsScore,
      keywordDensity: analysis.keywordDensity,
      formatScore: analysis.formatScore,
      contentQuality: analysis.contentQuality,
      skills: analysis.skills,
      suggestions: analysis.suggestions,
      fileName: analysis.fileName,
      fileSize: analysis.fileSize,
      uploadDate: resumeFile.uploadDate
    });
  } catch (error) {
    console.error('Resume Analysis Error:', error);
    res.status(500).json({ message: error.message || 'Server Error' });
  }
};

// @desc    Get resume analysis for current user
// @route   GET /api/resume/result
// @access  Private
const getResumeAnalysis = async (req, res) => {
  try {
    const analysis = await ResumeAnalysis.findOne({ userId: req.user._id })
      .sort({ analyzedAt: -1 });

    if (!analysis) {
      return res.status(404).json({ message: 'No analysis found' });
    }

    // Convert Map to Object
    const skillsObj = {};
    if (analysis.skills instanceof Map) {
      analysis.skills.forEach((value, key) => {
        skillsObj[key] = value;
      });
    } else {
      Object.assign(skillsObj, analysis.skills);
    }

    res.json({
      atsScore: analysis.atsScore,
      keywordDensity: analysis.keywordDensity,
      formatScore: analysis.formatScore,
      contentQuality: analysis.contentQuality,
      skills: skillsObj,
      suggestions: analysis.suggestions,
      fileName: analysis.fileName,
      fileSize: analysis.fileSize,
      uploadDate: analysis.uploadDate
    });
  } catch (error) {
    console.error('Get Analysis Error:', error);
    res.status(500).json({ message: error.message || 'Server Error' });
  }
};

// @desc    Get resume analysis by user ID
// @route   GET /api/resume/result/:userId
// @access  Private
const getResumeAnalysisByUserId = async (req, res) => {
  try {
    const { userId } = req.params;

    const analysis = await ResumeAnalysis.findOne({ userId })
      .sort({ analyzedAt: -1 });

    if (!analysis) {
      return res.status(404).json({ message: 'No analysis found for this user' });
    }

    // Convert Map to Object
    const skillsObj = {};
    if (analysis.skills instanceof Map) {
      analysis.skills.forEach((value, key) => {
        skillsObj[key] = value;
      });
    } else {
      Object.assign(skillsObj, analysis.skills);
    }

    res.json({
      atsScore: analysis.atsScore,
      keywordDensity: analysis.keywordDensity,
      formatScore: analysis.formatScore,
      contentQuality: analysis.contentQuality,
      skills: skillsObj,
      suggestions: analysis.suggestions,
      fileName: analysis.fileName,
      fileSize: analysis.fileSize,
      uploadDate: analysis.uploadDate
    });
  } catch (error) {
    console.error('Get Analysis Error:', error);
    res.status(500).json({ message: error.message || 'Server Error' });
  }
};

module.exports = {
  uploadResume,
  analyzeResumeFile,
  getResumeAnalysis,
  getResumeAnalysisByUserId
};
