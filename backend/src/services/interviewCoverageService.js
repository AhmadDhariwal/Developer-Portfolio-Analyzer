const { listImportantTopics, normalizeTopicInput } = require('./interviewTopicNormalizer');
const { normalizeComparableText, DIFFICULTY_SET } = require('./interviewQuestionQualityService');

const coverageTarget = () => {
  const value = Number(process.env.INTERVIEW_QUESTION_COVERAGE_TARGET);
  return Number.isInteger(value) && value > 0 ? Math.min(100, value) : 30;
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
module.exports = { coverageTarget, summarizeCoverage };
