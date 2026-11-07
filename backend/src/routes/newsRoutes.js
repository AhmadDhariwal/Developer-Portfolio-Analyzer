const express = require('express');
const {
  getNews,
  getSavedNews,
  saveNews,
  removeSavedNews,
  markSavedNewsAsRead
} = require('../controllers/newsController');
const { protect } = require('../middleware/authmiddleware');

const { feedLimit, mutationLimit, validateFeed } = require('../middleware/newsMiddleware');
const router = express.Router();
router.use(protect);
router.use((_req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  next();
});

router.get('/', feedLimit, validateFeed, getNews);
router.get('/saved', feedLimit, getSavedNews);
router.post('/save', mutationLimit, saveNews);
router.delete('/save/:id', mutationLimit, removeSavedNews);
router.patch('/save/:id/read', mutationLimit, markSavedNewsAsRead);

module.exports = router;
