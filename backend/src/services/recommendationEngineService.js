'use strict';

const crypto = require('node:crypto');
const requirements = require('./skillGapRequirements');
const { numeric } = require('./scoring/math');
const RULE_VERSION = 'recommendations-evidence-v1';
const SKILL_RULE = 'skill-evidence-coverage-v1';
const text = (value, limit = 500) =>
  typeof value === 'string' ? value.trim().slice(0, limit) : '';
const number = numeric;
const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const stableId = (category, target) =>
  `${category}_${hash(String(target).toLowerCase()).slice(0, 20)}`;
const timestamp = (value) =>
  value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toISOString() : null;
const freshness = (value, stale = false) =>
  stale ? 'STALE' : timestamp(value) ? 'RECORDED' : 'UNKNOWN';
const priorityWeight = (value) => ({ High: 3, Medium: 2, Low: 1 })[value] || 1;
const rank = (items) =>
  [...items].sort(
    (a, b) =>
      priorityWeight(b.priority) - priorityWeight(a.priority) ||
      (number(b.estimatedImpact) ?? 0) - (number(a.estimatedImpact) ?? 0) ||
      a.id.localeCompare(b.id, 'en'),
  );

// Only current, owned, explicitly versioned snapshots can supply coverage or skill status.
const compatibleSkillGap = (cache, context) => {
  const data = cache?.analysisData;
  if (
    !data ||
    data.ruleVersion !== SKILL_RULE ||
    data.cacheMetadata?.temporary ||
    String(cache.userId) !== String(context.userId) ||
    String(cache.githubUsername).toLowerCase() !== context.username.toLowerCase() ||
    cache.careerStack !== context.careerStack ||
    cache.experienceLevel !== context.experienceLevel ||
    cache.resumeHash !== context.resumeHash ||
    cache.resumeAnalysisId !== context.resumeAnalysisId
  )
    return null;
  const references = data.sourceReferences || data.evidenceCompleteness?.sources || [];
  for (const [type, current] of Object.entries(context.sources || {})) {
    const source = references.find((item) => item.type === type);
    if (!source || source.available !== current.available) return null;
    if (
      current.available &&
      ((type === 'github'
        ? String(source.id).toLowerCase() !== String(current.id).toLowerCase()
        : String(source.id) !== String(current.id)) ||
        timestamp(source.timestamp) !== timestamp(current.timestamp) ||
        (source.ruleVersion || null) !== (current.ruleVersion || null) ||
        source.freshness === 'STALE' ||
        current.freshness === 'STALE')
    )
      return null;
  }
  const generated = timestamp(cache.updatedAt || cache.createdAt);
  if (!generated || Date.now() - new Date(generated).getTime() > 24 * 60 * 60 * 1000) return null;
  return data;
};

const resumeSignals = (analysis, legacy = {}) => {
  if (!analysis)
    return { ...legacy, analyzed: Boolean(legacy.analyzed), atsScore: null, overallScore: null };
  const stored = analysis.resumeSignals || {};
  const scoring = analysis.scoring || stored.scoring;
  const modern = Boolean(scoring || stored.analysisVersion);
  return {
    ...legacy,
    analyzed: true,
    analysisId: String(analysis._id),
    fileId: String(analysis.fileId || ''),
    analysisVersion: analysis.analysisVersion || stored.analysisVersion || 'legacy',
    overallScore: modern ? number(scoring?.score) : null,
    atsScore: modern ? number(scoring?.score) : number(analysis.atsScore),
    keywordDensity: number(analysis.keywordDensity),
    formatScore: number(analysis.formatScore ?? stored.scores?.formattingScore),
    contentQuality: number(analysis.contentQuality),
    skills: (Array.isArray(stored.skills)
      ? stored.skills
      : Array.isArray(legacy.skills)
        ? legacy.skills
        : []
    )
      .filter((item) => typeof item === 'string')
      .slice(0, 40),
    technicalSkills: (Array.isArray(stored.skills)
      ? stored.skills
      : Array.isArray(legacy.technicalSkills)
        ? legacy.technicalSkills
        : []
    ).slice(0, 40),
    lastAnalyzedAt: analysis.analyzedAt || analysis.createdAt || null,
    scoring: scoring || null,
  };
};

