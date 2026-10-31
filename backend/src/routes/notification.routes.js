const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authmiddleware');
const { admission } = require('../middleware/notificationAdmission');
const {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
  streamNotifications,
  bulkDeleteNotifications
} = require('../controllers/notificationcontroller');

router.use(protect);
router.get('/', admission('read', 120), getNotifications);
router.get('/stream', admission('connect', 30), streamNotifications);
router.put('/read-all', admission('bulk', 10), markAllNotificationsRead);
router.post('/bulk-delete', admission('bulk', 10), bulkDeleteNotifications);
router.put('/:id/read', admission('mutation', 60), markNotificationRead);
router.delete('/:id', admission('mutation', 60), deleteNotification);

module.exports = router;
