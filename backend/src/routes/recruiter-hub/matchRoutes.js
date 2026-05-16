const express = require('express');
const {
  generateMatches,
  listMatches,
  getMatchDetails,
  patchMatchStatus
} = require('../../controllers/recruiter-hub/matchController');

const router = express.Router();

router.get('/', listMatches);
router.post('/generate', generateMatches);
router.get('/:id', getMatchDetails);
router.patch('/:id/status', patchMatchStatus);

module.exports = router;
