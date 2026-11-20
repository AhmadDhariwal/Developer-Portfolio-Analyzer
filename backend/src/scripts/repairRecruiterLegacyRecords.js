'use strict';

/**
 * Non-destructive audit and repair script for historical Recruiter records:
 * 1) Maps legacy Candidate._id references in RecruiterMatch and RecruiterShortlist
 *    to canonical User._id (skipping unique conflicts without deleting records).
 * 2) Repairs stale or missing match scores/breakdowns on existing RecruiterMatch
 *    documents while preserving shortlist/rejection status.
 *
 * Defaults to --dry-run unless --apply is explicitly passed.
 */
const mongoose = require('mongoose');
const Candidate = require('../modules/recruiter/models/Candidate');
const Job = require('../modules/recruiter/models/Job');
const RecruiterMatch = require('../modules/recruiter/models/RecruiterMatch');
const RecruiterShortlist = require('../modules/recruiter/models/RecruiterShortlist');
const { getCandidatesByIds } = require('../modules/recruiter/services/matching/matchingService');
const { generateMatches } = require('../modules/recruiter/utils/hub/matchCalculator');

const numbersDiffer = (left, right, epsilon = 0.01) => {
  if (left == null && right == null) return false;
  if (left == null || right == null) return true;
  return Math.abs(Number(left) - Number(right)) > epsilon;
};

const isMatchStale = (existing, computed) => {
  if (!computed) return false;
  if (numbersDiffer(existing.matchScore, computed.matchScore)) return true;
  if (numbersDiffer(existing.readinessScore, computed.readinessScore)) return true;
  if (numbersDiffer(existing.skillMatchPercent, computed.skillMatchPercent)) return true;
  if (numbersDiffer(existing.githubProjectScore, computed.githubProjectScore)) return true;
  if (numbersDiffer(existing.confidenceScore, computed.confidenceScore)) return true;
  if (String(existing.experienceMatch || '') !== String(computed.experienceMatch || '')) return true;
  if (!existing.breakdown || typeof existing.breakdown !== 'object') return true;
  if (Object.keys(existing.breakdown).length === 0) return true;
  return false;
};

