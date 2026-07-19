const SupportTicket = require('../models/supportTicket');
const SupportTicketQuota = require('../models/supportTicketQuota');
const SupportTicketDedupe = require('../models/supportTicketDedupe');
const crypto = require('node:crypto');
const { createNotification } = require('./notificationService');
const { sendConfiguredEmail } = require('./emailService');
const { isRedisCacheEnabled, getRedisCacheClient } = require('./redisCacheService');

const WINDOW_MS = 10 * 60 * 1000;
const MAX_TICKETS_PER_WINDOW = 5;
const VALID_CATEGORIES = new Set(['bug', 'feature_request', 'account_issue', 'billing_issue', 'general_feedback', 'other']);
const VALID_PRIORITIES = new Set(['low', 'medium', 'high', 'urgent']);
const supportError = (message, status) => Object.assign(new Error(message), { status });
const normalizeText = (value, maxLength, field, required = false) => {
  if (value === undefined || value === null) return required ? (() => { throw supportError(`${field} is required.`, 400); })() : '';
  if (typeof value !== 'string') throw supportError(`Invalid ${field}.`, 400);
  const normalized = value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  if (required && !normalized) throw supportError(`${field} is required.`, 400);
  if (normalized.length > maxLength) throw supportError(`${field} is too long.`, 400);
  return normalized;
};
const reserveMongoQuota = async (userId, now) => {
  const window = Math.floor(now / WINDOW_MS);
  try {
    return Boolean(await SupportTicketQuota.findOneAndUpdate(
      { userId, window, count: { $lt: MAX_TICKETS_PER_WINDOW } },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((window + 2) * WINDOW_MS) } },
      { new: true, upsert: true }
    ).lean());
  } catch (error) {
    if (error?.code === 11000) return false;
    throw error;
  }
};
const reserveMongoDedupe = async (userId, dedupeKey, now) => {
  const id = `${userId}:${dedupeKey}`;
  try {
    return Boolean(await SupportTicketDedupe.findOneAndUpdate(
      { _id: id, $or: [{ expiresAt: { $lte: new Date(now) } }, { expiresAt: { $exists: false } }] },
      { $set: { userId, dedupeKey, expiresAt: new Date(now + WINDOW_MS) } },
      { new: true, upsert: true }
    ).lean());
  } catch (error) {
    if (error?.code === 11000) return false;
    throw error;
  }
};

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
  low: '#15803d',
  medium: '#b45309',
  high: '#b91c1c',
  urgent: '#6d28d9'
};

const STATUS_BADGE_COLOR = {
  open: '#1d4ed8',
  in_progress: '#c2410c',
  resolved: '#15803d',
  closed: '#4b5563'
};

