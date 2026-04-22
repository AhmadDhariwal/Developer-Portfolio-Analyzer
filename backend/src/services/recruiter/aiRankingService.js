const { RANKING_FEATURES } = require('../../utils/recruiter/weightConfig');
const { extractCandidateFeatures } = require('../../utils/recruiter/featureExtractor');
const { calculateWeightedScore } = require('../../utils/recruiter/scoringEngine');
const { generateExplanation } = require('../../utils/recruiter/explanationEngine');

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Number(value) || 0));

const normalizeFeatureMatrix = (rows) => {
  const bounds = RANKING_FEATURES.reduce((acc, key) => {
    const values = rows.map((row) => Number(row.features[key]) || 0);
    const min = Math.min(...values);
    const max = Math.max(...values);
    acc[key] = { min, max };
    return acc;
  }, {});

  return rows.map((row) => {
    const normalized = {};

    RANKING_FEATURES.forEach((key) => {
      const { min, max } = bounds[key];
      const raw = Number(row.features[key]) || 0;

      if (max === min) {
        normalized[key] = clamp(raw);
      } else {
        normalized[key] = clamp(((raw - min) / (max - min)) * 100);
      }
    });

    return {
      ...row,
      normalizedFeatures: normalized
    };
  });
};

const rankCandidates = ({ job, candidates = [] }) => {
  if (!job) {
    throw new Error('job is required for AI ranking.');
  }

  const rows = (Array.isArray(candidates) ? candidates : []).map((candidate) => ({
    candidate,
    features: extractCandidateFeatures({ candidate, job, enrichment: candidate.enrichment || {} })
  }));

  if (!rows.length) {
    return {
      rankedCandidates: [],
      meta: {
        totalCandidates: 0,
        jobId: String(job._id || ''),
        generatedAt: new Date().toISOString()
      }
    };
  }

  const normalizedRows = normalizeFeatureMatrix(rows)
    .map((row) => {
      const scoring = calculateWeightedScore(row.normalizedFeatures);
      const explanation = generateExplanation({
        candidate: row.candidate,
        job,
        finalScore: scoring.finalScore,
        features: scoring.normalizedFeatures,
        breakdown: scoring.breakdown
      });

      return {
        candidateId: String(row.candidate.id || row.candidate._id || ''),
        candidate: row.candidate,
        rankScore: scoring.finalScore,
        scoreBreakdown: scoring.breakdown,
        normalizedFeatures: scoring.normalizedFeatures,
        rawFeatures: row.features,
        aiInsight: explanation
      };
    })
    .sort((a, b) => b.rankScore - a.rankScore)
    .map((row, index) => ({
      ...row,
      rank: index + 1
    }));

  return {
    rankedCandidates: normalizedRows,
    meta: {
      totalCandidates: normalizedRows.length,
      jobId: String(job._id || ''),
      generatedAt: new Date().toISOString()
    }
  };
};

module.exports = {
  rankCandidates
};