const sourceMetadata = ({ username, githubData = {}, resumeAnalysis, resumeInsights = {} }) => {
  const github = githubData.githubSignals || {};
  const githubTime =
    github.analyzedAt ||
    githubData.fetchedAt ||
    githubData.cache?.cachedAt ||
    githubData.analyzedAt;
  const resumeTime = resumeAnalysis?.analyzedAt || resumeInsights.lastAnalyzedAt;
  return {
    github: {
      type: 'github',
      id: username,
      available: Boolean(
        username &&
        !githubData.unavailable &&
        (githubData.repositories?.length ||
          github.repositories?.length ||
          githubData.dataAvailability?.repositories === 'complete'),
      ),
      timestamp: timestamp(githubTime),
      freshness: freshness(githubTime, githubData.cache?.stale),
      ruleVersion: github.scoring?.ruleVersion || githubData.scoring?.ruleVersion || null,
    },
    resume: {
      type: 'resume',
      id: String(resumeAnalysis?._id || resumeInsights.analysisId || 'no-resume'),
      available: Boolean(resumeAnalysis || resumeInsights.analyzed),
      timestamp: timestamp(resumeTime),
      freshness: freshness(resumeTime),
      ruleVersion:
        resumeAnalysis?.resumeSignals?.scoring?.ruleVersion ||
        resumeAnalysis?.scoring?.ruleVersion ||
        null,
    },
  };
};

