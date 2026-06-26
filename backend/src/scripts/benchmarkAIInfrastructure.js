const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const aiService = require('../services/aiservice');
const aiProviderManager = require('../services/aiProviderManager');
const { initRedisCache } = require('../services/redisCacheService');
const { estimateTokens, buildSkillGapPromptContext } = require('../services/promptBuilderService');
const { getSkillGapPrompt } = require('../prompts/skillGapPrompt');
const { getGitHubPrompt } = require('../prompts/githubPrompt');
const { getResumePrompt } = require('../prompts/resumePrompt');
const { getRecommendationPrompt } = require('../prompts/recommendationPrompt');
const { getCareerSprintPrompt } = require('../prompts/careerSprintPrompt');
const { getInterviewPrepPrompt } = require('../prompts/interviewPrepPrompt');
const { getPortfolioScorePrompt } = require('../prompts/portfolioScorePrompt');
const { getWeeklyReportPrompt } = require('../prompts/weeklyReportPrompt');
const { getResumeGuidePrompt } = require('../prompts/resumeGuidePrompt');

const live = process.argv.includes('--live');

const percentile = (values, p) => {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
};

const sampleContext = buildSkillGapPromptContext({
  careerStack: 'Full Stack',
  experienceLevel: '1-2 years',
  evidenceBreakdown: {
    githubSkills: ['React', 'Node.js', 'TypeScript', 'MongoDB'],
    resumeSkills: ['JavaScript', 'REST APIs', 'SQL'],
    provenSkills: ['React', 'Node.js'],
    claimedButNotProvenSkills: ['Docker'],
    missingExpectedSkills: ['Testing', 'CI/CD', 'System Design']
  },
  resumeInsights: {
    analyzed: true,
    atsScore: 76,
    strengths: ['Frontend projects', 'API experience'],
    weaknesses: ['Limited testing evidence'],
    missingSections: ['Impact metrics']
  },
  githubInsights: {
    repoCount: 8,
    developerLevel: 'Intermediate',
    strengths: ['Full-stack CRUD applications'],
    weakAreas: ['Deployment and testing proof'],
    languageDistribution: [{ language: 'TypeScript', percentage: 55 }, { language: 'JavaScript', percentage: 30 }],
    repositories: [
      { name: 'portfolio-api', language: 'JavaScript', topics: ['node', 'express'], description: 'REST API with auth and MongoDB' },
      { name: 'task-dashboard', language: 'TypeScript', topics: ['react', 'charts'], description: 'React dashboard with reusable components' }
    ],
    scores: { overall: 78 }
  },
  developerSignals: {
    portfolioSignal: { present: true, completenessScore: 80, portfolioSkills: ['React', 'Node.js'] },
    integrationSignal: { present: true, usedProviders: ['github'], detectedSkills: ['GitHub Actions'], weakProof: ['Docker'] },
    careerSprintSignal: { consistencyScore: 70, completedSkillSignals: ['React'], repeatedIncompleteSkills: ['Testing'] },
    weeklyReportSignal: { status: 'Available', weeklyProgressScore: 68, repeatedWeakAreas: ['Testing'] },
    jobsDemandSignal: {
      sampledJobs: 24,
      topSkills: [
        { name: 'React', demandScore: 88, postings: 19 },
        { name: 'TypeScript', demandScore: 82, postings: 16 },
        { name: 'Docker', demandScore: 74, postings: 12 }
      ]
    }
  },
  deterministicGroups: {
    yourSkills: [{ name: 'React' }, { name: 'Node.js' }, { name: 'TypeScript' }],
    missingSkills: [{ name: 'Testing' }, { name: 'CI/CD' }, { name: 'Docker' }]
  }
});

const sampleResumeText = `
Ahmad Developer
Full Stack Engineer
Skills: JavaScript, TypeScript, React, Node.js, Express, MongoDB, SQL.
Experience: Built REST APIs, dashboards, authentication flows, and deployment pipelines.
Projects: Portfolio analyzer, task dashboard, interview prep app.
Education: BS Computer Science.
Certifications: AWS Cloud Practitioner.
Achievements: Improved API response time by 35% and reduced dashboard load time by 25%.
`.repeat(12);

