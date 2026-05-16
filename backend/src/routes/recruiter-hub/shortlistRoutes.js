const express = require('express');
const {
  createShortlist,
  getShortlists,
  patchShortlist,
  deleteShortlist
} = require('../../controllers/recruiter-hub/shortlistController');

const router = express.Router();

router.get('/', getShortlists);
router.post('/', createShortlist);
router.patch('/:id', patchShortlist);
router.delete('/:id', deleteShortlist);

module.exports = router;
