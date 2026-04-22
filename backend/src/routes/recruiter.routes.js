const express = require('express');
const router = express.Router();
const { protect, authorizeRoles } = require('../middleware/authmiddleware');
const {
	getRecruiterCandidates,
	getRecruiterCandidateById,
	createRecruiterJob,
	updateRecruiterJob,
	deleteRecruiterJob,
	getRecruiterJobs,
	matchCandidates,
	aiRankCandidates
} = require('../controllers/recruiter');

router.use(protect, authorizeRoles('recruiter'));

router.get('/candidates', getRecruiterCandidates);
router.get('/candidate/:id', getRecruiterCandidateById);

router.post('/job', createRecruiterJob);
router.get('/jobs', getRecruiterJobs);
router.put('/job/:id', updateRecruiterJob);
router.delete('/job/:id', deleteRecruiterJob);

router.post('/match', matchCandidates);
router.post('/ai-rank', aiRankCandidates);

module.exports = router;
