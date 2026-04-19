const express = require('express');
const { getNews } = require('../controllers/newsController');
const { protect } = require('../middleware/authmiddleware');

const router = express.Router();

router.get('/', protect, getNews);

module.exports = router;
