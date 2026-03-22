const WorkflowRun = require('../models/workflowRun');
const { analyzeGitHubProfile } = require('./githubservice');
const { analyzeResume } = require('./resumeservice');
const aiService = require('./aiservice');
const { getSkillGapPrompt } = require('../prompts/skillGapPrompt');
const { getRecommendationPrompt } = require('../prompts/recommendationPrompt');
const { getPortfolioScorePrompt } = require('../prompts/portfolioScorePrompt');
const { createVersion } = require('./aiVersionService');

const PIPELINES = {
  github_only: [
    { key: 'github_analysis', label: 'GitHub Analysis' }
  ],
  resume_only: [
    { key: 'resume_analysis', label: 'Resume Analysis' }
  ],
  combined: [
    { key: 'github_analysis', label: 'GitHub Analysis' },
    { key: 'resume_analysis', label: 'Resume Analysis' },
    { key: 'portfolio_score', label: 'Portfolio Scoring' }
  ],
  deep_scan: [
    { key: 'github_analysis', label: 'GitHub Analysis' },
    { key: 'resume_analysis', label: 'Resume Analysis' },
    { key: 'skill_gap', label: 'Skill Gap Analysis' },
    { key: 'recommendations', label: 'Recommendations Analysis' },
    { key: 'portfolio_score', label: 'Portfolio Scoring' }
  ]
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeSkills = (resumeResult = {}) => {
  const source = resumeResult.skills || {};
  return Object.values(source).flat().map(String).filter(Boolean);
};

const executeStepHandler = async (stepKey, context) => {
  const { input, state } = context;

  if (stepKey === 'github_analysis') {
    if (!input.username) throw new Error('username is required for github analysis');
    const github = await analyzeGitHubProfile(String(input.username).trim());
    state.github = github;
    await createVersion({
      userId: input.userId,
      source: 'github_analysis',
      outputJson: github,
      metadata: { pipeline: input.pipeline }
    });
    return github;
  }

  if (stepKey === 'resume_analysis') {
    if (!input.resumeText || !String(input.resumeText).trim()) {
      throw new Error('resumeText is required for resume analysis');
    }
    const resume = await analyzeResume(String(input.resumeText).trim(), input.fileName || 'workflow-resume.txt', Number(input.fileSize || 0));
    state.resume = resume;
    await createVersion({
      userId: input.userId,
      source: 'resume_analysis',
      outputJson: resume,
      metadata: { pipeline: input.pipeline }
    });
    return resume;
  }

  if (stepKey === 'skill_gap') {
    const github = state.github || { repositories: [], scores: {} };
    const resume = state.resume || { skills: {} };
    const knownSkills = normalizeSkills(resume).slice(0, 20);
    const detectedSkills = {
      github: (github.repositories || []).map((r) => `${r.name} (${r.language})`).slice(0, 20),
      repoQuality: github.scores || {}
    };
    const prompt = getSkillGapPrompt(
      input.careerStack || 'Full Stack',
      input.experienceLevel || 'Student',
      detectedSkills,
      { skills: knownSkills },
      { repoCount: github.repoCount || 0, strengths: github.strengths || [] }
    );

    const fallback = { yourSkills: [], missingSkills: [], coverage: 0, missing: 100, roadmap: [], totalWeeks: 'N/A' };
    const result = await aiService.runAIAnalysis(prompt, fallback);
    state.skillGap = result;
    await createVersion({
      userId: input.userId,
      source: 'skill_gap',
      outputJson: result,
      metadata: { pipeline: input.pipeline }
    });
    return result;
  }

  if (stepKey === 'recommendations') {
    const skillGap = state.skillGap || { yourSkills: [], missingSkills: [] };
    const knownSkills = (skillGap.yourSkills || []).map((s) => s.name || s).filter(Boolean);
    const missingSkills = (skillGap.missingSkills || []).map((s) => s.name || s).filter(Boolean);

    const prompt = getRecommendationPrompt(
      input.careerStack || 'Full Stack',
      input.experienceLevel || 'Student',
      knownSkills,
      missingSkills,
      { skills: knownSkills },
      { strengths: state.github?.strengths || [] }
    );

    const fallback = { projects: [], technologies: [], careerPaths: [] };
    const result = await aiService.runAIAnalysis(prompt, fallback);
    state.recommendations = result;
    await createVersion({
      userId: input.userId,
      source: 'recommendations',
      outputJson: result,
      metadata: { pipeline: input.pipeline }
    });
    return result;
  }

  if (stepKey === 'portfolio_score') {
    const resume = state.resume || { skills: {}, strengths: [], weaknesses: [] };
    const github = state.github || { scores: {} };
    const prompt = getPortfolioScorePrompt(resume, github, input.careerStack || 'Full Stack', input.experienceLevel || 'Student');
    const fallback = {
      overallScore: 70,
      breakdown: { codeQuality: 70, skillCoverage: 70, industryReadiness: 70, projectImpact: 70 },
      summary: 'Baseline score calculated from available profile data.'
    };
    const result = await aiService.runAIAnalysis(prompt, fallback);
    state.portfolio = result;
    await createVersion({
      userId: input.userId,
      source: 'portfolio_score',
      outputJson: result,
      metadata: { pipeline: input.pipeline }
    });
    return result;
  }

  throw new Error(`Unknown pipeline step: ${stepKey}`);
};

const runPipeline = async (workflowId) => {
  const run = await WorkflowRun.findById(workflowId);
  if (!run) throw new Error('Workflow not found');

  run.status = 'running';
  run.startedAt = new Date();
  await run.save();

  const state = {};

  try {
    for (const step of run.steps) {
      step.status = 'running';
      step.startedAt = new Date();
      await run.save();

      let succeeded = false;
      const maxAttempts = Number(step.maxRetries || run.retryPolicy.maxRetriesPerStep || 1) + 1;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        step.attempts = attempt;
        try {
          step.output = await executeStepHandler(step.key, { input: run.input, state });
          step.status = 'completed';
          step.error = '';
          step.completedAt = new Date();
          succeeded = true;
          await run.save();
          break;
        } catch (error) {
          step.error = error.message;
          if (attempt < maxAttempts) {
            await run.save();
            await sleep(Number(run.retryPolicy.retryDelayMs || 600));
          }
        }
      }

      if (!succeeded) {
        step.status = 'failed';
        step.completedAt = new Date();
        run.status = 'failed';
        run.completedAt = new Date();
        await run.save();
        return run;
      }
    }

    run.result = state;
    run.status = 'completed';
    run.completedAt = new Date();
    await run.save();
    return run;
  } catch (error) {
    run.status = 'failed';
    run.completedAt = new Date();
    await run.save();
    throw error;
  }
};

const buildPipelineSteps = (pipeline, maxRetriesPerStep = 1) => {
  const template = PIPELINES[pipeline] || PIPELINES.combined;
  return template.map((item) => ({
    key: item.key,
    label: item.label,
    status: 'pending',
    attempts: 0,
    maxRetries: maxRetriesPerStep,
    startedAt: null,
    completedAt: null,
    error: '',
    output: null
  }));
};

module.exports = {
  PIPELINES,
  buildPipelineSteps,
  runPipeline
};
