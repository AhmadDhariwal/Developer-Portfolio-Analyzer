const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authmiddleware');
const { getAuditLogs, deleteAuditLog } = require('../controllers/auditLogController');

router.get('/', protect, getAuditLogs);
router.delete('/:id', protect, deleteAuditLog);

module.exports = router;
