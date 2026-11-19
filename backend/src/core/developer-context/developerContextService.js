const crypto = require('node:crypto');
const present = (value) => value != null && String(value).trim() !== '';
const first = (active, legacy) => (present(active) ? active : present(legacy) ? legacy : null);

// Pure identity resolution. No normalization, persistence, scoring, or cache writes.
const resolveIdentity = (user = {}) => ({
  githubUsername: first(user?.activeGithubUsername, user?.githubUsername),
  careerStack: first(user?.activeCareerStack, user?.careerStack),
  experienceLevel: first(user?.activeExperienceLevel, user?.experienceLevel)
});
const resolveGithubUsername = (user) => resolveIdentity(user).githubUsername;
const resolveCareerStack = (user) => resolveIdentity(user).careerStack;
const resolveExperienceLevel = (user) => resolveIdentity(user).experienceLevel;
const resolveDefaultResumeFileId = (user) => first(user?.defaultResumeFileId);
const resolveSelectedResumeFileId = (user) =>
  first(user?.defaultResumeFileId, user?.activeResumeFileId);
const loadUser = async (userId, models = {}) =>
  userId
    ? (models.User || require('../../modules/auth/models/user'))
        .findById(userId)
        .select(
          'activeGithubUsername githubUsername activeCareerStack careerStack activeExperienceLevel experienceLevel activeResumeFileId defaultResumeFileId careerGoal targetTimeline learningPreference updatedAt isActive sessionRevision'
        )
        .lean()
    : null;

// A historical resume is valid when its owned ResumeFile still exists. Latest means
// uploadDate, with createdAt and _id providing deterministic tie breakers.
const resolveResumeFile = async (userId, user, models = {}) => {
  if (!userId) return null;
  const contextUser = user === undefined ? await loadUser(userId, models) : user;
  const ResumeFile = models.ResumeFile || require('../../modules/resume/models/resumeFile');
  const selectedId = models.defaultOnly
    ? resolveDefaultResumeFileId(contextUser)
    : resolveSelectedResumeFileId(contextUser);
  if (selectedId) {
    const query = ResumeFile.findOne({ userId, _id: selectedId });
    if (models.session) query.session(models.session);
    return query.lean();
  }
  if (models.defaultOnly) return null;
  return ResumeFile.findOne({ userId }).sort({ uploadDate: -1, createdAt: -1, _id: -1 }).lean();
};
const resolveResumeAnalysis = async (userId, user, options = {}) => {
  if (!userId) return null;
  const contextUser = user === undefined ? await loadUser(userId, options) : user;
  const selectedId = options.defaultOnly
    ? resolveDefaultResumeFileId(contextUser)
    : resolveSelectedResumeFileId(contextUser);
  if (options.defaultOnly && !selectedId) return null;
  const file = Object.hasOwn(options, 'resolvedResumeFile')
    ? options.resolvedResumeFile
    : await resolveResumeFile(userId, contextUser, options);
  const fileId =
    file &&
    String(file.userId) === String(userId) &&
    (!selectedId || String(selectedId) === String(file._id))
      ? file._id
      : null;
  // Never borrow another historical analysis when the selected file is unanalyzed.
  if (!fileId) return null;
  const ResumeAnalysis =
    options.ResumeAnalysis || require('../../modules/resume/models/resumeAnalysis');
  let query = ResumeAnalysis.findOne({ userId, fileId }).sort({
    analyzedAt: -1,
    createdAt: -1,
    _id: -1
  });
  if (options.select) query = query.select(options.select);
  if (options.session) query.session(options.session);
  return query.lean();
};
const resolveCurrentContext = async (userId, user, models = {}) => {
  const contextUser = user === undefined ? await loadUser(userId, models) : user;
  const resumeFile = await resolveResumeFile(userId, contextUser, models);
  return { ...resolveIdentity(contextUser), resumeFileId: resumeFile?._id || null, resumeFile };
};
const buildProfileHash = (user = {}, { defaultOnly = false } = {}) =>
  crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        activeGithubUsername: String(resolveGithubUsername(user) || '')
          .trim()
          .toLowerCase(),
        activeCareerStack: String(resolveCareerStack(user) || 'Full Stack').trim(),
        activeExperienceLevel: String(resolveExperienceLevel(user) || 'Student').trim(),
        resumeFileId: String(
          (defaultOnly ? resolveDefaultResumeFileId(user) : resolveSelectedResumeFileId(user)) || ''
        ),
        careerGoal: String(user.careerGoal || '').trim(),
        targetTimeline: String(user.targetTimeline || '').trim(),
        learningPreference: String(user.learningPreference || '').trim()
      })
    )
    .digest('hex');

module.exports = {
  buildProfileHash,
  resolveIdentity,
  resolveGithubUsername,
  resolveCareerStack,
  resolveExperienceLevel,
  resolveDefaultResumeFileId,
  resolveSelectedResumeFileId,
  resolveResumeFile,
  resolveResumeAnalysis,
  resolveCurrentContext,
  loadUser
};
