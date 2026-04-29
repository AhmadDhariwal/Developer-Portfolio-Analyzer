const aiService = require('../services/aiservice');
const { getRecommendationPrompt } = require('../prompts/recommendationPrompt');
const AnalysisCache = require('../models/analysisCache');
const crypto = require('node:crypto');
const ResumeAnalysis = require('../models/resumeAnalysis');
const User = require('../models/user');
const { createVersion } = require('../services/aiVersionService');

const isValidUrl = (value) => typeof value === 'string' && /^https?:\/\//i.test(value.trim());

const toSearchUrl = (query) => `https://www.google.com/search?q=${encodeURIComponent(String(query || 'software engineering'))}`;

const normalizeProjectLink = (project) => {
  if (isValidUrl(project?.startUrl)) return project.startUrl.trim();
  if (isValidUrl(project?.url)) return project.url.trim();
  const query = `${project?.title || 'software project'} github tutorial`;
  return toSearchUrl(query);
};

const normalizeCareerPathLink = (path) => {
  if (isValidUrl(path?.exploreUrl)) return path.exploreUrl.trim();
  if (isValidUrl(path?.url)) return path.url.trim();
  const query = `${path?.title || 'software engineer'} career roadmap`;
  return toSearchUrl(query);
};

const toSkillName = (s) => (typeof s === 'string' ? s : s?.name || '').trim();

const flattenResumeSkills = (skillsMap = {}) => {
  if (!skillsMap) return [];
  const values = skillsMap instanceof Map
    ? Array.from(skillsMap.values())
    : Object.values(skillsMap);
  return values.flat().map(String).map((s) => s.trim()).filter(Boolean);
};

