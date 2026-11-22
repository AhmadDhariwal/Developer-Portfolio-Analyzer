const express = require('express');
const {
  listJobs,
  getJobDetails,
  createJob,
  updateJob,
  archiveJob,
  deleteJob
} = require('../../controllers/hub/recruiterJobController');

const router = express.Router();
const applications = require('../../../jobs/jobApplicationController');
router.get('/:id/applications', applications.applicants);
router.patch('/:id/applications/:applicationId', applications.status);
router.get('/:id/applications/:applicationId/resume', applications.resume);

router.get('/', listJobs);
router.post('/', createJob);
router.get('/:id', getJobDetails);
router.patch('/:id', updateJob);
router.post('/:id/archive', archiveJob);
router.delete('/:id', deleteJob);

module.exports = router;
