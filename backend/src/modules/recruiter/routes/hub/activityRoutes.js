const express = require('express');
const { getActivity } = require('../../controllers/hub/recruiterActivityController');

const router = express.Router();

router.get('/', getActivity);

module.exports = router;
