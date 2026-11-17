const { tokenize, DIFFICULTY_SET } = require('./interviewQuestionQualityService');
const { hasValidAnswerSchema } = require('./interviewAIValidation');
const { coveragePlan } = require('./interviewCoverageService');

const sourceOf = (row) => row.sourceType || row.source || 'unknown';
const groupCoverageExclusions = (rows, eligibleIds, failures) => {
  const groups = new Map();
  for (const row of rows) {
    const technology = row.topicKey || row.skill || 'unknown';
    const source = sourceOf(row);
    const key = [technology, source, row.difficulty].join('|');
    if (!groups.has(key))
      groups.set(key, {
        technology,
        source,
        difficulty: row.difficulty,
        raw: 0,
        eligible: 0,
        excluded: 0,
        reasons: {},
        metadata: {},
        statuses: {}
      });
    const group = groups.get(key);
    group.raw++;
    if (eligibleIds.has(String(row._id))) group.eligible++;
    else group.excluded++;
    for (const reason of failures.get(String(row._id)) || [])
      group.reasons[reason] = (group.reasons[reason] || 0) + 1;
    const defects = [];
    for (const field of [
      'topicKey',
      'sourceType',
      'normalizedQuestionHash',
      'canonicalQuestionKey',
      'searchableTokens'
    ])
      if (!row[field] || (Array.isArray(row[field]) && !row[field].length)) defects.push(`missing_${field}`);
    if (row.topicKey && row.skill && row.topicKey !== row.skill) defects.push('inconsistent_topic_skill');
    if (!DIFFICULTY_SET.has(row.difficulty)) defects.push('invalid_canonical_difficulty');
    if (Number(row.qualityScore) >= 1 && Number(row.qualityScore) <= 5)
      defects.push('legacy_quality_scale_1_to_5');
    if (!hasValidAnswerSchema(row)) defects.push('incomplete_modern_answer_sections');
    for (const defect of defects) group.metadata[defect] = (group.metadata[defect] || 0) + 1;
    for (const field of [
      'reviewStatus',
      'qualityState',
      'qualityStatus',
      'isApproved',
      'confidenceScore',
      'qualityScore',
      'relevanceScore'
    ]) {
      const value = String(row[field] ?? 'missing');
      group.statuses[field] ||= {};
      group.statuses[field][value] = (group.statuses[field][value] || 0) + 1;
    }
  }
  return [...groups.values()];
};

const nearDuplicateCoverage = (rows, threshold = 0.8) => {
  const topics = new Map();
  for (const row of rows) {
    const topic = row.topicKey || row.skill || 'unknown';
    if (!topics.has(topic)) topics.set(topic, []);
    topics.get(topic).push({ id: String(row._id), tokens: new Set(tokenize(row.question)) });
  }
  const report = { threshold, pairs: 0, byTechnology: {}, samples: [] };
  for (const [topic, items] of topics) {
    let count = 0;
    for (let left = 0; left < items.length; left++)
      for (let right = left + 1; right < items.length; right++) {
        const a = items[left].tokens,
          b = items[right].tokens;
        if (!a.size || !b.size || Math.min(a.size, b.size) / Math.max(a.size, b.size) < threshold) continue;
        let overlap = 0;
        for (const token of a) if (b.has(token)) overlap++;
        const score = overlap / (a.size + b.size - overlap);
        if (score < threshold) continue;
        count++;
        if (report.samples.length < 30)
          report.samples.push({
            technology: topic,
            ids: [items[left].id, items[right].id],
            similarity: Number(score.toFixed(3))
          });
      }
    if (count) report.byTechnology[topic] = count;
    report.pairs += count;
  }
  return report;
};
module.exports = { groupCoverageExclusions, nearDuplicateCoverage, coveragePlan };
