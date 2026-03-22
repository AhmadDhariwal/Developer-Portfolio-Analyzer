const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authmiddleware');
const {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  streamNotifications
} = require('../controllers/notificationcontroller');

router.get('/', protect, getNotifications);
router.get('/stream', streamNotifications);
router.put('/read-all', protect, markAllNotificationsRead);
router.put('/:id/read', protect, markNotificationRead);

module.exports = router;
