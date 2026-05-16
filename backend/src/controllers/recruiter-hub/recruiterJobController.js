const {
  listRecruiterJobs,
  getRecruiterJobDetails,
  createRecruiterJob,
  updateRecruiterJob,
  archiveRecruiterJob,
  deleteRecruiterJob
} = require('../../services/recruiter-hub/recruiterJobService');
const { getRecruiterScope } = require('../../utils/recruiter-hub/recruiterAccess');

const listJobs = async (req, res) => {
  try {
    const scope = await getRecruiterScope(req);
    const jobs = await listRecruiterJobs(scope);
    return res.status(200).json({ jobs });
  } catch (error) {
    console.error('Recruiter hub jobs error:', error.message);
    return res.status(error.statusCode || 500).json({ message: error.message || 'Failed to load jobs.' });
  }
};

const getJobDetails = async (req, res) => {
  try {
    const scope = await getRecruiterScope(req);
    const job = await getRecruiterJobDetails({ ...scope, jobId: req.params.id });
    if (!job) return res.status(404).json({ message: 'Job not found.' });
    return res.status(200).json({ job });
  } catch (error) {
    console.error('Recruiter hub job detail error:', error.message);
    return res.status(error.statusCode || 500).json({ message: error.message || 'Failed to load job details.' });
  }
};

const createJob = async (req, res) => {
  try {
    const scope = await getRecruiterScope(req);
    const job = await createRecruiterJob({ ...scope, payload: req.body || {} });
    return res.status(201).json({ job });
  } catch (error) {
    console.error('Recruiter hub create job error:', error.message);
    return res.status(error.statusCode || 500).json({ message: error.message || 'Failed to create job.' });
  }
};

const updateJob = async (req, res) => {
  try {
    const scope = await getRecruiterScope(req);
    const job = await updateRecruiterJob({ ...scope, jobId: req.params.id, payload: req.body || {} });
    if (!job) return res.status(404).json({ message: 'Job not found.' });
    return res.status(200).json({ job });
  } catch (error) {
    console.error('Recruiter hub update job error:', error.message);
    return res.status(error.statusCode || 500).json({ message: error.message || 'Failed to update job.' });
  }
};

const archiveJob = async (req, res) => {
  try {
    const scope = await getRecruiterScope(req);
    const job = await archiveRecruiterJob({ ...scope, jobId: req.params.id });
    if (!job) return res.status(404).json({ message: 'Job not found.' });
    return res.status(200).json({ job });
  } catch (error) {
    console.error('Recruiter hub archive job error:', error.message);
    return res.status(error.statusCode || 500).json({ message: error.message || 'Failed to archive job.' });
  }
};

const deleteJob = async (req, res) => {
  try {
    const scope = await getRecruiterScope(req);
    const deleted = await deleteRecruiterJob({ ...scope, jobId: req.params.id });
    if (!deleted) return res.status(404).json({ message: 'Job not found.' });
    return res.status(200).json({ message: 'Job deleted successfully.' });
  } catch (error) {
    console.error('Recruiter hub delete job error:', error.message);
    return res.status(error.statusCode || 500).json({ message: error.message || 'Failed to delete job.' });
  }
};

module.exports = {
  listJobs,
  getJobDetails,
  createJob,
  updateJob,
  archiveJob,
  deleteJob
};
