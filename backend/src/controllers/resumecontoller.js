const { extractTextFromPDF, analyzeResume, findCachedResumeAnalysis, persistResumeAnalysisCache, ANALYSIS_VERSION } = require('../services/resumeservice');
const { generateResumeGuide } = require('../services/resumeGuideService');
const ResumeFile = require('../models/resumeFile');
const ResumeAnalysis = require('../models/resumeAnalysis');
const User = require('../models/user');
const fs = require('fs/promises');
const path = require('path');
const { createNotification } = require('../services/notificationService');
const { invalidateDashboardSummaryCache } = require('./dashboardcontroller');
const { invalidateCareerSprintCache } = require('../services/careerSprintService');
const { invalidateContextCache } = require('../services/scenarioSimulatorService');
const { createPreviewResume } = require('../services/previewResumeCacheService');

const resumeAnalysisInflight = new Map();

const elapsedMs = (startedAt) => Number((process.hrtime.bigint() - startedAt) / 1000000n);

const createPipelineTimings = () => ({
  fileLookupMs: 0,
  fileReadMs: 0,
  pdfExtractionMs: 0,
  parsingMs: 0,
  skillDetectionMs: 0,
  scoringMs: 0,
  aiMs: 0,
  resumeAnalysisLookupMs: 0,
  resumeAnalysisPersistenceMs: 0,
  cachePersistenceMs: 0,
  userDefaultUpdateMs: 0,
  invalidationNotificationMs: 0,
  responseSerializationMs: 0
});

const logPipelineTiming = ({ forceRefresh, cacheHit, status, timings, totalDurationMs }) => {
  if (process.env.RESUME_TIMING !== '1') return;
  console.info('[ResumeAnalysisTiming]', JSON.stringify({
    forceRefresh: Boolean(forceRefresh),
    cacheHit: Boolean(cacheHit),
    status,
    ...timings,
    totalMs: totalDurationMs
  }));
};

const toForceRefresh = (req) => (
  String(req.body?.forceRefresh ?? req.query?.forceRefresh ?? '').toLowerCase() === 'true'
);

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
  let resumeFilePersisted = false;
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No resume file uploaded' });
    }

    const fileHandle = await fs.open(req.file.path, 'r');
    const signature = Buffer.alloc(5);
    try {
      await fileHandle.read(signature, 0, signature.length, 0);
    } finally {
      await fileHandle.close();
    }
    if (signature.toString('ascii') !== '%PDF-') {
      await fs.unlink(req.file.path).catch(() => {});
      return res.status(400).json({ message: 'Only valid PDF files are allowed' });
    }

    const resumeFile = new ResumeFile({
      userId: req.user._id,
      fileName: req.file.originalname,
      fileUrl: req.file.path,
      fileSize: req.file.size,
      mimeType: req.file.mimetype
    });

    await resumeFile.save();
    resumeFilePersisted = true;

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
    if (req.file?.path && !resumeFilePersisted) {
      await fs.unlink(req.file.path).catch(() => {});
    }
    console.error('Resume Upload Error:', error);
    res.status(500).json({ message: 'Resume upload could not be completed.' });
  }
};

