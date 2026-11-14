const supportService = require('../services/support.service');
const mongoose = require('mongoose');
const validFilter = (value, allowed) => !value || allowed.includes(value);
const validId = (value) => mongoose.isValidObjectId(value);

const createTicket = async (req, res) => {
  try {
    const ticket = await supportService.createTicket(req.user, req.body);
    res.status(201).json({ message: 'Support ticket submitted successfully.', ticket });
  } catch (error) {
    const status = error.status || 503;
    if (status === 429 || status === 503) {
      res.set('Retry-After', String(error.retryAfter ?? 30));
    }
    if (status >= 500) console.warn('Support ticket submission failed.', { status });
    res
      .status(status)
      .json({ message: error.status ? error.message : 'Failed to submit support ticket.' });
  }
};

const getMyTickets = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));

    const result = await supportService.getMyTickets(req.user._id, page, limit);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch tickets.' });
  }
};

const getTicketById = async (req, res) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ message: 'Invalid ticket ID.' });
    const ticket = await supportService.getTicketById(req.params.id, req.user._id);
    if (!ticket) return res.status(404).json({ message: 'Ticket not found.' });
    res.json(ticket);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch ticket.' });
  }
};

const deleteTicket = async (req, res) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ message: 'Invalid ticket ID.' });
    const ticket = await supportService.deleteTicket(req.params.id, req.user._id);
    if (!ticket) return res.status(404).json({ message: 'Ticket not found or unauthorized.' });
    res.json({ message: 'Ticket deleted successfully.' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete ticket.' });
  }
};

const getAdminTickets = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));

    const { status, category, priority, startDate, endDate, search, sort } = req.query;
    if (
      !validFilter(status, ['open', 'in_progress', 'resolved', 'closed']) ||
      !validFilter(category, [
        'bug',
        'feature_request',
        'account_issue',
        'billing_issue',
        'general_feedback',
        'other'
      ]) ||
      !validFilter(priority, ['low', 'medium', 'high', 'urgent']) ||
      (startDate && Number.isNaN(Date.parse(startDate))) ||
      (endDate && Number.isNaN(Date.parse(endDate)))
    ) {
      return res.status(400).json({ message: 'Invalid ticket filters.' });
    }
    // search/sort are not validated here: search is sanitized in the service and sort
    // is allow-listed there (unrecognized values coerce to the default), so neither 400s.
    const result = await supportService.getAllTickets(page, limit, {
      status,
      category,
      priority,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      search,
      sort
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch tickets.' });
  }
};

const getAdminTicketById = async (req, res) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ message: 'Invalid ticket ID.' });
    const ticket = await supportService.getAdminTicketById(req.params.id);
    if (!ticket) return res.status(404).json({ message: 'Ticket not found.' });
    res.json(ticket);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch ticket.' });
  }
};

const updateTicketStatus = async (req, res) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ message: 'Invalid ticket ID.' });
    const { status, expectedUpdatedAt } = req.body;
    const ticket = await supportService.updateTicketStatus(
      req.params.id,
      status,
      req.user._id,
      req.user.sessionRevision,
      expectedUpdatedAt
    );
    if (!ticket) return res.status(404).json({ message: 'Ticket not found.' });
    res.json({ message: 'Status updated.', ticket });
  } catch (error) {
    if ([400, 401, 403].includes(error.status))
      return res.status(error.status).json({ message: error.message });
    if (error.status === 409) return res.status(409).json({ message: error.message });
    res.status(500).json({ message: 'Failed to update ticket.' });
  }
};

const addReply = async (req, res) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ message: 'Invalid ticket ID.' });
    const ticket = await supportService.addReply(req.user, req.params.id, req.body.body);
    res.status(201).json({ message: 'Reply added.', ticket });
  } catch (error) {
    if ([400, 401, 403].includes(error.status))
      return res.status(error.status).json({ message: error.message });
    if (error.status === 404) return res.status(404).json({ message: error.message });
    if (error.status === 409) return res.status(409).json({ message: error.message });
    res.status(500).json({ message: 'Failed to add reply.' });
  }
};

const adminAddReply = async (req, res) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ message: 'Invalid ticket ID.' });
    const ticket = await supportService.adminAddReply(req.user, req.params.id, req.body.body);
    res.status(201).json({ message: 'Reply added.', ticket });
  } catch (error) {
    if ([400, 401, 403].includes(error.status))
      return res.status(error.status).json({ message: error.message });
    if (error.status === 404) return res.status(404).json({ message: error.message });
    if (error.status === 409) return res.status(409).json({ message: error.message });
    res.status(500).json({ message: 'Failed to add reply.' });
  }
};

module.exports = {
  createTicket,
  getMyTickets,
  getTicketById,
  deleteTicket,
  getAdminTickets,
  getAdminTicketById,
  updateTicketStatus,
  addReply,
  adminAddReply
};
