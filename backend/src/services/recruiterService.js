const User = require('../models/user');
const Analysis = require('../models/analysis');
const ResumeAnalysis = require('../models/resumeAnalysis');
const SkillGraph = require('../models/skillGraph');
const PublicProfile = require('../models/publicProfile');

const flattenResumeSkills = (skillsMap = {}) => {
  if (!skillsMap) return [];
  const values = skillsMap instanceof Map ? Array.from(skillsMap.values()) : Object.values(skillsMap);
  return values.flat().map(String).map((s) => s.trim()).filter(Boolean);
};

const computeResumeScore = (resumeAnalysis) => {
  if (!resumeAnalysis) return 0;
  const scores = [
    Number(resumeAnalysis.atsScore || 0),
    Number(resumeAnalysis.keywordDensity || 0),
    Number(resumeAnalysis.formatScore || 0),
    Number(resumeAnalysis.contentQuality || 0)
  ].filter((s) => Number.isFinite(s));
  if (!scores.length) return 0;
  return Math.round(scores.reduce((sum, val) => sum + val, 0) / scores.length);
};

const computeCandidateScore = ({ githubScore, resumeScore }) => {
  const values = [Number(githubScore || 0), Number(resumeScore || 0)].filter((v) => Number.isFinite(v) && v > 0);
  if (!values.length) return 0;
  return Math.round(values.reduce((sum, val) => sum + val, 0) / values.length);
};

const collectSkillScores = (skillGraph, fallbackSkills = []) => {
  if (skillGraph?.nodes?.length) {
    return skillGraph.nodes
      .filter((node) => node.kind === 'current')
      .sort((a, b) => (b.proficiency || 0) - (a.proficiency || 0))
      .slice(0, 12)
      .map((node) => ({ name: node.name, score: Math.round(node.proficiency || 0) }));
  }

  return fallbackSkills.slice(0, 12).map((skill) => ({ name: skill, score: 60 }));
};

const getCandidates = async ({ search = '', minScore = 0, skills = [], limit = 20 }) => {
  const query = {};
  if (search) {
    const regex = new RegExp(search, 'i');
    query.$or = [{ name: regex }, { email: regex }, { githubUsername: regex }, { jobTitle: regex }];
  }

  const users = await User.find(query).select('name email githubUsername jobTitle location avatar').limit(limit).lean();
  if (!users.length) return [];

  const userIds = users.map((u) => u._id);
  const [analyses, resumeAnalyses, skillGraphs, publicProfiles] = await Promise.all([
    Analysis.find({ userId: { $in: userIds } }).lean(),
    ResumeAnalysis.find({ userId: { $in: userIds } }).sort({ analyzedAt: -1 }).lean(),
    SkillGraph.find({ userId: { $in: userIds } }).sort({ updatedAt: -1 }).lean(),
    PublicProfile.find({ userId: { $in: userIds } }).lean()
  ]);

  const analysisByUser = new Map(analyses.map((a) => [String(a.userId), a]));
  const resumeByUser = new Map();
  resumeAnalyses.forEach((entry) => {
    const key = String(entry.userId);
    if (!resumeByUser.has(key)) resumeByUser.set(key, entry);
  });
  const skillByUser = new Map();
  skillGraphs.forEach((entry) => {
    const key = String(entry.userId);
    if (!skillByUser.has(key)) skillByUser.set(key, entry);
  });
  const publicByUser = new Map(publicProfiles.map((p) => [String(p.userId), p]));

  const normalizedSkills = (skills || []).map((s) => String(s || '').trim().toLowerCase()).filter(Boolean);

  const candidates = users.map((user) => {
    const analysis = analysisByUser.get(String(user._id));
    const resume = resumeByUser.get(String(user._id));
    const skillGraph = skillByUser.get(String(user._id));
    const resumeSkills = flattenResumeSkills(resume?.skills);
    const githubScore = Number(analysis?.githubScore || 0);
    const resumeScore = computeResumeScore(resume);
    const score = computeCandidateScore({ githubScore, resumeScore });
    const skillScores = collectSkillScores(skillGraph, resumeSkills);
    const profile = publicByUser.get(String(user._id));

    return {
      id: user._id,
      name: user.name,
      jobTitle: user.jobTitle || '',
      location: user.location || '',
      githubUsername: user.githubUsername || '',
      avatar: user.avatar || '',
      score,
      githubScore,
      resumeScore,
      skillScores,
      publicProfileSlug: profile?.slug || null
    };
  });

  return candidates.filter((candidate) => {
    if (Number(minScore) && candidate.score < Number(minScore)) return false;
    if (normalizedSkills.length) {
      const candidateSkills = candidate.skillScores.map((s) => s.name.toLowerCase());
      return normalizedSkills.some((skill) => candidateSkills.includes(skill));
    }
    return true;
  });
};

module.exports = { getCandidates };