// @desc    Analyze resume
// @route   POST /api/resume/analyze
// @access  Private
const analyzeResumeFileCore = async (req, res) => {
  const pipelineStartedAt = process.hrtime.bigint();
  const timings = createPipelineTimings();
  const addTiming = (stage, durationMs) => {
    if (Object.prototype.hasOwnProperty.call(timings, stage)) {
      timings[stage] += Number(durationMs || 0);
    }
  };
  let fileId = req.body?.fileId || '';
  const forceRefresh = toForceRefresh(req);
  let cacheHit = false;
  let status = 'error';

  try {
    if (!fileId) {
      status = 'validation_error';
      return res.status(400).json({ message: 'fileId is required' });
    }

    const fileLookupStartedAt = process.hrtime.bigint();
    const resumeFile = await ResumeFile.findById(fileId);
    addTiming('fileLookupMs', elapsedMs(fileLookupStartedAt));
    if (!resumeFile) {
      status = 'not_found';
      return res.status(404).json({ message: 'Resume file not found' });
    }

    const resolvedFilePath = path.resolve(String(resumeFile.fileUrl || ''));
    const uploadsRoot = path.resolve(process.cwd(), 'uploads') + path.sep;
    if (!resolvedFilePath.startsWith(uploadsRoot)) {
      status = 'invalid_file_path';
      return res.status(400).json({ message: 'Resume file is unavailable.' });
    }

    if (resumeFile.userId.toString() !== req.user._id.toString()) {
      status = 'forbidden';
      return res.status(403).json({ message: 'Unauthorized' });
    }

    const canLookupBeforeExtraction = !forceRefresh
      && resumeFile.resumeHash
      && resumeFile.analysisVersion === ANALYSIS_VERSION;
    let analysis = canLookupBeforeExtraction
      ? await findCachedResumeAnalysis({
        userId: req.user._id,
        resumeFileId: resumeFile._id,
        resumeHash: resumeFile.resumeHash,
        analysisVersion: ANALYSIS_VERSION,
        onTiming: addTiming
      })
      : null;

    let userContext;
    if (analysis) {
      userContext = await User.findById(req.user._id)
        .select('defaultResumeFileId activeResumeFileId');
    } else {
      const text = await extractTextFromPDF(resolvedFilePath, { onTiming: addTiming });

      const [loadedUserContext, previousAnalysis] = await Promise.all([
        User.findById(req.user._id).select('defaultResumeFileId activeResumeFileId'),
        ResumeAnalysis.findOne({ userId: req.user._id }).sort({ analyzedAt: -1 }).lean()
      ]);
      userContext = loadedUserContext;
      analysis = await analyzeResume(text, resumeFile.fileName, resumeFile.fileSize, {
        userId: req.user._id,
        resumeFileId: resumeFile._id,
        forceRefresh,
        cacheLookupCompleted: canLookupBeforeExtraction,
        previousAnalysis,
        deferCacheWrite: true,
        onTiming: addTiming
      });
    }
    cacheHit = Boolean(analysis.cacheMetadata?.loadedFromCache) && !forceRefresh;

    const resumeAnalysisLookupStartedAt = process.hrtime.bigint();
    let resumeAnalysis = await ResumeAnalysis.findOne({
      userId: req.user._id,
      fileId: resumeFile._id,
      resumeHash: analysis.resumeHash,
      analysisVersion: analysis.analysisVersion || ANALYSIS_VERSION
    }).sort({ analyzedAt: -1 });
    addTiming('resumeAnalysisLookupMs', elapsedMs(resumeAnalysisLookupStartedAt));

    let createdAnalysis = false;
    if (!resumeAnalysis || forceRefresh) {
      const persistedFields = {
        userId: req.user._id,
        fileId: resumeFile._id,
        fileName: analysis.fileName,
        fileSize: analysis.fileSize,
        atsScore: analysis.atsScore,
        keywordDensity: analysis.keywordDensity,
        formatScore: analysis.formatScore,
        contentQuality: analysis.contentQuality,
        skills: new Map(Object.entries(analysis.skills || {})),
        experienceYears: analysis.experienceYears,
        experienceLevel: analysis.experienceLevel,
        certifications: analysis.certifications,
        keyAchievements: analysis.keyAchievements,
        scoreBreakdown: analysis.scoreBreakdown,
        suggestions: analysis.suggestions,
        resumeHash: analysis.resumeHash,
        analysisVersion: analysis.analysisVersion || ANALYSIS_VERSION,
        normalized: analysis.normalized,
        qualityScores: analysis.qualityScores,
        technologyCategories: analysis.technologyCategories,
        consistencyWarnings: analysis.consistencyWarnings,
        recruiterPerspective: analysis.recruiterPerspective,
        resumeSignals: analysis.resumeSignals,
        aiInsights: analysis.aiInsights,
        cacheMetadata: analysis.cacheMetadata,
        previousAnalysisId: analysis.previousAnalysisId,
        improvementDelta: analysis.improvementDelta,
        scoreChanges: analysis.scoreChanges,
        newSkillsAdded: analysis.newSkillsAdded,
        uploadDate: resumeFile.uploadDate,
        analyzedAt: new Date()
      };
      if (!resumeAnalysis) {
        resumeAnalysis = new ResumeAnalysis(persistedFields);
      } else {
        resumeAnalysis.set(persistedFields);
      }

      const analysisWriteStartedAt = process.hrtime.bigint();
      await resumeAnalysis.save();
      addTiming('resumeAnalysisPersistenceMs', elapsedMs(analysisWriteStartedAt));
      await persistResumeAnalysisCache({
        userId: req.user._id,
        resumeFileId: resumeFile._id,
        resumeHash: analysis.resumeHash,
        analysisVersion: analysis.analysisVersion || ANALYSIS_VERSION,
        result: analysis,
        onTiming: addTiming
      });
      createdAnalysis = true;
    }
    const resolvedResumeHash = analysis.resumeHash || resumeFile.resumeHash || '';
    const resolvedAnalysisVersion = analysis.analysisVersion || ANALYSIS_VERSION;
    const resumeFileNeedsSave = !resumeFile.isAnalyzed
      || resumeFile.resumeHash !== resolvedResumeHash
      || resumeFile.analysisVersion !== resolvedAnalysisVersion
      || createdAnalysis;
    if (resumeFileNeedsSave) {
      resumeFile.isAnalyzed = true;
      resumeFile.resumeHash = resolvedResumeHash;
      resumeFile.lastAnalyzedAt = resumeAnalysis.analyzedAt || new Date();
      resumeFile.analysisVersion = resolvedAnalysisVersion;
    }

    let userNeedsSave = false;
    if (userContext) {
      if (String(userContext.activeResumeFileId || '') !== String(resumeFile._id)) {
        userContext.activeResumeFileId = resumeFile._id;
        userNeedsSave = true;
      }
      if (!userContext.defaultResumeFileId) {
        userContext.defaultResumeFileId = resumeFile._id;
        userNeedsSave = true;
      }
    }

    const contextWritesStartedAt = process.hrtime.bigint();
    await Promise.all([
      resumeFileNeedsSave ? resumeFile.save() : null,
      userNeedsSave ? userContext.save() : null,
      createdAnalysis
        ? createNotification({
          userId: req.user._id,
          type: 'resume_upload',
          title: 'Resume Analysis Completed',
          message: `Analysis finished for ${resumeFile.fileName} (ATS ${analysis.atsScore}%).`,
          dedupeKey: `resume_analysis:${resumeFile._id}`,
          meta: { fileId: resumeFile._id, atsScore: analysis.atsScore }
        })
        : null
    ]);
    addTiming('userDefaultUpdateMs', elapsedMs(contextWritesStartedAt));

    if (createdAnalysis || userNeedsSave) {
      const invalidationStartedAt = process.hrtime.bigint();
      invalidateDashboardSummaryCache(req.user._id);
      invalidateCareerSprintCache(req.user._id);
      invalidateContextCache(req.user._id);
      addTiming('invalidationNotificationMs', elapsedMs(invalidationStartedAt));
    }

    const responsePayload = {
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
      fileId: resumeFile._id,
      uploadDate: resumeFile.uploadDate,
      analyzedAt: resumeAnalysis.analyzedAt,
      resumeHash: analysis.resumeHash,
      analysisVersion: analysis.analysisVersion || ANALYSIS_VERSION,
      normalized: analysis.normalized,
      qualityScores: analysis.qualityScores,
      technologyCategories: analysis.technologyCategories,
      consistencyWarnings: analysis.consistencyWarnings,
      recruiterPerspective: analysis.recruiterPerspective,
      resumeSignals: analysis.resumeSignals,
      aiInsights: analysis.aiInsights,
      cacheMetadata: analysis.cacheMetadata,
      previousAnalysisId: analysis.previousAnalysisId,
      improvementDelta: analysis.improvementDelta,
      scoreChanges: analysis.scoreChanges,
      newSkillsAdded: analysis.newSkillsAdded
    };
    const serializationStartedAt = process.hrtime.bigint();
    res.json(responsePayload);
    addTiming('responseSerializationMs', elapsedMs(serializationStartedAt));
    status = 'success';
  } catch (error) {
    console.error('Resume Analysis Error');
    res.status(error?.code === 'RESUME_UNREADABLE_PDF' ? 422 : 500).json({
      message: error?.code === 'RESUME_UNREADABLE_PDF' ? 'Resume PDF has no readable text.' : 'Resume analysis could not be completed.'
    });
  } finally {
    logPipelineTiming({
      forceRefresh,
      cacheHit,
      status,
      timings,
      totalDurationMs: elapsedMs(pipelineStartedAt)
    });
  }
};

