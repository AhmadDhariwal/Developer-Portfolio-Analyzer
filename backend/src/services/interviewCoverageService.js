const { listImportantTopics, normalizeTopicInput } = require('./interviewTopicNormalizer');
const { normalizeComparableText, DIFFICULTY_SET } = require('./interviewQuestionQualityService');

const coverageTarget = (topicKey = '', difficulty = '') => {
  const value = Number(process.env.INTERVIEW_QUESTION_COVERAGE_TARGET);
  const fallback = Number.isInteger(value) && value > 0 ? Math.min(100, value) : 30;
  const config = JSON.parse(process.env.INTERVIEW_QUESTION_COVERAGE_TARGETS || '{}');
  if (!config || typeof config !== 'object' || Array.isArray(config))
    throw new Error('Invalid interview coverage target configuration.');
  const technologies = new Set(listImportantTopics().map((item) => item.key));
  const valid = (target) => Number.isInteger(target) && target >= 0 && target <= 100;
  if (
    Object.keys(config).some((key) => !['default', 'difficulties', 'technologies'].includes(key)) ||
    (config.default !== undefined && !valid(config.default)) ||
    Object.entries(config.difficulties || {}).some(
      ([key, target]) => !DIFFICULTY_SET.has(key) || !valid(target)
    ) ||
    Object.entries(config.technologies || {}).some(
      ([key, cells]) =>
        !technologies.has(key) ||
        !cells ||
        typeof cells !== 'object' ||
        Object.entries(cells).some(([level, target]) => !DIFFICULTY_SET.has(level) || !valid(target))
    )
  )
    throw new Error('Invalid interview coverage target configuration.');
  const canonicalTopic = topicKey ? normalizeTopicInput({ skill: topicKey }).topicKey : '';
  return (
    config.technologies?.[canonicalTopic]?.[difficulty] ??
    config.difficulties?.[difficulty] ??
    config.default ??
    fallback
  );
};
const coveragePlan = (matrix) =>
  listImportantTopics().flatMap(({ key }) =>
    [...DIFFICULTY_SET].map((difficulty) => {
      const target = coverageTarget(key, difficulty);
      const available = matrix?.[key]?.[difficulty] || 0;
      return { technology: key, difficulty, target, available, missing: Math.max(0, target - available) };
    })
  );
// A stable run ID caps cumulative inserts across retries, including partial failures.
const planCoverageBatch = ({ batch, alreadyGenerated, target, available }) => {
  if (
    ![batch, alreadyGenerated, target, available].every((value) => Number.isInteger(value) && value >= 0) ||
    batch < 1 ||
    batch > 10
  )
    throw new Error('Invalid bounded coverage batch.');
  return Math.min(Math.max(0, batch - alreadyGenerated), Math.max(0, target - available));
};
const summarizeCoverage = (rows) => {
  const matrix = Object.fromEntries(
    listImportantTopics().map(({ key }) => [key, { easy: 0, medium: 0, hard: 0, senior: 0 }])
  );
  const summary = {
    total: 0,
    matrix,
    sources: {},
    missingAnswers: 0,
    duplicates: 0,
    canonicalDuplicates: 0,
    invalidDifficulties: 0,
    technologyAliases: 0,
    unknownTechnologies: 0,
    incorrectVerification: 0
  };
  const identities = new Set();
  const canonical = new Set();
  for (const row of rows) {
    summary.total++;
    const rawTopic = row.topicKey || row.skill || '';
    const topic = normalizeTopicInput({ skill: rawTopic }).topicKey;
    const difficulty = row.difficulty;
    if (!rawTopic || !matrix[topic]) summary.unknownTechnologies++;
    else {
      if (rawTopic !== topic) summary.technologyAliases++;
      if (DIFFICULTY_SET.has(difficulty)) matrix[topic][difficulty]++;
    }
    if (!DIFFICULTY_SET.has(difficulty)) summary.invalidDifficulties++;
    if (!String(row.answer || '').trim()) summary.missingAnswers++;
    const identity = `${topic}:${normalizeComparableText(row.question)}`;
    if (identities.has(identity)) summary.duplicates++;
    identities.add(identity);
    if (row.canonicalQuestionKey) {
      const key = `${topic}:${row.canonicalQuestionKey}`;
      if (canonical.has(key)) summary.canonicalDuplicates++;
      canonical.add(key);
    }
    const source = row.sourceType || row.source || 'unknown';
    summary.sources[source] = (summary.sources[source] || 0) + 1;
    if (
      ['ai', 'ai_generated', 'user_asked'].includes(source) &&
      (row.verificationStatus === 'verified' || row.sourceMeta?.verificationStatus === 'verified') &&
      row.reviewStatus !== 'approved'
    )
      summary.incorrectVerification++;
  }
  return summary;
};
module.exports = { coverageTarget, coveragePlan, planCoverageBatch, summarizeCoverage };
