const express = require('express');
const router = express.Router();
const { protect, authorizeRoles } = require('../middleware/authmiddleware');
const supportController = require('../controllers/support.controller');

// In-memory rate limiting & deduplication
const rateLimits = new Map();

const rateLimitAndDedupe = (req, res, next) => {
  const userId = String(req.user._id);
  const now = Date.now();
  const windowMs = 10 * 60 * 1000; // 10 minutes

  if (!rateLimits.has(userId)) {
    rateLimits.set(userId, { count: 0, firstRequest: now, lastSubjects: [] });
  }

  const userStats = rateLimits.get(userId);

  // Reset window if it passed
  if (now - userStats.firstRequest > windowMs) {
    userStats.count = 0;
    userStats.firstRequest = now;
    userStats.lastSubjects = [];
  }

  if (userStats.count >= 5) {
    return res.status(429).json({ message: 'Rate limit exceeded. Please wait before submitting another ticket.' });
  }

  // Deduplication check
  const subjectKey = String(req.body.subject || '').trim().toLowerCase();
  const messageKey = String(req.body.message || '').trim().toLowerCase();
  const isDuplicate = userStats.lastSubjects.some(t => t.subject === subjectKey && t.message === messageKey);

  if (isDuplicate) {
    return res.status(409).json({ message: 'A similar ticket was recently submitted.' });
  }

  userStats.count += 1;
  userStats.lastSubjects.push({ subject: subjectKey, message: messageKey });
  
  next();
};

// User endpoints
router.post('/tickets', protect, rateLimitAndDedupe, supportController.createTicket);
router.get('/my-tickets', protect, supportController.getMyTickets);
router.get('/tickets/:id', protect, supportController.getTicketById);
router.delete('/tickets/:id', protect, supportController.deleteTicket);

// Admin endpoints
router.get('/admin/tickets', protect, authorizeRoles('admin', 'super_admin'), supportController.getAdminTickets);
router.put('/admin/tickets/:id/status', protect, authorizeRoles('admin', 'super_admin'), supportController.updateTicketStatus);

module.exports = router;
