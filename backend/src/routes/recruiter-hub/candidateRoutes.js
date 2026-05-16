const express = require('express');
const { listCandidates, getCandidateDetails, analyzeCandidate } = require('../../controllers/recruiter-hub/candidateController');

const router = express.Router();

router.get('/', listCandidates);
router.get('/:id', getCandidateDetails);
router.post('/:id/analyze', analyzeCandidate);

module.exports = router;