const promptCases = [
  {
    feature: 'Skill Gap',
    endpoint: 'POST /api/skillgap/skill-gap',
    prompt: getSkillGapPrompt(
      sampleContext.profile.careerStack,
      sampleContext.profile.experienceLevel,
      sampleContext.detectedSkills,
      sampleContext.resume,
      sampleContext.github,
      sampleContext.signals
    )
  },
  {
    feature: 'GitHub Analyzer',
    endpoint: 'POST /api/github/analyze',
    prompt: getGitHubPrompt(sampleContext.github)
  },
  {
    feature: 'Resume Analysis',
    endpoint: 'POST /api/resume/analyze',
    prompt: getResumePrompt(sampleResumeText)
  },
  {
    feature: 'Recommendations',
    endpoint: 'POST /api/recommendations/generate',
    prompt: getRecommendationPrompt('Full Stack', '1-2 years', ['React', 'Node.js'], ['Testing', 'Docker'], sampleContext.resume, sampleContext.github, sampleContext.signals)
  },
  {
    feature: 'Career Sprint',
    endpoint: 'POST /api/career-sprint/ai-plan',
    prompt: getCareerSprintPrompt({
      careerStack: 'Full Stack',
      experienceLevel: '1-2 years',
      focusTechnology: 'Testing',
      sprintWindow: 'Current sprint',
      missingSkills: ['Testing', 'Docker', 'CI/CD'],
      githubWeakAreas: ['Testing proof'],
      recommendationTechnologies: ['Vitest', 'Docker'],
      developerSignals: sampleContext.signals,
      baselineTasks: [{ title: 'Add tests', category: 'practice', priority: 'high', points: 5, description: 'Cover service and component behavior.' }]
    })
  },
  {
    feature: 'Interview Prep',
    endpoint: 'POST /api/interview-prep/generate',
    prompt: getInterviewPrepPrompt({ careerStack: 'Full Stack', experienceLevel: '1-2 years', skillGaps: ['Testing', 'System Design'] })
  },
  {
    feature: 'Portfolio Score',
    endpoint: 'POST /api/analysis/score',
    prompt: getPortfolioScorePrompt(sampleContext.resume, sampleContext.github, 'Full Stack', '1-2 years')
  },
  {
    feature: 'Weekly Report',
    endpoint: 'POST /api/weekly-reports/generate',
    prompt: getWeeklyReportPrompt({
      name: 'Developer',
      careerStack: 'Full Stack',
      experienceLevel: '1-2 years',
      aiInput: { current: { score: 78 }, previous: { score: 70 }, signals: sampleContext.signals }
    })
  },
  {
    feature: 'Resume Guide',
    endpoint: 'POST /api/resume-guide/generate',
    prompt: getResumeGuidePrompt({
      atsScore: 76,
      keywordDensity: 70,
      formatScore: 82,
      contentQuality: 74,
      experienceLevel: 'Intermediate',
      experienceYears: 2,
      skillsFlat: 'React, Node.js, TypeScript, MongoDB, SQL',
      certifications: ['AWS Cloud Practitioner'],
      keyAchievements: ['Reduced dashboard load time by 25%'],
      suggestions: [{ title: 'Add metrics', description: 'Quantify project and business impact in each role.' }]
    })
  }
];

const promptStats = promptCases.map((item) => {
  const chars = Buffer.byteLength(item.prompt, 'utf8');
  const estimatedTokens = estimateTokens(item.prompt);
  return {
    feature: item.feature,
    endpoint: item.endpoint,
    chars,
    estimatedTokens,
    underTarget: estimatedTokens < 5000
  };
});

const summarizeStatus = () => {
  const status = aiProviderManager.getStatus();
  return {
    priority: status.priority,
    enabledProviders: status.enabledProviders,
    disabledProviders: status.disabledProviders,
    providerHealth: status.providers.map((provider) => ({
      provider: provider.provider,
      enabled: provider.enabled,
      reason: provider.disabledReason,
      models: provider.models,
      successRate: provider.health.successRate,
      averageLatencyMs: provider.health.averageLatencyMs,
      lastSuccessfulAt: provider.health.lastSuccessfulAt
    }))
  };
};

const run = async () => {
  const startedAt = Date.now();
  await initRedisCache();
  const tokenValues = promptStats.map((item) => item.estimatedTokens);
  const report = {
    mode: live ? 'live' : 'dry-run',
    promptBenchmark: {
      targetTokens: 5000,
      averageTokens: Math.round(tokenValues.reduce((sum, value) => sum + value, 0) / tokenValues.length),
      p95Tokens: percentile(tokenValues, 95),
      maxTokens: Math.max(...tokenValues),
      underTargetCount: promptStats.filter((item) => item.underTarget).length,
      totalPromptFamilies: promptStats.length,
      prompts: promptStats
    },
    providerConfiguration: summarizeStatus(),
    liveProviderLatencyMs: 'not-run',
    cachedPromptLatencyMs: 'not-run',
    aiService: aiService.getBenchmarkSnapshot(),
    databaseOptimization: {
      addedIndexes: [
        'Analysis: userId + updatedAt',
        'Recommendation: userId + createdAt',
        'Repository: ownerId + lastUpdated',
        'CareerSprint: userId + updatedAt/week range',
        'InterviewPrepSession: userId + createdAt',
        'SkillGraph: userId + updatedAt/profile'
      ]
    }
  };

  if (live) {
    const fallback = { ok: true, source: 'benchmark-fallback' };
    const firstStartedAt = Date.now();
    await aiService.runAIAnalysis(promptCases[0].prompt, fallback, 0);
    report.liveProviderLatencyMs = Date.now() - firstStartedAt;

    const secondStartedAt = Date.now();
    await aiService.runAIAnalysis(promptCases[0].prompt, fallback, 0);
    report.cachedPromptLatencyMs = Date.now() - secondStartedAt;
    report.providerConfiguration = summarizeStatus();
    report.aiService = aiService.getBenchmarkSnapshot();
  }

  report.durationMs = Date.now() - startedAt;
  console.log(JSON.stringify(report, null, 2));
};

run().catch((error) => {
  console.error(JSON.stringify({
    error: 'AI infrastructure benchmark failed',
    message: error.message
  }, null, 2));
  process.exitCode = 1;
});
