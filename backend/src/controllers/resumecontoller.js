const { extractTextFromPDF, analyzeResume } = require('../services/resumeservice');
const { generateResumeGuide } = require('../services/resumeGuideService');
const Analysis = require('../models/analysis');
const ResumeFile = require('../models/resumeFile');
const ResumeAnalysis = require('../models/resumeAnalysis');
const User = require('../models/user');
const fs = require('fs');
const { createNotification } = require('../services/notificationService');

const ensureResumeContext = async (userId) => {
  const user = await User.findById(userId).select('defaultResumeFileId activeResumeFileId');
  if (!user) return null;

  if (!user.defaultResumeFileId) {
    const latestAnalyzed = await ResumeFile.findOne({ userId, isAnalyzed: true }).sort({ uploadDate: -1 });
    const latestAny = latestAnalyzed || await ResumeFile.findOne({ userId }).sort({ uploadDate: -1 });
    if (latestAny) {
      user.defaultResumeFileId = latestAny._id;
      user.activeResumeFileId = latestAny._id;
      await user.save();
    }
  }

  if (!user.activeResumeFileId && user.defaultResumeFileId) {
    user.activeResumeFileId = user.defaultResumeFileId;
    await user.save();
  }

  return user;
};

// @desc    Upload resume file
// @route   POST /api/resume/upload
// @access  Private
const uploadResume = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No resume file uploaded' });
    }

    const resumeFile = new ResumeFile({
      userId: req.user._id,
      fileName: req.file.originalname,
      fileUrl: req.file.path,
      fileSize: req.file.size,
      mimeType: req.file.mimetype
    });

    await resumeFile.save();

    // New uploads become active resume context for this user.
    await User.findByIdAndUpdate(req.user._id, { activeResumeFileId: resumeFile._id });

    await createNotification({
      userId: req.user._id,
      type: 'resume_upload',
      title: 'New Resume Uploaded',
      message: `${resumeFile.fileName} uploaded successfully.`,
      dedupeKey: `resume_upload:${resumeFile._id}`,
      meta: { fileId: resumeFile._id, fileName: resumeFile.fileName }
    });

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

    const resumeFile = await ResumeFile.findById(fileId);
    if (!resumeFile) {
      return res.status(404).json({ message: 'Resume file not found' });
    }

    if (resumeFile.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    // Extract text from PDF
    const text = await extractTextFromPDF(resumeFile.fileUrl);

    // AI analysis
    const analysis = await analyzeResume(text, resumeFile.fileName, resumeFile.fileSize);

    // Persist to DB
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
      experienceYears: analysis.experienceYears,
      experienceLevel: analysis.experienceLevel,
      certifications: analysis.certifications,
      keyAchievements: analysis.keyAchievements,
      scoreBreakdown: analysis.scoreBreakdown,
      suggestions: analysis.suggestions,
      uploadDate: resumeFile.uploadDate,
      analyzedAt: new Date()
    });

    await resumeAnalysis.save();

    resumeFile.isAnalyzed = true;
    await resumeFile.save();

    const user = await User.findById(req.user._id);
    if (user) {
      user.activeResumeFileId = resumeFile._id;
      if (!user.defaultResumeFileId) {
        user.defaultResumeFileId = resumeFile._id;
      }
      await user.save();
    }

    await createNotification({
      userId: req.user._id,
      type: 'resume_upload',
      title: 'Resume Analysis Completed',
      message: `Analysis finished for ${resumeFile.fileName} (ATS ${analysis.atsScore}%).`,
      dedupeKey: `resume_analysis:${resumeFile._id}`,
      meta: { fileId: resumeFile._id, atsScore: analysis.atsScore }
    });

    res.json({
      message: 'Resume analyzed successfully',
      atsScore: analysis.atsScore,
      keywordDensity: analysis.keywordDensity,
      formatScore: analysis.formatScore,
      contentQuality: analysis.contentQuality,
      skills: analysis.skills,
      experienceYears: analysis.experienceYears,
      experienceLevel: analysis.experienceLevel,
      certifications: analysis.certifications,
      keyAchievements: analysis.keyAchievements,
      scoreBreakdown: analysis.scoreBreakdown,
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

/** Convert a Mongoose Map or plain object to a plain JS object */
const mapToObj = (skills) => {
  if (skills instanceof Map) {
    const obj = {};
    skills.forEach((value, key) => { obj[key] = value; });
    return obj;
  }
  return Object.assign({}, skills);
};

// @desc    Get resume analysis for current user
// @route   GET /api/resume/result
// @access  Private
const getResumeAnalysis = async (req, res) => {
  try {
    const user = await ensureResumeContext(req.user._id);
    const activeFileId = user?.activeResumeFileId || user?.defaultResumeFileId || null;

    let analysis = null;
    if (activeFileId) {
      analysis = await ResumeAnalysis.findOne({ userId: req.user._id, fileId: activeFileId }).sort({ analyzedAt: -1 });
    }
    if (!analysis) {
      analysis = await ResumeAnalysis.findOne({ userId: req.user._id }).sort({ analyzedAt: -1 });
    }

    if (!analysis) {
      return res.status(404).json({ message: 'No analysis found' });
    }

    res.json({
      atsScore: analysis.atsScore,
      keywordDensity: analysis.keywordDensity,
      formatScore: analysis.formatScore,
      contentQuality: analysis.contentQuality,
      skills: mapToObj(analysis.skills),
      experienceYears: analysis.experienceYears,
      experienceLevel: analysis.experienceLevel,
      certifications: analysis.certifications,
      keyAchievements: analysis.keyAchievements,
      scoreBreakdown: analysis.scoreBreakdown,
      suggestions: analysis.suggestions,
      fileId: analysis.fileId,
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

    res.json({
      atsScore: analysis.atsScore,
      keywordDensity: analysis.keywordDensity,
      formatScore: analysis.formatScore,
      contentQuality: analysis.contentQuality,
      skills: mapToObj(analysis.skills),
      experienceYears: analysis.experienceYears,
      experienceLevel: analysis.experienceLevel,
      certifications: analysis.certifications,
      keyAchievements: analysis.keyAchievements,
      scoreBreakdown: analysis.scoreBreakdown,
      suggestions: analysis.suggestions,
      fileId: analysis.fileId,
      fileName: analysis.fileName,
      fileSize: analysis.fileSize,
      uploadDate: analysis.uploadDate
    });
  } catch (error) {
    console.error('Get Analysis Error:', error);
    res.status(500).json({ message: error.message || 'Server Error' });
  }
};

// @desc    Generate and download a personalised AI resume improvement guide
// @route   GET /api/resume/guide
// @access  Private
const downloadResumeGuide = async (req, res) => {
  try {
    const analysis = await ResumeAnalysis.findOne({ userId: req.user._id })
      .sort({ analyzedAt: -1 });

    if (!analysis) {
      return res.status(404).json({
        message: 'No resume analysis found. Please upload and analyze your resume first.'
      });
    }

    const htmlContent = await generateResumeGuide(analysis);

    const safeName = (analysis.fileName || 'resume')
      .replace(/\.pdf$/i, '')
      .replace(/[^a-z0-9_-]/gi, '-')
      .toLowerCase();

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="resume-guide-${safeName}.html"`);
    res.setHeader('Cache-Control', 'no-cache');
    res.send(htmlContent);
  } catch (error) {
    console.error('Resume Guide Error:', error);
    res.status(500).json({ message: error.message || 'Failed to generate resume guide' });
  }
};

// @desc    List resume files for current user
// @route   GET /api/resume/files
// @access  Private
const getResumeFiles = async (req, res) => {
  try {
    const user = await ensureResumeContext(req.user._id);
    const files = await ResumeFile.find({ userId: req.user._id }).sort({ uploadDate: -1 }).lean();

    res.json({
      files: files.map((f) => ({
        fileId: f._id,
        fileName: f.fileName,
        fileSize: f.fileSize,
        uploadDate: f.uploadDate,
        isAnalyzed: !!f.isAnalyzed,
        isDefault: String(user?.defaultResumeFileId || '') === String(f._id),
        isActive: String(user?.activeResumeFileId || '') === String(f._id)
      }))
    });
  } catch (error) {
    console.error('Resume files error:', error);
    res.status(500).json({ message: error.message || 'Server Error' });
  }
};

// @desc    Get active/default resume context for current user
// @route   GET /api/resume/active
// @access  Private
const getActiveResumeContext = async (req, res) => {
  try {
    const user = await ensureResumeContext(req.user._id);
    const activeFileId = user?.activeResumeFileId || user?.defaultResumeFileId || null;

    const [defaultFile, activeFile] = await Promise.all([
      user?.defaultResumeFileId ? ResumeFile.findOne({ _id: user.defaultResumeFileId, userId: req.user._id }).lean() : null,
      activeFileId ? ResumeFile.findOne({ _id: activeFileId, userId: req.user._id }).lean() : null
    ]);

    res.json({
      defaultResume: defaultFile ? {
        fileId: defaultFile._id,
        fileName: defaultFile.fileName,
        uploadDate: defaultFile.uploadDate,
        isAnalyzed: !!defaultFile.isAnalyzed
      } : null,
      activeResume: activeFile ? {
        fileId: activeFile._id,
        fileName: activeFile.fileName,
        uploadDate: activeFile.uploadDate,
        isAnalyzed: !!activeFile.isAnalyzed
      } : null
    });
  } catch (error) {
    console.error('Active resume context error:', error);
    res.status(500).json({ message: error.message || 'Server Error' });
  }
};

// @desc    Set active resume (and optionally default resume)
// @route   PUT /api/resume/active
// @access  Private
const setActiveResume = async (req, res) => {
  try {
    const { fileId, setAsDefault } = req.body;
    if (!fileId) {
      return res.status(400).json({ message: 'fileId is required' });
    }

    const resumeFile = await ResumeFile.findOne({ _id: fileId, userId: req.user._id });
    if (!resumeFile) {
      return res.status(404).json({ message: 'Resume file not found' });
    }

    const update = { activeResumeFileId: resumeFile._id };
    if (setAsDefault === true) {
      update.defaultResumeFileId = resumeFile._id;
    }
    await User.findByIdAndUpdate(req.user._id, update);

    res.json({
      message: setAsDefault ? 'Active and default resume updated' : 'Active resume updated',
      fileId: resumeFile._id
    });
  } catch (error) {
    console.error('Set active resume error:', error);
    res.status(500).json({ message: error.message || 'Server Error' });
  }
};

module.exports = {
  uploadResume,
  analyzeResumeFile,
  getResumeAnalysis,
  getResumeAnalysisByUserId,
  downloadResumeGuide,
  getResumeFiles,
  getActiveResumeContext,
  setActiveResume
};
