const Job = require('../../models/Job');
const {
  createJob,
  listCandidates,
  listOrganizationJobs
} = require('../../services/recruiter/matchingService');
const { rankCandidates } = require('../../services/recruiter/aiRankingService');

const getAdminJobs = async (req, res) => {
  try {
    const jobs = await listOrganizationJobs({
      organizationId: req.organizationId,
      limit: Number(req.query.limit || 200)
    });

    return res.status(200).json({ jobs });
  } catch (error) {
    if (error.code === 400) {
      return res.status(400).json({ message: error.message });
    }

    console.error('Admin jobs error:', error.message);
    return res.status(500).json({ message: 'Failed to load organization jobs.' });
  }
};

const createAdminJob = async (req, res) => {
  try {
    const payload = req.body || {};

    if (!payload.title || !payload.description) {
      return res.status(400).json({ message: 'title and description are required.' });
    }

    const job = await createJob({
      recruiterId: req.user._id,
      organizationId: req.organizationId,
      payload
    });

    return res.status(201).json({ job });
  } catch (error) {
    if (error.code === 400) {
      return res.status(400).json({ message: error.message });
    }

    console.error('Admin create job error:', error.message);
    return res.status(500).json({ message: 'Failed to create organization job.' });
  }
};

const aiRankCandidates = async (req, res) => {
  try {
    const { jobId, candidates: inlineCandidates = [], candidateIds = [] } = req.body || {};

    if (!jobId) {
      return res.status(400).json({ message: 'jobId is required.' });
    }

    const job = await Job.findOne({ _id: jobId, organizationId: req.organizationId }).lean();
    if (!job) {
      return res.status(404).json({ message: 'Job not found in this organization.' });
    }

    let candidates = Array.isArray(inlineCandidates) ? inlineCandidates : [];
    if (!candidates.length) {
      const visibleCandidates = await listCandidates({
        stack: String(job.stack || '').trim(),
        limit: 500
      });

      if (Array.isArray(candidateIds) && candidateIds.length) {
        const selected = new Set(candidateIds.map((id) => String(id).trim()).filter(Boolean));
        candidates = visibleCandidates.filter((candidate) => {
          const candidateId = String(candidate.id || '').trim();
          const userId = String(candidate.userId || '').trim();
          return selected.has(candidateId) || selected.has(userId);
        });
      } else {
        candidates = visibleCandidates;
      }
    }

    const ranked = rankCandidates({ job, candidates });
    return res.status(200).json({
      job,
      ...ranked
    });
  } catch (error) {
    console.error('Admin AI rank error:', error.message);
    return res.status(500).json({ message: 'Failed to rank candidates.' });
  }
};

module.exports = {
  getAdminJobs,
  createAdminJob,
  aiRankCandidates
};
