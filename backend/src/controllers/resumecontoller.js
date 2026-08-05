const mongoose = require('mongoose');
const { extractTextFromPDF, analyzeResume, findCachedResumeAnalysis, ANALYSIS_VERSION } = require('../services/resumeservice');
const { generateResumeGuide } = require('../services/resumeGuideService');
const ResumeFile = require('../models/resumeFile');
const ResumeAnalysis = require('../models/resumeAnalysis');
const User = require('../models/user');
const fs = require('fs/promises');
const { createNotification } = require('../services/notificationService');
const { invalidateDashboardSummaryCache } = require('./dashboardcontroller');
const { createPreviewResume } = require('../services/previewResumeCacheService');

const analyzeInFlight = new Map();

const sanitizeClientMessage = (error, fallback) => {
  const msg = String(error?.message || '').trim();
  if (!msg || msg.length > 300) return fallback;
  if (/[A-Za-z]:\\|\/(?:Users|home)\//i.test(msg)) return fallback;
  if (/node_modules|at\s+\S+\s+\(|api[_-]?key|bearer\s|secret|password|token=/i.test(msg)) return fallback;
  if (/stack|traceback|ENOENT|EACCES|uploads\//i.test(msg)) return fallback;
  return msg;
};

const respondResumeError = (res, error, fallbackMessage) => {
  const status = Number(error?.status || 0);
  if (status === 400 || error?.name === 'CastError' || /Cast to ObjectId failed/i.test(String(error?.message || ''))) {
    return res.status(400).json({ message: sanitizeClientMessage(error, 'Invalid resume request.') });
  }
  if (status === 403) {
    return res.status(403).json({ message: sanitizeClientMessage(error, 'Unauthorized') });
  }
  if (status === 404) {
    return res.status(404).json({ message: sanitizeClientMessage(error, 'Resume file not found') });
  }
  if (status === 413) {
    return res.status(413).json({ message: sanitizeClientMessage(error, 'Resume file is too large.') });
  }
  if (status === 409) {
    return res.status(409).json({ message: sanitizeClientMessage(error, 'Resume analysis is already in progress. Please retry.') });
  }
  return res.status(500).json({ message: sanitizeClientMessage(error, fallbackMessage) });
};

const parseResumeFileId = (raw) => {
  const fileId = String(raw || '').trim();
  if (!fileId) {
    const error = new Error('fileId is required');
    error.status = 400;
    throw error;
  }
  if (fileId.length > 64 || !mongoose.Types.ObjectId.isValid(fileId)) {
    const error = new Error('Invalid fileId');
    error.status = 400;
    throw error;
  }
  return fileId;
};

const canReadResumeAnalysisForUser = (requester, targetUserId) => (
  Boolean(requester?._id) && String(requester._id) === String(targetUserId)
);

const elapsedMs = (startedAt) => Number((process.hrtime.bigint() - startedAt) / 1000000n);

const createPipelineTimings = () => ({
  memoryCacheMs: 0,
  redisMs: 0,
  mongoMs: 0,
  providerMs: 0,
  aiMs: 0,
  deterministicMs: 0,
  validationMs: 0,
  persistenceMs: 0,
  cacheWriteMs: 0,
  totalMs: 0,
  // legacy aliases kept for existing log consumers
  pdfTextExtractionMs: 0,
  cacheLookupMs: 0,
  deterministicAnalysisMs: 0,
  aiInsightsMs: 0,
  mongoWritesMs: 0,
  responseSerializationMs: 0
});

const logPipelineTiming = ({ userId, fileId, forceRefresh, cacheHit, status, timings, totalDurationMs }) => {
  if (String(process.env.RESUME_TIMING || '') !== '1' && process.env.NODE_ENV === 'production') return;
  console.log('[ResumeAnalysisPipeline]', JSON.stringify({
    event: 'resume_analysis_complete',
    userId: String(userId || ''),
    fileId: String(fileId || ''),
    forceRefresh: Boolean(forceRefresh),
    cacheHit: Boolean(cacheHit),
    status,
    memoryCacheMs: timings.memoryCacheMs,
    redisMs: timings.redisMs,
    mongoMs: timings.mongoMs,
    providerMs: timings.providerMs || timings.pdfTextExtractionMs,
    aiMs: timings.aiMs || timings.aiInsightsMs,
    deterministicMs: timings.deterministicMs || timings.deterministicAnalysisMs,
    validationMs: timings.validationMs,
    persistenceMs: timings.persistenceMs || timings.mongoWritesMs,
    cacheWriteMs: timings.cacheWriteMs,
    totalMs: totalDurationMs,
    ...timings,
    totalDurationMs
  }));
};

const toForceRefresh = (req) => (
  String(req.body?.forceRefresh ?? req.query?.forceRefresh ?? '').toLowerCase() === 'true'
);

const ensureResumeContext = async (userId) => {
  const user = await User.findById(userId).select('defaultResumeFileId activeResumeFileId');
  if (!user) return null;

  if (!user.defaultResumeFileId) {
    const latestAnalyzed = await ResumeFile.findOne({ userId, isAnalyzed: true })
      .sort({ uploadDate: -1 })
      .select('_id')
      .lean();
    const latestAny = latestAnalyzed || await ResumeFile.findOne({ userId })
      .sort({ uploadDate: -1 })
      .select('_id')
      .lean();
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
    console.error('Resume Upload Error:', sanitizeClientMessage(error, 'Server Error'));
    respondResumeError(res, error, 'Server Error');
  }
};

// @desc    Analyze resume
// @route   POST /api/resume/analyze
// @access  Private
const runAnalyzeResumePipeline = async (req, { fileId, forceRefresh, timings, addTiming }) => {
  const resumeFile = await ResumeFile.findById(fileId)
    .select('userId fileName fileUrl fileSize uploadDate isAnalyzed resumeHash analysisVersion lastAnalyzedAt');
  if (!resumeFile) {
    const error = new Error('Resume file not found');
    error.status = 404;
    throw error;
  }

  if (resumeFile.userId.toString() !== req.user._id.toString()) {
    const error = new Error('Unauthorized');
    error.status = 403;
    throw error;
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
    const extractionStartedAt = process.hrtime.bigint();
    const text = await extractTextFromPDF(resumeFile.fileUrl);
    const providerMs = elapsedMs(extractionStartedAt);
    addTiming('pdfTextExtractionMs', providerMs);
    addTiming('providerMs', providerMs);

    const [loadedUserContext, previousAnalysis] = await Promise.all([
      User.findById(req.user._id).select('defaultResumeFileId activeResumeFileId'),
      ResumeAnalysis.findOne({ userId: req.user._id })
        .sort({ analyzedAt: -1 })
        .select('atsScore keywordDensity formatScore contentQuality technologyCategories qualityScores analyzedAt createdAt')
        .lean()
    ]);
    userContext = loadedUserContext;
    analysis = await analyzeResume(text, resumeFile.fileName, resumeFile.fileSize, {
      userId: req.user._id,
      resumeFileId: resumeFile._id,
      forceRefresh,
      cacheLookupCompleted: canLookupBeforeExtraction,
      previousAnalysis,
      onTiming: addTiming
    });
  }

  const cacheHit = Boolean(analysis.cacheMetadata?.loadedFromCache) && !forceRefresh;

  let resumeAnalysis = null;
  if (cacheHit) {
    resumeAnalysis = await ResumeAnalysis.findOne({
      userId: req.user._id,
      fileId: resumeFile._id,
      resumeHash: analysis.resumeHash,
      analysisVersion: analysis.analysisVersion || ANALYSIS_VERSION
    })
      .sort({ analyzedAt: -1 })
      .select('analyzedAt');
  }

  let createdAnalysis = false;
  if (!resumeAnalysis) {
    resumeAnalysis = new ResumeAnalysis({
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
    });

    const analysisWriteStartedAt = process.hrtime.bigint();
    await resumeAnalysis.save();
    const persistMs = elapsedMs(analysisWriteStartedAt);
    addTiming('mongoWritesMs', persistMs);
    addTiming('persistenceMs', persistMs);
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
    userNeedsSave ? userContext.save() : null
  ]);
  const contextMs = elapsedMs(contextWritesStartedAt);
  addTiming('mongoWritesMs', contextMs);
  addTiming('persistenceMs', contextMs);

  const notify = () => createNotification({
    userId: req.user._id,
    type: 'resume_upload',
    title: 'Resume Analysis Completed',
    message: `Analysis finished for ${resumeFile.fileName} (ATS ${analysis.atsScore}%).`,
    dedupeKey: `resume_analysis:${resumeFile._id}`,
    meta: { fileId: resumeFile._id, atsScore: analysis.atsScore }
  }).catch(() => {});

  if (process.env.NODE_ENV === 'production') {
    setImmediate(notify);
  } else if (!cacheHit) {
    await notify();
  }

  if (createdAnalysis || userNeedsSave) {
    if (process.env.NODE_ENV === 'production') {
      setImmediate(() => invalidateDashboardSummaryCache(req.user._id));
    } else {
      invalidateDashboardSummaryCache(req.user._id);
    }
  }

  return {
    cacheHit,
    responsePayload: {
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
    }
  };
};

const analyzeResumeFile = async (req, res) => {
  const pipelineStartedAt = process.hrtime.bigint();
  const timings = createPipelineTimings();
  const addTiming = (stage, durationMs) => {
    if (Object.prototype.hasOwnProperty.call(timings, stage)) {
      timings[stage] += Number(durationMs || 0);
    }
  };
  let fileId = '';
  const forceRefresh = toForceRefresh(req);
  let cacheHit = false;
  let status = 'error';

  try {
    fileId = parseResumeFileId(req.body?.fileId);

    const inFlightKey = `${req.user._id}:${fileId}:${forceRefresh ? 'refresh' : 'analyze'}`;
    if (analyzeInFlight.has(inFlightKey)) {
      const shared = await analyzeInFlight.get(inFlightKey);
      cacheHit = shared.cacheHit;
      status = 'success';
      return res.json(shared.responsePayload);
    }

    const pipelinePromise = runAnalyzeResumePipeline(req, { fileId, forceRefresh, timings, addTiming });
    analyzeInFlight.set(inFlightKey, pipelinePromise);
    const { cacheHit: hit, responsePayload } = await pipelinePromise.finally(() => {
      analyzeInFlight.delete(inFlightKey);
    });
    cacheHit = hit;

    const serializationStartedAt = process.hrtime.bigint();
    res.json(responsePayload);
    addTiming('responseSerializationMs', elapsedMs(serializationStartedAt));
    status = 'success';
  } catch (error) {
    if (error?.code === 'ENOENT' || /no such file|Unable to extract text from this PDF/i.test(String(error?.message || ''))) {
      error.status = 404;
      if (!error.message || /ENOENT|no such file/i.test(error.message)) {
        error.message = 'Resume file is missing or unreadable. Please upload the PDF again.';
      }
    }
    console.error('Resume Analysis Error:', sanitizeClientMessage(error, 'Server Error'));
    if (error?.status === 400) status = 'validation_error';
    else if (error?.status === 403) status = 'forbidden';
    else if (error?.status === 404) status = 'not_found';
    respondResumeError(res, error, 'Server Error');
  } finally {
    logPipelineTiming({
      userId: req.user?._id,
      fileId,
      forceRefresh,
      cacheHit,
      status,
      timings,
      totalDurationMs: elapsedMs(pipelineStartedAt)
    });
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

    let analysis = null;
    if (requestedFileId) {
      parseResumeFileId(requestedFileId);
      analysis = await ResumeAnalysis.findOne({ userId: req.user._id, fileId: requestedFileId })
        .sort({ analyzedAt: -1 })
        .lean();
      if (!analysis) {
        return res.status(404).json({ message: 'No analysis found' });
      }
      return res.json(serializeAnalysis(analysis));
    }

    const targetFileId = defaultFileId;
    if (targetFileId) {
      analysis = await ResumeAnalysis.findOne({ userId: req.user._id, fileId: targetFileId })
        .sort({ analyzedAt: -1 })
        .lean();
    }
    if (!analysis) {
      analysis = await ResumeAnalysis.findOne({ userId: req.user._id })
        .sort({ analyzedAt: -1 })
        .lean();
    }

    if (!analysis) {
      return res.status(404).json({ message: 'No analysis found' });
    }

    res.json(serializeAnalysis(analysis));
  } catch (error) {
    console.error('Get Analysis Error:', sanitizeClientMessage(error, 'Server Error'));
    respondResumeError(res, error, 'Server Error');
  }
};

// @desc    Get resume analysis by user ID
// @route   GET /api/resume/result/:userId
// @access  Private
const getResumeAnalysisByUserId = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(String(userId || ''))) {
      return res.status(400).json({ message: 'Invalid userId' });
    }
    if (!canReadResumeAnalysisForUser(req.user, userId)) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    const analysis = await ResumeAnalysis.findOne({ userId })
      .sort({ analyzedAt: -1 })
      .lean();

    if (!analysis) {
      return res.status(404).json({ message: 'No analysis found for this user' });
    }

    res.json(serializeAnalysis(analysis));
  } catch (error) {
    console.error('Get Analysis Error:', sanitizeClientMessage(error, 'Server Error'));
    respondResumeError(res, error, 'Server Error');
  }
};

