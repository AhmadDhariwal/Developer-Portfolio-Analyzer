const { analyzeGitHubProfile } = require('../services/githubservice');
const aiService = require('../services/aiservice');
const { getSkillGapPrompt } = require('../prompts/skillGapPrompt');
const AnalysisCache = require('../models/analysisCache');
const crypto = require('node:crypto');
const ResumeAnalysis = require('../models/resumeAnalysis');
const User = require('../models/user');
const { createVersion } = require('../services/aiVersionService');

const MIN_MISSING_SKILLS = 12;
const MIN_KNOWN_SKILLS = 8;

const DEFAULT_MISSING_SKILLS = [
  'Testing',
  'System Design',
  'CI/CD',
  'Docker',
  'SQL',
  'Cloud Basics',
  'Security Basics',
  'Performance Optimization',
  'Design Patterns',
  'Monitoring and Observability',
  'API Versioning',
  'Caching Strategies',
  'Scalability Patterns',
  'Accessibility',
  'Documentation'
];

const isValidUrl = (value) => typeof value === 'string' && /^https?:\/\//i.test(value.trim());

const toDocSearchUrl = (topic) => {
  const q = encodeURIComponent(String(topic || 'software engineering docs'));
  return `https://www.google.com/search?q=${q}`;
};

const normalizeRoadmapResource = (resource, fallbackTopic = 'software engineering docs') => {
  if (typeof resource === 'object' && resource !== null) {
    const title = String(resource.title || resource.name || fallbackTopic).trim();
    const url = isValidUrl(resource.url) ? resource.url.trim() : toDocSearchUrl(title || fallbackTopic);
    return { title, url };
  }

  const text = String(resource || '').trim();
  if (!text) {
    return { title: fallbackTopic, url: toDocSearchUrl(fallbackTopic) };
  }

  if (isValidUrl(text)) {
    return { title: text.replace(/^https?:\/\//i, '').slice(0, 80), url: text };
  }

  return { title: text, url: toDocSearchUrl(text) };
};

const normalizeRoadmap = (roadmap = [], min = 3) => {
  const defaults = [
    {
      phase: 'Phase 1',
      title: 'Core Foundations',
      description: 'Build strong fundamentals for your current stack.',
      duration: '2-3 weeks',
      skills: ['Core language fundamentals', 'Git workflows'],
      resources: [
        { title: 'Official language docs', url: 'https://developer.mozilla.org/' },
        { title: 'Git documentation', url: 'https://git-scm.com/doc' }
      ],
      color: 'blue'
    },
    {
      phase: 'Phase 2',
      title: 'Project Depth',
      description: 'Apply missing skills in practical projects.',
      duration: '3-4 weeks',
      skills: ['Build one production-like project', 'Add tests and CI'],
      resources: [
        { title: 'Docker docs', url: 'https://docs.docker.com/' },
        { title: 'GitHub Actions docs', url: 'https://docs.github.com/en/actions' }
      ],
      color: 'green'
    },
    {
      phase: 'Phase 3',
      title: 'Interview Readiness',
      description: 'Prepare portfolio and interview-focused practice.',
      duration: '2-3 weeks',
      skills: ['System design practice', 'Behavioral storytelling'],
      resources: [
        { title: 'System Design Primer', url: 'https://github.com/donnemartin/system-design-primer' },
        { title: 'LeetCode', url: 'https://leetcode.com/' }
      ],
      color: 'orange'
    }
  ];

  const safe = Array.isArray(roadmap) ? [...roadmap] : [];
  while (safe.length < min) safe.push(defaults[safe.length % defaults.length]);

  return safe.map((phase, idx) => {
    const phaseSkills = Array.isArray(phase.skills) ? phase.skills.map(String).map((s) => s.trim()).filter(Boolean) : [];
    const firstSkill = phaseSkills[0] || 'software engineering';
    const resources = Array.isArray(phase.resources)
      ? phase.resources.map((r) => normalizeRoadmapResource(r, firstSkill))
      : [];

    return {
      phase: String(phase.phase || `Phase ${idx + 1}`).trim(),
      title: String(phase.title || `Milestone ${idx + 1}`).trim(),
      description: String(phase.description || 'Complete focused practice for this milestone.').trim(),
      duration: String(phase.duration || '2-3 weeks').trim(),
      skills: phaseSkills,
      resources: resources.length ? resources : [normalizeRoadmapResource(firstSkill, firstSkill)],
      color: ['purple', 'blue', 'green', 'orange'].includes(String(phase.color || '').trim())
        ? String(phase.color).trim()
        : defaults[idx % defaults.length].color
    };
  });
};

const toSkillName = (s) => (typeof s === 'string' ? s : s?.name || '').trim();

const flattenResumeSkills = (skillsMap = {}) => {
  if (!skillsMap) return [];
  const values = skillsMap instanceof Map
    ? Array.from(skillsMap.values())
    : Object.values(skillsMap);
  return values.flat().map(String).map((s) => s.trim()).filter(Boolean);
};

const uniqueByLower = (arr = []) => {
  const seen = new Set();
  return arr.filter((item) => {
    const key = String(item || '').trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const saveAIVersionSnapshot = async ({ req, source, output, metadata = {} }) => {
  if (!req.user?._id || !output || typeof output !== 'object') return;
  try {
    await createVersion({
      userId: req.user._id,
      source,
      outputJson: output,
      metadata
    });
  } catch (error) {
    console.error('Skill gap AI snapshot error:', error.message);
  }
};

/**
 * @desc  Analyze skill gap using the user's global career profile
 * @route POST /api/skillgap/skill-gap
 */
const analyzeSkillGap = async (req, res) => {
  try {
    let { username, resumeText } = req.body;
    username = username || req.user?.activeGithubUsername || req.user?.githubUsername;

    // Career profile: prefer the authenticated user's saved profile, allow body override
    const careerStack     = req.user?.careerStack     || req.body.careerStack     || 'Full Stack';
    const experienceLevel = req.user?.experienceLevel || req.body.experienceLevel || 'Student';

    if (!username) {
      return res.status(400).json({ message: 'Username is required.' });
    }

    // Attempt to recover resumeText from persisted analysis
    if (!resumeText && req.user) {
      const Analysis = require('../models/analysis');
      const analysis = await Analysis.findOne({ userId: req.user._id });
      resumeText = analysis?.resumeText || '';
    }

    const cleanResume = (resumeText || '').trim();
    const resumeHash  = crypto.createHash('sha256').update(cleanResume).digest('hex');
    const cacheKey    = { githubUsername: username, careerStack, experienceLevel, resumeHash, analysisVersion: 'v3' };

    // Cache lookup
    const cached = await AnalysisCache.findOne(cacheKey);
    if (cached) {
      const cachedResult = { ...cached.analysisData, fromCache: true };
      await saveAIVersionSnapshot({
        req,
        source: 'skill_gap',
        output: cachedResult,
        metadata: { fromCache: true, username, careerStack, experienceLevel }
      });
      return res.json(cachedResult);
    }

    // Fetch GitHub and resume analysis data
    const githubData     = await analyzeGitHubProfile(username.trim());
    let latestResumeAnalysis = null;
    if (req.user?._id) {
      const userContext = await User.findById(req.user._id).select('activeResumeFileId defaultResumeFileId').lean();
      const activeResumeFileId = userContext?.activeResumeFileId || userContext?.defaultResumeFileId || null;
      if (activeResumeFileId) {
        latestResumeAnalysis = await ResumeAnalysis.findOne({ userId: req.user._id, fileId: activeResumeFileId }).sort({ analyzedAt: -1 }).lean();
      }
      if (!latestResumeAnalysis) {
        latestResumeAnalysis = await ResumeAnalysis.findOne({ userId: req.user._id }).sort({ analyzedAt: -1 }).lean();
      }
    }

    const resumeSkills = flattenResumeSkills(latestResumeAnalysis?.skills);
    const resumeInsights = {
      experienceLevel: latestResumeAnalysis?.experienceLevel || '',
      experienceYears: latestResumeAnalysis?.experienceYears || 0,
      atsScore: latestResumeAnalysis?.atsScore || 0,
      keywordDensity: latestResumeAnalysis?.keywordDensity || 0,
      skills: resumeSkills.slice(0, 25),
      keyAchievements: (latestResumeAnalysis?.keyAchievements || []).slice(0, 8)
    };

    const githubInsights = {
      repoCount: githubData?.repoCount || 0,
      developerLevel: githubData?.developerLevel || '',
      strengths: githubData?.strengths || [],
      weakAreas: githubData?.weakAreas || [],
      scores: githubData?.scores || {}
    };

    const detectedSkills = {
      github:      githubData.repositories.map(r => `${r.name} (${r.language})`).concat(resumeSkills.slice(0, 15)),
      repoQuality: githubData.scores
    };

    const prompt = getSkillGapPrompt(careerStack, experienceLevel, detectedSkills, resumeInsights, githubInsights);
    const fallback = {
      yourSkills:      [],
      missingSkills:   [],
      coverage:        50,
      missing:         50,
      levelAssessment: '',
      roadmap:         [],
      totalWeeks:      'N/A'
    };

    const aiResult = await aiService.runAIAnalysis(prompt, fallback);

    const yourSkills = (Array.isArray(aiResult.yourSkills) ? aiResult.yourSkills : [])
      .map((s) => ({
        name: toSkillName(s),
        category: s?.category || 'General',
        proficiency: Number(s?.proficiency || 50),
        isFoundational: Boolean(s?.isFoundational)
      }))
      .filter((s) => s.name);

    const detectedKnown = uniqueByLower(resumeSkills.concat(githubData.repositories.map((r) => r.language || '').filter(Boolean)));
    while (yourSkills.length < MIN_KNOWN_SKILLS && detectedKnown[yourSkills.length]) {
      yourSkills.push({
        name: detectedKnown[yourSkills.length],
        category: 'General',
        proficiency: 60,
        isFoundational: true
      });
    }

    const missingSkills = (Array.isArray(aiResult.missingSkills) ? aiResult.missingSkills : [])
      .map((s) => ({
        name: toSkillName(s),
        category: s?.category || 'General',
        priority: s?.priority || 'Medium',
        jobDemand: Number(s?.jobDemand || 60),
        levelRelevance: s?.levelRelevance || 'Current'
      }))
      .filter((s) => s.name);

    const defaultMissing = uniqueByLower(DEFAULT_MISSING_SKILLS);
    const existingMissing = new Set(missingSkills.map((s) => s.name.toLowerCase()));
    for (const fallbackSkill of defaultMissing) {
      if (missingSkills.length >= MIN_MISSING_SKILLS) break;
      if (existingMissing.has(fallbackSkill.toLowerCase())) continue;
      missingSkills.push({
        name: fallbackSkill,
        category: 'General',
        priority: 'Medium',
        jobDemand: 70,
        levelRelevance: 'Current'
      });
      existingMissing.add(fallbackSkill.toLowerCase());
    }

    const knownCount = yourSkills.length;
    const missingCount = missingSkills.length;
    const avgProficiency = knownCount > 0
      ? Math.round(yourSkills.reduce((sum, skill) => sum + Math.max(0, Math.min(100, Number(skill.proficiency || 0))), 0) / knownCount)
      : 0;

    const balanceFactor = (knownCount + missingCount) > 0 ? (knownCount / (knownCount + missingCount)) : 0;
    const proficiencyFactor = avgProficiency / 100;
    const resumeFactor = Math.max(0, Math.min(100, Number(resumeInsights.atsScore || 0))) / 100;
    const aiCoverage = Math.max(0, Math.min(100, Number(aiResult.coverage || 0)));

    const computedCoverage = Math.round(((balanceFactor * 0.62) + (proficiencyFactor * 0.28) + (resumeFactor * 0.1)) * 100);
    const blendedCoverage = Math.round((computedCoverage * 0.8) + (aiCoverage * 0.2));
    const coverage = Math.max(0, Math.min(100, blendedCoverage));
    const missing = Math.max(0, Math.min(100, 100 - coverage));

    const fullResult = {
      username,
      careerStack,
      experienceLevel,
      ...aiResult,
      yourSkills,
      missingSkills,
      coverage,
      missing,
      roadmap: normalizeRoadmap(aiResult.roadmap, 3),
      resumeInsights,
      githubStats: githubData
    };

    if (req.user) {
      await AnalysisCache.findOneAndUpdate(
        cacheKey,
        { $set: { analysisData: fullResult, userId: req.user._id } },
        { upsert: true }
      );
    }

    await saveAIVersionSnapshot({
      req,
      source: 'skill_gap',
      output: fullResult,
      metadata: { fromCache: false, username, careerStack, experienceLevel }
    });

    res.json(fullResult);

  } catch (error) {
    console.error('Skill Gap Error:', { message: error.message, username: req.body?.username });
    res.status(500).json({
      message: 'Analysis failed. GitHub profile may be private or AI is overloaded. Try again in 30 seconds.',
      error: error.message
    });
  }
};

module.exports = { analyzeSkillGap };