const buildPlan = ({
  username = '',
  careerStack,
  experienceLevel,
  githubData = {},
  resumeAnalysis,
  resumeInsights = {},
  skillGap = null,
  supportingSignals = {},
}) => {
  const sources = sourceMetadata({ username, githubData, resumeAnalysis, resumeInsights });
  sources.profile = {
    type: 'profile',
    id: `${careerStack}/${experienceLevel}`,
    available: true,
    timestamp: null,
    freshness: 'SELECTED_CONTEXT',
    ruleVersion: null,
  };
  for (const [type, signal] of [
    ['portfolio', supportingSignals.portfolioSignal],
    ['careerSprint', supportingSignals.careerSprintSignal],
  ]) {
    sources[type] = {
      type,
      id: type,
      available: Boolean(signal?.present),
      timestamp: timestamp(signal?.updatedAt),
      freshness: freshness(signal?.updatedAt),
      ruleVersion: null,
    };
  }
  const cards = [];
  const add = ({
    category,
    target,
    title,
    description,
    priority = 'Medium',
    action,
    facts,
    source,
    status = null,
    confidence = 'UNKNOWN',
    requirement = null,
  }) => {
    const meta =
      source === 'skillGap'
        ? {
            type: source,
            id: skillGap?.signalHash || skillGap?.cacheMetadata?.signalHash || SKILL_RULE,
            timestamp: timestamp(skillGap?.calculatedAt),
            freshness: freshness(skillGap?.calculatedAt),
            ruleVersion: SKILL_RULE,
          }
        : sources[source];
    const id = stableId(category, target);
    if (meta?.freshness === 'STALE') {
      priority = 'Low';
      description = `Last recorded evidence: ${description} Refresh this source before treating it as outstanding work.`;
      action = 'Refresh and review the current source evidence before choosing this improvement.';
    }
    cards.push({
      id,
      type: category,
      category,
      title: text(title, 160),
      description: text(description),
      priority,
      reason: text(description),
      evidence: facts
        .map((fact) => text(fact))
        .filter(Boolean)
        .slice(0, 5),
      factualSignals: facts.map((fact) => ({ source, fact: text(fact) })).slice(0, 5),
      sourceSignalsUsed: [`${source}Signals`],
      sources: [meta],
      freshness: meta?.freshness || 'UNKNOWN',
      actionLabel: 'Review next step',
      actionableNextStep: text(action),
      targetSkill: category === 'learning' ? target : null,
      targetProject: category === 'projects' ? target : null,
      evidenceStatus: status,
      requirement,
      sourceConfidence: confidence,
      confidenceScore: null,
      estimatedImpact: null,
      estimatedEffort: '',
      actionUrl:
        source === 'portfolio'
          ? '/app/portfolio'
          : source === 'careerSprint'
            ? '/app/career-sprint'
            : category === 'careerPaths'
              ? '/app/profile'
              : category === 'resume'
                ? '/app/resume-analyzer'
                : category === 'learning'
                  ? '/app/courses'
                  : '/app/github-analyzer',
      navigation: {
        courses: { route: '/app/courses', query: category === 'learning' ? { skill: target } : {} },
        careerSprint: {
          route: '/app/career-sprint',
          recommendationId: id,
          skill: category === 'learning' ? target : '',
          requiresAuthentication: true,
        },
      },
      ruleVersion: RULE_VERSION,
      aiGenerated: false,
    });
  };
  const skills = skillGap
    ? skillGap.skills || [...(skillGap.yourSkills || []), ...(skillGap.missingSkills || [])]
    : [];
  const seenSkills = new Set();
  for (const skill of skills.slice(0, 80)) {
    const name = text(skill.name, 100);
    if (!name || seenSkills.has(name.toLowerCase()) || skill.status === 'DEMONSTRATED') continue;
    seenSkills.add(name.toLowerCase());
    if (!['PARTIAL', 'CLAIMED_ONLY', 'NOT_EVIDENCED', 'UNKNOWN'].includes(skill.status)) continue;
    const unknown = skill.status === 'UNKNOWN';
    const projected = [...(skillGap.yourSkills || []), ...(skillGap.missingSkills || [])].find(
      (item) => item.name === name,
    );
    const approvedPriority =
      skill.priority || projected?.priority || requirements.metadata(name).priority || 'Medium';
    const description = unknown
      ? `Available sources cannot assess ${name}. Verify your current evidence before choosing study work.`
      : `${name} is ${skill.status} in the current evidence snapshot. This describes available proof, not inability.`;
    add({
      category: 'learning',
      target: name,
      title: `${unknown ? 'Review evidence for' : 'Build technical proof for'} ${name}`,
      description,
      priority: unknown
        ? 'Low'
        : ['High', 'Medium', 'Low'].includes(approvedPriority)
          ? approvedPriority
          : 'Medium',
      action: unknown
        ? `Review analyzed artifacts for ${name}; add relevant evidence if available.`
        : `Choose a focused ${name} exercise or project and record implementation, tests and an explanation.`,
      facts: [`${name}: ${skill.status}`, `Requirement: ${skill.requirement || 'UNKNOWN'}`],
      source: 'skillGap',
      status: skill.status,
      confidence: skill.evidenceConfidence,
      requirement: skill.requirement,
    });
  }
  const resume = resumeAnalysis?.resumeSignals || {};
  if (resumeAnalysis?.contentQualityState?.scoreable === false)
    add({
      category: 'resume',
      target: 'readability',
      title: 'Review resume readability',
      priority: 'High',
      description: 'The selected resume analysis marks the content as not scoreable.',
      action:
        'Review text extraction and readability, then upload a readable version of this resume.',
      facts: ['Resume contentQualityState.scoreable: false'],
      source: 'resume',
      confidence: 'RECORDED',
    });
  if (!skillGap && sources.resume.available) {
    for (const name of [...new Set(resumeInsights.skills || [])].slice(0, 12)) {
      add({
        category: 'learning',
        target: name,
        title: `Review technical proof for ${name}`,
        description: `The selected resume lists ${name}. Without a compatible Skill Gap snapshot, technical evidence status is unavailable.`,
        priority: 'Low',
        action: `Review existing ${name} implementation evidence before choosing learning or proof-building work.`,
        facts: [`Selected resume lists: ${name}`],
        source: 'resume',
        status: 'CLAIMED_ONLY',
        confidence: 'LOW',
      });
    }
  }
  // Deterministic warning codes are safer than AI concerns or arbitrary prose.
  for (const warning of (resume.warnings || []).slice(0, 20)) {
    const code = text(warning.code, 80);
    if (!code || !/^(missing_|weak_|format|readab|education_|inconsistent)/.test(code)) continue;
    if (
      code === 'missing_metrics' &&
      number(resumeAnalysis?.scoring?.evidence?.facts?.quantifiedAchievementCount) >= 2
    )
      continue;
    const section = code.startsWith('missing_') ? code.slice(8) : '';
    if (resume.sectionPresence?.[section] === true) continue;
    add({
      category: 'resume',
      target: code,
      title: `Review resume: ${code.replaceAll('_', ' ')}`,
      description: `The selected resume analysis reports: ${text(warning.message)}.`,
      priority:
        warning.severity === 'high' ? 'High' : warning.severity === 'low' ? 'Low' : 'Medium',
      action:
        code === 'missing_metrics'
          ? 'Add verifiable outcomes to relevant achievement bullets, then reanalyze this resume.'
          : `Review ${code.replaceAll('_', ' ')} in the selected resume and reanalyze it.`,
      facts: [`Selected resume analysis: ${sources.resume.id}`, `Warning: ${code}`],
      source: 'resume',
      confidence: 'RECORDED',
    });
  }
  for (const repo of (
    githubData.repositories ||
    githubData.githubSignals?.repositories ||
    []
  ).slice(0, 30)) {
    const name = text(repo.name || repo.fullName, 140);
    if (!name) continue;
    const hasReadme = repo.hasReadme ?? repo.documentation?.hasReadme;
    if (hasReadme === false)
      add({
        category: 'projects',
        target: `${username}/${name}:readme`,
        title: `Document ${name}`,
        description: `The repository analysis records no README for ${name}.`,
        priority: 'High',
        action:
          'Add setup instructions, purpose, usage and verified project outcomes to the README.',
        facts: [`Repository: ${name}`, 'hasReadme: false'],
        source: 'github',
        confidence: 'RECORDED',
      });
    if (repo.hasTests === false || repo.testing?.hasTests === false)
      add({
        category: 'projects',
        target: `${username}/${name}:testing`,
        title: `Add testing evidence to ${name}`,
        description: `The repository analysis records no testing evidence for ${name}.`,
        action: 'Add relevant automated tests and document how to run them.',
        facts: [`Repository: ${name}`, 'hasTests: false'],
        source: 'github',
        confidence: 'RECORDED',
      });
    // A supported next step for a known repository, without asserting a weakness.
    if (hasReadme == null && text(repo.description))
      add({
        category: 'projects',
        target: `${username}/${name}:review`,
        title: `Review technical proof in ${name}`,
        description: `The analyzed repository ${name} is available for a proof review; documentation and test completeness are unknown.`,
        priority: 'Low',
        action: 'Review implementation, documentation and tests before choosing an improvement.',
        facts: [`Repository: ${name}`],
        source: 'github',
      });
  }
  const portfolio = supportingSignals.portfolioSignal;
  const dimensions = Object.entries(githubData.scoring?.breakdown || {})
    .map(([name, value]) => ({
      name: value?.id || name,
      score: number(value?.score ?? value?.value),
    }))
    .filter((item) => item.score !== null)
    .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
  if (
    sources.github.available &&
    dimensions.length &&
    !cards.some((card) => card.category === 'projects')
  )
    add({
      category: 'projects',
      target: `${username}:quality-review`,
      title: 'Review repository quality evidence',
      priority: 'Medium',
      description: `${dimensions[0].name} is the lowest available recorded GitHub dimension; sampled evidence limits interpretation.`,
      action:
        'Inspect the source repositories and quality evidence before choosing a concrete improvement.',
      facts: [
        `Recorded dimension: ${dimensions[0].name} ${dimensions[0].score}`,
        'Repository quality signals may be sampled.',
      ],
      source: 'github',
    });
  if (portfolio?.present && number(portfolio.listedProjects) === 0)
    add({
      category: 'careerPaths',
      target: 'portfolio-projects',
      title: 'Present existing projects in your portfolio',
      description: 'The current portfolio signal records no listed projects.',
      action:
        'Choose an existing project and add a verifiable description and links to your portfolio.',
      facts: ['Portfolio listedProjects: 0'],
      source: 'portfolio',
    });
  const sprint = supportingSignals.careerSprintSignal;
  if (
    sprint?.present &&
    sprint.activeLearningFocus &&
    (sprint.repeatedIncompleteSkills || []).length
  )
    add({
      category: 'careerPaths',
      target: 'learning-follow-through',
      title: 'Review unfinished learning actions',
      description:
        'Career Sprint records repeated incomplete learning actions in the current focus.',
      action: `Review unfinished tasks for ${text(sprint.activeLearningFocus, 100)} and choose one concrete next step.`,
      facts: [`Sprint focus: ${text(sprint.activeLearningFocus, 100)}`],
      source: 'careerSprint',
    });
  if (!cards.length)
    add({
      category: 'careerPaths',
      target: careerStack,
      title: `Review ${careerStack} evidence`,
      description: 'No outstanding supported weakness is established by the available sources.',
      priority: 'Low',
      action:
        'Review the active profile and available analyses before selecting the next career action.',
      facts: [`Target stack: ${careerStack}`],
      source: 'profile',
    });
  const sorted = rank([...new Map(cards.map((card) => [card.id, card])).values()]).slice(0, 40);
  const grouped = Object.fromEntries(
    ['learning', 'projects', 'resume', 'careerPaths'].map((category) => [
      category,
      sorted.filter((card) => card.category === category),
    ]),
  );
  return {
    username,
    careerStack,
    experienceLevel,
    ruleVersion: RULE_VERSION,
    analysisSummary: `Recommendations use the current ${careerStack} / ${experienceLevel} context and recorded evidence. Unavailable evidence does not establish missing ability.`,
    recommendations: sorted,
    structuredRecommendations: grouped,
    projects: grouped.projects.map((card) => ({
      ...card,
      tech: [],
      newTech: [],
      impact: null,
      estimatedWeeks: '',
      whyThisProject: card.reason,
      startUrl: card.actionUrl,
    })),
    technologies: grouped.learning.map((card) => ({
      ...card,
      name: card.targetSkill,
      priorityRaw: card.priority,
      jobDemand: null,
    })),
    careerPaths: grouped.careerPaths.map((card) => ({
      ...card,
      match: null,
      actionItems: [card.actionableNextStep],
      exploreUrl: '/app/profile',
      hiringCompanies: [],
    })),
    resumeRecommendations: grouped.resume.map((card) => card.actionableNextStep),
    portfolioRecommendations: [],
    learningActions: grouped.learning.map((card) => card.actionableNextStep),
    interviewReadinessActions: [],
    sourceMetadata: sources,
    sourceScores: {
      githubHealth: number(
        githubData.scoring
          ? githubData.scoring.score
          : githubData.githubSignals?.scoring
            ? githubData.githubSignals.scoring.score
            : githubData.scores?.healthScore,
      ),
      resumeOverall: number(resumeInsights.overallScore),
      skillEvidenceCoverage: number(skillGap?.coverage),
    },
    recommendationScores: Object.fromEntries(
      [
        'readinessScore',
        'portfolioScore',
        'learningScore',
        'interviewScore',
        'marketReadinessScore',
        'careerGrowthScore',
        'overallRecommendationScore',
      ].map((key) => [key, null]),
    ),
    scoreProvenance: {
      legacyComposite: 'unavailable',
      reason: 'Evidence coverage is not a readiness or hiring score.',
    },
    roadmap: {
      immediateActions: sorted.slice(0, 4),
      next30Days: [],
      next60Days: [],
      next90Days: [],
      phases: [],
      learningSequence: grouped.learning.map((card) => card.targetSkill),
      suggestedProjects: grouped.projects.map((card) => card.title),
    },
    supportingContext: {
      portfolioAvailable: Boolean(supportingSignals.portfolioSignal?.present),
      sprintAvailable: Boolean(supportingSignals.careerSprintSignal?.present),
      weeklyProgressAvailable: Boolean(supportingSignals.weeklyReportSignal?.present),
    },
  };
};