const uniqueBy = (arr, keyFn) => {
  const seen = new Set();
  return arr.filter((item) => {
    const key = keyFn(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const normalizeRecommendationPayload = (payload = {}) => {
  const projects = Array.isArray(payload.projects) ? payload.projects : [];
  const careerPaths = Array.isArray(payload.careerPaths) ? payload.careerPaths : [];

  return {
    ...payload,
    projects: projects.map((project, index) => ({
      ...project,
      id: project.id || `p_${index + 1}`,
      startUrl: normalizeProjectLink(project)
    })),
    careerPaths: careerPaths.map((path, index) => ({
      ...path,
      id: path.id || `c_${index + 1}`,
      exploreUrl: normalizeCareerPathLink(path)
    }))
  };
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
    console.error('Recommendation AI snapshot error:', error.message);
  }
};

/**
 * @desc  Generate personalised roadmap and project suggestions
 * @route POST /api/recommendations
 */
const getRecommendations = async (req, res) => {
  try {
    let { username, missingSkills, knownSkills, resumeText } = req.body;
    username = username || req.user?.activeGithubUsername || req.user?.githubUsername;

    // Career profile: prefer the authenticated user's saved profile, allow body override
    const careerStack     = req.user?.careerStack     || req.body.careerStack     || 'Full Stack';
    const experienceLevel = req.user?.experienceLevel || req.body.experienceLevel || 'Student';

    if (!username) {
      return res.status(400).json({ message: 'Username is required.' });
    }

    const { analyzeGitHubProfile } = require('../services/githubservice');
    const { getSkillGapPrompt }    = require('../prompts/skillGapPrompt');

    let githubData;
    try {
      githubData = await analyzeGitHubProfile(username.trim());
    } catch (githubError) {
      console.warn('Recommendations GitHub fallback:', githubError.message);
      githubData = {
        repoCount: 0,
        developerLevel: 'Unknown',
        strengths: [],
        weakAreas: [],
        languageDistribution: [],
        scores: {},
        repositories: []
      };
    }
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
      languageDistribution: githubData?.languageDistribution || [],
      scores: githubData?.scores || {}
    };

    // Resolve missingSkills and knownSkills if not supplied by the client
    if (!missingSkills || !knownSkills) {

      const cleanResume = (resumeText || '').trim();
      const lookupHash  = resumeText
        ? crypto.createHash('sha256').update(cleanResume).digest('hex')
        : 'no-resume';

      // Check cache for an existing skill gap result first
      const cachedGap = await AnalysisCache.findOne({
        githubUsername: username, careerStack, experienceLevel, resumeHash: lookupHash, analysisVersion: 'v2'
      });

      if (cachedGap?.analysisData?.missingSkills) {
        missingSkills = missingSkills || cachedGap.analysisData.missingSkills.map(s => s.name || s);
        knownSkills   = knownSkills   || (cachedGap.analysisData.yourSkills?.map(s => s.name || s) ?? []);
      } else {
        // Run an on-the-fly gap analysis to get both lists
        const detectedSkills = {
          github:      githubData.repositories.map(r => `${r.name} (${r.language})`).concat(resumeSkills.slice(0, 15)),
          repoQuality: githubData.scores
        };
        const gapPrompt = getSkillGapPrompt(careerStack, experienceLevel, detectedSkills, resumeInsights, githubInsights);
        const gapResult = await aiService.runAIAnalysis(gapPrompt, { missingSkills: [], yourSkills: [] });

        missingSkills = missingSkills || (gapResult.missingSkills?.map(s => s.name || s) ?? []);
        knownSkills   = knownSkills   || (gapResult.yourSkills?.map(s => s.name || s)   ?? []);
      }
    }

    knownSkills = uniqueBy(
      [...(knownSkills || []), ...resumeSkills, ...(githubData?.languageDistribution || []).map((l) => l.language)],
      (s) => String(s || '').trim().toLowerCase()
    ).slice(0, 30);

    missingSkills = uniqueBy(
      (missingSkills || []).map((s) => toSkillName(s)).filter(Boolean),
      (s) => String(s || '').trim().toLowerCase()
    ).slice(0, 20);

    const cleanResume = (resumeText || '').trim();
    const resumeHash  = resumeText
      ? crypto.createHash('sha256').update(cleanResume).digest('hex')
      : 'no-resume';
    const cacheKey = { githubUsername: username, careerStack, experienceLevel, resumeHash, analysisVersion: 'v2' };

    // Check cache for existing recommendations
    const cached = await AnalysisCache.findOne(cacheKey);
    if (cached?.analysisData?.projects) {
      const cachedResult = { ...normalizeRecommendationPayload(cached.analysisData), fromCache: true };
      await saveAIVersionSnapshot({
        req,
        source: 'recommendations',
        output: cachedResult,
        metadata: { fromCache: true, username, careerStack, experienceLevel }
      });
      return res.json(cachedResult);
    }

    // AI generation — pass known/missing plus resume+github context
    const fallback = {
      projects: [
        {
          id: 'p1', title: `${careerStack} Portfolio Revamp`, description: 'Build a production-grade portfolio with measurable outcomes.',
          tech: knownSkills.slice(0, 4), newTech: missingSkills.slice(0, 1), difficulty: 'Intermediate', impact: 82,
          estimatedWeeks: '2-3 weeks', whyThisProject: 'Shows your stack depth and real project impact.'
        },
        {
          id: 'p2', title: `${careerStack} API + Dashboard`, description: 'Create APIs and an analytics dashboard for domain data.',
          tech: knownSkills.slice(0, 4), newTech: missingSkills.slice(1, 2), difficulty: 'Intermediate', impact: 85,
          estimatedWeeks: '3-4 weeks', whyThisProject: 'Demonstrates end-to-end delivery and architecture skills.'
        },
        {
          id: 'p3', title: `${careerStack} Interview Project`, description: 'Build a focused project aligned to your target role interviews.',
          tech: knownSkills.slice(0, 4), newTech: missingSkills.slice(2, 3), difficulty: 'Intermediate', impact: 80,
          estimatedWeeks: '2-3 weeks', whyThisProject: 'Bridges your skill gaps to hiring requirements quickly.'
        }
      ],
      technologies: [
        { name: missingSkills[0] || 'Testing', category: 'Engineering Quality', priority: 'Must Learn', priorityRaw: 'High', jobDemand: 90, description: 'Core requirement in many modern teams.' },
        { name: missingSkills[1] || 'System Design', category: 'Architecture', priority: 'Must Learn', priorityRaw: 'High', jobDemand: 88, description: 'Needed for stronger mid/senior readiness.' },
        { name: missingSkills[2] || 'CI/CD', category: 'DevOps', priority: 'High', priorityRaw: 'High', jobDemand: 85, description: 'Improves delivery speed and reliability.' },
        { name: missingSkills[3] || 'Docker', category: 'Cloud/Infra', priority: 'Medium', priorityRaw: 'Medium', jobDemand: 83, description: 'Frequently required in backend/full-stack roles.' },
        { name: missingSkills[4] || 'SQL', category: 'Data', priority: 'Medium', priorityRaw: 'Medium', jobDemand: 80, description: 'Critical for production applications and reporting.' },
        { name: missingSkills[5] || 'Security Basics', category: 'Security', priority: 'Medium', priorityRaw: 'Medium', jobDemand: 78, description: 'Essential baseline for robust software delivery.' }
      ],
      careerPaths: [
        { id: 'c1', title: `${careerStack} Engineer`, match: 82, salaryRange: 'Market dependent', description: 'Primary target path aligned with your current stack.', timeline: '3-6 months', hiringCompanies: ['Product startups', 'SaaS companies'], actionItems: ['Complete 3 portfolio projects', 'Polish resume bullets with metrics'], exploreUrl: toSearchUrl(`${careerStack} engineer roadmap`) },
        { id: 'c2', title: 'Platform/Backend Engineer', match: 72, salaryRange: 'Market dependent', description: 'Great next path if you deepen architecture and delivery skills.', timeline: '6-9 months', hiringCompanies: ['Fintech', 'Cloud companies'], actionItems: ['Improve system design', 'Strengthen API reliability and scaling'], exploreUrl: toSearchUrl('platform backend engineer roadmap') },
        { id: 'c3', title: 'Technical Consultant', match: 65, salaryRange: 'Market dependent', description: 'Client-facing path for solution implementation and delivery.', timeline: '6-12 months', hiringCompanies: ['Consulting firms', 'Service companies'], actionItems: ['Build communication portfolio', 'Add domain-specific case studies'], exploreUrl: toSearchUrl('technical consultant career path') }
      ]
    };

    const prompt = getRecommendationPrompt(careerStack, experienceLevel, knownSkills, missingSkills, resumeInsights, githubInsights);
    const aiResult = await aiService.runAIAnalysis(prompt, fallback);

    const projects = uniqueBy(Array.isArray(aiResult.projects) ? aiResult.projects : [], (p) => String(p?.title || '').toLowerCase());
    const technologies = uniqueBy(Array.isArray(aiResult.technologies) ? aiResult.technologies : [], (t) => String(t?.name || '').toLowerCase());
    const careerPaths = uniqueBy(Array.isArray(aiResult.careerPaths) ? aiResult.careerPaths : [], (c) => String(c?.title || '').toLowerCase());

    while (projects.length < 3) projects.push(fallback.projects[projects.length % fallback.projects.length]);
    while (technologies.length < 6) technologies.push(fallback.technologies[technologies.length % fallback.technologies.length]);
    while (careerPaths.length < 3) careerPaths.push(fallback.careerPaths[careerPaths.length % fallback.careerPaths.length]);

    const fullResult = normalizeRecommendationPayload({
      username,
      careerStack,
      experienceLevel,
      projects: projects.slice(0, 8),
      technologies: technologies.slice(0, 12),
      careerPaths: careerPaths.slice(0, 6),
      resumeInsights,
      githubInsights
    });

    if (req.user) {
      await AnalysisCache.findOneAndUpdate(
        cacheKey,
        {
          $set: {
            'analysisData.projects':     fullResult.projects,
            'analysisData.technologies': fullResult.technologies,
            'analysisData.careerPaths':  fullResult.careerPaths,
            'analysisData.resumeInsights': fullResult.resumeInsights,
            'analysisData.githubInsights': fullResult.githubInsights,
            userId:                      req.user._id
          }
        },
        { upsert: true }
      );
    }

    await saveAIVersionSnapshot({
      req,
      source: 'recommendations',
      output: fullResult,
      metadata: { fromCache: false, username, careerStack, experienceLevel }
    });

    res.json(fullResult);

  } catch (error) {
    console.error('Recommendations Error:', error.message);
    res.status(500).json({ message: 'Failed to generate recommendations.' });
  }
};

/**
 * @desc  Generate recommendations (supports both temporary and permanent analysis)
 * @route POST /api/recommendations/generate
 * @body   { githubUsername, careerStack, experienceLevel, isTemporary, knownSkills, missingSkills }
 * @access Public (temporary) or Protected (permanent)
 */
const generateRecommendations = async (req, res) => {
  try {
    let { githubUsername, careerStack, experienceLevel, isTemporary, missingSkills, knownSkills, resumeText } = req.body;
    const isTemporaryMode = isTemporary === true || isTemporary === 'true';
    
    // Validate required fields
    if (!githubUsername) {
      return res.status(400).json({ message: 'GitHub username is required.' });
    }

    if (!careerStack) {
      return res.status(400).json({ message: 'Career stack is required.' });
    }

    if (!experienceLevel) {
      return res.status(400).json({ message: 'Experience level is required.' });
    }

    // Use the incoming parameters directly for temporary analysis
    // For permanent analysis, prefer user profile but allow overrides
    const finalCareerStack = isTemporaryMode ? careerStack : (req.user?.careerStack || careerStack || 'Full Stack');
    const finalExperienceLevel = isTemporaryMode ? experienceLevel : (req.user?.experienceLevel || experienceLevel || 'Student');

    const { analyzeGitHubProfile } = require('../services/githubservice');
    const { getSkillGapPrompt } = require('../prompts/skillGapPrompt');

    let githubData;
    try {
      githubData = await analyzeGitHubProfile(githubUsername.trim());
    } catch (githubError) {
      console.warn('Recommendations GitHub fallback:', githubError.message);
      githubData = {
        repoCount: 0,
        developerLevel: 'Unknown',
        strengths: [],
        weakAreas: [],
        languageDistribution: [],
        scores: {},
        repositories: []
      };
    }

    // Only fetch resume analysis for non-temporary (permanent) requests with authenticated user
    let latestResumeAnalysis = null;
    if (!isTemporaryMode && req.user?._id) {
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
      experienceLevel: latestResumeAnalysis?.experienceLevel || finalExperienceLevel,
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
      languageDistribution: githubData?.languageDistribution || [],
      scores: githubData?.scores || {}
    };

    const baseKnownSkills = uniqueBy(
      [...resumeSkills, ...(githubData?.languageDistribution || []).map((l) => l.language).filter(Boolean)],
      (s) => String(s || '').trim().toLowerCase()
    ).slice(0, 30);

    const cleanResume = (resumeText || '').trim();
    const resumeHash = cleanResume
      ? crypto.createHash('sha256').update(cleanResume).digest('hex')
      : 'no-resume';

    const recommendationCacheKey = {
      githubUsername: githubUsername.trim(),
      careerStack: finalCareerStack,
      experienceLevel: finalExperienceLevel,
      resumeHash,
      analysisVersion: 'v2'
    };

    const aiUnavailableNow = (() => {
      const openAIDown = !aiService?.hasOpenAI || (typeof aiService.isOpenAICoolingDown === 'function' && aiService.isOpenAICoolingDown());
      const geminiDown = !aiService?.hasGemini || (typeof aiService.isGeminiCoolingDown === 'function' && aiService.isGeminiCoolingDown());
      return openAIDown && geminiDown;
    })();

    // Resolve missingSkills and knownSkills if not supplied
    if (!missingSkills || !knownSkills) {
      const lookupHash = crypto.createHash('md5').update(cleanResume).digest('hex');
      const cachedAnalysis = await AnalysisCache.findOne({ hash: lookupHash }).lean();

      if (cachedAnalysis?.missingSkills && cachedAnalysis?.knownSkills) {
        knownSkills = cachedAnalysis.knownSkills;
        missingSkills = cachedAnalysis.missingSkills;
      } else {
        const detectedSkills = {
          github: (githubData?.repositories || []).map((r) => `${r.name} (${r.language || 'Unknown'})`).concat(resumeSkills.slice(0, 15)),
          repoQuality: githubData?.scores || {}
        };

        const skillGapPrompt = getSkillGapPrompt(
          finalCareerStack,
          finalExperienceLevel,
          detectedSkills,
          resumeInsights,
          githubInsights
        );

        const gapFallback = { yourSkills: [], missingSkills: [] };
        const skillGapData = await aiService.runAIAnalysis(skillGapPrompt, gapFallback);
        try {
          knownSkills = skillGapData.yourSkills?.map((s) => s.name || s) || [];
          missingSkills = skillGapData.missingSkills?.map((s) => s.name || s) || [];
          if (cleanResume) {
            await AnalysisCache.updateOne({ hash: lookupHash }, { hash: lookupHash, missingSkills, knownSkills }, { upsert: true });
          }
        } catch (jsonError) {
          console.warn('Skill gap parsing error:', jsonError.message);
          knownSkills = resumeSkills;
          missingSkills = [];
        }
      }
    }

    const safeKnownSkills = uniqueBy(Array.isArray(knownSkills) ? knownSkills : baseKnownSkills, (s) => String(s || '').trim().toLowerCase()).slice(0, 30);
    const safeMissingSkills = uniqueBy(Array.isArray(missingSkills) ? missingSkills : [], (s) => String(s || '').trim().toLowerCase()).slice(0, 20);

    const prompt = getRecommendationPrompt(
      finalCareerStack,
      finalExperienceLevel,
      safeKnownSkills,
      safeMissingSkills,
      resumeInsights,
      githubInsights
    );

    // AI-first behavior: if providers are unavailable, use cached AI output only.
    if (aiUnavailableNow) {
      const cachedRecommendations = await AnalysisCache.findOne(recommendationCacheKey).lean()
        || await AnalysisCache.findOne({
          githubUsername: githubUsername.trim(),
          careerStack: finalCareerStack,
          experienceLevel: finalExperienceLevel,
          analysisVersion: 'v2'
        }).sort({ updatedAt: -1 }).lean();

      if (cachedRecommendations?.analysisData?.projects?.length) {
        const cachedResult = {
          username: githubUsername,
          careerStack: finalCareerStack,
          experienceLevel: finalExperienceLevel,
          ...normalizeRecommendationPayload(cachedRecommendations.analysisData),
          fromCache: true,
          aiUnavailableNow: true
        };
        return res.json(cachedResult);
      }

      return res.status(503).json({
        message: 'AI providers are temporarily rate-limited. Please retry in a minute.',
        aiUnavailableNow: true
      });
    }

    const parsedRecommendations = await aiService.runAIAnalysis(prompt, {
      projects: [],
      technologies: [],
      careerPaths: []
    });

    const projects = uniqueBy(Array.isArray(parsedRecommendations.projects) ? parsedRecommendations.projects : [], (p) => String(p?.title || '').toLowerCase());
    const technologies = uniqueBy(Array.isArray(parsedRecommendations.technologies) ? parsedRecommendations.technologies : [], (t) => String(t?.name || '').toLowerCase());
    const careerPaths = uniqueBy(Array.isArray(parsedRecommendations.careerPaths) ? parsedRecommendations.careerPaths : [], (c) => String(c?.title || '').toLowerCase());

    if (!projects.length && !technologies.length && !careerPaths.length) {
      return res.status(503).json({
        message: 'AI did not return recommendation data. Please retry shortly.',
        aiUnavailableNow: false
      });
    }

    const fullResult = {
      username: githubUsername,
      careerStack: finalCareerStack,
      experienceLevel: finalExperienceLevel,
      ...normalizeRecommendationPayload({
        projects: projects.slice(0, 8),
        technologies: technologies.slice(0, 12),
        careerPaths: careerPaths.slice(0, 6)
      })
    };

    // Only save AI version snapshot for non-temporary analysis
    if (!isTemporaryMode) {
      await saveAIVersionSnapshot({
        req,
        source: 'recommendations/generate',
        output: fullResult,
        metadata: { isTemporary: false, username: githubUsername, careerStack: finalCareerStack, experienceLevel: finalExperienceLevel }
      });
    }

    console.log('[recommendations/generate] response counts', {
      username: githubUsername,
      projects: fullResult.projects?.length || 0,
      technologies: fullResult.technologies?.length || 0,
      careerPaths: fullResult.careerPaths?.length || 0,
      aiUnavailableNow
    });

    res.json(fullResult);

  } catch (error) {
    console.error('Generate Recommendations Error:', error.message);
    res.status(500).json({ message: 'Failed to generate recommendations.' });
  }
};

module.exports = { getRecommendations, generateRecommendations };


