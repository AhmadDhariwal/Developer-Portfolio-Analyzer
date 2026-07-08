const express = require('express');
const router = express.Router();
const { protect, authorizeRoles } = require('../middleware/authmiddleware');
const SupportTicket = require('../models/supportTicket');
const { createNotification } = require('../services/notificationService');
const { getTransporter } = require('../services/emailService');

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

// POST /api/support/tickets
router.post('/tickets', protect, rateLimitAndDedupe, async (req, res) => {
  try {
    const { category, priority, subject, message, sourcePage, browserInfo } = req.body;

    // Sanitize and validate
    const safeSubject = String(subject || '').trim().substring(0, 150);
    const safeMessage = String(message || '').trim().substring(0, 5000);

    const ticket = await SupportTicket.create({
      userId: req.user._id,
      name: req.user.name,
      email: req.user.email,
      category,
      priority,
      subject: safeSubject,
      message: safeMessage,
      sourcePage,
      browserInfo
    });

    // Create user notification
    await createNotification({
      userId: req.user._id,
      type: 'info',
      title: 'Support request received',
      message: `Your ticket "${safeSubject}" has been received. Our team will look into it shortly.`,
      dedupeKey: `support-ticket-${ticket._id}`,
      meta: { ticketId: ticket._id }
    });

    // Send email optionally
    const supportEmail = String(process.env.SUPPORT_INBOX_EMAIL || '').trim();
    if (supportEmail) {
      try {
        const tx = getTransporter();
        if (tx) {
          await tx.sendMail({
            from: String(process.env.EMAIL_USER || '').trim(),
            to: supportEmail,
            subject: `[Support Ticket] ${safeSubject}`,
            text: `New support ticket from ${req.user.name} (${req.user.email}).\n\nCategory: ${category}\nPriority: ${priority}\n\nMessage:\n${safeMessage}\n\nTicket ID: ${ticket._id}`,
          });
        }
      } catch (err) {
        console.warn('Failed to send support email:', err.message);
      }
    }

    res.status(201).json({ message: 'Support ticket submitted successfully.', ticket });
  } catch (error) {
    console.error('Error creating support ticket:', error);
    res.status(400).json({ message: 'Failed to submit support ticket.' });
  }
});

// GET /api/support/my-tickets
router.get('/my-tickets', protect, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
    const skip = (page - 1) * limit;

    const tickets = await SupportTicket.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
    
    const total = await SupportTicket.countDocuments({ userId: req.user._id });

    res.json({
      tickets,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch tickets.' });
  }
});

// GET /api/support/tickets/:id
router.get('/tickets/:id', protect, async (req, res) => {
  try {
    const ticket = await SupportTicket.findOne({ _id: req.params.id, userId: req.user._id }).lean();
    if (!ticket) return res.status(404).json({ message: 'Ticket not found.' });
    res.json(ticket);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch ticket.' });
  }
});

// Admin endpoints
router.get('/admin/tickets', protect, authorizeRoles('admin', 'super_admin'), async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
    const skip = (page - 1) * limit;

    const tickets = await SupportTicket.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
    
    const total = await SupportTicket.countDocuments();

    res.json({
      tickets,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch tickets.' });
  }
});

router.put('/admin/tickets/:id/status', protect, authorizeRoles('admin', 'super_admin'), async (req, res) => {
  try {
    const { status } = req.body;
    if (!['open', 'in_progress', 'resolved', 'closed'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status.' });
    }
    const ticket = await SupportTicket.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!ticket) return res.status(404).json({ message: 'Ticket not found.' });
    res.json({ message: 'Status updated.', ticket });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update ticket.' });
  }
});

module.exports = router;