// @desc    Generate and download a personalised AI resume improvement guide
// @route   GET /api/resume/guide
// @access  Private
const downloadResumeGuide = async (req, res) => {
  try {
    const analysis = await ResumeAnalysis.findOne({ userId: req.user._id })
      .sort({ analyzedAt: -1 })
      .lean();

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
    console.error('Resume Guide Error:', sanitizeClientMessage(error, 'Failed to generate resume guide'));
    respondResumeError(res, error, 'Failed to generate resume guide');
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
    console.error('Resume files error:', sanitizeClientMessage(error, 'Server Error'));
    respondResumeError(res, error, 'Server Error');
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
    console.error('Active resume context error:', sanitizeClientMessage(error, 'Server Error'));
    respondResumeError(res, error, 'Server Error');
  }
};

// @desc    Set active resume (and optionally default resume)
// @route   PUT /api/resume/active
// @access  Private
const setActiveResume = async (req, res) => {
  try {
    const fileId = parseResumeFileId(req.body?.fileId);
    const { setAsDefault } = req.body;

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
    console.error('Set active resume error:', sanitizeClientMessage(error, 'Server Error'));
    respondResumeError(res, error, 'Server Error');
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
  parsePreviewResume,
  __test: {
    sanitizeClientMessage,
    parseResumeFileId,
    canReadResumeAnalysisForUser
  }
};