const repairRecruiterLegacyRecords = async ({ apply = false, organizationId = '' } = {}) => {
  const scopeFilter = organizationId ? { organizationId } : {};

  const legacyAliasDocs = await Candidate.find({ userId: { $ne: null } })
    .select('_id userId')
    .lean();
  const aliasToUserId = new Map(
    legacyAliasDocs
      .filter((doc) => doc.userId && String(doc._id) !== String(doc.userId))
      .map((doc) => [String(doc._id), String(doc.userId)])
  );

  const report = {
    apply: Boolean(apply),
    aliasMapSize: aliasToUserId.size,
    shortlistAliasesFound: 0,
    shortlistAliasesRepaired: 0,
    shortlistConflictsSkipped: [],
    matchAliasesFound: 0,
    matchAliasesRepaired: 0,
    matchConflictsSkipped: [],
    staleMatchesFound: 0,
    staleMatchesRepaired: 0,
    missingContextSkipped: []
  };

  if (aliasToUserId.size > 0) {
    const legacyIds = [...aliasToUserId.keys()];

    const legacyShortlists = await RecruiterShortlist.find({
      ...scopeFilter,
      candidateId: { $in: legacyIds }
    }).lean();
    report.shortlistAliasesFound = legacyShortlists.length;

    for (const row of legacyShortlists) {
      const targetCandidateId = aliasToUserId.get(String(row.candidateId));
      if (!targetCandidateId) continue;

      const conflict = await RecruiterShortlist.findOne({
        _id: { $ne: row._id },
        recruiterId: row.recruiterId,
        candidateId: targetCandidateId,
        jobId: row.jobId || null
      })
        .select('_id')
        .lean();

      if (conflict) {
        report.shortlistConflictsSkipped.push({
          shortlistId: String(row._id),
          legacyCandidateId: String(row.candidateId),
          canonicalUserId: targetCandidateId,
          existingCanonicalShortlistId: String(conflict._id)
        });
        continue;
      }

      if (apply) {
        await RecruiterShortlist.updateOne(
          { _id: row._id },
          { $set: { candidateId: targetCandidateId } }
        );
        report.shortlistAliasesRepaired += 1;
      }
    }

    const legacyMatches = await RecruiterMatch.find({
      ...scopeFilter,
      candidateId: { $in: legacyIds }
    }).lean();
    report.matchAliasesFound = legacyMatches.length;

    for (const row of legacyMatches) {
      const targetCandidateId = aliasToUserId.get(String(row.candidateId));
      if (!targetCandidateId) continue;

      const conflict = await RecruiterMatch.findOne({
        _id: { $ne: row._id },
        recruiterId: row.recruiterId,
        jobId: row.jobId,
        candidateId: targetCandidateId
      })
        .select('_id')
        .lean();

      if (conflict) {
        report.matchConflictsSkipped.push({
          matchId: String(row._id),
          legacyCandidateId: String(row.candidateId),
          canonicalUserId: targetCandidateId,
          existingCanonicalMatchId: String(conflict._id)
        });
        continue;
      }

      if (apply) {
        await RecruiterMatch.updateOne(
          { _id: row._id },
          { $set: { candidateId: targetCandidateId } }
        );
        report.matchAliasesRepaired += 1;
      }
    }
  }

  const allMatches = await RecruiterMatch.find(scopeFilter).lean();
  const matchesByOrgAndJob = new Map();

  for (const row of allMatches) {
    const orgKey = String(row.organizationId || '');
    const jobKey = String(row.jobId || '');
    const groupKey = `${orgKey}:${jobKey}`;
    if (!matchesByOrgAndJob.has(groupKey)) {
      matchesByOrgAndJob.set(groupKey, {
        organizationId: orgKey,
        jobId: jobKey,
        rows: []
      });
    }
    matchesByOrgAndJob.get(groupKey).rows.push(row);
  }

  for (const group of matchesByOrgAndJob.values()) {
    const job = await Job.findOne({
      _id: group.jobId,
      organizationId: group.organizationId
    }).lean();

    if (!job) {
      report.missingContextSkipped.push({
        jobId: group.jobId,
        organizationId: group.organizationId,
        reason: 'job_missing'
      });
      continue;
    }

    const rawCandidateIds = [
      ...new Set(group.rows.map((entry) => String(entry.candidateId || '')).filter(Boolean))
    ];
    const resolvedMap = await getCandidatesByIds(rawCandidateIds, {
      organizationId: group.organizationId
    });

    for (const row of group.rows) {
      const candidate = resolvedMap.get(String(row.candidateId || ''));
      if (!candidate) {
        report.missingContextSkipped.push({
          matchId: String(row._id),
          candidateId: String(row.candidateId),
          reason: 'candidate_unavailable_or_private'
        });
        continue;
      }

      const generated = generateMatches({ job, candidates: [candidate] });
      const computed = generated.records?.[0];
      if (!computed || !isMatchStale(row, computed)) continue;

      report.staleMatchesFound += 1;

      if (apply) {
        await RecruiterMatch.updateOne(
          { _id: row._id },
          {
            $set: {
              matchScore: computed.matchScore,
              skillMatchPercent: computed.skillMatchPercent,
              experienceMatch: computed.experienceMatch,
              githubProjectScore: computed.githubProjectScore,
              readinessScore: computed.readinessScore,
              confidenceScore: computed.confidenceScore,
              recommendation: computed.recommendation,
              strengths: computed.strengths,
              weaknesses: computed.weaknesses,
              explanation: computed.explanation,
              breakdown: computed.breakdown
            }
          }
        );
        report.staleMatchesRepaired += 1;
      }
    }
  }

  return report;
};

module.exports = {
  isMatchStale,
  repairRecruiterLegacyRecords
};

if (require.main === module) {
  const apply = process.argv.includes('--apply');
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;

  if (!uri) {
    console.error('MONGODB_URI is required');
    process.exit(1);
  }

  mongoose
    .connect(uri)
    .then(async () => {
      const result = await repairRecruiterLegacyRecords({ apply });
      console.log(JSON.stringify(result, null, 2));
      await mongoose.disconnect();
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

