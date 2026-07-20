const crypto = require('node:crypto');
const aiService = require('./aiservice');
const { extractSkillsFromText } = require('../utils/skilldetector');

const PREVIEW_RESUME_TTL_SECONDS = 30 * 60;
const MAX_INLINE_PREVIEW_RESUME_CHARS = 12_000;

const toPreviewResumeInsights = ({ skills = [], resumeHash = 'no-resume', experienceLevel = 'Student' } = {}) => ({
  analyzed: Boolean(resumeHash && resumeHash !== 'no-resume'),
  analysisId: 'temporary-preview',
  fileId: '',
  fileName: 'Temporary Preview Resume',
  experienceLevel,
  experienceYears: 0,
  atsScore: 70,
  skills,
  technicalSkills: skills,
  extractedSkills: skills,
  statusMessage: resumeHash === 'no-resume' ? 'GitHub-only preview' : 'Temporary resume parsed successfully'
});

const createPreviewResume = async (text = '') => {
  const normalizedText = String(text || '').trim();
  const resumeHash = crypto.createHash('sha256').update(normalizedText).digest('hex');
  const previewResumeId = crypto.randomUUID();
  const extractedSkills = extractSkillsFromText([normalizedText]).slice(0, 40);
  const payload = { previewResumeId, resumeHash, extractedSkills, createdAt: new Date().toISOString() };

  await aiService.setSharedCache(previewResumeId, payload, PREVIEW_RESUME_TTL_SECONDS, 'preview:resume');
  return {
    previewResumeId,
    resumeHash,
    extractedSkills,
    summary: `${extractedSkills.length} skills extracted from the temporary resume.`
  };
};

const resolvePreviewResume = async ({ previewResumeId, resumeHash, resumeText, experienceLevel } = {}) => {
  const requestedId = String(previewResumeId || '').trim();
  if (requestedId) {
    if (!/^[a-f\d]{64}$/i.test(String(resumeHash || '').trim())) {
      return { error: 'A valid temporary resume identity is required.', status: 400 };
    }
    const cached = await aiService.getSharedCache(requestedId, 'preview:resume');
    if (!cached || String(resumeHash) !== String(cached.resumeHash)) {
      return { error: 'Temporary resume expired. Please upload or paste resume again.', status: 400 };
    }
    return {
      resumeInsights: toPreviewResumeInsights({ ...cached, experienceLevel }),
      resumeCacheIdentity: { resumeHash: cached.resumeHash, resumeAnalysisId: requestedId }
    };
  }

  const cleanResume = String(resumeText || '').trim();
  if (cleanResume.length > MAX_INLINE_PREVIEW_RESUME_CHARS) {
    return { error: 'Request too large. Please upload a smaller resume or use file upload.', status: 413 };
  }
  if (!cleanResume) {
    return {
      resumeInsights: toPreviewResumeInsights({ experienceLevel }),
      resumeCacheIdentity: { resumeHash: 'no-resume', resumeAnalysisId: 'no-resume' }
    };
  }

  const inline = await createPreviewResume(cleanResume);
  return {
    resumeInsights: toPreviewResumeInsights({ ...inline, experienceLevel }),
    resumeCacheIdentity: { resumeHash: inline.resumeHash, resumeAnalysisId: 'inline-preview' }
  };
};

module.exports = {
  MAX_INLINE_PREVIEW_RESUME_CHARS,
  createPreviewResume,
  resolvePreviewResume
};