// Wording is supplemental. Never use it to replace evidence-backed cards or actions.
const safeSuggestions = (enrichment, plan) => {
  const targets = plan.recommendations
    .map((card) => card.targetSkill || card.targetProject)
    .filter(Boolean);
  return (enrichment.learningActions || [])
    .filter(
      (value) =>
        typeof value === 'string' &&
        value.length <= 500 &&
        /^(practice|explore|try|review|build|test|document|compare|implement)\b/i.test(value) &&
        !/\d|https?:|\b(you|your|because|already|expert|mastered|strong|lack|missing|weak|poor|guarantee|hiring|salary|score|percent|days?|weeks?|months?|years?)\b/i.test(
          value,
        ) &&
        targets.some((target) => value.toLowerCase().includes(target.toLowerCase())),
    )
    .slice(0, 4)
    .map((suggestion) => ({
      suggestion,
      aiGenerated: true,
      kind: 'learningIdea',
      ruleVersion: RULE_VERSION,
    }));
};

const versionChanges = (current, previous) => {
  const before =
    previous?.recommendations || Object.values(previous?.structuredRecommendations || {}).flat();
  const after = current.recommendations || [];
  const beforeIds = new Set(before.map((card) => card.id));
  const afterIds = new Set(after.map((card) => card.id));
  const added = after.filter((card) => !beforeIds.has(card.id));
  const obsolete = before.filter((card) => !afterIds.has(card.id));
  return {
    currentRecommendation: { score: null, count: after.length, ruleVersion: RULE_VERSION },
    previousRecommendation: previous
      ? {
          score: number(previous.recommendationScores?.overallRecommendationScore),
          count: before.length,
          ruleVersion: previous.ruleVersion || 'legacy',
          legacy: previous.ruleVersion !== RULE_VERSION,
        }
      : null,
    delta: {
      scoreChange: null,
      newCount: added.length,
      obsoleteCount: obsolete.length,
      completedCount: 0,
    },
    newRecommendations: added.slice(0, 8),
    obsoleteRecommendations: obsolete.slice(0, 8),
    completedRecommendations: [],
    note: 'Disappearance or a changed context does not establish task completion.',
  };
};

const sourceFingerprint = ({ githubData, resumeInsights, skillGap }) =>
  hash({
    github: {
      repositories: githubData.repositories || [],
      scoring: githubData.scoring || githubData.githubSignals?.scoring || null,
      timestamp: githubData.githubSignals?.analyzedAt || githubData.fetchedAt || null,
      stale: Boolean(githubData.cache?.stale),
    },
    resume: resumeInsights,
    skillGap,
  });

module.exports = {
  RULE_VERSION,
  SKILL_RULE,
  number,
  hash,
  rank,
  stableId,
  compatibleSkillGap,
  resumeSignals,
  sourceMetadata,
  buildPlan,
  safeSuggestions,
  versionChanges,
  sourceFingerprint,
};
