const SupportTicket = require('../models/supportTicket');
const { createNotification } = require('./notificationService');
const { getTransporter } = require('./emailService');

const createTicket = async (user, data) => {
  const { category, priority, subject, message, sourcePage, browserInfo } = data;

  // Sanitize and validate
  const safeSubject = String(subject || '').trim().substring(0, 150);
  const safeMessage = String(message || '').trim().substring(0, 5000);

  const ticket = await SupportTicket.create({
    userId: user._id,
    name: user.name,
    email: user.email,
    category,
    priority,
    subject: safeSubject,
    message: safeMessage,
    sourcePage,
    browserInfo
  });

  // Create user notification (fire-and-forget)
  createNotification({
    userId: user._id,
    type: 'info',
    title: 'Support request received',
    message: `Your ticket "${safeSubject}" has been received. Our team will look into it shortly.`,
    dedupeKey: `support-ticket-${ticket._id}`,
    meta: { ticketId: ticket._id }
  }).catch(err => console.warn('Failed to create notification:', err.message));

  // Send email optionally in the background (fire-and-forget)
  const supportEmail = String(process.env.SUPPORT_INBOX_EMAIL || process.env.EMAIL_USER || '').trim();
  if (supportEmail) {
    const tx = getTransporter();
    if (tx) {
      tx.sendMail({
        from: String(process.env.EMAIL_USER || '').trim(),
        to: supportEmail,
        subject: `[Support Ticket] ${safeSubject}`,
        text: `New support ticket from ${user.name} (${user.email}).\n\nCategory: ${category}\nPriority: ${priority}\n\nSubject: ${safeSubject}\nMessage:\n${safeMessage}\n\nSource Page: ${sourcePage || 'N/A'}\nBrowser/Device: ${browserInfo || 'N/A'}\nTicket ID: ${ticket._id}\nCreated Date: ${ticket.createdAt}`,
      }).catch(err => {
        console.warn('Failed to send support email asynchronously:', err.message);
      });
    }
  }

  return ticket;
};

const getMyTickets = async (userId, page = 1, limit = 10) => {
  const skip = (page - 1) * limit;

  const tickets = await SupportTicket.find({ userId })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();
  
  const total = await SupportTicket.countDocuments({ userId });

  return {
    tickets,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    }
  };
};

const getTicketById = async (ticketId, userId) => {
  return await SupportTicket.findOne({ _id: ticketId, userId }).lean();
};

const deleteTicket = async (ticketId, userId) => {
  return await SupportTicket.findOneAndDelete({ _id: ticketId, userId });
};

const getAllTickets = async (page = 1, limit = 10) => {
  const skip = (page - 1) * limit;

  const tickets = await SupportTicket.find()
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();
  
  const total = await SupportTicket.countDocuments();

  return {
    tickets,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    }
  };
};

const updateTicketStatus = async (ticketId, status) => {
  if (!['open', 'in_progress', 'resolved', 'closed'].includes(status)) {
    throw new Error('Invalid status.');
  }
  return await SupportTicket.findByIdAndUpdate(ticketId, { status }, { new: true });
};

module.exports = {
  createTicket,
  getMyTickets,
  getTicketById,
  deleteTicket,
  getAllTickets,
  updateTicketStatus
};
