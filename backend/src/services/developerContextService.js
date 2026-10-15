const present = (value) => value != null && String(value).trim() !== '';
const first = (active, legacy) => present(active) ? active : present(legacy) ? legacy : null;

// Pure identity resolution. No normalization, persistence, scoring, or cache writes.
const resolveIdentity = (user = {}) => ({
  githubUsername: first(user?.activeGithubUsername, user?.githubUsername),
  careerStack: first(user?.activeCareerStack, user?.careerStack),
  experienceLevel: first(user?.activeExperienceLevel, user?.experienceLevel)
});
const resolveGithubUsername = (user) => resolveIdentity(user).githubUsername;
const resolveCareerStack = (user) => resolveIdentity(user).careerStack;
const resolveExperienceLevel = (user) => resolveIdentity(user).experienceLevel;
const resolveSelectedResumeFileId = (user) => first(user?.activeResumeFileId, user?.defaultResumeFileId);
const loadUser = async (userId, models = {}) => userId
  ? (models.User || require('../models/user')).findById(userId)
    .select('activeGithubUsername githubUsername activeCareerStack careerStack activeExperienceLevel experienceLevel activeResumeFileId defaultResumeFileId').lean()
  : null;

// A historical resume is valid when its owned ResumeFile still exists. Latest means
// uploadDate, with createdAt and _id providing deterministic tie breakers.
const resolveResumeFile = async (userId, user, models = {}) => {
  if (!userId) return null;
  const contextUser = user === undefined ? await loadUser(userId, models) : user;
  const ResumeFile = models.ResumeFile || require('../models/resumeFile');
  const selectedId = resolveSelectedResumeFileId(contextUser);
  if (selectedId) return ResumeFile.findOne({ userId, _id: selectedId }).lean();
  return ResumeFile.findOne({ userId }).sort({ uploadDate: -1, createdAt: -1, _id: -1 }).lean();
};
const resolveResumeAnalysis = async (userId, user, options = {}) => {
  if (!userId) return null;
  const contextUser = user === undefined ? await loadUser(userId, options) : user;
  let fileId = resolveSelectedResumeFileId(contextUser);
  if (!fileId) fileId = (await resolveResumeFile(userId, contextUser, options))?._id;
  // Never borrow another historical analysis when the selected file is unanalyzed.
  if (!fileId) return null;
  const ResumeAnalysis = options.ResumeAnalysis || require('../models/resumeAnalysis');
  let query = ResumeAnalysis.findOne({ userId, fileId })
    .sort({ analyzedAt: -1, createdAt: -1, _id: -1 });
  if (options.select) query = query.select(options.select);
  return query.lean();
};
const resolveCurrentContext = async (userId, user, models = {}) => {
  const contextUser = user === undefined ? await loadUser(userId, models) : user;
  const resumeFile = await resolveResumeFile(userId, contextUser, models);
  return { ...resolveIdentity(contextUser), resumeFileId: resumeFile?._id || null, resumeFile };
};
module.exports = {
  resolveIdentity, resolveGithubUsername, resolveCareerStack, resolveExperienceLevel,
  resolveSelectedResumeFileId, resolveResumeFile, resolveResumeAnalysis, resolveCurrentContext, loadUser
};