const escapeHtml = (str) => String(str || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const titleCase = (str) => String(str || '')
  .replace(/_/g, ' ')
  .replace(/\b\w/g, char => char.toUpperCase());

const formatHtmlMessage = (str) => escapeHtml(str).replace(/\r?\n/g, '<br />');

const buildSupportEmailHtml = (ticket, user) => {
  const categoryLabel = CATEGORY_LABELS[ticket.category] || ticket.category;
  const priorityLabel = PRIORITY_LABELS[ticket.priority] || ticket.priority;
  const priorityColor = PRIORITY_BADGE_COLOR[ticket.priority] || '#6b7280';
  const statusColor = STATUS_BADGE_COLOR[ticket.status] || '#6b7280';
  const statusLabel = titleCase(ticket.status);
  const createdDate = ticket.createdAt
    ? `${new Date(ticket.createdAt).toISOString().replace('T', ' ').substring(0, 19)} UTC`
    : 'N/A';
  const requesterName = ticket.name || user.name;
  const requesterEmail = ticket.email || user.email;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Support Ticket - DevInsight AI</title>
</head>
<body style="margin:0;padding:0;background:#eef2ff;font-family:Arial,'Segoe UI',sans-serif;color:#111827;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#eef2ff;margin:0;padding:32px 12px;">
    <tr>
      <td align="center">
        <table width="640" cellpadding="0" cellspacing="0" role="presentation" style="width:100%;max-width:640px;border-collapse:separate;border-spacing:0;">
          <tr>
            <td style="background:#24114d;border-radius:12px 12px 0 0;padding:24px 28px;border-bottom:4px solid #8b5cf6;">
              <div style="font-size:20px;font-weight:700;color:#ffffff;line-height:1.2;">DevInsight AI Support</div>
              <div style="margin-top:7px;font-size:13px;color:#e9d5ff;">A new support request needs review.</div>
            </td>
          </tr>
          <tr>
            <td style="background:#ffffff;border:1px solid #c7d2fe;border-top:0;border-radius:0 0 12px 12px;padding:28px;">
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;">
                <tr>
                  <td style="padding:0 0 18px 0;">
                    <h1 style="margin:0 0 10px 0;font-size:24px;line-height:1.25;color:#111827;font-weight:700;">New Support Ticket</h1>
                    <div style="font-size:16px;line-height:1.5;color:#1f2937;font-weight:700;">${escapeHtml(ticket.subject)}</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 0 22px 0;">
                    <span style="display:inline-block;background:${priorityColor};border-radius:999px;padding:5px 11px;font-size:11px;font-weight:700;line-height:1;color:#ffffff;text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(priorityLabel)}</span>
                    <span style="display:inline-block;background:${statusColor};border-radius:999px;padding:5px 11px;margin-left:8px;font-size:11px;font-weight:700;line-height:1;color:#ffffff;text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(statusLabel)}</span>
                  </td>
                </tr>
              </table>

              <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;border:1px solid #c7d2fe;border-radius:8px;margin:0 0 22px 0;background:#f8f7ff;">
                <tr>
                  <td width="50%" style="padding:14px 16px;border-right:1px solid #c7d2fe;border-bottom:1px solid #c7d2fe;vertical-align:top;background:#ffffff;">
                    <div style="font-size:11px;font-weight:700;color:#5b21b6;text-transform:uppercase;letter-spacing:0.04em;">Requester</div>
                    <div style="margin-top:5px;font-size:14px;color:#111827;font-weight:600;line-height:1.4;">${escapeHtml(requesterName)}</div>
                    <div style="margin-top:2px;font-size:13px;color:#374151;line-height:1.4;">${escapeHtml(requesterEmail)}</div>
                  </td>
                  <td width="50%" style="padding:14px 16px;border-bottom:1px solid #c7d2fe;vertical-align:top;background:#ffffff;">
                    <div style="font-size:11px;font-weight:700;color:#5b21b6;text-transform:uppercase;letter-spacing:0.04em;">Category</div>
                    <div style="margin-top:5px;font-size:14px;color:#111827;font-weight:600;line-height:1.4;">${escapeHtml(categoryLabel)}</div>
                  </td>
                </tr>
                <tr>
                  <td width="50%" style="padding:14px 16px;border-right:1px solid #c7d2fe;vertical-align:top;background:#ffffff;">
                    <div style="font-size:11px;font-weight:700;color:#5b21b6;text-transform:uppercase;letter-spacing:0.04em;">Ticket ID</div>
                    <div style="margin-top:5px;font-size:13px;color:#111827;font-family:Consolas,Monaco,monospace;line-height:1.4;">${escapeHtml(String(ticket._id))}</div>
                  </td>
                  <td width="50%" style="padding:14px 16px;vertical-align:top;background:#ffffff;">
                    <div style="font-size:11px;font-weight:700;color:#5b21b6;text-transform:uppercase;letter-spacing:0.04em;">Created</div>
                    <div style="margin-top:5px;font-size:14px;color:#111827;font-weight:600;line-height:1.4;">${escapeHtml(createdDate)}</div>
                  </td>
                </tr>
              </table>

              <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;">
                <tr>
                  <td style="padding:0 0 8px 0;font-size:13px;font-weight:700;color:#111827;">Message</td>
                </tr>
                <tr>
                  <td style="background:#f5f3ff;border:1px solid #a78bfa;border-left:5px solid #6d28d9;border-radius:8px;padding:16px 18px;font-size:14px;line-height:1.65;color:#111827;word-break:break-word;">
                    ${formatHtmlMessage(ticket.message)}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:18px 8px 0 8px;">
              <p style="margin:0;font-size:12px;line-height:1.5;color:#4b5563;">
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
  const statusLabel = titleCase(ticket.status);
  const createdDate = ticket.createdAt
    ? `${new Date(ticket.createdAt).toISOString().replace('T', ' ').substring(0, 19)} UTC`
    : 'N/A';
  const requesterName = ticket.name || user.name;
  const requesterEmail = ticket.email || user.email;

  return `DevInsight AI Support
New Support Ticket

Subject: ${ticket.subject}
Priority: ${priorityLabel}
Status: ${statusLabel}
Category: ${categoryLabel}

Requester: ${requesterName} (${requesterEmail})
Ticket ID: ${ticket._id}
Created: ${createdDate}

Message:
${'-'.repeat(40)}
${ticket.message}
${'-'.repeat(40)}

This email was generated automatically from DevInsight AI.`;
};

const createTicket = async (user, data) => {
  const { category, priority, subject, message, sourcePage, browserInfo } = data;
  if (!VALID_CATEGORIES.has(category)) throw supportError('Invalid category.', 400);
  if (!VALID_PRIORITIES.has(priority)) throw supportError('Invalid priority.', 400);
  const safeSubject = normalizeText(subject, 150, 'subject', true);
  const safeMessage = normalizeText(message, 5000, 'message', true);
  const safeSourcePage = normalizeText(sourcePage, 500, 'sourcePage');
  const safeBrowserInfo = normalizeText(browserInfo, 512, 'browserInfo');
  const dedupeKey = crypto.createHash('sha256')
    .update(`${safeSubject.toLowerCase()}\n${safeMessage.toLowerCase()}`)
    .digest('hex');
  const now = Date.now();
  const dedupeWindow = Math.floor(now / WINDOW_MS);
  const redis = isRedisCacheEnabled() ? getRedisCacheClient() : null;
  const redisDedupeKey = `support:dedupe:${user._id}:${dedupeWindow}:${dedupeKey}`;
  if (redis) {
    try {
      if (await redis.set(redisDedupeKey, '1', { NX: true, PX: WINDOW_MS }) !== 'OK') {
        throw supportError('A similar ticket was recently submitted.', 409);
      }
    } catch (error) {
      if (error?.status) throw error;
      console.warn('Support Redis dedupe unavailable; using Mongo fallback.');
    }
  }
  if (!await reserveMongoDedupe(user._id, dedupeKey, now)) {
    throw supportError('A similar ticket was recently submitted.', 409);
  }
  let ticket;
  try {
    ticket = await SupportTicket.create({
      userId: user._id, name: user.name, email: user.email, category, priority,
      subject: safeSubject, message: safeMessage, sourcePage: safeSourcePage, browserInfo: safeBrowserInfo,
      dedupeKey, dedupeWindow
    });
  } catch (error) {
    if (error?.code === 11000) throw supportError('A similar ticket was recently submitted.', 409);
    throw error;
  }
  const quotaWindow = Math.floor(now / WINDOW_MS);
  let redisAllowed = true;
  if (redis) {
    try {
      const key = `support:rate:${user._id}:${quotaWindow}`;
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, Math.ceil(WINDOW_MS / 1000));
      redisAllowed = count <= MAX_TICKETS_PER_WINDOW;
    } catch {
      console.warn('Support Redis limiter unavailable; using Mongo fallback.');
    }
  }
  if (!redisAllowed || !await reserveMongoQuota(user._id, now)) {
    await SupportTicket.deleteOne({ _id: ticket._id, userId: user._id });
    if (redis) await redis.del(redisDedupeKey).catch(() => undefined);
    await SupportTicketDedupe.deleteOne({ _id: `${user._id}:${dedupeKey}` });
    throw supportError('Too many support requests. Please try again in a few minutes.', 429);
  }

  // Create user notification (fire-and-forget)
  createNotification({
    userId: user._id,
    type: 'info',
    title: 'Support request received',
    message: `Your ticket "${safeSubject}" has been received. Our team will look into it shortly.`,
    dedupeKey: `support-ticket-${ticket._id}`,
    meta: { ticketId: ticket._id }
  }).catch(err => console.warn('Failed to create notification:', err.message));

  // Send notification email to support inbox (fire-and-forget, never blocks ticket creation)
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
      // Sanitize: log only the error message, never the email body or SMTP credentials.
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

const getAllTickets = async (page = 1, limit = 10, filters = {}) => {
  const skip = (page - 1) * limit;
  const query = {};
  if (filters.status) query.status = filters.status;
  if (filters.category) query.category = filters.category;
  if (filters.priority) query.priority = filters.priority;
  if (filters.startDate || filters.endDate) {
    query.createdAt = {};
    if (filters.startDate) query.createdAt.$gte = filters.startDate;
    if (filters.endDate) query.createdAt.$lte = filters.endDate;
  }

  const tickets = await SupportTicket.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();
  
  const total = await SupportTicket.countDocuments(query);

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
