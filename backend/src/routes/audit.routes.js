const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authmiddleware');
const { getAuditLogs } = require('../controllers/auditLogController');

router.get('/', protect, getAuditLogs);

module.exports = router;
