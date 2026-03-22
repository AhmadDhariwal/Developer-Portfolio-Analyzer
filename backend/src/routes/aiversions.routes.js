const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authmiddleware');
const {
  listVersions,
  createAiVersion,
  compareVersions,
  rollbackVersion
} = require('../controllers/aiversioncontroller');

router.get('/', protect, listVersions);
router.post('/', protect, createAiVersion);
router.get('/:id/compare/:compareId', protect, compareVersions);
router.post('/:id/rollback', protect, rollbackVersion);

module.exports = router;
