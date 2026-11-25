const { buildCandidateStages, normalizeSkills, jsTrim } = require('./candidateDiscoveryPipeline');
const { parse } = require('./candidateDiscoveryQuery');

// Existing analytics boundaries, including inclusive score maxima, decimal
// gaps and half-open experience ranges. Do not use MongoDB's bankers $round.
const SCORE_BUCKETS = [
  { label: '90-100', min: 90, max: 100 },
  { label: '80-89', min: 80, max: 89.999 },
  { label: '70-79', min: 70, max: 79.999 },
  { label: '60-69', min: 60, max: 69.999 },
  { label: 'Below 60', min: -Infinity, max: 59.999 }
];
const EXPERIENCE_BUCKETS = [
  { label: '0-2 Years', min: 0, max: 2 },
  { label: '2-5 Years', min: 2, max: 5 },
  { label: '5-8 Years', min: 5, max: 8 },
  { label: '8+ Years', min: 8, max: Infinity }
];
const CARD_POOL_LIMIT = 240;

function selectDemandSkills(jobs) {
  const counts = new Map();
  for (const job of jobs) {
    for (const skill of [...(job.requiredSkills || []), ...(job.preferredSkills || [])]) {
      const label = String(skill || '').trim();
      if (label) counts.set(label, (counts.get(label) || 0) + 1);
    }
  }
  return [...counts].sort((left, right) => right[1] - left[1]).slice(0, 6);
}

function buildAnalyticsPipeline(visibility, demand = []) {
  const labels = demand.map(([label]) => label);
  const summary = { _id: null, total: { $sum: 1 }, scoreSum: { $sum: '$analyticsScore' } };
  for (const [prefix, buckets, field, upper] of [
    ['score', SCORE_BUCKETS, '$analyticsScore', '$lte'],
    ['experience', EXPERIENCE_BUCKETS, '$experience', '$lt']
  ])
    buckets.forEach((bucket, index) => {
      summary[`${prefix}${index}`] = {
        $sum: {
          $cond: [{ $and: [{ $gte: [field, bucket.min] }, { [upper]: [field, bucket.max] }] }, 1, 0]
        }
      };
    });
  return [
    ...buildCandidateStages(visibility, parse({})),
    {
      $project: {
        _id: 1,
        readiness: { $ifNull: ['$readiness', 0] },
        experience: 1,
        stack: jsTrim('$stack'),
        // Preserve Number(readinessScore || score || 0), including zero fallback.
        analyticsScore: { $cond: [{ $ifNull: ['$readiness', false] }, '$readiness', '$score'] },
        skills: normalizeSkills(
          {
            $concatArrays: [
              '$_resumeSkills',
              { $map: { input: { $ifNull: ['$_p.skills', []] }, as: 'skill', in: '$$skill.name' } },
              { $ifNull: ['$_c.skills', []] }
            ]
          },
          true
        )
      }
    },
    // Same encounter order as discovery score-desc. Group ties and zero-demand
    // skill selection retain the old JavaScript Map insertion-order behavior.
    { $sort: { readiness: -1, _id: 1 } },
    {
      $facet: {
        summary: [{ $group: summary }],
        stacks: [
          { $match: { stack: { $ne: '' } } },
          {
            $group: {
              _id: '$stack',
              count: { $sum: 1 },
              firstReadiness: { $first: '$readiness' },
              firstId: { $first: '$_id' }
            }
          },
          { $sort: { count: -1, firstReadiness: -1, firstId: 1 } },
          { $limit: 6 },
          { $project: { _id: 0, label: '$_id', count: 1 } }
        ],
        supply: [
          { $unwind: { path: '$skills', includeArrayIndex: 'skillIndex' } },
          ...(labels.length === 6 ? [{ $match: { skills: { $in: labels } } }] : []),
          {
            $group: {
              _id: '$skills',
              count: { $sum: 1 },
              firstReadiness: { $first: '$readiness' },
              firstId: { $first: '$_id' },
              firstSkill: { $first: '$skillIndex' }
            }
          },
          { $set: { demandIndex: { $indexOfArray: [{ $literal: labels }, '$_id'] } } },
          { $set: { priority: { $cond: [{ $gte: ['$demandIndex', 0] }, '$demandIndex', 6] } } },
          { $sort: { priority: 1, firstReadiness: -1, firstId: 1, firstSkill: 1 } },
          { $limit: 6 },
          { $project: { _id: 0, label: '$_id', count: 1 } }
        ],
        sample: [{ $limit: CARD_POOL_LIMIT }, { $project: { _id: 1 } }]
      }
    }
  ];
}

function formatPopulation(result, demand = []) {
  const summary = result?.summary?.[0] || {};
  const total = summary.total || 0;
  const supply = new Map((result?.supply || []).map((row) => [row.label, row.count]));
  const demandCounts = new Map(demand);
  const labels = [...new Set([...demandCounts.keys(), ...supply.keys()])].slice(0, 6);
  return {
    total,
    avgCandidateScore: total ? Math.round((summary.scoreSum / total) * 10) / 10 : 0,
    scoreDistribution: SCORE_BUCKETS.map((bucket, index) => ({
      ...bucket,
      count: summary[`score${index}`] || 0
    })),
    experienceDistribution: EXPERIENCE_BUCKETS.map((bucket, index) => ({
      ...bucket,
      count: summary[`experience${index}`] || 0
    })),
    candidatesByStack: result?.stacks || [],
    supplyVsDemand: labels.map((label) => ({
      label,
      supply: supply.get(label) || 0,
      demand: demandCounts.get(label) || 0
    }))
  };
}

module.exports = { buildAnalyticsPipeline, formatPopulation, selectDemandSkills, CARD_POOL_LIMIT };
