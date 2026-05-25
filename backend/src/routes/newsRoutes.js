const express = require('express');
const { getNews, getSavedNews, saveNews, removeSavedNews, markSavedNewsAsRead } = require('../controllers/newsController');
const { protect } = require('../middleware/authmiddleware');

const router = express.Router();

router.get('/', protect, getNews);
router.get('/saved', protect, getSavedNews);
router.post('/save', protect, saveNews);
router.delete('/save/:id', protect, removeSavedNews);
router.patch('/save/:id/read', protect, markSavedNewsAsRead);

module.exports = router;
