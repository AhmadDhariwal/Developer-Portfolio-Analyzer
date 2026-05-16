const express = require('express');
const { getActivity } = require('../../controllers/recruiter-hub/recruiterActivityController');

const router = express.Router();

router.get('/', getActivity);

module.exports = router;