const captureAnalysisResponse = () => {
  const captured = { statusCode: 200, payload: null };
  const response = {
    status(code) { captured.statusCode = code; return response; },
    json(payload) { captured.payload = payload; return response; }
  };
  return { captured, response };
};

const buildResumeAnalysisInflightKey = ({ userId, resumeFileId, resumeHash, forceRefresh }) => [
  String(userId || ''), String(resumeFileId || ''), String(resumeHash || 'pending'), ANALYSIS_VERSION,
  forceRefresh ? 'force' : 'normal'
].join(':');

const analyzeResumeFile = async (req, res) => {
  const fileId = String(req.body?.fileId || '').trim();
  if (!fileId || !req.user?._id) return analyzeResumeFileCore(req, res);
  const resumeFile = await ResumeFile.findOne({ _id: fileId, userId: req.user._id })
    .select('_id resumeHash')
    .lean()
    .catch(() => null);
  if (!resumeFile) return analyzeResumeFileCore(req, res);

  const key = buildResumeAnalysisInflightKey({
    userId: req.user._id,
    resumeFileId: resumeFile._id,
    resumeHash: resumeFile.resumeHash,
    forceRefresh: toForceRefresh(req)
  });
  let pending = resumeAnalysisInflight.get(key);
  if (!pending) {
    pending = (async () => {
      const { captured, response } = captureAnalysisResponse();
      await analyzeResumeFileCore(req, response);
      return captured;
    })();
    resumeAnalysisInflight.set(key, pending);
  }
  try {
    const outcome = await pending;
    return res.status(outcome.statusCode).json(outcome.payload);
  } finally {
    if (resumeAnalysisInflight.get(key) === pending) resumeAnalysisInflight.delete(key);
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

const serializeAnalysis = (analysis) => ({
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
  uploadDate: analysis.uploadDate,
  analyzedAt: analysis.analyzedAt,
  resumeHash: analysis.resumeHash || '',
  analysisVersion: analysis.analysisVersion || ANALYSIS_VERSION,
  normalized: analysis.normalized || {},
  qualityScores: analysis.qualityScores || {},
  technologyCategories: analysis.technologyCategories || {},
  consistencyWarnings: analysis.consistencyWarnings || [],
  recruiterPerspective: analysis.recruiterPerspective || {},
  resumeSignals: analysis.resumeSignals || {},
  aiInsights: analysis.aiInsights || {},
  cacheMetadata: {
    ...(analysis.cacheMetadata || {}),
    loadedFromCache: false,
    analysisVersion: analysis.analysisVersion || ANALYSIS_VERSION,
    resumeHash: analysis.resumeHash || ''
  },
  previousAnalysisId: analysis.previousAnalysisId || null,
  improvementDelta: analysis.improvementDelta || {},
  scoreChanges: analysis.scoreChanges || {},
  newSkillsAdded: analysis.newSkillsAdded || []
});

// @desc    Get resume analysis for current user
// @route   GET /api/resume/result
// @access  Private
const getResumeAnalysis = async (req, res) => {
  try {
    const user = await ensureResumeContext(req.user._id);
    const requestedFileId = String(req.query.fileId || '').trim();
    const defaultFileId = user?.defaultResumeFileId || null;
    const targetFileId = requestedFileId || defaultFileId;

    let analysis = null;
    if (targetFileId) {
      analysis = await ResumeAnalysis.findOne({ userId: req.user._id, fileId: targetFileId }).sort({ analyzedAt: -1 });
    }
    if (!analysis) {
      analysis = await ResumeAnalysis.findOne({ userId: req.user._id }).sort({ analyzedAt: -1 });
    }

    if (!analysis) {
      return res.status(404).json({ message: 'No analysis found' });
    }

    res.json(serializeAnalysis(analysis));
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
    if (String(userId) !== String(req.user?._id || '')) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    const analysis = await ResumeAnalysis.findOne({ userId })
      .sort({ analyzedAt: -1 });

    if (!analysis) {
      return res.status(404).json({ message: 'No analysis found for this user' });
    }

    res.json(serializeAnalysis(analysis));
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
        lastAnalyzed: f.lastAnalyzedAt || null,
        resumeHash: f.resumeHash || '',
        analysisVersion: f.analysisVersion || '',
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
    const activeFileId = user?.defaultResumeFileId || user?.activeResumeFileId || null;

    const [defaultFile, activeFile] = await Promise.all([
      user?.defaultResumeFileId ? ResumeFile.findOne({ _id: user.defaultResumeFileId, userId: req.user._id }).lean() : null,
      activeFileId ? ResumeFile.findOne({ _id: activeFileId, userId: req.user._id }).lean() : null
    ]);

    res.json({
      defaultResume: defaultFile ? {
        fileId: defaultFile._id,
        fileName: defaultFile.fileName,
        uploadDate: defaultFile.uploadDate,
        isAnalyzed: !!defaultFile.isAnalyzed,
        lastAnalyzed: defaultFile.lastAnalyzedAt || null,
        resumeHash: defaultFile.resumeHash || '',
        analysisVersion: defaultFile.analysisVersion || ''
      } : null,
      activeResume: activeFile ? {
        fileId: activeFile._id,
        fileName: activeFile.fileName,
        uploadDate: activeFile.uploadDate,
        isAnalyzed: !!activeFile.isAnalyzed,
        lastAnalyzed: activeFile.lastAnalyzedAt || null,
        resumeHash: activeFile.resumeHash || '',
        analysisVersion: activeFile.analysisVersion || ''
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

const memoryRateLimitMap = new Map();

const parsePreviewResume = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    // Rate Limiting: 10 requests per 10 minutes
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown-ip';
    const rateLimitKey = `rate_limit:parse_resume:${ip}`;
    const { isRedisCacheEnabled, getCacheJson, setCacheJson } = require('../services/redisCacheService');

    if (isRedisCacheEnabled()) {
      const current = await getCacheJson(rateLimitKey);
      if (current && current.count >= 10) {
        await fs.unlink(req.file.path).catch(() => {});
        return res.status(429).json({ message: 'Too many resume parse requests. Try again in 10 minutes.' });
      }
      const nextCount = (current?.count || 0) + 1;
      await setCacheJson(rateLimitKey, { count: nextCount }, 600); // 10 minutes TTL
    } else {
      const now = Date.now();
      const windowStart = now - 10 * 60 * 1000;
      const history = memoryRateLimitMap.get(ip) || [];
      const recent = history.filter((timestamp) => timestamp > windowStart);
      if (recent.length >= 10) {
        await fs.unlink(req.file.path).catch(() => {});
        return res.status(429).json({ message: 'Too many resume parse requests. Try again in 10 minutes.' });
      }
      recent.push(now);
      memoryRateLimitMap.set(ip, recent);
    }

    // Validate file signature (first 5 bytes must be %PDF-)
    const fsDirect = require('node:fs');
    const fileHandle = fsDirect.readFileSync(req.file.path);
    if (fileHandle.slice(0, 5).toString('ascii') !== '%PDF-') {
      await fs.unlink(req.file.path).catch(() => {});
      return res.status(400).json({ message: 'Only valid PDF files are allowed' });
    }

    let text = await extractTextFromPDF(req.file.path);
    if (text.length > 50000) text = text.substring(0, 50000);
    const previewResume = await createPreviewResume(text);

    await fs.unlink(req.file.path).catch(() => {});
    return res.json(previewResume);
  } catch (error) {
    if (req.file?.path) {
      await fs.unlink(req.file.path).catch(() => {});
    }
    console.error('Preview resume parsing failed'); // DO NOT log raw resume text
    return res.status(500).json({ message: 'Failed to parse PDF resume' });
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
  setActiveResume,
  parsePreviewResume
};
