const SupportTicket = require('../models/supportTicket');
const { createNotification } = require('./notificationService');
const { sendConfiguredEmail } = require('./emailService');

// ── Helpers ────────────────────────────────────────────────────────────────────

const CATEGORY_LABELS = {
  bug: 'Bug Report',
  feature_request: 'Feature Request',
  account_issue: 'Account Issue',
  billing_issue: 'Billing Issue',
  general_feedback: 'General Feedback',
  other: 'Other'
};

const PRIORITY_LABELS = { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' };

const PRIORITY_BADGE_COLOR = {
  low: '#22c55e',
  medium: '#eab308',
  high: '#ef4444',
  urgent: '#9333ea'
};

const STATUS_BADGE_COLOR = {
  open: '#3b82f6',
  in_progress: '#f97316',
  resolved: '#22c55e',
  closed: '#6b7280'
};

const escapeHtml = (str) => String(str || '').replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>').replace(/"/g, '"');

const buildSupportEmailHtml = (ticket, user) => {
  const categoryLabel = CATEGORY_LABELS[ticket.category] || ticket.category;
  const priorityLabel = PRIORITY_LABELS[ticket.priority] || ticket.priority;
  const priorityColor = PRIORITY_BADGE_COLOR[ticket.priority] || '#6b7280';
  const statusColor = STATUS_BADGE_COLOR[ticket.status] || '#6b7280';
  const statusLabel = ticket.status.replace('_', ' ');
  const createdDate = ticket.createdAt ? new Date(ticket.createdAt).toISOString().replace('T', ' ').substring(0, 19) + ' UTC' : 'N/A';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Support Ticket — DevInsight AI</title>
</head>
<body style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="580" cellpadding="0" cellspacing="0" style="max-width:580px;width:100%;">

          <!-- Header -->
          <tr>
            <td align="center" style="padding-bottom:24px;">
              <span style="font-size:20px;font-weight:800;color:#818cf8;letter-spacing:-0.5px;">DevInsight AI Support</span>
            </td>
          </tr>

          <!-- Main card -->
          <tr>
            <td style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:32px 28px;">

              <!-- Title row -->
              <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.08em;">New Support Ticket</p>

              <!-- Subject -->
              <h1 style="margin:0 0 20px;font-size:20px;font-weight:700;color:#f1f5f9;line-height:1.35;">
                ${escapeHtml(ticket.subject)}
              </h1>

              <!-- Badges row -->
              <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td style="padding:4px 10px;background:${priorityColor};border-radius:6px;font-size:11px;font-weight:700;color:#ffffff;text-transform:uppercase;letter-spacing:0.05em;">
                    ${escapeHtml(priorityLabel)}
                  </td>
                  <td style="width:8px;"></td>
                  <td style="padding:4px 10px;background:rgba(99,102,241,0.15);border:1px solid rgba(99,102,241,0.25);border-radius:6px;font-size:11px;font-weight:700;color:#818cf8;text-transform:uppercase;letter-spacing:0.05em;">
                    ${escapeHtml(categoryLabel)}
                  </td>
                  <td style="width:8px;"></td>
                  <td style="padding:4px 10px;background:${statusColor};border-radius:6px;font-size:11px;font-weight:700;color:#ffffff;text-transform:uppercase;letter-spacing:0.05em;">
                    ${escapeHtml(statusLabel)}
                  </td>
                </tr>
              </table>

              <!-- Meta info -->
              <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:20px;">
                <tr>
                  <td style="padding:6px 0;font-size:13px;color:#94a3b8;vertical-align:top;width:80px;">From</td>
                  <td style="padding:6px 0;font-size:13px;color:#e2e8f0;font-weight:600;">${escapeHtml(user.name)} <${escapeHtml(user.email)}></td>
                </tr>
                <tr>
                  <td style="padding:6px 0;font-size:13px;color:#94a3b8;vertical-align:top;">Ticket ID</td>
                  <td style="padding:6px 0;font-size:13px;color:#e2e8f0;font-family:monospace;">${escapeHtml(String(ticket._id))}</td>
                </tr>
                <tr>
                  <td style="padding:6px 0;font-size:13px;color:#94a3b8;vertical-align:top;">Date</td>
                  <td style="padding:6px 0;font-size:13px;color:#e2e8f0;">${escapeHtml(createdDate)}</td>
                </tr>
              </table>

              <!-- Message box -->
              <div style="background:#0f172a;border:1px solid #334155;border-radius:8px;padding:16px 18px;margin-bottom:8px;">
                <p style="margin:0;font-size:14px;color:#cbd5e1;line-height:1.7;white-space:pre-wrap;word-break:break-word;">${escapeHtml(ticket.message)}</p>
              </div>

              <p style="margin:8px 0 0;font-size:11px;color:#475569;text-align:right;">
                ${escapeHtml(String(ticket.message || '').length)} characters
              </p>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:20px;">
              <p style="margin:0;font-size:12px;color:#475569;">
                This email was generated automatically from DevInsight AI.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};

const buildSupportEmailText = (ticket, user) => {
  const categoryLabel = CATEGORY_LABELS[ticket.category] || ticket.category;
  const priorityLabel = PRIORITY_LABELS[ticket.priority] || ticket.priority;
  const statusLabel = ticket.status.replace('_', ' ');
  const createdDate = ticket.createdAt ? new Date(ticket.createdAt).toISOString().replace('T', ' ').substring(0, 19) + ' UTC' : 'N/A';

  return `DevInsight AI Support
New Support Ticket

Subject: ${ticket.subject}
Priority: ${priorityLabel}
Category: ${categoryLabel}
Status: ${statusLabel}

From: ${user.name} (${user.email})
Ticket ID: ${ticket._id}
Date: ${createdDate}

Message:
${'-'.repeat(40)}
${ticket.message}
${'-'.repeat(40)}

This email was generated automatically from DevInsight AI.`;
};

// ── Core ────────────────────────────────────────────────────────────────────────

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

  // Send notification email to support inbox (fire-and-forget — never blocks ticket creation)
  const supportEmail = String(process.env.SUPPORT_INBOX_EMAIL || '').trim();
  if (supportEmail) {
    const categoryLabel = CATEGORY_LABELS[ticket.category] || ticket.category;
    const priorityLabel = PRIORITY_LABELS[ticket.priority] || ticket.priority;

    sendConfiguredEmail({
      to: supportEmail,
      subject: `New Support Ticket: [${priorityLabel}] [${categoryLabel}] - ${safeSubject}`,
      html: buildSupportEmailHtml(ticket, user),
      text: buildSupportEmailText(ticket, user)
    }).catch(err => {
      // Sanitize: log only the error message, never the email body or SMTP credentials
      console.warn('Failed to send support notification email:', err.message);
    });
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
