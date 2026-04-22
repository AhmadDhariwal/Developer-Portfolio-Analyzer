const { matchCandidatesToJob } = require('../../services/recruiter/matchingService');
const { rankCandidates } = require('../../services/recruiter/aiRankingService');
const { listCandidates } = require('../../services/recruiter/matchingService');
const Job = require('../../models/Job');

const matchCandidates = async (req, res) => {
  try {
    const { jobId, candidateIds = [] } = req.body || {};

    if (!jobId) {
      return res.status(400).json({ message: 'jobId is required.' });
    }

    const result = await matchCandidatesToJob({
      recruiterId: req.user._id,
      jobId,
      candidateIds
    });

    return res.status(200).json(result);
  } catch (error) {
    if (error.code === 404) {
      return res.status(404).json({ message: error.message });
    }

    console.error('Match candidates error:', error.message);
    return res.status(500).json({ message: 'Failed to match candidates to job.' });
  }
};

const aiRankCandidates = async (req, res) => {
  try {
    const { jobId, job: inlineJob, candidates: inlineCandidates = [], candidateIds = [] } = req.body || {};

    let resolvedJob = inlineJob || null;
    if (!resolvedJob && jobId) {
      resolvedJob = await Job.findOne({ _id: jobId, recruiterId: req.user._id }).lean();
    }

    if (!resolvedJob) {
      return res.status(400).json({ message: 'A valid jobId or job object is required.' });
    }

    let candidates = Array.isArray(inlineCandidates) ? inlineCandidates : [];

    if (!candidates.length) {
      if (Array.isArray(candidateIds) && candidateIds.length) {
        const allCandidates = await listCandidates({ limit: 300 });
        const allowed = new Set(candidateIds.map(String));
        candidates = allCandidates.filter((candidate) => allowed.has(String(candidate.id)));
      } else {
        candidates = await listCandidates({ stack: resolvedJob.stack, limit: 300 });
      }
    }

    const ranked = rankCandidates({
      job: resolvedJob,
      candidates
    });

    return res.status(200).json({
      job: resolvedJob,
      ...ranked
    });
  } catch (error) {
    console.error('AI rank candidates error:', error.message);
    return res.status(500).json({ message: 'Failed to rank candidates.' });
  }
};

module.exports = {
  matchCandidates,
  aiRankCandidates
};
