const mongoose = require('mongoose');
const AIVersion = require('../models/aiVersion');
const { numeric } = require('./scoring/math');

function comparableHistory(rows, identity, ruleVersion) {
  if (!ruleVersion) return [];
  const seen = new Set();
  return rows
    .filter((row) => {
      const meta = row.provenance || {};
      if (
        meta.producer !== 'portfolio-score-v1' ||
        meta.ruleVersion !== ruleVersion ||
        !/^[a-f0-9]{64}$/.test(meta.sourceRevisionHash || '') ||
        !/^[a-f0-9]{64}$/.test(meta.assessmentHash || '') ||
        !Number.isFinite(new Date(meta.assessedAt).getTime())
      )
        return false;
      const score = row.outputJson?.portfolioScore || row.outputJson;
      return (
        meta.githubUsername?.toLowerCase() === identity.githubUsername.toLowerCase() &&
        meta.careerStack === identity.careerStack &&
        meta.experienceLevel === identity.experienceLevel &&
        meta.resumeAnalysisId === identity.resumeAnalysisId &&
        score?.scoring?.ruleVersion === ruleVersion &&
        numeric(score.overallScore) !== null &&
        numeric(score.overallScore) >= 0 &&
        numeric(score.overallScore) <= 100 &&
        Number.isFinite(new Date(row.createdAt).getTime())
      );
    })
    .sort(
      (a, b) =>
        new Date(a.provenance.assessedAt) - new Date(b.provenance.assessedAt) ||
        String(a._id).localeCompare(String(b._id)),
    )
    .filter((row) => {
      const key = row.provenance.assessmentHash;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((row) => ({
      at: new Date(row.provenance.assessedAt).toISOString(),
      value: numeric((row.outputJson.portfolioScore || row.outputJson).overallScore),
    }));
}

async function loadReadinessHistory(userId, identity, ruleVersion, asOf) {
  if (!ruleVersion)
    return {
      status: 'missing',
      points: [],
      reason: 'Current portfolio has no scoring-rule provenance.',
    };
  try {
    // Existing (userId, source, version) index bounds work to 32 records per source.
    // Filter scope in application only after this bound, never scan all durable history.
    const owner = mongoose.isValidObjectId(userId)
      ? new mongoose.Types.ObjectId(String(userId))
      : userId;
    const rows = await AIVersion.aggregate([
      { $match: { userId: owner, source: 'portfolio_score' } },
      { $sort: { version: -1 } },
      { $limit: 32 },
      // Never transfer arbitrary user-authored archive output to Dashboard memory.
      {
        $project: {
          createdAt: 1,
          provenance: 1,
          outputJson: {
            $cond: [
              { $isNumber: '$outputJson.overallScore' },
              {
                overallScore: '$outputJson.overallScore',
                scoring: {
                  ruleVersion: {
                    $substrCP: [
                      {
                        $convert: {
                          input: '$outputJson.scoring.ruleVersion',
                          to: 'string',
                          onError: '',
                          onNull: '',
                        },
                      },
                      0,
                      80,
                    ],
                  },
                },
              },
              null,
            ],
          },
        },
      },
    ]).option({ maxTimeMS: 1500, allowDiskUse: false });
    const points = comparableHistory(
      rows.filter(
        (row) => new Date(row.createdAt) <= asOf && new Date(row.provenance?.assessedAt) <= asOf,
      ),
      identity,
      ruleVersion,
    );
    return {
      status: points.length >= 2 ? 'available' : 'missing',
      points,
      reason:
        points.length >= 2
          ? 'Trusted portfolio assessments with the same profile, selected resume and scoring rule; latest 32 versions per source, without the integration blend.'
          : 'Fewer than two trusted, comparable portfolio assessments. Legacy or user-authored archives do not establish a readiness trend.',
    };
  } catch {
    return {
      status: 'unavailable',
      points: [],
      reason: 'Durable history could not be read within its query budget.',
    };
  }
}
module.exports = { comparableHistory, loadReadinessHistory };
