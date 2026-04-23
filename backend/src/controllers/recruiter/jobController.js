const {
  createJob,
  updateJob,
  deleteJob,
  listJobs
} = require('../../services/recruiter/matchingService');

const createRecruiterJob = async (req, res) => {
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

    console.error('Create recruiter job error:', error.message);
    return res.status(500).json({ message: 'Failed to create job.' });
  }
};

const updateRecruiterJob = async (req, res) => {
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

    console.error('Update recruiter job error:', error.message);
    return res.status(500).json({ message: 'Failed to update job.' });
  }
};

const deleteRecruiterJob = async (req, res) => {
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

    console.error('Delete recruiter job error:', error.message);
    return res.status(500).json({ message: 'Failed to delete job.' });
  }
};

const getRecruiterJobs = async (req, res) => {
  try {
    const jobs = await listJobs({ organizationId: req.organizationId });
    return res.status(200).json({ jobs });
  } catch (error) {
    if (error.code === 400) {
      return res.status(400).json({ message: error.message });
    }

    console.error('List recruiter jobs error:', error.message);
    return res.status(500).json({ message: 'Failed to load jobs.' });
  }
};

module.exports = {
  createRecruiterJob,
  updateRecruiterJob,
  deleteRecruiterJob,
  getRecruiterJobs
};
