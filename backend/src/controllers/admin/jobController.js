const Job = require('../../models/Job');
const {
  createJob,
  updateJob,
  closeJob,
  deleteJob,
  listCandidates,
  listOrganizationJobsPage
} = require('../../services/recruiter/matchingService');
const { rankCandidates } = require('../../services/recruiter/aiRankingService');

const getAdminJobs = async (req, res) => {
  try {
    const result = await listOrganizationJobsPage({
      organizationId: req.organizationId,
      page: req.query.page,
      limit: req.query.limit,
      search: req.query.search,
      stack: req.query.stack,
      status: req.query.status,
      employmentType: req.query.employmentType,
      location: req.query.location,
      sortBy: req.query.sortBy,
      sortOrder: req.query.sortOrder
    });

    return res.status(200).json(result);
  } catch (error) {
    if (error.code === 400) {
      return res.status(400).json({ message: error.message });
    }

    console.error('Admin jobs error:', error.message);
    return res.status(500).json({ message: 'Failed to load organization jobs.' });
  }
};

const updateAdminJob = async (req, res) => {
  try {
    const job = await updateJob({
      organizationId: req.organizationId,
      jobId: req.params.id,
      payload: req.body || {}
    });

    if (!job) {
      return res.status(404).json({ message: 'Job not found.' });
    }

    return res.status(200).json({ job });
  } catch (error) {
    if (error.code === 400) {
      return res.status(400).json({ message: error.message });
    }

    console.error('Admin update job error:', error.message);
    return res.status(500).json({ message: 'Failed to update organization job.' });
  }
};

const closeAdminJob = async (req, res) => {
  try {
    const job = await closeJob({
      organizationId: req.organizationId,
      jobId: req.params.id
    });

    if (!job) {
      return res.status(404).json({ message: 'Job not found.' });
    }

    return res.status(200).json({ job });
  } catch (error) {
    if (error.code === 400) {
      return res.status(400).json({ message: error.message });
    }

    console.error('Admin close job error:', error.message);
    return res.status(500).json({ message: 'Failed to close organization job.' });
  }
};

const deleteAdminJob = async (req, res) => {
  try {
    const deleted = await deleteJob({
      organizationId: req.organizationId,
      jobId: req.params.id
    });

    if (!deleted) {
      return res.status(404).json({ message: 'Job not found.' });
    }

    return res.status(200).json({ message: 'Job deleted successfully.' });
  } catch (error) {
    if (error.code === 400) {
      return res.status(400).json({ message: error.message });
    }

    console.error('Admin delete job error:', error.message);
    return res.status(500).json({ message: 'Failed to delete organization job.' });
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
  updateAdminJob,
  closeAdminJob,
  deleteAdminJob,
  aiRankCandidates
};
