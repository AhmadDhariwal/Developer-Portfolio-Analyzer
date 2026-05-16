const express = require('express');
const {
  listJobs,
  getJobDetails,
  createJob,
  updateJob,
  archiveJob,
  deleteJob
} = require('../../controllers/recruiter-hub/recruiterJobController');

const router = express.Router();

router.get('/', listJobs);
router.post('/', createJob);
router.get('/:id', getJobDetails);
router.patch('/:id', updateJob);
router.post('/:id/archive', archiveJob);
router.delete('/:id', deleteJob);

module.exports = router;
